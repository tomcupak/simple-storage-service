import { ApiProperty } from '@nestjs/swagger'
import { BucketAcl, BucketPermission, BucketVersioning } from '@storage/database'
import { Api } from '@storage/shared'
import { ArrayUnique, IsEnum, IsOptional, IsString, IsUUID } from 'class-validator'

import { UsageDto } from '../usage/usage.dto'

export namespace BucketsDto {
	export enum ErrorCodes {
		BUCKET_NOT_FOUND = 'bucket_not_found',
		BUCKET_ALREADY_EXISTS = 'bucket_already_exists',
		INVALID_BUCKET_NAME = 'invalid_bucket_name',
		BUCKET_NOT_EMPTY = 'bucket_not_empty',
		INVALID_VERSIONING = 'invalid_versioning',
		PERMISSION_DENIED = 'permission_denied',
	}

	export class BucketItem {
		@ApiProperty({ type: 'string', format: 'uuid' })
		declare guid: string

		@ApiProperty({ type: 'string' })
		declare name: string

		@ApiProperty({ type: 'string', format: 'uuid' })
		declare ownerUserGuid: string

		@ApiProperty({ type: 'string' })
		declare region: string

		@ApiProperty({ enum: BucketAcl })
		declare acl: BucketAcl

		@ApiProperty({ enum: BucketVersioning })
		declare versioning: BucketVersioning

		@ApiProperty({ type: 'integer', nullable: true, description: 'Storage limit in bytes; null means unlimited' })
		declare quotaBytes: number | null

		@ApiProperty({ type: 'string', format: 'date-time' })
		declare createdAt: Date
	}

	export class SetBucketAclBody {
		@ApiProperty({ enum: BucketAcl })
		@IsEnum(BucketAcl)
		declare acl: BucketAcl
	}

	export class SetBucketVersioningBody {
		@ApiProperty({ enum: BucketVersioning, description: 'S3 has no way back to "disabled" once versioning was enabled' })
		@IsEnum(BucketVersioning)
		declare versioning: BucketVersioning
	}

	/** Bucket settings plus what it currently holds - what the detail screen shows at once. */
	export class BucketDetail extends BucketItem {
		@ApiProperty({ type: UsageDto.UsageItem })
		declare usage: UsageDto.UsageItem
	}

	export class CreateBucketBody {
		@ApiProperty({ type: 'string', description: 'DNS-compatible bucket name (3-63 chars)' })
		@IsString()
		declare name: string

		@ApiProperty({ type: 'string', required: false })
		@IsOptional()
		@IsString()
		declare region?: string
	}

	export class BucketGrantItem {
		@ApiProperty({ type: 'string', format: 'uuid' })
		declare userGuid: string

		@ApiProperty({ enum: BucketPermission, isArray: true })
		declare permissions: BucketPermission[]
	}

	/** A grantee as the access screen needs them: enough to show who a `userGuid` is and to
	 *  offer them in the picker, without the role/quota/status a full user record carries. */
	export class BucketUserItem {
		@ApiProperty({ type: 'string', format: 'uuid' })
		declare guid: string

		@ApiProperty({ type: 'string', format: 'email' })
		declare email: string

		@ApiProperty({ type: 'string', nullable: true, required: false })
		declare name: string | null
	}

	export class SetBucketGrantBody {
		@ApiProperty({ type: 'string', format: 'uuid' })
		@IsUUID()
		declare userGuid: string

		@ApiProperty({ enum: BucketPermission, isArray: true })
		@IsEnum(BucketPermission, { each: true })
		@ArrayUnique()
		declare permissions: BucketPermission[]
	}

	export class BucketNotFoundError extends Api.createErrorDto([ErrorCodes.BUCKET_NOT_FOUND]) {}
	export class CreateBucketBadRequestError extends Api.createErrorDto([
		ErrorCodes.BUCKET_ALREADY_EXISTS,
		ErrorCodes.INVALID_BUCKET_NAME,
	]) {}
	export class DeleteBucketBadRequestError extends Api.createErrorDto([ErrorCodes.BUCKET_NOT_EMPTY]) {}
	export class SetVersioningBadRequestError extends Api.createErrorDto([ErrorCodes.INVALID_VERSIONING]) {}
	export class BucketForbiddenError extends Api.createErrorDto([ErrorCodes.PERMISSION_DENIED]) {}
}
