import { ApiProperty } from '@nestjs/swagger'
import { AccessKeyStatus } from '@storage/database'
import { Api } from '@storage/shared'
import { IsDateString, IsEnum, IsOptional, IsString, IsUUID } from 'class-validator'

export namespace AccessKeysDto {
	export enum ErrorCodes {
		ACCESS_KEY_NOT_FOUND = 'access_key_not_found',
		ACCESS_KEY_INACTIVE = 'access_key_inactive',
		NO_USABLE_ACCESS_KEY = 'no_usable_access_key',
		PERMISSION_DENIED = 'permission_denied',
	}

	export class AccessKeyItem {
		@ApiProperty({ type: 'string' })
		declare accessKeyId: string

		@ApiProperty({ type: 'string', format: 'uuid' })
		declare userGuid: string

		@ApiProperty({ type: 'string', nullable: true, required: false })
		declare description: string | null

		@ApiProperty({ enum: AccessKeyStatus })
		declare status: AccessKeyStatus

		@ApiProperty({ type: 'string', format: 'date-time', nullable: true, required: false })
		declare expiresAt: Date | null

		@ApiProperty({ type: 'string', format: 'date-time', nullable: true, required: false })
		declare lastUsedAt: Date | null

		@ApiProperty({ type: 'string', format: 'date-time' })
		declare createdAt: Date
	}

	export class CreatedAccessKey extends AccessKeyItem {
		@ApiProperty({ type: 'string', description: 'Returned only once, at creation time' })
		declare secretAccessKey: string
	}

	export class CreateAccessKeyBody {
		@ApiProperty({ type: 'string', format: 'uuid', required: false, description: 'Defaults to the calling user' })
		@IsOptional()
		@IsUUID()
		declare userGuid?: string

		@ApiProperty({ type: 'string', required: false })
		@IsOptional()
		@IsString()
		declare description?: string

		@ApiProperty({ type: 'string', format: 'date-time', required: false })
		@IsOptional()
		@IsDateString()
		declare expiresAt?: string
	}

	export class SetAccessKeyStatusBody {
		@ApiProperty({ enum: AccessKeyStatus })
		@IsEnum(AccessKeyStatus)
		declare status: AccessKeyStatus
	}

	export class AccessKeyPage extends Api.PaginatedDataDto<AccessKeyItem> {
		@ApiProperty({ type: AccessKeyItem, isArray: true })
		declare data: AccessKeyItem[]
	}

	export class AccessKeyNotFoundError extends Api.createErrorDto([ErrorCodes.ACCESS_KEY_NOT_FOUND]) {}
	export class AccessKeyForbiddenError extends Api.createErrorDto([ErrorCodes.PERMISSION_DENIED]) {}
}
