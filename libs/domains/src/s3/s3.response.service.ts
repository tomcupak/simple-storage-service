import { Injectable } from '@nestjs/common'
import { BucketVersioning } from '@storage/database'
import { Response } from 'express'

import { ObjectsTypes } from '../objects/objects.types'
import { S3Exception } from './s3.exception'
import { S3Types } from './s3.types'
import { S3XmlService } from './s3.xml.service'

/** Builds the XML documents and response headers of the S3 API.
 *
 *  Controllers hold only handlers, so the wire format of every answer - element names, header
 *  names, quoting of ETags - is decided here. */
@Injectable()
export class S3ResponseService {
	listObjectsV2({ bucket, result, prefix, delimiter, maxKeys, continuationToken, startAfter }: {
		bucket: string
		result: ObjectsTypes.ListResult
		prefix?: string
		delimiter?: string
		maxKeys: number
		continuationToken?: string
		startAfter?: string
	}): string {
		return S3XmlService.build('ListBucketResult', {
			Name: bucket,
			Prefix: prefix ?? '',
			Delimiter: delimiter,
			MaxKeys: maxKeys,
			KeyCount: result.objects.length + result.commonPrefixes.length,
			IsTruncated: result.isTruncated,
			ContinuationToken: continuationToken,
			NextContinuationToken: result.nextContinuationToken,
			StartAfter: startAfter,
			Contents: result.objects.map((object) => this.contents(object)),
			CommonPrefixes: result.commonPrefixes.map((commonPrefix) => ({ Prefix: commonPrefix })),
		})
	}

	/** `ListObjects` (v1) differs only in how the cursor is named and returned. */
	listObjectsV1({ bucket, result, prefix, delimiter, maxKeys, marker }: {
		bucket: string
		result: ObjectsTypes.ListResult
		prefix?: string
		delimiter?: string
		maxKeys: number
		marker?: string
	}): string {
		const lastEntry = result.objects[result.objects.length - 1]?.key ?? result.commonPrefixes[result.commonPrefixes.length - 1]

		return S3XmlService.build('ListBucketResult', {
			Name: bucket,
			Prefix: prefix ?? '',
			Marker: marker ?? '',
			Delimiter: delimiter,
			MaxKeys: maxKeys,
			IsTruncated: result.isTruncated,
			NextMarker: result.isTruncated ? lastEntry : undefined,
			Contents: result.objects.map((object) => this.contents(object)),
			CommonPrefixes: result.commonPrefixes.map((commonPrefix) => ({ Prefix: commonPrefix })),
		})
	}

	listVersions({ bucket, result, prefix, delimiter, maxKeys, keyMarker, versionIdMarker }: {
		bucket: string
		result: ObjectsTypes.ListVersionsResult
		prefix?: string
		delimiter?: string
		maxKeys: number
		keyMarker?: string
		versionIdMarker?: string
	}): string {
		const entry = (version: ObjectsTypes.VersionListItem) => ({
			Key: version.key,
			VersionId: version.versionId,
			IsLatest: version.isLatest,
			LastModified: version.lastModified.toISOString(),
		})

		return S3XmlService.build('ListVersionsResult', {
			Name: bucket,
			Prefix: prefix ?? '',
			Delimiter: delimiter,
			KeyMarker: keyMarker ?? '',
			VersionIdMarker: versionIdMarker ?? '',
			MaxKeys: maxKeys,
			IsTruncated: result.isTruncated,
			NextKeyMarker: result.nextKeyMarker,
			NextVersionIdMarker: result.nextVersionIdMarker,
			Version: result.versions.filter((version) => !version.isDeleteMarker).map((version) => ({
				...entry(version),
				ETag: this.quote(version.etag),
				Size: version.size,
				StorageClass: version.storageClass,
			})),
			DeleteMarker: result.versions.filter((version) => version.isDeleteMarker).map(entry),
			CommonPrefixes: result.commonPrefixes.map((commonPrefix) => ({ Prefix: commonPrefix })),
		})
	}

	listMultipartUploads({ bucket, result, prefix, delimiter, maxUploads, keyMarker, uploadIdMarker }: {
		bucket: string
		result: ObjectsTypes.ListMultipartUploadsResult
		prefix?: string
		delimiter?: string
		maxUploads: number
		keyMarker?: string
		uploadIdMarker?: string
	}): string {
		return S3XmlService.build('ListMultipartUploadsResult', {
			Bucket: bucket,
			Prefix: prefix ?? '',
			Delimiter: delimiter,
			KeyMarker: keyMarker ?? '',
			UploadIdMarker: uploadIdMarker ?? '',
			MaxUploads: maxUploads,
			IsTruncated: result.isTruncated,
			NextKeyMarker: result.nextKeyMarker,
			NextUploadIdMarker: result.nextUploadIdMarker,
			Upload: result.uploads.map((upload) => ({
				Key: upload.key,
				UploadId: upload.uploadId,
				StorageClass: upload.storageClass,
				Initiated: upload.initiatedAt.toISOString(),
			})),
			CommonPrefixes: result.commonPrefixes.map((commonPrefix) => ({ Prefix: commonPrefix })),
		})
	}

	listParts({ bucket, key, uploadId, result, maxParts, partNumberMarker }: {
		bucket: string
		key: string
		uploadId: string
		result: ObjectsTypes.ListPartsResult
		maxParts: number
		partNumberMarker?: number
	}): string {
		return S3XmlService.build('ListPartsResult', {
			Bucket: bucket,
			Key: key,
			UploadId: uploadId,
			PartNumberMarker: partNumberMarker ?? 0,
			NextPartNumberMarker: result.nextPartNumberMarker,
			MaxParts: maxParts,
			IsTruncated: result.isTruncated,
			Part: result.parts.map((part) => ({
				PartNumber: part.partNumber,
				LastModified: part.lastModified.toISOString(),
				ETag: this.quote(part.etag),
				Size: part.size,
			})),
		})
	}

