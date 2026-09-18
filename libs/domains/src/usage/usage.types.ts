export namespace UsageTypes {
	/** Bytes actually held on disk, and what they are made of. Every stored version counts,
	 *  not just the newest one - an old version occupies the same disk as a current one. */
	export interface Usage {
		/** Keys whose newest version is not a delete marker, i.e. what a listing shows. */
		objectCount: number
		/** Version rows carrying a payload, across every key. */
		versionCount: number
		/** Bytes of all stored versions. */
		versionBytes: number
		/** Bytes held by parts of multipart uploads that were never completed or aborted. */
		multipartBytes: number
		/** `versionBytes + multipartBytes` - the number a quota is compared against. */
		totalBytes: number
	}

	export interface BucketUsage extends Usage {
		bucketGuid: string
		bucketName: string
		ownerUserGuid: string
		quotaBytes: number | null
	}

	export interface UserUsage extends Usage {
		userGuid: string
		email: string
		bucketCount: number
		quotaBytes: number | null
	}

	/** What a write would add, and to whom - everything a quota check needs. */
	export interface QuotaTarget {
		guid: string
		ownerUserGuid: string
		quotaBytes: number | null
	}

	export class BucketQuotaExceededError extends Error { public code = 'bucket_quota_exceeded' }
	export class UserQuotaExceededError extends Error { public code = 'user_quota_exceeded' }
}
