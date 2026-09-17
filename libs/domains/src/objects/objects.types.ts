import { BucketVersioning, StorageClass } from '@storage/database'
import { Readable } from 'stream'

export namespace ObjectsTypes {
	/** Version id used for objects in a bucket that has versioning disabled. */
	export const NULL_VERSION_ID = 'null'

	/** S3 requires every part but the last to be at least 5 MiB. */
	export const MIN_PART_SIZE = 5 * 1024 * 1024

	export const MAX_KEYS_LIMIT = 1000

	/** What `CopyObject` does with the source's system and user metadata. */
	export enum MetadataDirective {
		copy = 'COPY',
		replace = 'REPLACE',
	}

	/** Headers stored alongside an object version and replayed on `GetObject`. */
	export interface ObjectHeaders {
		contentType?: string | null
		contentEncoding?: string | null
		cacheControl?: string | null
		contentDisposition?: string | null
		metadata?: Record<string, string> | null
		storageClass?: StorageClass
	}

	/** The bucket an object operation runs against, in the terms the operation needs. */
	export interface BucketContext {
		guid: string
		versioning: BucketVersioning
	}

	export interface PutObjectParams extends ObjectHeaders {
		bucket: BucketContext
		key: string
		stream: Readable
		/** Base64 `Content-MD5` the client claims for the payload, verified after the write. */
		contentMd5?: string
		accessKeyId?: string
	}

	export interface PutObjectResult {
		versionId: string
		etag: string
		size: number
	}

	/** One stored version with everything `GetObject`/`HeadObject` need to answer. */
	export interface ObjectVersionDetail {
		objectGuid: string
		versionGuid: string
		key: string
		versionId: string
		isLatest: boolean
		isDeleteMarker: boolean
		size: number
		etag: string
		storagePath: string | null
		contentType: string | null
		contentEncoding: string | null
		cacheControl: string | null
		contentDisposition: string | null
		storageClass: StorageClass
		metadata: Record<string, string> | null
		lastModified: Date
	}

	export interface ObjectVersionItem {
		guid: string
		versionId: string
		isLatest: boolean
		isDeleteMarker: boolean
		size: number
		etag: string
		contentType: string | null
		storageClass: StorageClass
		metadata: Record<string, string> | null
		createdAt: Date
	}

	export interface ObjectItem {
		guid: string
		key: string
		size: number
		etag: string
		contentType: string | null
		versionId: string
		storageClass: StorageClass
		lastModified: Date
	}

	/** Result shape of a `ListObjectsV2`-style listing: keys plus the synthetic "folders"
	 *  produced by collapsing everything after `delimiter`. */
	export interface ListResult {
		objects: ObjectItem[]
		commonPrefixes: string[]
		isTruncated: boolean
		nextContinuationToken?: string
	}

	export interface ListQuery {
		bucketGuid: string
		prefix?: string
		delimiter?: string
		maxKeys?: number
		/** Opaque cursor handed out as `NextContinuationToken`. */
		continuationToken?: string
		/** Plain key to resume after (`start-after` in V2, `marker` in V1). */
		startAfter?: string
	}

	/** One row of `ListObjectVersions`: every version of every key, newest first per key. */
	export interface VersionListItem {
		key: string
		versionId: string
		isLatest: boolean
		isDeleteMarker: boolean
		size: number
		etag: string
		storageClass: StorageClass
		lastModified: Date
	}

	export interface ListVersionsResult {
		versions: VersionListItem[]
		commonPrefixes: string[]
		isTruncated: boolean
		nextKeyMarker?: string
		nextVersionIdMarker?: string
	}

	export interface ListVersionsQuery {
		bucketGuid: string
		prefix?: string
		delimiter?: string
		maxKeys?: number
		keyMarker?: string
		versionIdMarker?: string
	}

	/** What a `DeleteObject` did: a hard delete, or a new delete marker hiding the key. */
	export interface DeleteResult {
		versionId?: string
		isDeleteMarker: boolean
	}

	export interface DeletedEntry {
		key: string
		versionId?: string
		deleteMarker?: boolean
		deleteMarkerVersionId?: string
	}

	export interface DeleteErrorEntry {
		key: string
		code: string
		message: string
	}

	export interface DeleteManyResult {
		deleted: DeletedEntry[]
		errors: DeleteErrorEntry[]
	}

	export interface MultipartUploadItem {
		uploadId: string
		key: string
		storageClass: StorageClass
		initiatedAt: Date
	}

	export interface ListMultipartUploadsResult {
		uploads: MultipartUploadItem[]
		commonPrefixes: string[]
		isTruncated: boolean
		nextKeyMarker?: string
		nextUploadIdMarker?: string
	}

	export interface PartItem {
		partNumber: number
		size: number
		etag: string
		lastModified: Date
	}

	export interface ListPartsResult {
		parts: PartItem[]
		isTruncated: boolean
		nextPartNumberMarker?: number
	}

	/** One `<Part>` of a `CompleteMultipartUpload` request. */
	export interface CompletePart {
		partNumber: number
		etag: string
	}

	export class ObjectNotFoundError extends Error { public code = 'object_not_found' }
	export class VersionNotFoundError extends Error { public code = 'version_not_found' }
	export class InvalidRangeError extends Error { public code = 'invalid_range' }
	export class UploadNotFoundError extends Error { public code = 'upload_not_found' }
	export class InvalidPartError extends Error { public code = 'invalid_part' }
	export class InvalidPartOrderError extends Error { public code = 'invalid_part_order' }
	export class PartTooSmallError extends Error { public code = 'part_too_small' }
	export class BadDigestError extends Error { public code = 'bad_digest' }
}
