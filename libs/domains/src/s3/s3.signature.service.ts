import { Injectable } from '@nestjs/common'
import * as crypto from 'crypto'
import { Request } from 'express'

import { S3Types } from './s3.types'

const ALGORITHM = 'AWS4-HMAC-SHA256'
const CHUNK_ALGORITHM = 'AWS4-HMAC-SHA256-PAYLOAD'
const MAX_CLOCK_SKEW_MS = 15 * 60 * 1000
const EMPTY_SHA256 = crypto.createHash('sha256').update('').digest('hex')

/** Re-exported for callers that only deal with payload hashes. */
export const UNSIGNED_PAYLOAD = S3Types.UNSIGNED_PAYLOAD
export const STREAMING_PAYLOAD = S3Types.STREAMING_SIGNED_PAYLOAD

/** AWS Signature Version 4 verification for incoming S3 requests, both header-signed and
 *  presigned (query-string) ones.
 *  See https://docs.aws.amazon.com/AmazonS3/latest/API/sig-v4-authenticating-requests.html */
@Injectable()
export class S3SignatureService {
	/** Parses `Authorization: AWS4-HMAC-SHA256 Credential=.../20240101/us-east-1/s3/aws4_request, SignedHeaders=..., Signature=...` */
	parseAuthorizationHeader(header: string): S3Types.SignatureV4Header {
		if (!header?.startsWith(ALGORITHM)) throw new S3Types.MalformedAuthorizationError()

		const parts = Object.fromEntries(
			header
				.slice(ALGORITHM.length)
				.split(',')
				.map((part) => part.trim().split('='))
				.map(([key, ...rest]) => [key, rest.join('=')]),
		) as Record<string, string | undefined>

		const [accessKeyId, date, region, service] = (parts.Credential ?? '').split('/')
		const signedHeaders = (parts.SignedHeaders ?? '').split(';').filter(Boolean)
		const signature = parts.Signature

		if (!accessKeyId || !date || !region || !service || signedHeaders.length === 0 || !signature) {
			throw new S3Types.MalformedAuthorizationError()
		}

		return { accessKeyId, date, region, service, signedHeaders, signature }
	}

	/** Parses the `X-Amz-*` query parameters of a presigned URL, or returns null when the
	 *  request carries no query signature. */
	parseQuerySignature(req: Request): S3Types.SignatureV4Query | null {
		const query = this.queryParams(req)
		if (query.get('X-Amz-Algorithm') !== ALGORITHM) return null

		const [accessKeyId, date, region, service] = (query.get('X-Amz-Credential') ?? '').split('/')
		const signedHeaders = (query.get('X-Amz-SignedHeaders') ?? '').split(';').filter(Boolean)
		const signature = query.get('X-Amz-Signature')
		const amzDate = query.get('X-Amz-Date')
		const expires = Number(query.get('X-Amz-Expires') ?? 0)

		if (!accessKeyId || !date || !region || !service || !signature || !amzDate || signedHeaders.length === 0) {
			throw new S3Types.MalformedAuthorizationError()
		}

		return { accessKeyId, date, region, service, signedHeaders, signature, amzDate, expires }
	}

	/** Recomputes a header-signed request's signature and compares it against the client's.
	 *  The returned material also seeds per-chunk verification of an `aws-chunked` body. */
	verify({ req, parsed, secretAccessKey, payloadHash }: {
		req: Request
		parsed: S3Types.SignatureV4Header
		secretAccessKey: string
		payloadHash: string
	}): S3Types.ChunkSigningContext {
		const amzDate = this.header(req, 'x-amz-date') ?? this.header(req, 'date')
		if (!amzDate) throw new S3Types.MalformedAuthorizationError()
		this.assertFreshTimestamp(amzDate)

		const canonicalRequest = this.buildCanonicalRequest({ req, signedHeaders: parsed.signedHeaders, payloadHash })
		const credentialScope = `${parsed.date}/${parsed.region}/${parsed.service}/aws4_request`
		const stringToSign = this.buildStringToSign({ amzDate, credentialScope, canonicalRequest })

		const signingKey = this.deriveSigningKey({ secretAccessKey, date: parsed.date, region: parsed.region, service: parsed.service })
		const expected = crypto.createHmac('sha256', signingKey).update(stringToSign).digest('hex')
		this.assertSignatureEquals(expected, parsed.signature)

		return { signingKey, seedSignature: parsed.signature, amzDate, credentialScope }
	}

	/** Verifies a presigned URL: the signature covers the query string minus `X-Amz-Signature`,
	 *  the payload hash is always `UNSIGNED-PAYLOAD`, and `X-Amz-Expires` bounds its lifetime. */
	verifyPresigned({ req, parsed, secretAccessKey }: {
		req: Request
		parsed: S3Types.SignatureV4Query
		secretAccessKey: string
	}): void {
		const issuedAt = this.parseAmzDate(parsed.amzDate)
		if (parsed.expires <= 0 || parsed.expires > 7 * 24 * 3600) throw new S3Types.MalformedAuthorizationError()
		if (Date.now() > issuedAt + parsed.expires * 1000) throw new S3Types.ExpiredSignatureError()

		const canonicalRequest = this.buildCanonicalRequest({
			req,
			signedHeaders: parsed.signedHeaders,
			payloadHash: S3Types.UNSIGNED_PAYLOAD,
			excludeQueryKeys: ['X-Amz-Signature'],
		})
		const credentialScope = `${parsed.date}/${parsed.region}/${parsed.service}/aws4_request`
		const stringToSign = this.buildStringToSign({ amzDate: parsed.amzDate, credentialScope, canonicalRequest })

		const signingKey = this.deriveSigningKey({ secretAccessKey, date: parsed.date, region: parsed.region, service: parsed.service })
		const expected = crypto.createHmac('sha256', signingKey).update(stringToSign).digest('hex')
		this.assertSignatureEquals(expected, parsed.signature)
	}

