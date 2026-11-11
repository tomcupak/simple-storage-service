import { BucketAcl, BucketPermission, BucketVersioning, DbProvider, UserRole } from '@storage/database'
import { TestDatabase, TestSeed } from '@storage/database/testing'

import { BucketsService } from './buckets.service'
import { BucketsTypes } from './buckets.types'

const mockDb = { core: {} } as unknown as DbProvider

describe('BucketsService', () => {
	let service: BucketsService

	beforeEach(() => {
		jest.clearAllMocks()
		service = new BucketsService(mockDb)
	})

	/** Naming runs before anything is written, so it is worth pinning on its own: a name this
	 *  accepts becomes a hostname in virtual-host style addressing. */
	describe('name validation', () => {
		const create = (name: string) => service.create({ name, ownerUserGuid: 'owner', region: 'us-east-1' })

		it.each([
			['too short', 'ab'],
			['too long', 'a'.repeat(64)],
			['uppercase', 'My-Bucket'],
			['underscore', 'my_bucket'],
			['leading hyphen', '-bucket'],
			['trailing dot', 'bucket.'],
			['consecutive dots', 'my..bucket'],
			['shaped like an IPv4 address', '192.168.0.1'],
		])('refuses a name that is %s', async (_reason, name) => {
			await expect(create(name)).rejects.toThrow(BucketsTypes.InvalidBucketNameError)
		})

		it.each([
			['the shortest allowed', 'abc'],
			['the longest allowed', `a${'b'.repeat(61)}c`],
			['dotted', 'my.bucket.name'],
			['hyphenated', 'my-bucket-1'],
			['all digits', '12345'],
		])('accepts a name that is %s', async (_reason, name) => {
			// Getting past validation is all that is asserted; the insert is not the subject.
			await expect(create(name)).rejects.not.toThrow(BucketsTypes.InvalidBucketNameError)
		})
	})

	describe('matchCorsRule', () => {
		const rule = (overrides: Partial<{ allowedOrigins: string[], allowedMethods: string[], allowedHeaders: string[] }> = {}) => ({
			rules: [{
				allowedOrigins: ['https://app.example.com'],
				allowedMethods: ['GET'],
				...overrides,
			}],
		})

		it('matches an exact origin and method', () => {
			const matched = service.matchCorsRule({ cors: rule(), origin: 'https://app.example.com', method: 'GET' })
			expect(matched).toBeDefined()
		})

		it('does not match another origin', () => {
			const matched = service.matchCorsRule({ cors: rule(), origin: 'https://evil.example.com', method: 'GET' })
			expect(matched).toBeUndefined()
		})

		it('does not match another method', () => {
			const matched = service.matchCorsRule({ cors: rule(), origin: 'https://app.example.com', method: 'DELETE' })
			expect(matched).toBeUndefined()
		})

		it('honours a wildcard origin', () => {
			const matched = service.matchCorsRule({
				cors: rule({ allowedOrigins: ['https://*.example.com'] }),
				origin: 'https://app.example.com',
				method: 'GET',
			})

			expect(matched).toBeDefined()
		})

		it('requires every requested header to be allowed', () => {
			const cors = rule({ allowedHeaders: ['x-amz-*'] })

			expect(service.matchCorsRule({ cors, origin: 'https://app.example.com', method: 'GET', requestHeaders: ['x-amz-date'] })).toBeDefined()
			expect(service.matchCorsRule({ cors, origin: 'https://app.example.com', method: 'GET', requestHeaders: ['x-amz-date', 'authorization'] })).toBeUndefined()
		})

		it('matches nothing when the bucket has no configuration', () => {
			expect(service.matchCorsRule({ cors: null, origin: 'https://app.example.com', method: 'GET' })).toBeUndefined()
		})
	})

	describe('setCors', () => {
		it.each([
			['no rules at all', { rules: [] }],
			['a rule without an origin', { rules: [{ allowedOrigins: [], allowedMethods: ['GET'] }] }],
			['a rule without a method', { rules: [{ allowedOrigins: ['*'], allowedMethods: [] }] }],
		])('refuses %s', async (_reason, configuration) => {
			await expect(service.setCors({ guid: 'bucket', configuration }))
				.rejects.toThrow(BucketsTypes.InvalidCorsConfigurationError)
		})
	})
})

