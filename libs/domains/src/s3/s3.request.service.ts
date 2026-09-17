import { Injectable } from '@nestjs/common'
import { StorageClass } from '@storage/database'
import { Request } from 'express'
import { Readable } from 'stream'

import { ObjectsTypes } from '../objects/objects.types'
import { S3ChunkedStream } from './s3.chunked.stream'
import { S3Exception } from './s3.exception'
import { S3SignatureService } from './s3.signature.service'
import { S3Types } from './s3.types'

/** Largest body accepted for the XML/JSON documents of control operations
 *  (`PutBucketPolicy`, `DeleteObjects`, `CompleteMultipartUpload`, ...). Object payloads are
 *  streamed and never go through here. */
const MAX_CONTROL_BODY_BYTES = 2 * 1024 * 1024

/** Reads the parts of an incoming S3 request that the wire format dictates: which sub-resource
 *  the query string selects, the bucket/key the path encodes, the payload stream (decoding
 *  `aws-chunked` framing), ranges, conditional headers and user metadata.
 *
 *  Controllers hold only handlers, so all of this request shaping lives here. */
@Injectable()
export class S3RequestService {
	constructor(
		private readonly signatureService: S3SignatureService,
	) {}

	/** Which `?subresource` the request selects. Sub-resources a real S3 answers but this
	 *  deployment does not implement fail as `NotImplemented` rather than as a missing key. */
	subResource(req: Request): S3Types.SubResource {
		const keys = Object.keys(req.query)

		const unimplemented = keys.find((key) => (S3Types.UNIMPLEMENTED_SUBRESOURCES as readonly string[]).includes(key))
		if (unimplemented) throw new S3Exception('NotImplemented', unimplemented)

		const known = [
			S3Types.SubResource.uploadId,
			S3Types.SubResource.uploads,
			S3Types.SubResource.versioning,
			S3Types.SubResource.versions,
			S3Types.SubResource.policy,
			S3Types.SubResource.cors,
			S3Types.SubResource.location,
			S3Types.SubResource.delete,
		]

		return known.find((subResource) => keys.includes(subResource)) ?? S3Types.SubResource.none
	}

	/** Bucket and object key taken from the (already path-style) request path. Keys may contain
	 *  slashes and percent-encoded characters, so they are decoded segment by segment. */
	bucketAndKey(req: Request): { bucket: string, key: string } {
		const [path] = req.url.split('?')
		const segments = path.split('/').filter((segment, index) => index > 0 || segment !== '')

		const [bucket, ...rest] = segments
		return {
			bucket: this.decodeSegment(bucket ?? ''),
			key: rest.map((segment) => this.decodeSegment(segment)).join('/'),
		}
	}

	/** The object payload as a plain byte stream: `aws-chunked` framing is stripped and, when
	 *  the chunks are signed, verified on the way through. */
	payloadStream(req: Request, identity: S3Types.RequestIdentity): Readable {
		const payloadHash = this.header(req, 'x-amz-content-sha256')

		if (payloadHash === S3Types.STREAMING_SIGNED_PAYLOAD || payloadHash === S3Types.STREAMING_SIGNED_PAYLOAD_TRAILER) {
			if (!identity.chunkSigning) throw new S3Exception('InvalidRequest')
			return req.pipe(new S3ChunkedStream(this.signatureService, identity.chunkSigning))
		}

		if (payloadHash === S3Types.STREAMING_UNSIGNED_PAYLOAD) {
			return req.pipe(new S3ChunkedStream(this.signatureService))
		}

		return req
	}

	/** Size of the decoded payload: with `aws-chunked` the `Content-Length` counts the framing,
	 *  so the real size arrives in `x-amz-decoded-content-length`. */
	payloadLength(req: Request): number | undefined {
		const decoded = this.header(req, 'x-amz-decoded-content-length') ?? this.header(req, 'content-length')
		const length = Number(decoded)
		return Number.isFinite(length) ? length : undefined
	}