	/** Signature of one `aws-chunked` chunk: chained from the previous chunk's signature,
	 *  seeded by the request signature itself. */
	computeChunkSignature({ context, previousSignature, chunkHash }: {
		context: S3Types.ChunkSigningContext
		previousSignature: string
		chunkHash: string
	}): string {
		const stringToSign = [
			CHUNK_ALGORITHM,
			context.amzDate,
			context.credentialScope,
			previousSignature,
			EMPTY_SHA256,
			chunkHash,
		].join('\n')

		return crypto.createHmac('sha256', context.signingKey).update(stringToSign).digest('hex')
	}

	/** `HTTPMethod\nCanonicalURI\nCanonicalQueryString\nCanonicalHeaders\nSignedHeaders\nPayloadHash` */
	buildCanonicalRequest({ req, signedHeaders, payloadHash, excludeQueryKeys }: {
		req: Request
		signedHeaders: string[]
		payloadHash: string
		excludeQueryKeys?: string[]
	}): string {
		// `originalUrl` and not `url`: virtual-host style requests are rewritten to path style
		// before routing, but the client signed the path as it sent it.
		const [uriPath, queryString] = req.originalUrl.split('?')

		const canonicalUri = uriPath
			.split('/')
			.map((segment) => this.uriEncode(decodeURIComponent(segment)))
			.join('/') || '/'

		const canonicalQuery = (queryString ?? '')
			.split('&')
			.filter(Boolean)
			.map((pair) => {
				const [key, ...rest] = pair.split('=')
				return [this.uriEncode(decodeURIComponent(key)), this.uriEncode(decodeURIComponent(rest.join('=')))] as const
			})
			.filter(([key]) => !excludeQueryKeys?.includes(key))
			.sort((a, b) => (a[0] === b[0] ? a[1].localeCompare(b[1]) : a[0].localeCompare(b[0])))
			.map(([key, value]) => `${key}=${value}`)
			.join('&')

		const canonicalHeaders = signedHeaders
			.map((name) => `${name}:${(this.header(req, name) ?? '').trim().replace(/\s+/g, ' ')}\n`)
			.join('')

		return [
			req.method,
			canonicalUri,
			canonicalQuery,
			canonicalHeaders,
			signedHeaders.join(';'),
			payloadHash,
		].join('\n')
	}

	deriveSigningKey({ secretAccessKey, date, region, service }: {
		secretAccessKey: string
		date: string
		region: string
		service: string
	}): Buffer {
		const dateKey = crypto.createHmac('sha256', `AWS4${secretAccessKey}`).update(date).digest()
		const regionKey = crypto.createHmac('sha256', dateKey).update(region).digest()
		const serviceKey = crypto.createHmac('sha256', regionKey).update(service).digest()
		return crypto.createHmac('sha256', serviceKey).update('aws4_request').digest()
	}

	private buildStringToSign({ amzDate, credentialScope, canonicalRequest }: {
		amzDate: string
		credentialScope: string
		canonicalRequest: string
	}): string {
		return [
			ALGORITHM,
			amzDate,
			credentialScope,
			crypto.createHash('sha256').update(canonicalRequest).digest('hex'),
		].join('\n')
	}

	private assertSignatureEquals(expected: string, provided: string): void {
		const expectedBuffer = Buffer.from(expected, 'utf8')
		const providedBuffer = Buffer.from(provided, 'utf8')
		if (expectedBuffer.length !== providedBuffer.length || !crypto.timingSafeEqual(expectedBuffer, providedBuffer)) {
			throw new S3Types.SignatureMismatchError()
		}
	}

	/** Rejects replays of an old signed request - AWS allows a 15 minute window. */
	private assertFreshTimestamp(amzDate: string): void {
		const timestamp = this.parseAmzDate(amzDate)
		if (Math.abs(Date.now() - timestamp) > MAX_CLOCK_SKEW_MS) throw new S3Types.ClockSkewError()
	}

	private parseAmzDate(amzDate: string): number {
		const parsed = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(amzDate)
		const timestamp = parsed
			? Date.UTC(Number(parsed[1]), Number(parsed[2]) - 1, Number(parsed[3]), Number(parsed[4]), Number(parsed[5]), Number(parsed[6]))
			: Date.parse(amzDate)

		if (Number.isNaN(timestamp)) throw new S3Types.MalformedAuthorizationError()
		return timestamp
	}

	/** AWS URI encoding: unreserved characters stay, everything else is percent-encoded uppercase. */
	private uriEncode(value: string): string {
		return encodeURIComponent(value)
			.replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)
	}

	private queryParams(req: Request): URLSearchParams {
		return new URLSearchParams(req.originalUrl.split('?')[1] ?? '')
	}

	private header(req: Request, name: string): string | undefined {
		const value = req.headers[name.toLowerCase()]
		return Array.isArray(value) ? value.join(',') : value
	}
}
