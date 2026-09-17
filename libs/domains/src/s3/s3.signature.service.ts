import { Injectable } from '@nestjs/common'
import * as crypto from 'crypto'
import { Request } from 'express'

import { S3Types } from './s3.types'

const ALGORITHM = 'AWS4-HMAC-SHA256'
const MAX_CLOCK_SKEW_MS = 15 * 60 * 1000
/** Payload hash sent by clients that stream a body they cannot hash upfront. */
export const UNSIGNED_PAYLOAD = 'UNSIGNED-PAYLOAD'
export const STREAMING_PAYLOAD = 'STREAMING-AWS4-HMAC-SHA256-PAYLOAD'

/** AWS Signature Version 4 verification for incoming S3 requests.
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

	/** Recomputes the request signature from the secret key and compares it against the client's. */
	verify({ req, parsed, secretAccessKey, payloadHash }: {
		req: Request
		parsed: S3Types.SignatureV4Header
		secretAccessKey: string
		payloadHash: string
	}): void {
		const amzDate = this.header(req, 'x-amz-date') ?? this.header(req, 'date')
		if (!amzDate) throw new S3Types.MalformedAuthorizationError()
		this.assertFreshTimestamp(amzDate)

		const canonicalRequest = this.buildCanonicalRequest({ req, signedHeaders: parsed.signedHeaders, payloadHash })
		const credentialScope = `${parsed.date}/${parsed.region}/${parsed.service}/aws4_request`
		const stringToSign = [
			ALGORITHM,
			amzDate,
			credentialScope,
			crypto.createHash('sha256').update(canonicalRequest).digest('hex'),
		].join('\n')

		const signingKey = this.deriveSigningKey({ secretAccessKey, date: parsed.date, region: parsed.region, service: parsed.service })
		const expected = crypto.createHmac('sha256', signingKey).update(stringToSign).digest('hex')

		const expectedBuffer = Buffer.from(expected, 'utf8')
		const providedBuffer = Buffer.from(parsed.signature, 'utf8')
		if (expectedBuffer.length !== providedBuffer.length || !crypto.timingSafeEqual(expectedBuffer, providedBuffer)) {
			throw new S3Types.SignatureMismatchError()
		}
	}

	/** `HTTPMethod\nCanonicalURI\nCanonicalQueryString\nCanonicalHeaders\nSignedHeaders\nPayloadHash` */
	buildCanonicalRequest({ req, signedHeaders, payloadHash }: {
		req: Request
		signedHeaders: string[]
		payloadHash: string
	}): string {
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

	private deriveSigningKey({ secretAccessKey, date, region, service }: {
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

	/** Rejects replays of an old signed request - AWS allows a 15 minute window. */
	private assertFreshTimestamp(amzDate: string): void {
		const parsed = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(amzDate)
		const timestamp = parsed
			? Date.UTC(Number(parsed[1]), Number(parsed[2]) - 1, Number(parsed[3]), Number(parsed[4]), Number(parsed[5]), Number(parsed[6]))
			: Date.parse(amzDate)

		if (Number.isNaN(timestamp)) throw new S3Types.MalformedAuthorizationError()
		if (Math.abs(Date.now() - timestamp) > MAX_CLOCK_SKEW_MS) throw new S3Types.ClockSkewError()
	}

	/** AWS URI encoding: unreserved characters stay, everything else is percent-encoded uppercase. */
	private uriEncode(value: string): string {
		return encodeURIComponent(value)
			.replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)
	}

	private header(req: Request, name: string): string | undefined {
		const value = req.headers[name.toLowerCase()]
		return Array.isArray(value) ? value.join(',') : value
	}
}