	/** Buffers a control-operation body (policy JSON, `DeleteObjects` XML, ...). */
	async readBody(req: Request): Promise<string> {
		const chunks: Buffer[] = []
		let size = 0

		for await (const chunk of req) {
			const buffer = chunk as Buffer
			size += buffer.length
			if (size > MAX_CONTROL_BODY_BYTES) throw new S3Exception('EntityTooLarge')
			chunks.push(buffer)
		}

		return Buffer.concat(chunks).toString('utf8')
	}

	/** `Range: bytes=0-99`, `bytes=100-` and `bytes=-100` resolved against the object size.
	 *  An unsatisfiable range is an error; a syntactically odd one is ignored, as in S3. */
	parseRange(req: Request, size: number): S3Types.ResolvedRange | undefined {
		const header = this.header(req, 'range')
		if (!header) return undefined

		const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
		if (!match) return undefined

		const [, startPart, endPart] = match
		if (startPart === '' && endPart === '') return undefined

		if (startPart === '') {
			const suffix = Number(endPart)
			if (suffix <= 0) throw new S3Exception('InvalidRange')
			return { start: Math.max(size - suffix, 0), end: size - 1 }
		}

		const start = Number(startPart)
		const end = endPart === '' ? size - 1 : Math.min(Number(endPart), size - 1)

		if (start >= size || start > end) throw new S3Exception('InvalidRange')
		return { start, end }
	}

	conditionalHeaders(req: Request): S3Types.ConditionalHeaders {
		const ifModifiedSince = this.header(req, 'if-modified-since')
		const ifUnmodifiedSince = this.header(req, 'if-unmodified-since')

		return {
			ifMatch: this.header(req, 'if-match'),
			ifNoneMatch: this.header(req, 'if-none-match'),
			ifModifiedSince: ifModifiedSince ? new Date(ifModifiedSince) : undefined,
			ifUnmodifiedSince: ifUnmodifiedSince ? new Date(ifUnmodifiedSince) : undefined,
		}
	}

	/** Applies `If-Match` / `If-None-Match` / `If-Modified-Since` / `If-Unmodified-Since` to a
	 *  stored version: a failed precondition ends the request before any bytes are read.
	 *  `If-Match` and `If-Unmodified-Since` fail with 412, the other two answer 304. */
	assertConditions({ req, etag, lastModified }: { req: Request, etag: string, lastModified: Date }): void {
		const conditions = this.conditionalHeaders(req)
		// HTTP dates have a one second resolution, so the stored timestamp is truncated too.
		const modifiedAt = Math.floor(lastModified.getTime() / 1000) * 1000

		if (conditions.ifMatch && !this.etagMatches(conditions.ifMatch, etag)) throw new S3Exception('PreconditionFailed')
		if (conditions.ifUnmodifiedSince && !Number.isNaN(conditions.ifUnmodifiedSince.getTime())
			&& modifiedAt > conditions.ifUnmodifiedSince.getTime()) throw new S3Exception('PreconditionFailed')

		if (conditions.ifNoneMatch) {
			if (this.etagMatches(conditions.ifNoneMatch, etag)) throw new S3Exception('NotModified')
			return
		}

		if (conditions.ifModifiedSince && !Number.isNaN(conditions.ifModifiedSince.getTime())
			&& modifiedAt <= conditions.ifModifiedSince.getTime()) throw new S3Exception('NotModified')
	}

	/** `response-content-type` and friends, which override the stored headers on a GET. */
	responseOverrides(req: Request): Record<string, string | undefined> {
		const names = [
			'response-content-type', 'response-content-language', 'response-expires',
			'response-cache-control', 'response-content-disposition', 'response-content-encoding',
		]

		return Object.fromEntries(names.map((name) => [name, this.query(req, name)]))
	}

	/** `x-amz-meta-*` headers, with the prefix stripped. */
	userMetadata(req: Request): Record<string, string> {
		const metadata: Record<string, string> = {}

		for (const [name, value] of Object.entries(req.headers)) {
			if (!name.startsWith('x-amz-meta-')) continue
			metadata[name.slice('x-amz-meta-'.length)] = Array.isArray(value) ? value.join(',') : (value ?? '')
		}

		return metadata
	}

