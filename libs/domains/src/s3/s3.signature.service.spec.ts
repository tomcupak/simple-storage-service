import { Request } from 'express'

import { S3SignatureService } from './s3.signature.service'
import { S3Types } from './s3.types'

const SECRET = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY'

describe('S3SignatureService', () => {
	let service: S3SignatureService

	beforeEach(() => {
		jest.clearAllMocks()
		service = new S3SignatureService()
	})

	/** The URL `presign` hands out is only worth anything if this very service accepts it back,
	 *  so the round trip is what is asserted rather than a hard-coded signature. */
	const makeRequest = (url: string): Request => {
		const { pathname, search, host } = new URL(url)

		return {
			method: 'GET',
			url: `${pathname}${search}`,
			originalUrl: `${pathname}${search}`,
			headers: { host },
		} as unknown as Request
	}

	const presign = (overrides?: { key?: string, expiresIn?: number, query?: Record<string, string | undefined> }) =>
		service.presign({
			method: 'GET',
			endpoint: 'http://localhost:10411',
			bucket: 'photos',
			key: overrides?.key ?? 'holiday/cat.jpg',
			expiresIn: overrides?.expiresIn ?? 3600,
			accessKeyId: 'STEXAMPLEACCESSKEY',
			secretAccessKey: SECRET,
			region: 'us-east-1',
			query: overrides?.query,
		})

	describe('presign', () => {
		it('produces a URL this service verifies', () => {
			const req = makeRequest(presign())
			const parsed = service.parseQuerySignature(req)

			expect(parsed).not.toBeNull()
			expect(() => service.verifyPresigned({ req, parsed: parsed, secretAccessKey: SECRET })).not.toThrow()
		})

		it('signs the key so a tampered path is rejected', () => {
			const req = makeRequest(presign().replace('cat.jpg', 'dog.jpg'))
			const parsed = service.parseQuerySignature(req)

			expect(() => service.verifyPresigned({ req, parsed, secretAccessKey: SECRET }))
				.toThrow(S3Types.SignatureMismatchError)
		})

		it('does not verify under a different secret', () => {
			const req = makeRequest(presign())
			const parsed = service.parseQuerySignature(req)

			expect(() => service.verifyPresigned({ req, parsed, secretAccessKey: 'another-secret' }))
				.toThrow(S3Types.SignatureMismatchError)
		})

		it('covers extra query parameters such as versionId', () => {
			const url = presign({ query: { versionId: 'v1' } })
			expect(url).toContain('versionId=v1')

			const req = makeRequest(url)
			const parsed = service.parseQuerySignature(req)
			expect(() => service.verifyPresigned({ req, parsed, secretAccessKey: SECRET })).not.toThrow()

			const tampered = makeRequest(url.replace('versionId=v1', 'versionId=v2'))
			const tamperedParsed = service.parseQuerySignature(tampered)
			expect(() => service.verifyPresigned({ req: tampered, parsed: tamperedParsed, secretAccessKey: SECRET }))
				.toThrow(S3Types.SignatureMismatchError)
		})

		it('encodes a key with spaces and keeps its slashes as separators', () => {
			const url = presign({ key: 'my holiday/a+b.jpg' })
			expect(new URL(url).pathname).toBe('/photos/my%20holiday/a%2Bb.jpg')

			const req = makeRequest(url)
			const parsed = service.parseQuerySignature(req)
			expect(() => service.verifyPresigned({ req, parsed, secretAccessKey: SECRET })).not.toThrow()
		})

		it('is refused once it has expired', () => {
			const req = makeRequest(presign({ expiresIn: 60 }))
			const parsed = service.parseQuerySignature(req)

			const now = jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 61_000)
			try {
				expect(() => service.verifyPresigned({ req, parsed, secretAccessKey: SECRET }))
					.toThrow(S3Types.ExpiredSignatureError)
			} finally {
				now.mockRestore()
			}
		})
	})
})
