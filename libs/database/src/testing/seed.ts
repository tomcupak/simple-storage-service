import * as crypto from 'crypto'
import { eq } from 'drizzle-orm'
import { NodePgDatabase } from 'drizzle-orm/node-postgres'

import { BucketPermission, UserRole } from '../core/types'
import { coreSchema } from '../index'

/** Rows an integration test needs before it can exercise the thing it is actually about.
 *
 *  Each helper inserts only what the foreign keys demand - a bucket needs an owner, a version
 *  needs an object - and returns the inserted row, so a test names what it cares about and
 *  lets the rest default. Anything a test asserts on should be passed in explicitly rather than
 *  read out of a default here, or the assertion ends up testing this file. */
export class TestSeed {
	constructor(
		private readonly db: NodePgDatabase<typeof coreSchema>,
	) {}

	async user(overrides: Partial<typeof coreSchema.user.$inferInsert> = {}) {
		const [row] = await this.db
			.insert(coreSchema.user)
			.values({
				email: `user-${crypto.randomUUID()}@test.local`,
				passwordHash: 'not-a-real-hash',
				role: UserRole.user,
				...overrides,
			})
			.returning()

		return row
	}

	/** Creates the owner too when the caller did not name one - most tests do not care who
	 *  owns the bucket, only that somebody does. */
	async bucket(overrides: Partial<typeof coreSchema.bucket.$inferInsert> = {}) {
		const ownerUserGuid = overrides.ownerUserGuid ?? (await this.user()).guid

		const [row] = await this.db
			.insert(coreSchema.bucket)
			.values({
				name: `bucket-${crypto.randomUUID().slice(0, 8)}`,
				...overrides,
				ownerUserGuid,
			})
			.returning()

		return row
	}

	async grant({ bucketGuid, userGuid, permissions }: {
		bucketGuid: string
		userGuid: string
		permissions: BucketPermission[]
	}) {
		const [row] = await this.db
			.insert(coreSchema.bucketAccess)
			.values({ bucketGuid, userGuid, permissions })
			.returning()

		return row
	}

	/** One key with one version, which is the smallest thing a listing or a read can find.
	 *  The object row is pointed at the version, exactly as `ObjectsService` would leave it. */
	async object({ bucketGuid, key, ...version }: {
		bucketGuid: string
		key: string
	} & Partial<typeof coreSchema.objectVersion.$inferInsert>) {
		const [object] = await this.db
			.insert(coreSchema.object)
			.values({ bucketGuid, key })
			.returning()

		const [objectVersion] = await this.db
			.insert(coreSchema.objectVersion)
			.values({
				objectGuid: object.guid,
				versionId: 'null',
				etag: crypto.randomBytes(16).toString('hex'),
				size: 0,
				storagePath: `test/${crypto.randomUUID()}`,
				...version,
			})
			.returning()

		const [linked] = await this.db
			.update(coreSchema.object)
			.set({ latestVersionGuid: objectVersion.guid })
			.where(eq(coreSchema.object.guid, object.guid))
			.returning()

		return { object: linked, version: objectVersion }
	}
}
