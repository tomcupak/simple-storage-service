import { Injectable, Logger } from '@nestjs/common'
import * as crypto from 'crypto'
import * as fs from 'fs'
import * as path from 'path'
import { Readable } from 'stream'
import { pipeline } from 'stream/promises'

import { StorageCipher } from './storage.cipher'
import { StorageTypes } from './storage.types'

/** Filesystem-backed blob store. Metadata (buckets, keys, versions) lives in Postgres;
 *  this service only owns opaque byte blobs addressed by their generated storage path.
 *
 *  Layout: `<dataPath>/<aa>/<bb>/<uuid>` - the two nibble directories keep a single
 *  directory from collecting millions of entries. */
@Injectable()
export class StorageService {
	private logger = new Logger(StorageService.name)
	private cipher: StorageCipher

	constructor(
		private config: StorageConfig,
	) {
		this.cipher = new StorageCipher(config.encryption)
	}

	async onApplicationBootstrap() {
		await fs.promises.mkdir(this.config.dataPath, { recursive: true })
		this.logger.log(`Object data path: ${path.resolve(this.config.dataPath)}`)
		this.logger.log(this.cipher.enabled
			? 'Server-side encryption at rest: AES256'
			: 'Server-side encryption at rest: off')
	}

	/** Readiness probe for the blob store: the data root must exist and accept a write.
	 *  A read-only mount or a full volume passes `stat` and fails every upload, so this writes
	 *  a throwaway file rather than only looking. */
	async assertWritable(): Promise<void> {
		const probePath = path.resolve(this.config.dataPath, `.probe-${crypto.randomUUID()}`)

		try {
			await fs.promises.writeFile(probePath, '')
		} finally {
			await fs.promises.rm(probePath, { force: true }).catch(() => undefined)
		}
	}

	/** Streams a payload to disk, computing size and MD5 (the S3 ETag) on the way through.
	 *
	 *  Both are taken from the plaintext, before the cipher stage: the ETag a client compares
	 *  against is the MD5 of what it uploaded, not of what happens to sit on the disk. */
	async write(source: Readable, options?: StorageTypes.WriteOptions): Promise<StorageTypes.WriteResult> {
		const storagePath = this.generateStoragePath()
		const absolutePath = this.toAbsolute(storagePath)
		await fs.promises.mkdir(path.dirname(absolutePath), { recursive: true })

		const hash = crypto.createHash('md5')
		let size = 0
		let tooLarge = false

		source.on('data', (chunk: Buffer) => {
			hash.update(chunk)
			size += chunk.length

			// Destroying the source ends the pipeline, which is what stops the write; the flag
			// is what tells the rejection below apart from a client that simply hung up.
			if (options?.maxBytes !== undefined && size > options.maxBytes && !tooLarge) {
				tooLarge = true
				source.destroy(new StorageTypes.PayloadTooLargeError())
			}
		})

		const blobKey = this.cipher.enabled ? this.cipher.createKey() : undefined

		try {
			const target = fs.createWriteStream(absolutePath)
			await (blobKey
				? pipeline(source, this.cipher.encryptStream(blobKey), target)
				: pipeline(source, target))
		} catch (err) {
			await this.delete(storagePath).catch(() => undefined)
			throw tooLarge ? new StorageTypes.PayloadTooLargeError() : err
		}

		return { storagePath, size, etag: hash.digest('hex'), encryption: blobKey?.descriptor }
	}

