import { ApiProperty } from '@nestjs/swagger'
import { UserRole } from '@storage/database'
import { Api } from '@storage/shared'
import { IsEmail, IsString, MinLength } from 'class-validator'

export namespace AuthDto {
	export enum ErrorCodes {
		INVALID_CREDENTIALS = 'invalid_credentials',
		INVALID_REFRESH_TOKEN = 'invalid_refresh_token',
		USER_DISABLED = 'user_disabled',
	}

	export class LoginBody {
		@ApiProperty({ type: 'string', format: 'email' })
		@IsEmail()
		declare email: string

		@ApiProperty({ type: 'string' })
		@IsString()
		@MinLength(8)
		declare password: string
	}

	export class RefreshBody {
		@ApiProperty({ type: 'string' })
		@IsString()
		declare refreshToken: string
	}

	export class TokensResponse {
		@ApiProperty({ type: 'string' })
		declare accessToken: string

		@ApiProperty({ type: 'string' })
		declare refreshToken: string

		@ApiProperty({ type: 'integer', description: 'Access token lifetime in seconds' })
		declare expiresIn: number
	}

	export class IdentityResponse {
		@ApiProperty({ type: 'string', format: 'uuid' })
		declare guid: string

		@ApiProperty({ type: 'string', format: 'email' })
		declare email: string

		@ApiProperty({ enum: UserRole })
		declare role: UserRole
	}

	export class UnauthorizedError extends Api.createErrorDto([
		ErrorCodes.INVALID_CREDENTIALS,
		ErrorCodes.INVALID_REFRESH_TOKEN,
		ErrorCodes.USER_DISABLED,
	]) {}
}
