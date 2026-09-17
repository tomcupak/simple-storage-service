import { ApiProperty } from '@nestjs/swagger'
import { StorageClass } from '@storage/database'
import { Api } from '@storage/shared'
import { IsInt, IsOptional, IsString, Min } from 'class-validator'

export namespace ObjectsDto {
	export enum ErrorCodes {
		OBJECT_NOT_FOUND = 'object_not_found',
		VERSION_NOT_FOUND = 'version_not_found',
		BUCKET_NOT_FOUND = 'bucket_not_found',
		PERMISSION_DENIED = 'permission_denied',
	}

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

		@ApiProperty({ type: 'integer', required: false, minimum: 1, default: 1000 })
		@IsOptional()
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

	export class ObjectNotFoundError extends Api.createErrorDto([
		ErrorCodes.OBJECT_NOT_FOUND,
		ErrorCodes.VERSION_NOT_FOUND,
		ErrorCodes.BUCKET_NOT_FOUND,
	]) {}

	export class ObjectForbiddenError extends Api.createErrorDto([ErrorCodes.PERMISSION_DENIED]) {}
}
