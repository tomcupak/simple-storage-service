import { UserRole } from '@storage/database'

export namespace AuthTypes {
	/** Identity attached to `response.locals.user` by the guard for every secured endpoint. */
	export interface Identity {
		guid: string
		email: string
		role: UserRole
	}

	export interface AccessTokenPayload {
		sub: string
		email: string
		role: UserRole
		type: 'access'
	}

	export interface Tokens {
		accessToken: string
		refreshToken: string
		expiresIn: number
	}

	export class InvalidCredentialsError extends Error { public code = 'invalid_credentials' }
	export class InvalidRefreshTokenError extends Error { public code = 'invalid_refresh_token' }
	export class UserDisabledError extends Error { public code = 'user_disabled' }
}
