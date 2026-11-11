import { Sha256 } from '@aws-crypto/sha256-js'
import { SignatureV4 } from '@smithy/signature-v4'
import { Request } from 'express'

import { S3SignatureService } from './s3.signature.service'
import { S3Types } from './s3.types'

/** Credentials and timestamp of the official `aws-sig-v4-test-suite`. Nothing expected below
 *  is computed by this implementation: the canonical request is transcribed from the published
 *  vector, and the two hex values are what the AWS SDK's signer produces for the same inputs.
 *  That is the point of a known-answer test - changing our code cannot change what it expects. */
const VECTOR_ACCESS_KEY = 'AKIDEXAMPLE'
const VECTOR_SECRET = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY'
const VECTOR_DATE = '20150830T123600Z'
const VECTOR_SCOPE_DATE = '20150830'
const VECTOR_REGION = 'us-east-1'
const VECTOR_SERVICE = 'service'

/** SigV4 is a wire format, so it is worth pinning from both directions: against AWS's published
 *  canonicalisation, and against the signer the SDKs actually ship.
 *
 *  The round-trip test next door only shows that this service agrees with itself; these show
 *  that it agrees with AWS. */
describe('S3SignatureService (AWS vectors)', () => {
	let service: S3SignatureService

	beforeEach(() => {
		jest.clearAllMocks()
		service = new S3SignatureService()
	})

	describe('get-vanilla', () => {
		// https://github.com/awslabs/aws-c-auth/tree/main/tests/aws-sig-v4-test-suite/get-vanilla
		const CANONICAL_REQUEST = [
			'GET',
			'/',
			'',
			'host:example.amazonaws.com',
			'x-amz-date:20150830T123600Z',
			'',
			'host;x-amz-date',
			'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
		].join('\n')

		// Pinned from the AWS SDK's own signer (`@smithy/signature-v4`) for exactly these
		// inputs, not from this implementation - see the cross-check block at the bottom, which
		// is what keeps the two in step.
		const EXPECTED_SIGNATURE = 'ea21d6f05e96a897f6000a1a293f0a5bf0f92a00343409e820dce329ca6365ea'

		const request = {
			method: 'GET',
			url: '/',
			originalUrl: '/',
			headers: {
				'host': 'example.amazonaws.com',
				'x-amz-date': VECTOR_DATE,
			},
		} as unknown as Request

		it('builds the canonical request AWS documents', () => {
			const canonical = service.buildCanonicalRequest({
				req: request,
				signedHeaders: ['host', 'x-amz-date'],
				payloadHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
			})

			expect(canonical).toBe(CANONICAL_REQUEST)
		})

		it('accepts the signature the AWS signer produces for it', () => {
			const parsed: S3Types.SignatureV4Header = {
				accessKeyId: VECTOR_ACCESS_KEY,
				date: VECTOR_SCOPE_DATE,
				region: VECTOR_REGION,
				service: VECTOR_SERVICE,
				signedHeaders: ['host', 'x-amz-date'],
				signature: EXPECTED_SIGNATURE,
			}

			// The vector is from 2015, so the freshness window has to be pinned with it.
			withClockAt(Date.parse('2015-08-30T12:36:00Z'), () => {
				expect(() => service.verify({
					req: request,
					parsed,
					secretAccessKey: VECTOR_SECRET,
					payloadHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
				})).not.toThrow()
			})
		})

		it('rejects a signature one character off', () => {
			const parsed: S3Types.SignatureV4Header = {
				accessKeyId: VECTOR_ACCESS_KEY,
				date: VECTOR_SCOPE_DATE,
				region: VECTOR_REGION,
				service: VECTOR_SERVICE,
				signedHeaders: ['host', 'x-amz-date'],
				signature: EXPECTED_SIGNATURE.replace(/.$/, '0'),
			}

			withClockAt(Date.parse('2015-08-30T12:36:00Z'), () => {
				expect(() => service.verify({
					req: request,
					parsed,
					secretAccessKey: VECTOR_SECRET,
					payloadHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
				})).toThrow(S3Types.SignatureMismatchError)
			})
		})
	})

	/** The AWS SDKs put `x-id` and `x-amz-checksum-mode` on a presigned URL next to the
	 *  `X-Amz-*` parameters. Canonicalisation orders query parameters by bytes, where every
	 *  uppercase `X` comes before every lowercase `x`; a locale-aware comparison treats the two
	 *  as the same letter and interleaves them, which silently invalidates every presigned URL
	 *  an SDK produces. */
	describe('canonical query ordering', () => {
		it('sorts parameters by bytes, not by locale', () => {
			const url = '/my-bucket/a.txt?X-Amz-Algorithm=AWS4-HMAC-SHA256&x-id=GetObject'
				+ '&X-Amz-Content-Sha256=UNSIGNED-PAYLOAD&x-amz-checksum-mode=ENABLED&X-Amz-Date=20150830T123600Z'

			const canonical = service.buildCanonicalRequest({
				req: { method: 'GET', url, originalUrl: url, headers: { host: 'storage.local' } } as unknown as Request,
				signedHeaders: ['host'],
				payloadHash: S3Types.UNSIGNED_PAYLOAD,
			})

			expect(canonical.split('\n')[2]).toBe([
				'X-Amz-Algorithm=AWS4-HMAC-SHA256',
				'X-Amz-Content-Sha256=UNSIGNED-PAYLOAD',
				'X-Amz-Date=20150830T123600Z',
				'x-amz-checksum-mode=ENABLED',
				'x-id=GetObject',
			].join('&'))
		})
	})

	describe('signing key derivation', () => {
		/** The four chained HMACs are the part of SigV4 with no feedback from the rest: if this
		 *  drifts, every signature is wrong and nothing else in the service can tell you why. */
		it('derives the key the AWS signer derives for the vector scope', () => {
			const key = service.deriveSigningKey({
				secretAccessKey: VECTOR_SECRET,
				date: VECTOR_SCOPE_DATE,
				region: VECTOR_REGION,
				service: VECTOR_SERVICE,
			})

			expect(key.toString('hex')).toBe('9b3b06ce6b6366f283a9b9503888627337a037c7f2f66b419fbb30538acee4fb')
		})
	})

	/** The strongest check available: sign with the signer the AWS SDKs use, verify with ours.
	 *  It covers everything a fixed vector cannot - header ordering, the encoding of keys and
	 *  query parameters, the payload hash - and it keeps covering it as the SDK evolves. */
	describe('against the AWS SDK signer', () => {
		const sign = async ({ method, path, query, headers }: {
			method: string
			path: string
			query?: Record<string, string>
			headers?: Record<string, string>
		}) => {
			const signer = new SignatureV4({
				credentials: { accessKeyId: VECTOR_ACCESS_KEY, secretAccessKey: VECTOR_SECRET },
				region: VECTOR_REGION,
				service: 's3',
				sha256: Sha256,
				uriEscapePath: false,
			})

			const signed = await signer.sign({
				method,
				protocol: 'http:',
				hostname: 'storage.local',
				path,
				query,
				headers: { host: 'storage.local', 'x-amz-content-sha256': S3Types.UNSIGNED_PAYLOAD, ...headers },
			})

			const queryString = Object.entries(signed.query ?? {})
				.map(([name, value]) => `${encodeURIComponent(name)}=${encodeURIComponent(String(value))}`)
				.join('&')
			const url = queryString ? `${signed.path}?${queryString}` : signed.path

			return {
				req: { method, url, originalUrl: url, headers: signed.headers } as unknown as Request,
				authorization: signed.headers.authorization,
			}
		}

		const verify = ({ req, authorization }: { req: Request, authorization: string }) => {
			const parsed = service.parseAuthorizationHeader(authorization)
			service.verify({ req, parsed, secretAccessKey: VECTOR_SECRET, payloadHash: S3Types.UNSIGNED_PAYLOAD })
		}

		it('verifies a plain bucket listing', async () => {
			const signed = await sign({ method: 'GET', path: '/my-bucket' })
			expect(() => verify(signed)).not.toThrow()
		})

		it('verifies a request whose query parameters need sorting', async () => {
			const signed = await sign({
				method: 'GET',
				path: '/my-bucket',
				query: { 'list-type': '2', 'prefix': 'a/b', 'max-keys': '10', 'delimiter': '/' },
			})

			expect(() => verify(signed)).not.toThrow()
		})

		it('verifies a key with characters that have to be percent-encoded', async () => {
			const signed = await sign({ method: 'PUT', path: '/my-bucket/holiday%20photos/a%2Bb.jpg' })
			expect(() => verify(signed)).not.toThrow()
		})

		it('verifies a request carrying user metadata headers', async () => {
			const signed = await sign({
				method: 'PUT',
				path: '/my-bucket/report.pdf',
				headers: { 'x-amz-meta-author': 'someone', 'content-type': 'application/pdf' },
			})

			expect(() => verify(signed)).not.toThrow()
		})

		it('rejects the same request once a signed header has been altered', async () => {
			const signed = await sign({
				method: 'PUT',
				path: '/my-bucket/report.pdf',
				headers: { 'x-amz-meta-author': 'someone' },
			})

			const tampered = {
				...signed,
				req: {
					...signed.req,
					headers: { ...signed.req.headers, 'x-amz-meta-author': 'someone-else' },
				} as unknown as Request,
			}

			expect(() => verify(tampered)).toThrow(S3Types.SignatureMismatchError)
		})

		it('rejects the same request once its query string has been altered', async () => {
			const signed = await sign({ method: 'GET', path: '/my-bucket', query: { prefix: 'a/' } })
			const url = signed.req.originalUrl.replace('prefix=a%2F', 'prefix=b%2F')

			const tampered = {
				...signed,
				req: { ...signed.req, url, originalUrl: url } as unknown as Request,
			}

			expect(() => verify(tampered)).toThrow(S3Types.SignatureMismatchError)
		})
	})
})

/** Runs `body` with `Date.now` pinned, so a vector from 2015 does not fail the 15 minute
 *  freshness window that protects every real request. */
function withClockAt(timestamp: number, body: () => void): void {
	const now = jest.spyOn(Date, 'now').mockReturnValue(timestamp)
	try {
		body()
	} finally {
		now.mockRestore()
	}
}
