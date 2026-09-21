import { ApiProperty } from '@nestjs/swagger'
import { StorageClass } from '@storage/database'
import { Api } from '@storage/shared'
import { Type } from 'class-transformer'
import { IsBoolean, IsInt, IsOptional, IsString, Max, Min } from 'class-validator'

export namespace ObjectsDto {
	export enum ErrorCodes {
		OBJECT_NOT_FOUND = 'object_not_found',
		VERSION_NOT_FOUND = 'version_not_found',
		BUCKET_NOT_FOUND = 'bucket_not_found',
		PERMISSION_DENIED = 'permission_denied',
		INVALID_KEY = 'invalid_key',
		OBJECT_ALREADY_EXISTS = 'object_already_exists',
		BAD_DIGEST = 'bad_digest',
		BUCKET_QUOTA_EXCEEDED = 'bucket_quota_exceeded',
		USER_QUOTA_EXCEEDED = 'user_quota_exceeded',
		NO_USABLE_ACCESS_KEY = 'no_usable_access_key',
		PAYLOAD_TOO_LARGE = 'payload_too_large',
	}

	/** Longest lifetime a shared link may be given - SigV4's own ceiling. */
	export const MAX_PRESIGN_SECONDS = 7 * 24 * 3600

	export class ObjectItem {
		@ApiProperty({ type: 'string' })
		declare key: string

		@ApiProperty({ type: 'integer' })
		declare size: number

		@ApiProperty({ type: 'string' })
		declare etag: string

		@ApiProperty({ type: 'string', nullable: true, required: false })
		declare contentType: string | null

		@ApiProperty({ type: 'string' })
		declare versionId: string

		@ApiProperty({ type: 'string', format: 'date-time' })
		declare lastModified: Date
	}

	export class ListObjectsQuery {
		@ApiProperty({ type: 'string', required: false, description: 'Only keys starting with this prefix' })
		@IsOptional()
		@IsString()
		declare prefix?: string

		@ApiProperty({ type: 'string', required: false, description: 'Collapses keys into folders, typically "/"' })
		@IsOptional()
		@IsString()
		declare delimiter?: string

		// A query string carries numbers as text, and the validation pipe does not convert
		// implicitly - without `@Type` every `?maxKeys=` would be rejected as "not an integer".
		@ApiProperty({ type: 'integer', required: false, minimum: 1, default: 1000 })
		@IsOptional()
		@Type(() => Number)
		@IsInt()
		@Min(1)
		declare maxKeys?: number

		@ApiProperty({ type: 'string', required: false })
		@IsOptional()
		@IsString()
		declare continuationToken?: string
	}

	export class ListObjectsResponse {
		@ApiProperty({ type: ObjectItem, isArray: true })
		declare objects: ObjectItem[]

		@ApiProperty({ type: 'string', isArray: true, description: 'Synthetic folders produced by the delimiter' })
		declare commonPrefixes: string[]

		@ApiProperty({ type: 'boolean' })
		declare isTruncated: boolean

		@ApiProperty({ type: 'string', nullable: true, required: false })
		declare nextContinuationToken?: string
	}

	export class ObjectVersionItem {
		@ApiProperty({ type: 'string' })
		declare versionId: string

		@ApiProperty({ type: 'boolean' })
		declare isLatest: boolean

		@ApiProperty({ type: 'boolean' })
		declare isDeleteMarker: boolean

		@ApiProperty({ type: 'integer' })
		declare size: number

		@ApiProperty({ type: 'string' })
		declare etag: string

		@ApiProperty({ enum: StorageClass })
		declare storageClass: StorageClass

		@ApiProperty({ type: 'string', format: 'date-time' })
		declare createdAt: Date
	}

	export class UploadObjectQuery {
		@ApiProperty({ type: 'string', description: 'Full key the payload is stored under' })
		@IsString()
		declare key: string
	}

	export class UploadObjectResponse {
		@ApiProperty({ type: 'string' })
		declare key: string

		@ApiProperty({ type: 'string' })
		declare etag: string

