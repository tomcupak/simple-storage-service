import { ApiProperty } from '@nestjs/swagger'
import { UserRole, UserStatus } from '@storage/database'
import { Api } from '@storage/shared'
import { IsEmail, IsEnum, IsOptional, IsString, MinLength } from 'class-validator'

export namespace UsersDto {
	export enum ErrorCodes {
		USER_NOT_FOUND = 'user_not_found',
		EMAIL_ALREADY_USED = 'email_already_used',
		LAST_ADMIN = 'last_admin',
		INVALID_CURRENT_PASSWORD = 'invalid_current_password',
	}

	export class UserItem {
		@ApiProperty({ type: 'string', format: 'uuid' })
		declare guid: string

		@ApiProperty({ type: 'string', format: 'email' })
		declare email: string

		@ApiProperty({ type: 'string', nullable: true, required: false })
		declare name: string | null

		@ApiProperty({ enum: UserRole })
		declare role: UserRole

		@ApiProperty({ enum: UserStatus })
		declare status: UserStatus

		@ApiProperty({ type: 'integer', nullable: true, description: 'Storage limit in bytes; null means unlimited' })
		declare quotaBytes: number | null

		@ApiProperty({ type: 'string', format: 'date-time', nullable: true, required: false })
		declare lastLoginAt: Date | null

		@ApiProperty({ type: 'string', format: 'date-time' })
		declare createdAt: Date
	}

	export class CreateUserBody {
		@ApiProperty({ type: 'string', format: 'email' })
		@IsEmail()
		declare email: string

		@ApiProperty({ type: 'string' })
		@IsString()
		@MinLength(8)
		declare password: string

		@ApiProperty({ type: 'string', required: false })
		@IsOptional()
		@IsString()
		declare name?: string

		@ApiProperty({ enum: UserRole })
		@IsEnum(UserRole)
		declare role: UserRole
	}

	export class SetPasswordBody {
		@ApiProperty({ type: 'string' })
		@IsString()
		@MinLength(8)
		declare password: string

		@ApiProperty({
			type: 'string',
			required: false,
			description: 'Required when changing your own password; an admin resetting someone else\'s omits it',
		})
		@IsOptional()
		@IsString()
		declare currentPassword?: string
	}

	export class UpdateUserBody {
		@ApiProperty({ type: 'string', nullable: true, required: false })
		@IsOptional()
		@IsString()
		declare name?: string | null

		@ApiProperty({ enum: UserRole, required: false })
		@IsOptional()
		@IsEnum(UserRole)
		declare role?: UserRole
	}

	export class SetUserStatusBody {
		@ApiProperty({ enum: UserStatus })
		@IsEnum(UserStatus)
		declare status: UserStatus
	}

	export class UserPage extends Api.PaginatedDataDto<UserItem> {
		@ApiProperty({ type: UserItem, isArray: true })
		declare data: UserItem[]
	}

	export class UserNotFoundError extends Api.createErrorDto([ErrorCodes.USER_NOT_FOUND]) {}
	export class CreateUserBadRequestError extends Api.createErrorDto([ErrorCodes.EMAIL_ALREADY_USED]) {}
	export class DeleteUserBadRequestError extends Api.createErrorDto([ErrorCodes.LAST_ADMIN]) {}
	export class SetPasswordBadRequestError extends Api.createErrorDto([ErrorCodes.INVALID_CURRENT_PASSWORD]) {}
}
