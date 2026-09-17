import { Request } from 'express'

import { S3Exception } from './s3.exception'
import { S3RequestService } from './s3.request.service'
import { S3SignatureService } from './s3.signature.service'
import { S3Types } from './s3.types'

const service = new S3RequestService(new S3SignatureService())

function makeRequest({ url = '/', headers = {}, query }: {
	url?: string
	headers?: Record<string, string>
	query?: Record<string, string>
}): Request {
	const search = url.split('?')[1] ?? ''
	return {
		url,
		originalUrl: url,
		headers,
		query: query ?? Object.fromEntries(new URLSearchParams(search)),
	} as unknown as Request
}

describe('S3RequestService', () => {
	describe('bucketAndKey', () => {
		it('splits a path-style url into bucket and key', () => {
			expect(service.bucketAndKey(makeRequest({ url: '/my-bucket/folder/file.txt' })))
				.toEqual({ bucket: 'my-bucket', key: 'folder/file.txt' })
		})

		it('returns an empty key for a bucket-only url', () => {
			expect(service.bucketAndKey(makeRequest({ url: '/my-bucket?list-type=2' })))
				.toEqual({ bucket: 'my-bucket', key: '' })
		})

		it('decodes each key segment separately', () => {
			expect(service.bucketAndKey(makeRequest({ url: '/b/sub%20dir/a%2Bb.txt' })))
				.toEqual({ bucket: 'b', key: 'sub dir/a+b.txt' })
		})
	})

	describe('subResource', () => {
		it('recognises an implemented sub-resource', () => {
			expect(service.subResource(makeRequest({ query: { versioning: '' } }))).toBe(S3Types.SubResource.versioning)
		})

		it('reports a plain request as none', () => {
			expect(service.subResource(makeRequest({ query: { prefix: 'a/' } }))).toBe(S3Types.SubResource.none)
		})

		it('rejects a sub-resource this deployment does not implement', () => {
			expect(() => service.subResource(makeRequest({ query: { tagging: '' } }))).toThrow(S3Exception)
			expect(() => service.subResource(makeRequest({ query: { acl: '' } }))).toThrow(S3Exception)
		})
	})

	describe('parseRange', () => {
		it('resolves a closed range', () => {
			expect(service.parseRange(makeRequest({ headers: { range: 'bytes=0-4' } }), 100)).toEqual({ start: 0, end: 4 })
		})

		it('resolves an open-ended range against the object size', () => {
			expect(service.parseRange(makeRequest({ headers: { range: 'bytes=90-' } }), 100)).toEqual({ start: 90, end: 99 })
		})

		it('resolves a suffix range', () => {
			expect(service.parseRange(makeRequest({ headers: { range: 'bytes=-10' } }), 100)).toEqual({ start: 90, end: 99 })
		})

		it('clamps an end beyond the object size', () => {
			expect(service.parseRange(makeRequest({ headers: { range: 'bytes=0-999' } }), 100)).toEqual({ start: 0, end: 99 })
		})

		it('ignores a range header it cannot parse', () => {
			expect(service.parseRange(makeRequest({ headers: { range: 'items=0-4' } }), 100)).toBeUndefined()
		})

		it('rejects a range that starts past the end', () => {
			expect(() => service.parseRange(makeRequest({ headers: { range: 'bytes=100-200' } }), 100)).toThrow(S3Exception)
		})
	})

	describe('assertConditions', () => {
		const lastModified = new Date('2024-01-01T00:00:00Z')

		it('passes when no precondition is sent', () => {
			expect(() => service.assertConditions({ req: makeRequest({}), etag: 'abc', lastModified })).not.toThrow()
		})

		it('answers 304 for a matching If-None-Match', () => {
			expect(() => service.assertConditions({ req: makeRequest({ headers: { 'if-none-match': '"abc"' } }), etag: 'abc', lastModified }))
				.toThrow(expect.objectContaining({ errorCode: 'NotModified' }))
		})

		it('answers 412 for a failing If-Match', () => {
			expect(() => service.assertConditions({ req: makeRequest({ headers: { 'if-match': '"other"' } }), etag: 'abc', lastModified }))
				.toThrow(expect.objectContaining({ errorCode: 'PreconditionFailed' }))
		})

		it('answers 304 when the object was not modified since', () => {
			expect(() => service.assertConditions({ req: makeRequest({ headers: { 'if-modified-since': lastModified.toUTCString() } }), etag: 'abc', lastModified }))
				.toThrow(expect.objectContaining({ errorCode: 'NotModified' }))
		})

		it('lets If-None-Match take precedence over If-Modified-Since', () => {
			const req = makeRequest({ headers: { 'if-none-match': '"other"', 'if-modified-since': lastModified.toUTCString() } })

			expect(() => service.assertConditions({ req, etag: 'abc', lastModified })).not.toThrow()
		})
	})

	describe('copySource', () => {
		it('splits bucket and key', () => {
			expect(service.copySource(makeRequest({ headers: { 'x-amz-copy-source': '/source-bucket/dir/file.txt' } })))
				.toEqual({ bucket: 'source-bucket', key: 'dir/file.txt', versionId: undefined })
		})

		it('picks up the version id', () => {
			expect(service.copySource(makeRequest({ headers: { 'x-amz-copy-source': 'b/k?versionId=v1' } })))
				.toEqual({ bucket: 'b', key: 'k', versionId: 'v1' })
		})

		it('rejects a source without a key', () => {
			expect(() => service.copySource(makeRequest({ headers: { 'x-amz-copy-source': '/only-bucket' } }))).toThrow(S3Exception)
		})
	})

	describe('objectHeaders', () => {
		it('collects entity headers and user metadata', () => {
			const req = makeRequest({ headers: { 'content-type': 'text/plain', 'cache-control': 'max-age=60', 'x-amz-meta-owner': 'tom' } })

			expect(service.objectHeaders(req)).toEqual(expect.objectContaining({
				contentType: 'text/plain',
				cacheControl: 'max-age=60',
				metadata: { owner: 'tom' },
			}))
		})

		it('drops the aws-chunked transfer framing from the content encoding', () => {
			const req = makeRequest({ headers: { 'content-encoding': 'aws-chunked' } })

			expect(service.objectHeaders(req).contentEncoding).toBeUndefined()
		})

		it('keeps a real content encoding sent alongside aws-chunked', () => {
			const req = makeRequest({ headers: { 'content-encoding': 'gzip, aws-chunked' } })

			expect(service.objectHeaders(req).contentEncoding).toBe('gzip')
		})
	})
})
