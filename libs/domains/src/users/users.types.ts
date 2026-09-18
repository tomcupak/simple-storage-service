import { UserRole, UserStatus } from '@storage/database'

export namespace UsersTypes {
	export interface UserItem {
		guid: string
		email: string
		name: string | null
		role: UserRole
		status: UserStatus
		/** Storage limit across every bucket this user owns; null means unlimited. */
		quotaBytes: number | null
		lastLoginAt: Date | null
		createdAt: Date
	}

	export class UserNotFoundError extends Error { public code = 'user_not_found' }
	export class EmailAlreadyUsedError extends Error { public code = 'email_already_used' }
	export class LastAdminError extends Error { public code = 'last_admin' }
	/** Demoting or disabling the only remaining admin would lock everyone out of the deployment. */
	export class LastAdminDemotedError extends Error { public code = 'last_admin' }
}