	initiateMultipartUpload({ bucket, key, uploadId }: { bucket: string, key: string, uploadId: string }): string {
		return S3XmlService.build('InitiateMultipartUploadResult', { Bucket: bucket, Key: key, UploadId: uploadId })
	}

	completeMultipartUpload({ bucket, key, etag, location }: {
		bucket: string
		key: string
		etag: string
		location: string
	}): string {
		return S3XmlService.build('CompleteMultipartUploadResult', {
			Location: location,
			Bucket: bucket,
			Key: key,
			ETag: this.quote(etag),
		})
	}

	copyObjectResult({ etag, lastModified }: { etag: string, lastModified: Date }): string {
		return S3XmlService.build('CopyObjectResult', { LastModified: lastModified.toISOString(), ETag: this.quote(etag) })
	}

	copyPartResult({ etag, lastModified }: { etag: string, lastModified: Date }): string {
		return S3XmlService.build('CopyPartResult', { LastModified: lastModified.toISOString(), ETag: this.quote(etag) })
	}

	deleteObjects({ deleted, errors, quiet }: {
		deleted: { key: string, versionId?: string, deleteMarker?: boolean, deleteMarkerVersionId?: string }[]
		errors: { key: string, code: string, message: string }[]
		quiet: boolean
	}): string {
		return S3XmlService.build('DeleteResult', {
			Deleted: quiet ? [] : deleted.map((entry) => ({
				Key: entry.key,
				VersionId: entry.versionId,
				DeleteMarker: entry.deleteMarker ? true : undefined,
				DeleteMarkerVersionId: entry.deleteMarkerVersionId,
			})),
			Error: errors.map((error) => ({ Key: error.key, Code: error.code, Message: error.message })),
		})
	}

	bucketLocation(region: string): string {
		return S3XmlService.build('LocationConstraint', { '#text': region === 'us-east-1' ? '' : region })
	}

	/** An unversioned bucket answers with an empty configuration, as S3 does. */
	bucketVersioning(versioning: BucketVersioning): string {
		const status = versioning === BucketVersioning.enabled
			? 'Enabled'
			: versioning === BucketVersioning.suspended ? 'Suspended' : undefined

		return S3XmlService.build('VersioningConfiguration', status ? { Status: status } : {})
	}

	/** A delete marker has no payload: reading the key reports it as missing, and asking for the
	 *  marker's own version id is a method error, exactly as S3 answers. */
	assertReadable({ res, version }: { res: Response, version: ObjectsTypes.ObjectVersionDetail }): void {
		if (!version.isDeleteMarker) return

		res.setHeader('x-amz-delete-marker', 'true')
		res.setHeader('x-amz-version-id', version.versionId)
		throw new S3Exception(version.isLatest ? 'NoSuchKey' : 'MethodNotAllowed', version.key)
	}

	/** Headers describing a stored version, shared by `GetObject` and `HeadObject`.
	 *  `response-*` query parameters override what was stored, as S3 allows. */
	applyObjectHeaders({ res, version, overrides }: {
		res: Response
		version: ObjectsTypes.ObjectVersionDetail
		overrides?: Record<string, string | undefined>
	}): void {
		res.setHeader('ETag', this.quote(version.etag))
		res.setHeader('Last-Modified', version.lastModified.toUTCString())
		res.setHeader('Accept-Ranges', 'bytes')
		res.setHeader('x-amz-version-id', version.versionId)
		if (version.storageClass) res.setHeader('x-amz-storage-class', version.storageClass)

		const header = (name: string, stored: string | null | undefined, override?: string) => {
			const value = override ?? stored
			if (value) res.setHeader(name, value)
		}

		header('Content-Type', version.contentType ?? 'binary/octet-stream', overrides?.['response-content-type'])
		header('Content-Encoding', version.contentEncoding, overrides?.['response-content-encoding'])
		header('Cache-Control', version.cacheControl, overrides?.['response-cache-control'])
		header('Content-Disposition', version.contentDisposition, overrides?.['response-content-disposition'])
		header('Content-Language', undefined, overrides?.['response-content-language'])
		header('Expires', undefined, overrides?.['response-expires'])

		for (const [name, value] of Object.entries(version.metadata ?? {})) {
			res.setHeader(`x-amz-meta-${name}`, value)
		}
	}

	/** Echoes the CORS rule that matched back to the browser. */
	applyCorsHeaders({ res, rule, origin, method }: {
		res: Response
		rule: S3Types.CorsRule
		origin: string
		method?: string
	}): void {
		res.setHeader('Access-Control-Allow-Origin', rule.allowedOrigins.includes('*') ? '*' : origin)
		res.setHeader('Access-Control-Allow-Methods', rule.allowedMethods.join(', '))
		res.setHeader('Vary', 'Origin')

		if (rule.allowedHeaders?.length) res.setHeader('Access-Control-Allow-Headers', rule.allowedHeaders.join(', '))
		if (rule.exposeHeaders?.length) res.setHeader('Access-Control-Expose-Headers', rule.exposeHeaders.join(', '))
		if (rule.maxAgeSeconds !== undefined) res.setHeader('Access-Control-Max-Age', String(rule.maxAgeSeconds))
		if (method) res.setHeader('Access-Control-Allow-Method', method)
	}

	private contents(object: ObjectsTypes.ObjectItem): Record<string, unknown> {
		return {
			Key: object.key,
			LastModified: object.lastModified.toISOString(),
			ETag: this.quote(object.etag),
			Size: object.size,
			StorageClass: object.storageClass,
		}
	}

	private quote(etag: string): string {
		return `"${etag}"`
	}
}
