import { BucketAcl, BucketPermission, BucketVersioning } from '@storage/database'

export namespace BucketsTypes {
	/** S3 bucket naming rules (DNS-compatible subset): 3-63 chars, lowercase letters, digits,
	 *  dots and hyphens, starting and ending alphanumeric, not shaped like an IP address. */
	export const BUCKET_NAME_PATTERN = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/
	export const IP_ADDRESS_PATTERN = /^\d+\.\d+\.\d+\.\d+$/

	export interface BucketItem {
		guid: string
		name: string
		ownerUserGuid: string
		region: string
		acl: BucketAcl
		versioning: BucketVersioning
		createdAt: Date
	}

	export interface BucketGrant {
		bucketGuid: string
		userGuid: string
		permissions: BucketPermission[]
	}

	export class BucketNotFoundError extends Error { public code = 'bucket_not_found' }
	export class BucketAlreadyExistsError extends Error { public code = 'bucket_already_exists' }
	export class InvalidBucketNameError extends Error { public code = 'invalid_bucket_name' }
	export class BucketNotEmptyError extends Error { public code = 'bucket_not_empty' }
	export class PermissionDeniedError extends Error { public code = 'permission_denied' }
}
