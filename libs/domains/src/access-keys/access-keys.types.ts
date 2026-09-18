import { AccessKeyStatus } from '@storage/database'

export namespace AccessKeysTypes {
	export interface AccessKeyItem {
		accessKeyId: string
		userGuid: string
		description: string | null
		status: AccessKeyStatus
		expiresAt: Date | null
		lastUsedAt: Date | null
		createdAt: Date
	}

	/** The secret is returned exactly once, on creation - afterwards only its encrypted form
	 *  is readable, and only by the SigV4 verifier. */
	export interface CreatedAccessKey extends AccessKeyItem {
		secretAccessKey: string
	}

	/** Credentials resolved for SigV4 verification of an incoming S3 request. */
	export interface ResolvedCredentials {
		accessKeyId: string
		secretAccessKey: string
		userGuid: string
	}

	export class AccessKeyNotFoundError extends Error { public code = 'access_key_not_found' }
	export class AccessKeyInactiveError extends Error { public code = 'access_key_inactive' }
	/** The user has no active key to sign a presigned URL with; they have to create one first. */
	export class NoUsableAccessKeyError extends Error { public code = 'no_usable_access_key' }
}