	/** The headers stored with an object version: the HTTP entity headers plus `x-amz-meta-*`. */
	objectHeaders(req: Request): ObjectsTypes.ObjectHeaders {
		const metadata = this.userMetadata(req)

		return {
			contentType: this.header(req, 'content-type'),
			contentEncoding: this.contentEncoding(req),
			cacheControl: this.header(req, 'cache-control'),
			contentDisposition: this.header(req, 'content-disposition'),
			metadata: Object.keys(metadata).length ? metadata : null,
			storageClass: StorageClass.standard,
		}
	}

	/** `x-amz-copy-source-range: bytes=first-last` on an `UploadPartCopy`. */
	copySourceRange(req: Request, size: number): S3Types.ResolvedRange | undefined {
		const header = this.header(req, 'x-amz-copy-source-range')
		if (!header) return undefined

		const match = /^bytes=(\d+)-(\d+)$/.exec(header.trim())
		if (!match) throw new S3Exception('InvalidArgument', header)

		const start = Number(match[1])
		const end = Math.min(Number(match[2]), size - 1)
		if (start >= size || start > end) throw new S3Exception('InvalidRange')

		return { start, end }
	}

	/** `x-amz-copy-source: /bucket/key?versionId=...` (a leading slash is optional). */
	copySource(req: Request): S3Types.CopySource | undefined {
		const raw = this.header(req, 'x-amz-copy-source')
		if (!raw) return undefined

		const [pathPart, queryPart] = decodeURIComponent(raw).replace(/^\//, '').split('?')
		const [bucket, ...rest] = pathPart.split('/')
		if (!bucket || rest.length === 0) throw new S3Exception('InvalidArgument', raw)

		return {
			bucket,
			key: rest.join('/'),
			versionId: new URLSearchParams(queryPart ?? '').get('versionId') ?? undefined,
		}
	}

	query(req: Request, name: string): string | undefined {
		const value = req.query[name]
		// A repeated query parameter arrives as an array; S3 acts on the first occurrence.
		const first = Array.isArray(value) ? value[0] : value
		return typeof first === 'string' ? first : undefined
	}

	queryNumber(req: Request, name: string): number | undefined {
		const value = this.query(req, name)
		if (value === undefined || value === '') return undefined

		const parsed = Number(value)
		if (!Number.isFinite(parsed)) throw new S3Exception('InvalidArgument', name)
		return parsed
	}

	header(req: Request, name: string): string | undefined {
		const value = req.headers[name.toLowerCase()]
		return Array.isArray(value) ? value.join(',') : value
	}

	/** S3 quotes ETags in headers and XML bodies; internally they are stored bare. */
	formatEtag(etag: string): string {
		return `"${etag}"`
	}

	/** `aws-chunked` is transfer framing, not a content encoding of the stored object, so it
	 *  never reaches the stored headers. */
	private contentEncoding(req: Request): string | undefined {
		const value = this.header(req, 'content-encoding')
		if (!value) return undefined

		const encodings = value.split(',').map((encoding) => encoding.trim()).filter((encoding) => encoding !== 'aws-chunked')
		return encodings.length ? encodings.join(', ') : undefined
	}

	/** An `If-Match` / `If-None-Match` value is a comma separated list of quoted ETags, or `*`. */
	private etagMatches(header: string, etag: string): boolean {
		return header
			.split(',')
			.map((candidate) => candidate.trim().replace(/^W\//, '').replace(/"/g, ''))
			.some((candidate) => candidate === '*' || candidate === etag)
	}

	/** `%2F` in a path segment is part of the key, not a separator, so segments are decoded
	 *  one by one - and a malformed escape is left as-is rather than failing the request. */
	private decodeSegment(segment: string): string {
		try {
			return decodeURIComponent(segment)
		} catch {
			return segment
		}
	}
}
