import { ApiProperty } from '@nestjs/swagger'
import { Api } from '@storage/shared'
import { IsInt, IsOptional, Min } from 'class-validator'

export namespace UsageDto {
	export enum ErrorCodes {
		BUCKET_NOT_FOUND = 'bucket_not_found',
		USER_NOT_FOUND = 'user_not_found',
		PERMISSION_DENIED = 'permission_denied',
		BUCKET_QUOTA_EXCEEDED = 'bucket_quota_exceeded',
		USER_QUOTA_EXCEEDED = 'user_quota_exceeded',
	}

	export class UsageItem {
		@ApiProperty({ type: 'integer', description: 'Keys whose newest version is not a delete marker' })
		declare objectCount: number

		@ApiProperty({ type: 'integer', description: 'Stored versions carrying a payload' })
		declare versionCount: number

		@ApiProperty({ type: 'integer', description: 'Bytes of all stored versions' })
		declare versionBytes: number

		@ApiProperty({ type: 'integer', description: 'Bytes held by unfinished multipart uploads' })
		declare multipartBytes: number

		@ApiProperty({ type: 'integer', description: 'Bytes counted against the quota' })
		declare totalBytes: number
	}

	export class BucketUsageItem extends UsageItem {
		@ApiProperty({ type: 'string', format: 'uuid' })
		declare bucketGuid: string

		@ApiProperty({ type: 'string' })
		declare bucketName: string

		@ApiProperty({ type: 'string', format: 'uuid' })
		declare ownerUserGuid: string

		@ApiProperty({ type: 'integer', nullable: true, required: false, description: 'null means unlimited' })
		declare quotaBytes: number | null
	}

	export class UserUsageItem extends UsageItem {
		@ApiProperty({ type: 'string', format: 'uuid' })
		declare userGuid: string

		@ApiProperty({ type: 'string', format: 'email' })
		declare email: string

		@ApiProperty({ type: 'integer' })
		declare bucketCount: number

		@ApiProperty({ type: 'integer', nullable: true, required: false, description: 'null means unlimited' })
		declare quotaBytes: number | null
	}

	export class SetQuotaBody {
		@ApiProperty({ type: 'integer', nullable: true, required: false, minimum: 0, description: 'null or omitted removes the quota' })
		@IsOptional()
		@IsInt()
		@Min(0)
		declare quotaBytes?: number | null
	}

	export class UsageNotFoundError extends Api.createErrorDto([ErrorCodes.BUCKET_NOT_FOUND, ErrorCodes.USER_NOT_FOUND]) {}
	export class UsageForbiddenError extends Api.createErrorDto([ErrorCodes.PERMISSION_DENIED]) {}
	export class QuotaExceededError extends Api.createErrorDto([
		ErrorCodes.BUCKET_QUOTA_EXCEEDED,
		ErrorCodes.USER_QUOTA_EXCEEDED,
	]) {}
}
