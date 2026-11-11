import { ApiProperty } from '@nestjs/swagger'
import { MigrationBucketMode, MigrationBucketStatus, MigrationJobStatus } from '@storage/database'
import { Api } from '@storage/shared'
import { Type } from 'class-transformer'
import {
	ArrayMaxSize,
	ArrayMinSize,
	IsArray,
	IsBoolean,
	IsInt,
	IsNotEmpty,
	IsOptional,
	IsString,
	Max,
	Min,
	ValidateNested,
} from 'class-validator'

export namespace MigrationDto {
	export enum ErrorCodes {
		SOURCE_UNREACHABLE = 'migration_source_unreachable',
		SOURCE_AUTH_FAILED = 'migration_source_auth_failed',
		SOURCE_BUCKET_NOT_FOUND = 'migration_source_bucket_not_found',
		ALREADY_RUNNING = 'migration_already_running',
		NOT_CANCELLABLE = 'migration_not_cancellable',
		NOT_FOUND = 'migration_not_found',
	}

	export class SourceBody {
		@ApiProperty({ type: 'string', description: 'Host name or address of the MinIO server' })
		@IsString()
		@IsNotEmpty()
		declare host: string

		@ApiProperty({ type: 'integer' })
		@Type(() => Number)
		@IsInt()
		@Min(1)
		@Max(65535)
		declare port: number

		@ApiProperty({ type: 'boolean' })
		@IsBoolean()
		declare useSsl: boolean

		@ApiProperty({ type: 'string', description: 'Access key id, for MinIO the root user' })
		@IsString()
		@IsNotEmpty()
		declare accessKeyId: string

		@ApiProperty({ type: 'string', description: 'Secret access key, for MinIO the root password' })
		@IsString()
		@IsNotEmpty()
		declare secretAccessKey: string

		@ApiProperty({ type: 'string', required: false, description: 'Defaults to us-east-1' })
		@IsOptional()
		@IsString()
		declare region?: string
	}

	export class StartBucketBody {
		@ApiProperty({ type: 'string', description: 'Name of the source bucket' })
		@IsString()
		@IsNotEmpty()
		declare name: string

		@ApiProperty({ type: 'boolean', required: false, description: 'Merge mode: overwrite keys that exist here with different content' })
		@IsOptional()
		@IsBoolean()
		declare overwrite?: boolean
	}

	export class StartMigrationBody {
		@ApiProperty({ type: SourceBody })
		@ValidateNested()
		@Type(() => SourceBody)
		declare source: SourceBody

		@ApiProperty({ type: StartBucketBody, isArray: true })
		@IsArray()
		@ArrayMinSize(1)
		@ArrayMaxSize(1000)
		@ValidateNested({ each: true })
		@Type(() => StartBucketBody)
		declare buckets: StartBucketBody[]
	}

	export class InspectBucketItem {
		@ApiProperty({ type: 'string' })
		declare name: string

		@ApiProperty({ type: 'integer' })
		declare objectCount: number

		@ApiProperty({ type: 'integer' })
		declare totalBytes: number

		@ApiProperty({ type: 'string', enum: ['Enabled', 'Suspended'], nullable: true })
		declare versioning: 'Enabled' | 'Suspended' | null

		@ApiProperty({ type: 'boolean' })
		declare hasPolicy: boolean

		@ApiProperty({ type: 'string', isArray: true, description: 'Codes: policy_invalid, policy_unsupported_condition:<Operator>' })
		declare policyWarnings: string[]

		@ApiProperty({ type: 'boolean', description: 'Whether the name is acceptable as a bucket name here' })
		declare nameValid: boolean

		@ApiProperty({ type: 'boolean', description: 'A bucket of that name exists here; it would be merged into' })
		declare existsLocally: boolean
	}

	export class InspectResponse {
		@ApiProperty({ type: InspectBucketItem, isArray: true })
		declare buckets: InspectBucketItem[]
	}

	export class MigrationJobItem {
		@ApiProperty({ type: 'string', format: 'uuid' })
		declare guid: string

		@ApiProperty({ enum: MigrationJobStatus })
		declare status: MigrationJobStatus