describe('DB', () => {
	let testDb: TestDatabase
	let seed: TestSeed
	let service: BucketsService

	beforeAll(async () => {
		testDb = await TestDatabase.connect()
	})

	afterAll(async () => {
		await testDb.close()
	})

	beforeEach(async () => {
		await testDb.truncate()
		seed = new TestSeed(testDb.db)
		service = new BucketsService({ core: testDb.db } as unknown as DbProvider)
	})

	describe('create', () => {
		it('stores the bucket with its owner and defaults', async () => {
			const owner = await seed.user()

			const created = await service.create({ name: 'first-bucket', ownerUserGuid: owner.guid, region: 'eu-central-1' })

			expect(created).toEqual(expect.objectContaining({
				name: 'first-bucket',
				ownerUserGuid: owner.guid,
				region: 'eu-central-1',
				acl: BucketAcl.private,
				versioning: BucketVersioning.disabled,
				quotaBytes: null,
				cors: null,
			}))
		})

		it('refuses a name another bucket already holds', async () => {
			const owner = await seed.user()
			await service.create({ name: 'taken', ownerUserGuid: owner.guid, region: 'us-east-1' })

			await expect(service.create({ name: 'taken', ownerUserGuid: owner.guid, region: 'us-east-1' }))
				.rejects.toThrow(BucketsTypes.BucketAlreadyExistsError)
		})

		/** The unique index covers deleted rows too, so a name is not freed by deleting its
		 *  bucket. That is deliberate - the blobs are still there until the collector runs. */
		it('still refuses the name of a soft-deleted bucket', async () => {
			const owner = await seed.user()
			const created = await service.create({ name: 'gone', ownerUserGuid: owner.guid, region: 'us-east-1' })
			await service.delete(created.guid)

			await expect(service.create({ name: 'gone', ownerUserGuid: owner.guid, region: 'us-east-1' }))
				.rejects.toThrow(BucketsTypes.BucketAlreadyExistsError)
		})
	})

	describe('getByName', () => {
		it('finds a bucket that exists', async () => {
			const bucket = await seed.bucket({ name: 'findable' })
			await expect(service.getByName('findable')).resolves.toEqual(expect.objectContaining({ guid: bucket.guid }))
		})

		it('throws for a name nobody holds', async () => {
			await expect(service.getByName('nothing-here')).rejects.toThrow(BucketsTypes.BucketNotFoundError)
		})

		it('does not find a soft-deleted bucket', async () => {
			const bucket = await seed.bucket({ name: 'deleted-one' })
			await service.delete(bucket.guid)

			await expect(service.getByName('deleted-one')).rejects.toThrow(BucketsTypes.BucketNotFoundError)
		})
	})

	describe('findByName', () => {
		it('answers null rather than throwing', async () => {
			await expect(service.findByName('nothing-here')).resolves.toBeNull()
		})
	})

	describe('delete', () => {
		it('refuses a bucket that still holds a key', async () => {
			const bucket = await seed.bucket()
			await seed.object({ bucketGuid: bucket.guid, key: 'a.txt' })

			await expect(service.delete(bucket.guid)).rejects.toThrow(BucketsTypes.BucketNotEmptyError)
		})

		it('deletes an empty bucket', async () => {
			const bucket = await seed.bucket({ name: 'empty-one' })
			await expect(service.delete(bucket.guid)).resolves.toBeUndefined()
			await expect(service.findByName('empty-one')).resolves.toBeNull()
		})
	})

	describe('listForUser', () => {
		it('shows an admin every bucket', async () => {
			await seed.bucket()
			await seed.bucket()
			const stranger = await seed.user()

			const listed = await service.listForUser({ userGuid: stranger.guid, role: UserRole.admin })
			expect(listed).toHaveLength(2)
		})

		it('shows a plain user their own buckets and the ones granted to them', async () => {
			const user = await seed.user()
			const owned = await seed.bucket({ ownerUserGuid: user.guid })
			const granted = await seed.bucket()
			const unrelated = await seed.bucket()
			await seed.grant({ bucketGuid: granted.guid, userGuid: user.guid, permissions: [BucketPermission.read] })

			const listed = await service.listForUser({ userGuid: user.guid, role: UserRole.user })

			expect(listed.map((bucket) => bucket.guid).sort()).toEqual([owned.guid, granted.guid].sort())
			expect(listed.map((bucket) => bucket.guid)).not.toContain(unrelated.guid)
		})

		/** An empty permission array is a row that grants nothing - the UI writes one when the
		 *  last checkbox is cleared, and it must not keep the bucket visible. */
		it('ignores a grant with no permissions left on it', async () => {
			const user = await seed.user()
			const bucket = await seed.bucket()
			await seed.grant({ bucketGuid: bucket.guid, userGuid: user.guid, permissions: [] })

			await expect(service.listForUser({ userGuid: user.guid, role: UserRole.user })).resolves.toEqual([])
		})
	})

	describe('hasPermission', () => {
		it('gives an admin everything', async () => {
			const bucket = await seed.bucket()
			await expect(service.hasPermission({
				bucketGuid: bucket.guid, userGuid: 'anyone', role: UserRole.admin, permission: BucketPermission.manage,
			})).resolves.toBe(true)
		})

		it('gives the owner everything', async () => {
			const owner = await seed.user()
			const bucket = await seed.bucket({ ownerUserGuid: owner.guid })

			await expect(service.hasPermission({
				bucketGuid: bucket.guid, userGuid: owner.guid, role: UserRole.user, permission: BucketPermission.manage,
			})).resolves.toBe(true)
		})

		it('gives a grantee exactly what the grant lists', async () => {
			const user = await seed.user()
			const bucket = await seed.bucket()
			await seed.grant({ bucketGuid: bucket.guid, userGuid: user.guid, permissions: [BucketPermission.read, BucketPermission.write] })

			await expect(service.hasPermission({
				bucketGuid: bucket.guid, userGuid: user.guid, role: UserRole.user, permission: BucketPermission.write,
			})).resolves.toBe(true)
			await expect(service.hasPermission({
				bucketGuid: bucket.guid, userGuid: user.guid, role: UserRole.user, permission: BucketPermission.delete,
			})).resolves.toBe(false)
		})

		it('gives an ungranted user nothing', async () => {
			const user = await seed.user()
			const bucket = await seed.bucket()

			await expect(service.hasPermission({
				bucketGuid: bucket.guid, userGuid: user.guid, role: UserRole.user, permission: BucketPermission.read,
			})).resolves.toBe(false)
		})
	})

	describe('getForUser', () => {
		/** A read denial is reported as "not there" so a stranger cannot map the deployment's
		 *  buckets by watching which names answer 403 and which 404. */
		it('hides a bucket the user may not read behind a not-found', async () => {
			const user = await seed.user()
			const bucket = await seed.bucket({ name: 'someone-elses' })

			await expect(service.getForUser({
				name: bucket.name, userGuid: user.guid, role: UserRole.user, permission: BucketPermission.read,
			})).rejects.toThrow(BucketsTypes.BucketNotFoundError)
		})

		it('reports a stronger permission the user lacks as a denial', async () => {
			const user = await seed.user()
			const bucket = await seed.bucket()
			await seed.grant({ bucketGuid: bucket.guid, userGuid: user.guid, permissions: [BucketPermission.read] })

			await expect(service.getForUser({
				name: bucket.name, userGuid: user.guid, role: UserRole.user, permission: BucketPermission.manage,
			})).rejects.toThrow(BucketsTypes.PermissionDeniedError)
		})
	})

	describe('setGrant', () => {
		it('replaces the permissions of an existing grant instead of failing on the key', async () => {
			const user = await seed.user()
			const bucket = await seed.bucket()

			await service.setGrant({ bucketGuid: bucket.guid, userGuid: user.guid, permissions: [BucketPermission.read] })
			await service.setGrant({ bucketGuid: bucket.guid, userGuid: user.guid, permissions: [BucketPermission.read, BucketPermission.delete] })

			const grants = await service.listGrants(bucket.guid)
			expect(grants).toHaveLength(1)
			expect(grants[0].permissions.sort()).toEqual([BucketPermission.delete, BucketPermission.read].sort())
		})

		it('removes only the named grant', async () => {
			const kept = await seed.user()
			const removed = await seed.user()
			const bucket = await seed.bucket()

			await service.setGrant({ bucketGuid: bucket.guid, userGuid: kept.guid, permissions: [BucketPermission.read] })
			await service.setGrant({ bucketGuid: bucket.guid, userGuid: removed.guid, permissions: [BucketPermission.read] })
			await service.removeGrant({ bucketGuid: bucket.guid, userGuid: removed.guid })

			const grants = await service.listGrants(bucket.guid)
			expect(grants.map((grant) => grant.userGuid)).toEqual([kept.guid])
		})
	})

	describe('settings', () => {
		it('stores versioning, acl, quota and cors', async () => {
			const bucket = await seed.bucket()

			await service.setVersioning({ guid: bucket.guid, versioning: BucketVersioning.enabled })
			await service.setAcl({ guid: bucket.guid, acl: BucketAcl.publicRead })
			await service.setQuota({ guid: bucket.guid, quotaBytes: 1_024 })
			await service.setCors({ guid: bucket.guid, configuration: { rules: [{ allowedOrigins: ['*'], allowedMethods: ['GET'] }] } })

			await expect(service.getByName(bucket.name)).resolves.toEqual(expect.objectContaining({
				versioning: BucketVersioning.enabled,
				acl: BucketAcl.publicRead,
				quotaBytes: 1_024,
				cors: { rules: [{ allowedOrigins: ['*'], allowedMethods: ['GET'] }] },
			}))
		})

		it('lifts a quota when it is set back to null', async () => {
			const bucket = await seed.bucket({ quotaBytes: 1_024 })
			await service.setQuota({ guid: bucket.guid, quotaBytes: null })

			await expect(service.getByName(bucket.name)).resolves.toEqual(expect.objectContaining({ quotaBytes: null }))
		})

		it('clears the cors configuration', async () => {
			const bucket = await seed.bucket()
			await service.setCors({ guid: bucket.guid, configuration: { rules: [{ allowedOrigins: ['*'], allowedMethods: ['GET'] }] } })
			await service.deleteCors(bucket.guid)

			await expect(service.getByName(bucket.name)).resolves.toEqual(expect.objectContaining({ cors: null }))
		})
	})
})
