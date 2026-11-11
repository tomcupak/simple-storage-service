import * as crypto from 'crypto'
import { Transform, TransformCallback } from 'stream'

import { S3SignatureService } from './s3.signature.service'
import { S3Types } from './s3.types'

const CRLF = Buffer.from('\r\n')
/** A chunk header (`<hex-size>;chunk-signature=<64 hex>`) is far shorter than this. */
const MAX_HEADER_BYTES = 1024

enum State {
	header = 'header',
	data = 'data',
	/** The `\r\n` closing a chunk's data. */
	terminator = 'terminator',
	/** Zero-length chunk seen: only trailing headers may follow, and they are ignored. */
	done = 'done',
}

/** Decodes an `aws-chunked` request body back into the plain payload.
 *
 *  The AWS CLI and SDKs send `x-amz-content-sha256: STREAMING-AWS4-HMAC-SHA256-PAYLOAD` by
 *  default: the body is then framed as `<hex-size>;chunk-signature=<sig>\r\n<data>\r\n`,
 *  terminated by a zero-length chunk and optional trailing headers. Each chunk's signature is
 *  chained from the previous one, seeded by the request signature, so an altered body fails
 *  verification the same way an altered header would. */
export class S3ChunkedStream extends Transform {
	private state = State.header
	private pending: Buffer = Buffer.alloc(0)
	private remaining = 0
	private isFinalChunk = false
	private previousSignature: string
	private chunkSignature?: string
	private chunkHash = crypto.createHash('sha256')

	constructor(
		private readonly signatureService: S3SignatureService,
		/** Absent for `STREAMING-UNSIGNED-PAYLOAD-TRAILER`, where chunks carry no signature. */
		private readonly context?: S3Types.ChunkSigningContext,
	) {
		super()
		this.previousSignature = context?.seedSignature ?? ''
	}

	_transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback): void {
		this.pending = this.pending.length === 0 ? Buffer.from(chunk) : Buffer.concat([this.pending, chunk])

		try {
			this.consume()
			callback()
		} catch (err) {
			callback(err as Error)
		}
	}

	_flush(callback: TransformCallback): void {
		try {
			// Tolerate a body that stops right after the zero-length chunk header without the
			// closing CRLF - the payload itself is complete at that point.
			if (this.state === State.terminator && this.isFinalChunk && this.pending.length === 0) {
				this.verifyChunk()
				this.state = State.done
			}

			if (this.state !== State.done) throw new S3Types.MalformedBodyError()
			callback()
		} catch (err) {
			callback(err as Error)
		}
	}

	/** Drives the frame parser over whatever bytes have arrived so far. */
	private consume(): void {
		for (;;) {
			if (this.state === State.done) {
				// Trailing headers (checksums) are verified by the client, not needed for storage.
				this.pending = Buffer.alloc(0)
				return
			}

			const advanced = this.state === State.header
				? this.consumeHeader()
				: this.state === State.data ? this.consumeData() : this.consumeTerminator()

			if (!advanced) return
		}
	}

	private consumeHeader(): boolean {
		const index = this.pending.indexOf(CRLF)
		if (index < 0) {
			if (this.pending.length > MAX_HEADER_BYTES) throw new S3Types.MalformedBodyError()
			return false
		}

		const header = this.pending.subarray(0, index).toString('utf8')
		this.pending = this.pending.subarray(index + CRLF.length)

		const [sizePart, ...extensions] = header.split(';')
		const size = Number.parseInt(sizePart, 16)
		if (!Number.isFinite(size) || size < 0) throw new S3Types.MalformedBodyError()

		this.chunkSignature = extensions
			.map((extension) => /^chunk-signature=(.+)$/.exec(extension.trim())?.[1])
			.find((value): value is string => Boolean(value))

		if (this.context && !this.chunkSignature) throw new S3Types.MalformedBodyError()

		this.remaining = size
		this.isFinalChunk = size === 0
		this.chunkHash = crypto.createHash('sha256')
		this.state = size === 0 ? State.terminator : State.data
		return true
	}

	private consumeData(): boolean {
		if (this.pending.length === 0) return false

		const take = Math.min(this.remaining, this.pending.length)
		const data = this.pending.subarray(0, take)
		this.pending = this.pending.subarray(take)
		this.remaining -= take

		this.chunkHash.update(data)
		this.push(data)

		if (this.remaining > 0) return false
		this.state = State.terminator
		return true
	}

	private consumeTerminator(): boolean {
		if (this.pending.length < CRLF.length) return false
		if (!this.pending.subarray(0, CRLF.length).equals(CRLF)) throw new S3Types.MalformedBodyError()
		this.pending = this.pending.subarray(CRLF.length)

		this.verifyChunk()
		this.state = this.isFinalChunk ? State.done : State.header
		return true
	}

	/** Chains this chunk's signature onto the previous one; a mismatch means the body was altered. */
	private verifyChunk(): void {
		if (!this.context || !this.chunkSignature) return

		const expected = this.signatureService.computeChunkSignature({
			context: this.context,
			previousSignature: this.previousSignature,
			chunkHash: this.chunkHash.digest('hex'),
		})

		if (expected !== this.chunkSignature) throw new S3Types.SignatureMismatchError()
		this.previousSignature = this.chunkSignature
	}
}
