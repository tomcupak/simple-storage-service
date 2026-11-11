import { Injectable } from '@nestjs/common'
import { Readable } from 'stream'

import { sharp } from './thumbnails.sharp'
import { ThumbnailsTypes } from './thumbnails.types'

/** Renders WebP thumbnails from image payloads. It only transforms a stream it is handed: the
 *  caller resolves the object and opens the blob, so this service never touches the
 *  filesystem or the database. */
@Injectable()
export class ThumbnailsService {
	constructor(private readonly config: ThumbnailsTypes.Config) {}

	/** Cheap pre-check on the declared content type, falling back to the key's extension when the
	 *  type says nothing (missing or octet-stream). Not the real gate: `render` sniffs the bytes. */
	isSupported(contentType: string | null | undefined, key?: string): boolean {
		const type = this.normalize(contentType)
		if (ThumbnailsTypes.SUPPORTED_CONTENT_TYPES.includes(type)) return true
		if (!ThumbnailsTypes.GENERIC_CONTENT_TYPES.includes(type) || !key) return false

		const dot = key.lastIndexOf('.')
		return dot >= 0 && ThumbnailsTypes.SUPPORTED_EXTENSIONS.includes(key.slice(dot + 1).toLowerCase())
	}

	/** Whether an `If-None-Match` header names the ETag: a list is allowed and `W/` is ignored
	 *  (a weak comparison is what a conditional GET uses). */
	matchesEtag(header: string | undefined, etag: string): boolean {
		if (!header) return false
		if (header.trim() === '*') return true

		return header.split(',').some((candidate) => candidate.trim().replace(/^W\//, '') === etag)
	}

	/** Throws when the source is bigger than the configured ceiling. Takes the stored size so
	 *  it can be asked before the payload is read at all. */
	assertSourceSize(bytes: number): void {
		if (bytes > this.config.maxSourceBytes) throw new ThumbnailsTypes.ThumbnailSourceTooLargeError()
	}

	/** Fits the image inside `size` x `size`, keeping its aspect and never enlarging it. The
	 *  source stream is always destroyed, so no file handle outlives the call. */
	async render({ stream, contentType, size, key }: { stream: Readable, contentType: string | null | undefined, size: number, key?: string }): Promise<Buffer> {
		if (!this.isSupported(contentType, key)) {
			stream.destroy()
			throw new ThumbnailsTypes.ThumbnailUnsupportedError()
		}

		// Animated sources keep only their first frame: sharp's `animated` option is off.
		const pipeline = sharp({ limitInputPixels: ThumbnailsTypes.MAX_INPUT_PIXELS, sequentialRead: true })
			.rotate()
			.resize({ width: size, height: size, fit: 'inside', withoutEnlargement: true })
			.webp({ quality: ThumbnailsTypes.OUTPUT_QUALITY })

		// sharp does not settle `toBuffer` when its input is destroyed, so a failing source has to
		// reject on its own track or the call would hang.
		let sourceError: Error | undefined
		const sourceFailed = new Promise<never>((_, reject) => {
			stream.on('error', (err) => {
				sourceError = err
				reject(err)
			})
		})

		try {
			// The declared type is only a hint: sharp detects the format from the bytes, so what
			// the bytes are has to be checked here or an SVG could ride in as image/jpeg.
			const source = await Promise.race([this.sniff(stream), sourceFailed])
			source.pipe(pipeline)
			return await Promise.race([pipeline.toBuffer(), sourceFailed])
		} catch {
			// A read failure is not the image's fault; only what sharp itself rejected is.
			if (sourceError) throw sourceError
			throw new ThumbnailsTypes.ThumbnailUnsupportedError()
		} finally {
			stream.destroy()
			pipeline.destroy()
		}
	}

	/** Reads the head of the payload without buffering the rest and returns a stream that still
	 *  yields every byte; refuses anything that is not one of the supported raster formats. */
	private async sniff(stream: Readable): Promise<Readable> {
		const chunks: Buffer[] = []
		let length = 0

		await new Promise<void>((resolve, reject) => {
			const done = (err?: Error) => {
				stream.off('data', onData)
				stream.off('end', onEnd)
				stream.off('error', done)
				if (err) reject(err)
				else resolve()
			}
			const onData = (chunk: Buffer) => {
				chunks.push(chunk)
				length += chunk.length
				if (length < ThumbnailsTypes.SNIFF_BYTES) return
				stream.pause()
				done()
			}
			// A read failure before the head is complete must reject, or the request hangs.
			const onEnd = () => done()
			stream.on('data', onData)
			stream.once('end', onEnd)
			stream.once('error', done)
		})

		const head = Buffer.concat(chunks)
		if (!this.isRasterHeader(head)) throw new ThumbnailsTypes.ThumbnailUnsupportedError()

		// Not `unshift`: a stream that already ended cannot take the head back. Iterating the
		// rest after the head works whether or not it has.
		return Readable.from((async function* () {
			yield head
			for await (const chunk of stream) yield chunk
		})())
	}

	private isRasterHeader(head: Buffer): boolean {
		const startsWith = (bytes: number[], offset = 0) => head.length >= offset + bytes.length && bytes.every((byte, i) => head[offset + i] === byte)
		const ascii = (start: number, end: number) => head.subarray(start, end).toString('latin1')

		if (startsWith([0xFF, 0xD8, 0xFF])) return true
		if (startsWith([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])) return true
		if (ascii(0, 6) === 'GIF87a' || ascii(0, 6) === 'GIF89a') return true
		if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return true
		if (startsWith([0x49, 0x49, 0x2A, 0x00]) || startsWith([0x4D, 0x4D, 0x00, 0x2A])) return true

		if (ascii(4, 8) === 'ftyp') {
			const brands = ['avif', 'avis']
			if (brands.includes(ascii(8, 12))) return true
			// Compatible brands follow the minor version, up to the end of the first box.
			const boxEnd = Math.min(head.readUInt32BE(0), head.length)
			for (let at = 16; at + 4 <= boxEnd; at += 4) {
				if (brands.includes(ascii(at, at + 4))) return true
			}
		}

		return false
	}

	/** `image/jpeg; charset=x` and `IMAGE/JPEG` are the same type. */
	private normalize(contentType: string | null | undefined): string {
		return (contentType ?? '').split(';')[0].trim().toLowerCase()
	}
}
