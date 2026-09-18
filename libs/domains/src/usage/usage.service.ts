import { Injectable } from '@nestjs/common'
import { coreSchema, DbProvider, MultipartUploadStatus } from '@storage/database'
import { and, count, eq, isNotNull, isNull, sum } from 'drizzle-orm'

import { UsageTypes } from './usage.types'

const EMPTY_USAGE: UsageTypes.Usage = {
	objectCount: 0,
	versionCount: 0,
	versionBytes: 0,
	multipartBytes: 0,
	totalBytes: 0,
}

/** How much disk a bucket or a user occupies, and the quota check built on top of it.
 *
 *  Usage is derived from the metadata rather than tracked incrementally: a running total would
 *  have to stay consistent with every version write, delete marker, multipart abort and
 *  garbage collection pass, and any drift would silently lock a user out or let them past. */
@Injectable()
export class UsageService {
	constructor(
		private db: DbProvider,
	) {}

	async bucketUsage(bucketGuid: string): Promise<UsageTypes.Usage> {
		const [versions] = await this.db.core
			.select({ versionCount: count(), versionBytes: sum(coreSchema.objectVersion.size) })
			.from(coreSchema.objectVersion)
			.innerJoin(coreSchema.object, eq(coreSchema.object.guid, coreSchema.objectVersion.objectGuid))
			.where(and(eq(coreSchema.object.bucketGuid, bucketGuid), isNotNull(coreSchema.objectVersion.storagePath)))

		const [objects] = await this.db.core
			.select({ value: count() })
			.from(coreSchema.object)
			.innerJoin(coreSchema.objectVersion, eq(coreSchema.objectVersion.guid, coreSchema.object.latestVersionGuid))
			.where(and(eq(coreSchema.object.bucketGuid, bucketGuid), eq(coreSchema.objectVersion.isDeleteMarker, false)))

		const [parts] = await this.db.core
			.select({ value: sum(coreSchema.multipartPart.size) })
			.from(coreSchema.multipartPart)
			.innerJoin(coreSchema.multipartUpload, eq(coreSchema.multipartUpload.guid, coreSchema.multipartPart.uploadGuid))
			.where(and(
				eq(coreSchema.multipartUpload.bucketGuid, bucketGuid),
				eq(coreSchema.multipartUpload.status, MultipartUploadStatus.inProgress),
			))

		return this.toUsage({
			objectCount: objects?.value ?? 0,
			versionCount: versions?.versionCount ?? 0,
			versionBytes: versions?.versionBytes,
			multipartBytes: parts?.value,
		})
	}

	/** A user's usage is the sum over the buckets they own; buckets merely granted to them
	 *  count against their owner, so a single byte is never charged twice. */
	async userUsage(userGuid: string): Promise<UsageTypes.Usage> {
		const buckets = await this.db.core
			.select({ guid: coreSchema.bucket.guid })
			.from(coreSchema.bucket)
			.where(and(eq(coreSchema.bucket.ownerUserGuid, userGuid), isNull(coreSchema.bucket.deletedAt)))

		const usages = await Promise.all(buckets.map((bucket) => this.bucketUsage(bucket.guid)))
		return usages.reduce((total, usage) => this.add(total, usage), EMPTY_USAGE)
	}

	/** Per-bucket usage for the statistics view; `bucketGuids` narrows it to what the caller
	 *  is allowed to see. */
	async listBucketUsage(bucketGuids?: string[]): Promise<UsageTypes.BucketUsage[]> {
		const buckets = await this.db.core
			.select()
			.from(coreSchema.bucket)
			.where(isNull(coreSchema.bucket.deletedAt))

		const visible = bucketGuids ? buckets.filter((bucket) => bucketGuids.includes(bucket.guid)) : buckets

		return Promise.all(visible.map(async (bucket) => ({
			bucketGuid: bucket.guid,
			bucketName: bucket.name,
			ownerUserGuid: bucket.ownerUserGuid,
			quotaBytes: bucket.quotaBytes,
			...await this.bucketUsage(bucket.guid),
		})))
	}

	async listUserUsage(): Promise<UsageTypes.UserUsage[]> {
		const users = await this.db.core
			.select()
			.from(coreSchema.user)
			.where(isNull(coreSchema.user.deletedAt))

		return Promise.all(users.map(async (user) => {
			const buckets = await this.db.core
				.select({ guid: coreSchema.bucket.guid })
				.from(coreSchema.bucket)
				.where(and(eq(coreSchema.bucket.ownerUserGuid, user.guid), isNull(coreSchema.bucket.deletedAt)))

			const usages = await Promise.all(buckets.map((bucket) => this.bucketUsage(bucket.guid)))

			return {
				userGuid: user.guid,
				email: user.email,
				bucketCount: buckets.length,
				quotaBytes: user.quotaBytes,
				...usages.reduce((total, usage) => this.add(total, usage), EMPTY_USAGE),
			}
		}))
	}

	/** Throws when storing `bytes` more would push the bucket, or its owner, past their quota.
	 *  A quota of `null` means unlimited, which is the default for both. */
	async assertQuota({ bucket, bytes }: { bucket: UsageTypes.QuotaTarget, bytes: number }): Promise<void> {
		if (bucket.quotaBytes !== null && bucket.quotaBytes !== undefined) {
			const usage = await this.bucketUsage(bucket.guid)
			if (usage.totalBytes + bytes > bucket.quotaBytes) throw new UsageTypes.BucketQuotaExceededError()
		}

		const [owner] = await this.db.core
			.select({ quotaBytes: coreSchema.user.quotaBytes })
			.from(coreSchema.user)
			.where(eq(coreSchema.user.guid, bucket.ownerUserGuid))
			.limit(1)

		if (owner?.quotaBytes === null || owner?.quotaBytes === undefined) return

		const usage = await this.userUsage(bucket.ownerUserGuid)
		if (usage.totalBytes + bytes > owner.quotaBytes) throw new UsageTypes.UserQuotaExceededError()
	}

	private add(left: UsageTypes.Usage, right: UsageTypes.Usage): UsageTypes.Usage {
		return {
			objectCount: left.objectCount + right.objectCount,
			versionCount: left.versionCount + right.versionCount,
			versionBytes: left.versionBytes + right.versionBytes,
			multipartBytes: left.multipartBytes + right.multipartBytes,
			totalBytes: left.totalBytes + right.totalBytes,
		}
	}

	/** `sum()` comes back as a numeric string (or null for an empty set) on Postgres. */
	private toUsage({ objectCount, versionCount, versionBytes, multipartBytes }: {
		objectCount: number
		versionCount: number
		versionBytes: string | null | undefined
		multipartBytes: string | null | undefined
	}): UsageTypes.Usage {
		const versions = Number(versionBytes ?? 0)
		const multipart = Number(multipartBytes ?? 0)

		return {
			objectCount,
			versionCount,
			versionBytes: versions,
			multipartBytes: multipart,
			totalBytes: versions + multipart,
		}
	}
}
