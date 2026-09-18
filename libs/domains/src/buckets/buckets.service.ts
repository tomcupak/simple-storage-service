import { Injectable } from '@nestjs/common'
import { BucketAcl, BucketPermission, BucketVersioning, coreSchema, DbProvider, DrizzleErrorCode, UserRole } from '@storage/database'
import { and, count, eq, isNull } from 'drizzle-orm'

import { S3Types } from '../s3/s3.types'
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

	/** Like `getByName`, but a missing bucket is an answer rather than an error - `CreateBucket`
	 *  has to tell "not there" apart from "already yours". */
	async findByName(name: string): Promise<BucketsTypes.BucketItem | null> {
		const [found] = await this.db.core
			.select()
			.from(coreSchema.bucket)
			.where(and(eq(coreSchema.bucket.name, name), isNull(coreSchema.bucket.deletedAt)))
			.limit(1)

		return found ? this.toItem(found) : null
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

	/** `PutBucketVersioning`. S3 has no way back to `disabled` once versioning was enabled -
	 *  it can only be suspended, which keeps the versions already recorded. */
	async setVersioning({ guid, versioning }: { guid: string, versioning: BucketVersioning }): Promise<void> {
		await this.db.core
			.update(coreSchema.bucket)
			.set({ versioning, updatedAt: new Date() })
			.where(eq(coreSchema.bucket.guid, guid))
	}

	/** `PutBucketAcl`. Only the canned ACLs are stored - a per-grantee ACL has no representation
	 *  here, so the S3 layer rejects one rather than narrowing it silently. */
	async setAcl({ guid, acl }: { guid: string, acl: BucketAcl }): Promise<void> {
		await this.db.core
			.update(coreSchema.bucket)
			.set({ acl, updatedAt: new Date() })
			.where(eq(coreSchema.bucket.guid, guid))
	}

	/** Bucket-level storage limit in bytes; null lifts it. Enforced by `UsageService` on write. */
	async setQuota({ guid, quotaBytes }: { guid: string, quotaBytes: number | null }): Promise<void> {
		await this.db.core
			.update(coreSchema.bucket)
			.set({ quotaBytes, updatedAt: new Date() })
			.where(eq(coreSchema.bucket.guid, guid))
	}

	/** `PutBucketCors`. The rules are stored as given and evaluated per request by the S3 app. */
	async setCors({ guid, configuration }: { guid: string, configuration: S3Types.CorsConfiguration }): Promise<void> {
		if (!configuration.rules.length) throw new BucketsTypes.InvalidCorsConfigurationError()

		for (const rule of configuration.rules) {
			if (!rule.allowedOrigins?.length || !rule.allowedMethods?.length) throw new BucketsTypes.InvalidCorsConfigurationError()
		}

		await this.db.core
			.update(coreSchema.bucket)
			.set({ cors: configuration, updatedAt: new Date() })
			.where(eq(coreSchema.bucket.guid, guid))
	}

	async deleteCors(guid: string): Promise<void> {
		await this.db.core
			.update(coreSchema.bucket)
			.set({ cors: null, updatedAt: new Date() })
			.where(eq(coreSchema.bucket.guid, guid))
	}

	/** First rule matching the request's origin and method, i.e. the one whose headers the
	 *  response must echo. Undefined means the request is not allowed by the configuration. */
	matchCorsRule({ cors, origin, method, requestHeaders }: {
		cors: S3Types.CorsConfiguration | null
		origin: string
		method: string
		requestHeaders?: string[]
	}): S3Types.CorsRule | undefined {
		return cors?.rules.find((rule) => {
			if (!rule.allowedOrigins.some((allowed) => this.wildcardMatch(allowed, origin))) return false
			if (!rule.allowedMethods.includes(method.toUpperCase())) return false

			return (requestHeaders ?? []).every((header) =>
				(rule.allowedHeaders ?? []).some((allowed) => this.wildcardMatch(allowed.toLowerCase(), header.toLowerCase())))
		})
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

	/** CORS origins and headers allow a single `*` wildcard anywhere in the value. */
	private wildcardMatch(pattern: string, value: string): boolean {
		const escaped = pattern.replace(/[.+^${}()|[\]\\?]/g, '\\$&')
		return new RegExp(`^${escaped.replace(/\*/g, '.*')}$`).test(value)
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
			quotaBytes: row.quotaBytes,
			cors: (row.cors as S3Types.CorsConfiguration | null) ?? null,
			createdAt: row.createdAt,
		}
	}

	private isUniqueViolation(err: unknown): boolean {
		return typeof err === 'object' && err !== null && 'code' in err && err.code === DrizzleErrorCode.UNIQUE_CONSTRAINT_VIOLATION
	}
}
