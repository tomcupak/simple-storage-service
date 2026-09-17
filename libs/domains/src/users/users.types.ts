import { UserRole } from '@storage/database'

export namespace UsersTypes {
	export interface UserItem {
		guid: string
		email: string
		name: string | null
		role: UserRole
		lastLoginAt: Date | null
		createdAt: Date
	}

	export class UserNotFoundError extends Error { public code = 'user_not_found' }
	export class EmailAlreadyUsedError extends Error { public code = 'email_already_used' }
	export class LastAdminError extends Error { public code = 'last_admin' }
}
