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

	/** The little of a user that resolving a `userGuid` needs: enough to name a grantee in the
	 *  UI, nothing about their role, quota or status. */
	export interface UserDirectoryItem {
		guid: string
		email: string
		name: string | null
	}

	export class UserNotFoundError extends Error { public code = 'user_not_found' }
	export class EmailAlreadyUsedError extends Error { public code = 'email_already_used' }
	export class LastAdminError extends Error { public code = 'last_admin' }
	/** Changing your own password without proving you know the current one. */
	export class InvalidCurrentPasswordError extends Error { public code = 'invalid_current_password' }
	/** Demoting or disabling the only remaining admin would lock everyone out of the deployment. */
	export class LastAdminDemotedError extends Error { public code = 'last_admin' }
}
