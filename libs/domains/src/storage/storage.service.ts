import { Injectable, Logger } from '@nestjs/common'
import * as crypto from 'crypto'
import * as fs from 'fs'
import * as path from 'path'
import { Readable } from 'stream'
import { pipeline } from 'stream/promises'

import { StorageTypes } from './storage.types'

/** Filesystem-backed blob store. Metadata (buckets, keys, versions) lives in Postgres;
 *  this service only owns opaque byte blobs addressed by their generated storage path.
 *
 *  Layout: `<dataPath>/<aa>/<bb>/<uuid>` - the two nibble directories keep a single
 *  directory from collecting millions of entries. */
@Injectable()
export class StorageService {
	private logger = new Logger(StorageService.name)

	constructor(
		private config: StorageConfig,
	) {}

	async onApplicationBootstrap() {
		await fs.promises.mkdir(this.config.dataPath, { recursive: true })
		this.logger.log(`Object data path: ${path.resolve(this.config.dataPath)}`)
	}

	/** Streams a payload to disk, computing size and MD5 (the S3 ETag) on the way through. */
	async write(source: Readable): Promise<StorageTypes.WriteResult> {
		const storagePath = this.generateStoragePath()
		const absolutePath = this.toAbsolute(storagePath)
		await fs.promises.mkdir(path.dirname(absolutePath), { recursive: true })

		const hash = crypto.createHash('md5')
		let size = 0

		source.on('data', (chunk: Buffer) => {
			hash.update(chunk)
			size += chunk.length
		})

		try {
			await pipeline(source, fs.createWriteStream(absolutePath))
		} catch (err) {
			await this.delete(storagePath).catch(() => undefined)
			throw err
		}

		return { storagePath, size, etag: hash.digest('hex') }
	}

	async read(storagePath: string, range?: StorageTypes.ReadRange): Promise<StorageTypes.ReadResult> {
		const absolutePath = this.toAbsolute(storagePath)
		const stat = await this.statOrNull(absolutePath)
		if (!stat) throw new StorageTypes.BlobNotFoundError(storagePath)

		if (range) {
			return {
				stream: fs.createReadStream(absolutePath, { start: range.start, end: range.end }),
				size: range.end - range.start + 1,
			}
		}
		return { stream: fs.createReadStream(absolutePath), size: stat.size }
	}

	async delete(storagePath: string): Promise<void> {
		await fs.promises.rm(this.toAbsolute(storagePath), { force: true })
	}

	async size(storagePath: string): Promise<number> {
		const stat = await this.statOrNull(this.toAbsolute(storagePath))
		if (!stat) throw new StorageTypes.BlobNotFoundError(storagePath)
		return stat.size
	}

	/** Concatenates multipart parts into a single blob and returns the combined result.
	 *  The caller stays responsible for deleting the part blobs afterwards. */
	async concat(storagePaths: string[]): Promise<StorageTypes.WriteResult> {
		const targetPath = this.generateStoragePath()
		const absoluteTarget = this.toAbsolute(targetPath)
		await fs.promises.mkdir(path.dirname(absoluteTarget), { recursive: true })

		const target = fs.createWriteStream(absoluteTarget)
		const hash = crypto.createHash('md5')
		let size = 0

		try {
			for (const storagePath of storagePaths) {
				const source = fs.createReadStream(this.toAbsolute(storagePath))
				source.on('data', (chunk: Buffer) => {
					hash.update(chunk)
					size += chunk.length
				})
				await pipeline(source, target, { end: false })
			}
			target.end()
		} catch (err) {
			target.destroy()
			await this.delete(targetPath).catch(() => undefined)
			throw err
		}

		return { storagePath: targetPath, size, etag: hash.digest('hex') }
	}

	private async statOrNull(absolutePath: string): Promise<fs.Stats | null> {
		try {
			return await fs.promises.stat(absolutePath)
		} catch {
			return null
		}
	}

	private generateStoragePath(): string {
		const guid = crypto.randomUUID()
		return path.join(guid.slice(0, 2), guid.slice(2, 4), guid)
	}

	private toAbsolute(storagePath: string): string {
		const absolutePath = path.resolve(this.config.dataPath, storagePath)
		const root = path.resolve(this.config.dataPath)
		// Guards against a storagePath from the DB escaping the data root via `..`
		if (!absolutePath.startsWith(root + path.sep)) throw new Error('Storage path outside of data root')
		return absolutePath
	}
}

export interface StorageConfig {
	dataPath: string
}
