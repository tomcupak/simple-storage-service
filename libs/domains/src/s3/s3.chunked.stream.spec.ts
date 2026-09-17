import * as crypto from 'crypto'
import { Readable } from 'stream'

import { S3ChunkedStream } from './s3.chunked.stream'
import { S3SignatureService } from './s3.signature.service'
import { S3Types } from './s3.types'

const signatureService = new S3SignatureService()

const context: S3Types.ChunkSigningContext = {
	signingKey: signatureService.deriveSigningKey({ secretAccessKey: 'secret', date: '20240101', region: 'us-east-1', service: 's3' }),
	seedSignature: 'a'.repeat(64),
	amzDate: '20240101T000000Z',
	credentialScope: '20240101/us-east-1/s3/aws4_request',
}

/** Frames a payload the way an AWS client does, signing each chunk off the previous one. */
function makeSignedBody(payload: Buffer, chunkSize: number): Buffer {
	const chunks: Buffer[] = []
	for (let offset = 0; offset < payload.length; offset += chunkSize) {
		chunks.push(payload.subarray(offset, offset + chunkSize))
	}

	let previousSignature = context.seedSignature
	const framed: Buffer[] = []

	for (const chunk of [...chunks, Buffer.alloc(0)]) {
		previousSignature = signatureService.computeChunkSignature({
			context,
			previousSignature,
			chunkHash: crypto.createHash('sha256').update(chunk).digest('hex'),
		})
		framed.push(Buffer.from(`${chunk.length.toString(16)};chunk-signature=${previousSignature}\r\n`), chunk, Buffer.from('\r\n'))
	}

	return Buffer.concat(framed)
}

function makeUnsignedBody(payload: Buffer, chunkSize: number): Buffer {
	const framed: Buffer[] = []
	for (let offset = 0; offset < payload.length; offset += chunkSize) {
		const chunk = payload.subarray(offset, offset + chunkSize)
		framed.push(Buffer.from(`${chunk.length.toString(16)}\r\n`), chunk, Buffer.from('\r\n'))
	}
	framed.push(Buffer.from('0\r\n\r\n'))

	return Buffer.concat(framed)
}

/** Feeds the body through the decoder in `sliceSize` pieces, so frames straddle writes. */
async function decode(body: Buffer, { signed = true, sliceSize = 1024 } = {}): Promise<Buffer> {
	const source = Readable.from((function* () {
		for (let offset = 0; offset < body.length; offset += sliceSize) {
			yield body.subarray(offset, offset + sliceSize)
		}
	})())

	const decoded: Buffer[] = []
	const stream = source.pipe(new S3ChunkedStream(signatureService, signed ? context : undefined))

	for await (const chunk of stream) decoded.push(chunk as Buffer)
	return Buffer.concat(decoded)
}

describe('S3ChunkedStream', () => {
	it('decodes a signed aws-chunked body', async () => {
		const payload = Buffer.from('the quick brown fox jumps over the lazy dog')

		await expect(decode(makeSignedBody(payload, 7))).resolves.toEqual(payload)
	})

	it('decodes a body whose frames straddle stream writes', async () => {
		const payload = crypto.randomBytes(100_000)

		await expect(decode(makeSignedBody(payload, 8 * 1024), { sliceSize: 333 })).resolves.toEqual(payload)
	})

	it('decodes an unsigned (trailer) body', async () => {
		const payload = Buffer.from('no per-chunk signatures here')

		await expect(decode(makeUnsignedBody(payload, 5), { signed: false })).resolves.toEqual(payload)
	})

	it('accepts an empty payload', async () => {
		await expect(decode(makeSignedBody(Buffer.alloc(0), 16))).resolves.toEqual(Buffer.alloc(0))
	})

	it('rejects a body whose chunk signature does not chain', async () => {
		const framed = makeSignedBody(Buffer.from('tampered'), 4)
		const broken = Buffer.from(framed.toString('binary').replace(/chunk-signature=./, 'chunk-signature=0'), 'binary')

		await expect(decode(broken)).rejects.toThrow(S3Types.SignatureMismatchError)
	})

	it('rejects a truncated body', async () => {
		const framed = makeSignedBody(Buffer.from('cut short'), 4)

		await expect(decode(framed.subarray(0, framed.length - 20))).rejects.toThrow(S3Types.MalformedBodyError)
	})

	it('rejects a chunk header that is not a hex length', async () => {
		const framed = Buffer.from('nothex;chunk-signature=x\r\ndata\r\n')

		await expect(decode(framed)).rejects.toThrow(S3Types.MalformedBodyError)
	})

	it('rejects a signed request whose chunks carry no signature', async () => {
		await expect(decode(makeUnsignedBody(Buffer.from('unsigned'), 4))).rejects.toThrow(S3Types.MalformedBodyError)
	})
})
