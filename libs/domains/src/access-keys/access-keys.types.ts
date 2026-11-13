import { AccessKeyStatus } from '@storage/database'

export namespace AccessKeysTypes {
	export const BOOTSTRAP_ACCESS_KEY_ID_PATTERN = /^[A-Z0-9]{16,128}$/
	export const BOOTSTRAP_SECRET_MIN_LENGTH = 32
	export const BOOTSTRAP_KEY_DESCRIPTION = 'Bootstrap key (BOOTSTRAP_ACCESS_KEY_ID)'

	export interface BootstrapKey {
		accessKeyId: string
		secretAccessKey: string
	}

	/** Both unset means the feature is off; one without the other, or a malformed value, is a
	 *  configuration error - a half-configured key must stop the boot, not silently do nothing. */
	export function parseBootstrapKey(env: { accessKeyId?: string, secretAccessKey?: string }): BootstrapKey | null {
		const accessKeyId = env.accessKeyId || undefined
		const secretAccessKey = env.secretAccessKey || undefined

		if (!accessKeyId && !secretAccessKey) return null
		if (!accessKeyId || !secretAccessKey) {
			throw new Error('BOOTSTRAP_ACCESS_KEY_ID and BOOTSTRAP_SECRET_ACCESS_KEY must be set together')
		}
		if (!BOOTSTRAP_ACCESS_KEY_ID_PATTERN.test(accessKeyId)) {
			throw new Error('BOOTSTRAP_ACCESS_KEY_ID must be 16-128 characters of A-Z and 0-9')
		}
		if (secretAccessKey.length < BOOTSTRAP_SECRET_MIN_LENGTH) {
			throw new Error(`BOOTSTRAP_SECRET_ACCESS_KEY must be at least ${BOOTSTRAP_SECRET_MIN_LENGTH} characters long`)
		}
		return { accessKeyId, secretAccessKey }
	}

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