		@ApiProperty({ type: 'string' })
		declare sourceEndpoint: string

		@ApiProperty({ type: 'string', format: 'uuid' })
		declare createdByUserGuid: string

		@ApiProperty({ type: 'string', nullable: true, description: 'Error code or message when the job failed' })
		declare error: string | null

		@ApiProperty({ type: 'string', format: 'date-time', nullable: true })
		declare startedAt: Date | null

		@ApiProperty({ type: 'string', format: 'date-time', nullable: true })
		declare finishedAt: Date | null

		@ApiProperty({ type: 'string', format: 'date-time' })
		declare createdAt: Date

		@ApiProperty({ type: 'integer' })
		declare bucketCount: number

		@ApiProperty({ type: 'integer' })
		declare objectsTotal: number

		@ApiProperty({ type: 'integer', description: 'Copied or skipped as already present' })
		declare objectsDone: number

		@ApiProperty({ type: 'integer' })
		declare objectsFailed: number

		@ApiProperty({ type: 'integer' })
		declare objectsSkipped: number

		@ApiProperty({ type: 'integer' })
		declare bytesTotal: number

		@ApiProperty({ type: 'integer' })
		declare bytesDone: number
	}

	export class MigrationBucketItem {
		@ApiProperty({ type: 'string', format: 'uuid' })
		declare guid: string

		@ApiProperty({ type: 'string' })
		declare sourceName: string

		@ApiProperty({ enum: MigrationBucketMode })
		declare mode: MigrationBucketMode

		@ApiProperty({ type: 'boolean' })
		declare overwrite: boolean

		@ApiProperty({ enum: MigrationBucketStatus })
		declare status: MigrationBucketStatus

		@ApiProperty({ type: 'integer' })
		declare objectsTotal: number

		@ApiProperty({ type: 'integer' })
		declare objectsDone: number

		@ApiProperty({ type: 'integer' })
		declare objectsFailed: number

		@ApiProperty({ type: 'integer' })
		declare objectsSkipped: number

		@ApiProperty({ type: 'integer' })
		declare bytesTotal: number

		@ApiProperty({ type: 'integer' })
		declare bytesDone: number

		@ApiProperty({ type: 'boolean' })
		declare policyMigrated: boolean

		@ApiProperty({ type: 'string', isArray: true })
		declare policyWarnings: string[]

		@ApiProperty({ type: 'string', nullable: true })
		declare error: string | null
	}

	export class MigrationErrorItem {
		@ApiProperty({ type: 'string', format: 'uuid' })
		declare guid: string

		@ApiProperty({ type: 'string' })
		declare bucketName: string

		@ApiProperty({ type: 'string' })
		declare key: string

		@ApiProperty({ type: 'string' })
		declare code: string

		@ApiProperty({ type: 'string' })
		declare message: string

		@ApiProperty({ type: 'string', format: 'date-time' })
		declare createdAt: Date
	}

	export class MigrationJobDetail extends MigrationJobItem {
		@ApiProperty({ type: MigrationBucketItem, isArray: true })
		declare buckets: MigrationBucketItem[]

		@ApiProperty({ type: MigrationErrorItem, isArray: true, description: 'The most recent failures, newest first' })
		declare errors: MigrationErrorItem[]
	}

	export class SourceBadRequestError extends Api.createErrorDto([
		ErrorCodes.SOURCE_UNREACHABLE,
		ErrorCodes.SOURCE_AUTH_FAILED,
	]) {}

	export class StartBadRequestError extends Api.createErrorDto([
		ErrorCodes.SOURCE_UNREACHABLE,
		ErrorCodes.SOURCE_AUTH_FAILED,
		ErrorCodes.SOURCE_BUCKET_NOT_FOUND,
		ErrorCodes.ALREADY_RUNNING,
	]) {}

	export class CancelBadRequestError extends Api.createErrorDto([ErrorCodes.NOT_CANCELLABLE]) {}
	export class MigrationNotFoundError extends Api.createErrorDto([ErrorCodes.NOT_FOUND]) {}
}
