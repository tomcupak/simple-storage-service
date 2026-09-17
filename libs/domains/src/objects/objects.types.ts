import { StorageClass } from '@storage/database'

export namespace ObjectsTypes {
	/** Version id used for objects in a bucket that has versioning disabled. */
	export const NULL_VERSION_ID = 'null'

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
		continuationToken?: string
	}

	export class ObjectNotFoundError extends Error { public code = 'object_not_found' }
	export class VersionNotFoundError extends Error { public code = 'version_not_found' }
	export class InvalidRangeError extends Error { public code = 'invalid_range' }
}
