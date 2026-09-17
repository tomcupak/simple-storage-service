import { Injectable } from '@nestjs/common'
import { BucketPermission, coreSchema, DbProvider, DrizzleErrorCode, UserRole } from '@storage/database'
import { and, count, eq, isNull } from 'drizzle-orm'

import { BucketsTypes } from './buckets.types'

@Injectable()
export class BucketsService {
	constructor(
		private db: DbProvider,
	) {}

	/** Buckets an admin can see (all) or a plain user can see (owned + explicitly granted). */
	async listForUser({ userGuid, role }: { userGuid: string, role: UserRole }): Promise<BucketsTypes.BucketItem[]> {
		if (role === UserRole.admin) {
			const rows = await this.db.core
				.select()
				.from(coreSchema.bucket)
				.where(isNull(coreSchema.bucket.deletedAt))
			return rows.map((row) => this.toItem(row))
		}

		const rows = await this.db.core
			.select({ bucket: coreSchema.bucket, access: coreSchema.bucketAccess })
			.from(coreSchema.bucket)
			.leftJoin(coreSchema.bucketAccess, and(
				eq(coreSchema.bucketAccess.bucketGuid, coreSchema.bucket.guid),
				eq(coreSchema.bucketAccess.userGuid, userGuid),
			))
			.where(isNull(coreSchema.bucket.deletedAt))

		return rows
			.filter((row) => row.bucket.ownerUserGuid === userGuid || (row.access?.permissions.length ?? 0) > 0)
			.map((row) => this.toItem(row.bucket))
	}

	async getByName(name: string): Promise<BucketsTypes.BucketItem> {
		const [found] = await this.db.core
			.select()
			.from(coreSchema.bucket)
			.where(and(eq(coreSchema.bucket.name, name), isNull(coreSchema.bucket.deletedAt)))
			.limit(1)

		if (!found) throw new BucketsTypes.BucketNotFoundError()
		return this.toItem(found)
	}

	/** Resolves a bucket by name and asserts the caller's management permission on it.
	 *  Callers surface both `BucketNotFoundError` and a read-permission denial as 404, so
	 *  bucket names cannot be enumerated by probing. */
	async getForUser({ name, userGuid, role, permission }: {
		name: string
		userGuid: string
		role: UserRole
		permission: BucketPermission
	}): Promise<BucketsTypes.BucketItem> {
		const bucket = await this.getByName(name)

		const allowed = await this.hasPermission({ bucketGuid: bucket.guid, userGuid, role, permission })
		if (!allowed) {
			if (permission === BucketPermission.read) throw new BucketsTypes.BucketNotFoundError()
			throw new BucketsTypes.PermissionDeniedError()
		}

		return bucket
	}

	async create({ name, ownerUserGuid, region }: { name: string, ownerUserGuid: string, region: string }): Promise<BucketsTypes.BucketItem> {
		this.assertValidName(name)

		try {
			const [created] = await this.db.core
				.insert(coreSchema.bucket)
				.values({ name, ownerUserGuid, region })
				.returning()

			return this.toItem(created)
		} catch (err) {
			if (this.isUniqueViolation(err)) throw new BucketsTypes.BucketAlreadyExistsError()
			throw err
		}
	}

	async delete(guid: string): Promise<void> {
		const [{ value: objectCount }] = await this.db.core
			.select({ value: count() })
			.from(coreSchema.object)
			.where(eq(coreSchema.object.bucketGuid, guid))

		if (objectCount > 0) throw new BucketsTypes.BucketNotEmptyError()

		await this.db.core
			.update(coreSchema.bucket)
			.set({ deletedAt: new Date() })
			.where(eq(coreSchema.bucket.guid, guid))
	}

	async listGrants(bucketGuid: string): Promise<BucketsTypes.BucketGrant[]> {
		return this.db.core
			.select()
			.from(coreSchema.bucketAccess)
			.where(eq(coreSchema.bucketAccess.bucketGuid, bucketGuid))
	}

	async setGrant({ bucketGuid, userGuid, permissions }: BucketsTypes.BucketGrant): Promise<void> {
		await this.db.core
			.insert(coreSchema.bucketAccess)
			.values({ bucketGuid, userGuid, permissions })
			.onConflictDoUpdate({
				target: [coreSchema.bucketAccess.bucketGuid, coreSchema.bucketAccess.userGuid],
				set: { permissions },
			})
	}

	async removeGrant({ bucketGuid, userGuid }: { bucketGuid: string, userGuid: string }): Promise<void> {
		await this.db.core
			.delete(coreSchema.bucketAccess)
			.where(and(
				eq(coreSchema.bucketAccess.bucketGuid, bucketGuid),
				eq(coreSchema.bucketAccess.userGuid, userGuid),
			))
	}

	/** Management-level check used by the UI API. S3 requests go through the policy engine instead. */
	async hasPermission({ bucketGuid, userGuid, role, permission }: {
		bucketGuid: string
		userGuid: string
		role: UserRole
		permission: BucketPermission
	}): Promise<boolean> {
		if (role === UserRole.admin) return true

		const [bucket] = await this.db.core
			.select()
			.from(coreSchema.bucket)
			.where(and(eq(coreSchema.bucket.guid, bucketGuid), isNull(coreSchema.bucket.deletedAt)))
			.limit(1)

		if (!bucket) throw new BucketsTypes.BucketNotFoundError()
		if (bucket.ownerUserGuid === userGuid) return true

		const [grant] = await this.db.core
			.select()
			.from(coreSchema.bucketAccess)
			.where(and(
				eq(coreSchema.bucketAccess.bucketGuid, bucketGuid),
				eq(coreSchema.bucketAccess.userGuid, userGuid),
			))
			.limit(1)

		return grant?.permissions.includes(permission) ?? false
	}

	private assertValidName(name: string): void {
		if (
			!BucketsTypes.BUCKET_NAME_PATTERN.test(name)
			|| BucketsTypes.IP_ADDRESS_PATTERN.test(name)
			|| name.includes('..')
		) {
			throw new BucketsTypes.InvalidBucketNameError()
		}
	}

	private toItem(row: typeof coreSchema.bucket.$inferSelect): BucketsTypes.BucketItem {
		return {
			guid: row.guid,
			name: row.name,
			ownerUserGuid: row.ownerUserGuid,
			region: row.region,
			acl: row.acl,
			versioning: row.versioning,
			createdAt: row.createdAt,
		}
	}

	private isUniqueViolation(err: unknown): boolean {
		return typeof err === 'object' && err !== null && 'code' in err && err.code === DrizzleErrorCode.UNIQUE_CONSTRAINT_VIOLATION
	}
}