		@ApiProperty({ type: 'integer' })
		declare size: number

		@ApiProperty({ type: 'string' })
		declare versionId: string
	}

	export class DownloadObjectQuery {
		@ApiProperty({ type: 'string' })
		@IsString()
		declare key: string

		@ApiProperty({ type: 'string', required: false, description: 'Defaults to the newest version' })
		@IsOptional()
		@IsString()
		declare versionId?: string
	}

	export class DeleteObjectQuery {
		@ApiProperty({ type: 'string', required: false, description: 'One key; mutually exclusive with prefix' })
		@IsOptional()
		@IsString()
		declare key?: string

		@ApiProperty({ type: 'string', required: false, description: 'Deletes every key under the prefix (a folder)' })
		@IsOptional()
		@IsString()
		declare prefix?: string

		@ApiProperty({ type: 'string', required: false, description: 'Removes exactly this version instead of adding a delete marker' })
		@IsOptional()
		@IsString()
		declare versionId?: string
	}

	export class DeleteObjectResponse {
		@ApiProperty({ type: 'integer', description: 'Keys removed, or hidden behind a delete marker' })
		declare deletedCount: number

		@ApiProperty({ type: 'string', isArray: true, description: 'Keys that could not be removed' })
		declare failedKeys: string[]
	}

	export class CreateFolderBody {
		@ApiProperty({ type: 'string', description: 'Folder key; a trailing slash is added when missing' })
		@IsString()
		declare key: string
	}

	export class CopyObjectBody {
		@ApiProperty({ type: 'string', description: 'Key to copy from; a trailing slash copies the whole folder' })
		@IsString()
		declare sourceKey: string

		@ApiProperty({ type: 'string' })
		@IsString()
		declare targetKey: string

		@ApiProperty({ type: 'string', required: false, description: 'Defaults to the same bucket' })
		@IsOptional()
		@IsString()
		declare targetBucket?: string

		@ApiProperty({ type: 'boolean', required: false, description: 'Removes the source afterwards, i.e. a rename' })
		@IsOptional()
		@IsBoolean()
		declare move?: boolean
	}

	export class CopyObjectResponse {
		@ApiProperty({ type: 'integer' })
		declare copiedCount: number
	}

	export class PresignObjectBody {
		@ApiProperty({ type: 'string' })
		@IsString()
		declare key: string

		@ApiProperty({ type: 'integer', required: false, minimum: 1, maximum: MAX_PRESIGN_SECONDS, default: 3600 })
		@IsOptional()
		@IsInt()
		@Min(1)
		@Max(MAX_PRESIGN_SECONDS)
		declare expiresIn?: number

		@ApiProperty({ type: 'string', required: false })
		@IsOptional()
		@IsString()
		declare versionId?: string
	}

	export class PresignObjectResponse {
		@ApiProperty({ type: 'string', description: 'Signed S3 URL usable without any further credentials' })
		declare url: string

		@ApiProperty({ type: 'string', format: 'date-time' })
		declare expiresAt: Date
	}

	export class ObjectBadRequestError extends Api.createErrorDto([
		ErrorCodes.INVALID_KEY,
		ErrorCodes.OBJECT_ALREADY_EXISTS,
		ErrorCodes.BAD_DIGEST,
		ErrorCodes.BUCKET_QUOTA_EXCEEDED,
		ErrorCodes.USER_QUOTA_EXCEEDED,
		ErrorCodes.NO_USABLE_ACCESS_KEY,
	]) {}

	export class ObjectNotFoundError extends Api.createErrorDto([
		ErrorCodes.OBJECT_NOT_FOUND,
		ErrorCodes.VERSION_NOT_FOUND,
		ErrorCodes.BUCKET_NOT_FOUND,
	]) {}

	export class ObjectForbiddenError extends Api.createErrorDto([ErrorCodes.PERMISSION_DENIED]) {}

	export class ObjectTooLargeError extends Api.createErrorDto([ErrorCodes.PAYLOAD_TOO_LARGE]) {}
}