	/** Opens a stored payload, optionally a byte range of it.
	 *
	 *  Ranges are offsets into the plaintext. An encrypted blob is read from the start of the
	 *  cipher block the range falls in and the surplus bytes are dropped after decryption, so
	 *  the work stays proportional to the range rather than to the object. */
	async read(storagePath: string, options?: StorageTypes.ReadOptions): Promise<StorageTypes.ReadResult> {
		const absolutePath = this.toAbsolute(storagePath)
		const stat = await this.statOrNull(absolutePath)
		if (!stat) throw new StorageTypes.BlobNotFoundError(storagePath)

		const range = options?.range
		const size = range ? range.end - range.start + 1 : stat.size

		if (!options?.encryption) {
			const stream = range
				? fs.createReadStream(absolutePath, { start: range.start, end: range.end })
				: fs.createReadStream(absolutePath)

			return { stream, size }
		}

		const blobKey = this.cipher.openKey(options.encryption)
		const { stages, alignedOffset } = this.cipher.decryptStages(blobKey, range?.start ?? 0)

		// A stream cipher does not change the length, so the plaintext range maps onto the same
		// byte range of the file; only its start is pulled back to a block boundary, and the
		// surplus that creates is what the skip stage drops. The end needs no correction, which
		// is why the piped output is already exactly `size` bytes long.
		const source = fs.createReadStream(absolutePath, range
			? { start: alignedOffset, end: range.end }
			: undefined)

		return { stream: stages.reduce<Readable>((stream, stage) => stream.pipe(stage), source), size }
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
	 *  The caller stays responsible for deleting the part blobs afterwards.
	 *
	 *  Each part is decrypted with its own key and the result re-encrypted under a new one:
	 *  the parts were written at different times, possibly under a different setting, and the
	 *  finished object has to be one blob with one key. */
	async concat(sources: StorageTypes.ConcatSource[]): Promise<StorageTypes.WriteResult> {
		const targetPath = this.generateStoragePath()
		const absoluteTarget = this.toAbsolute(targetPath)
		await fs.promises.mkdir(path.dirname(absoluteTarget), { recursive: true })

		const blobKey = this.cipher.enabled ? this.cipher.createKey() : undefined
		const target = fs.createWriteStream(absoluteTarget)
		// One cipher stage for the whole output: restarting it per part would reuse the
		// keystream from byte zero for every one of them.
		const encryptStage = blobKey ? this.cipher.encryptStream(blobKey) : undefined
		const sink = encryptStage ?? target
		const written = encryptStage ? pipeline(encryptStage, target) : undefined

		const hash = crypto.createHash('md5')
		let size = 0

		try {
			for (const source of sources) {
				const plain = (await this.read(source.storagePath, { encryption: source.encryption })).stream
				plain.on('data', (chunk: Buffer) => {
					hash.update(chunk)
					size += chunk.length
				})
				await pipeline(plain, sink, { end: false })
			}
			sink.end()
			await written
		} catch (err) {
			sink.destroy()
			target.destroy()
			await this.delete(targetPath).catch(() => undefined)
			throw err
		}

		return { storagePath: targetPath, size, etag: hash.digest('hex'), encryption: blobKey?.descriptor }
	}

	/** Every blob currently on disk, with the time it was last written.
	 *
	 *  This is what lets the collector tell a blob no row points at from one that is simply
	 *  new: a payload is written before its version row is committed, so a blob younger than
	 *  the collector's safety margin may well be an upload still in flight.
	 *
	 *  Yielded one at a time rather than collected into an array - a data root holds as many
	 *  blobs as the deployment holds object versions. */
	async *listBlobs(): AsyncGenerator<StorageTypes.BlobEntry> {
		const root = path.resolve(this.config.dataPath)

		for (const first of await this.readDirNames(root)) {
			for (const second of await this.readDirNames(path.join(root, first))) {
				const directory = path.join(root, first, second)

				for (const name of await this.readDirNames(directory)) {
					const stat = await this.statOrNull(path.join(directory, name))
					if (!stat?.isFile()) continue

					yield { storagePath: path.join(first, second, name), modifiedAt: stat.mtime, size: stat.size }
				}
			}
		}
	}

	/** Directory entries, or nothing at all: a data root that is still empty, or a shard
	 *  directory removed between two steps of the walk, is not a failure of the walk. */
	private async readDirNames(directory: string): Promise<string[]> {
		try {
			return await fs.promises.readdir(directory)
		} catch {
			return []
		}
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
	encryption: StorageTypes.EncryptionConfig
}
