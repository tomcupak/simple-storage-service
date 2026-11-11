import { BucketVersioning, coreSchema, DbProvider, MigrationBucketMode, MigrationBucketStatus, MigrationJobStatus } from '@storage/database'
import { TestDatabase, TestSeed } from '@storage/database/testing'
import { eq, sql } from 'drizzle-orm'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { Readable } from 'stream'

import { BucketsService } from '../buckets/buckets.service'
import { CryptographicService } from '../cryptographic/cryptographic.service'
import { ObjectsService } from '../objects/objects.service'
import { ObjectsTypes } from '../objects/objects.types'
import { PoliciesService } from '../policies/policies.service'
import { PoliciesTypes } from '../policies/policies.types'
import { StorageService } from '../storage/storage.service'
import { UsageService } from '../usage/usage.service'
import { MigrationService } from './migration.service'
import { MigrationTypes } from './migration.types'
import { MigrationWorker } from './migration.worker'
import { MigrationSourceService } from './migration-source.service'

const mockDb = { core: {} } as unknown as DbProvider

const config: MigrationTypes.Config = { enabled: true, concurrency: 2, pollIntervalMs: 5000 }

const makeSourceObject = (key: string, size: number, lastModified = new Date('2021-05-06T07:08:09.000Z')): MigrationTypes.SourceObject => ({ key, size, lastModified })

const makeExisting = (overrides: Partial<ObjectsTypes.ObjectVersionDetail>): ObjectsTypes.ObjectVersionDetail => ({
	size: 3,
	lastModified: new Date('2021-05-06T07:08:09.500Z'),
	isDeleteMarker: false,
	...overrides,
}) as ObjectsTypes.ObjectVersionDetail

describe('MigrationWorker', () => {
	const worker = new MigrationWorker(config, mockDb, null, null as never, null, null, null, null)
	const decide = (args: { existing: ObjectsTypes.ObjectVersionDetail | null, mode?: MigrationBucketMode, overwrite?: boolean, size?: number }) =>
		worker['decide']({
			existing: args.existing,
			object: makeSourceObject('k', args.size ?? 3),
			mode: args.mode ?? MigrationBucketMode.create,
			overwrite: args.overwrite ?? false,
		})

	describe('decide', () => {
		it('copies what is not there, or only hidden behind a delete marker', () => {
			expect(decide({ existing: null })).toBe('copy')
			expect(decide({ existing: makeExisting({ isDeleteMarker: true }) })).toBe('copy')
		})

		it('skips an object of the same size and modification second, in either mode', () => {
			expect(decide({ existing: makeExisting({}) })).toBe('skip-identical')
			expect(decide({ existing: makeExisting({}), mode: MigrationBucketMode.merge, overwrite: true })).toBe('skip-identical')
		})

		it('leaves a differing object alone in merge mode without overwrite', () => {
			expect(decide({ existing: makeExisting({}), size: 9, mode: MigrationBucketMode.merge })).toBe('skip-existing')
		})

		it('replaces a differing object in merge mode with overwrite, and in create mode', () => {
			expect(decide({ existing: makeExisting({}), size: 9, mode: MigrationBucketMode.merge, overwrite: true })).toBe('copy')
			expect(decide({ existing: makeExisting({}), size: 9 })).toBe('copy')
		})
	})
})

describe('DB', () => {
	let testDb: TestDatabase
	let seed: TestSeed
	let dataPath: string
	let admin: Awaited<ReturnType<TestSeed['user']>>
	let objects: ObjectsService
	let buckets: BucketsService
	let worker: MigrationWorker
	let crypto: CryptographicService

	const mockSource = {
		open: jest.fn(() => ({})),
		close: jest.fn(),
		listObjects: jest.fn(),
		getObject: jest.fn(),
		getPolicy: jest.fn(),
		getVersioning: jest.fn(),
	}

	const provider = () => ({ core: testDb.db }) as unknown as DbProvider

	beforeAll(async () => {
		testDb = await TestDatabase.connect()
	})

	afterAll(async () => {
		await testDb.close()
	})

	beforeEach(async () => {
		jest.clearAllMocks()
		await testDb.truncate()
		dataPath = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'migration-test-'))

		seed = new TestSeed(testDb.db)
		admin = await seed.user()
		crypto = new CryptographicService({ password: 'test-password-with-enough-length' })
		const storage = new StorageService({ dataPath, encryption: { enabled: false, masterKey: 'test-master-key-32-characters!!!' } })
		await storage.onApplicationBootstrap()

		buckets = new BucketsService(provider())
		const policies = new PoliciesService(provider())
		objects = new ObjectsService(provider(), storage, new UsageService(provider()))
		const migrationService = new MigrationService(provider(), crypto, mockSource as unknown as MigrationSourceService, buckets, policies)
		worker = new MigrationWorker(config, provider(), crypto, mockSource as unknown as MigrationSourceService, migrationService, buckets, policies, objects)

		mockSource.getPolicy.mockResolvedValue(null)
		mockSource.getVersioning.mockResolvedValue(null)
	})

	afterEach(async () => {
		await fs.promises.rm(dataPath, { recursive: true, force: true })
	})

	const makeJob = async (overrides: Partial<typeof coreSchema.migrationJob.$inferInsert> = {}) => {
		const [job] = await testDb.db.insert(coreSchema.migrationJob).values({
			sourceEndpoint: 'http://minio.local:9000',
			sourceRegion: 'us-east-1',
			sourceAccessKeyId: 'root',
			sourceSecret: crypto.encrypt('rootpass'),
			createdByUserGuid: admin.guid,
			...overrides,
		}).returning()

		return job
	}

	const makeJobBucket = async (jobGuid: string, overrides: Partial<typeof coreSchema.migrationJobBucket.$inferInsert> = {}) => {
		const [row] = await testDb.db.insert(coreSchema.migrationJobBucket).values({
			jobGuid,
			sourceName: 'photos',
			mode: MigrationBucketMode.create,
			...overrides,
		}).returning()

		return row
	}

	/** Source objects by key, served as listing pages of `pageSize`. */
	const serveSource = (files: Record<string, { body: string, lastModified?: Date }>, pageSize = 100, onGet?: (key: string) => Promise<void> | void) => {
		const keys = Object.keys(files).sort()
		const asObject = (key: string) => makeSourceObject(key, files[key].body.length, files[key].lastModified)

		mockSource.listObjects.mockImplementation(({ token }: { token?: string }) => {
			const start = token ? Number(token) : 0
			const slice = keys.slice(start, start + pageSize)
			return Promise.resolve({ objects: slice.map(asObject), nextToken: start + pageSize < keys.length ? String(start + pageSize) : undefined })
		})
		mockSource.getObject.mockImplementation(async ({ key }: { key: string }) => {
			await Promise.resolve(onGet?.(key))
			if (key === 'broken') throw new Error('boom')
			return {
				stream: Readable.from([Buffer.from(files[key].body)]),
				size: files[key].body.length,
				contentType: 'text/plain',
				cacheControl: 'max-age=60',
				metadata: { owner: 'tom' },
			}
		})
	}

	const reload = async (jobGuid: string) => {
		const [job] = await testDb.db.select().from(coreSchema.migrationJob).where(eq(coreSchema.migrationJob.guid, jobGuid))
		const rows = await testDb.db.select().from(coreSchema.migrationJobBucket).where(eq(coreSchema.migrationJobBucket.jobGuid, jobGuid))
		return { job, rows }
	}

	describe('claimNext', () => {
		it('claims a queued job and marks it running with a heartbeat', async () => {
			const queued = await makeJob()

			const claimed = await worker.claimNext()

			expect(claimed).toEqual(expect.objectContaining({ guid: queued.guid, status: MigrationJobStatus.running }))
			expect(claimed?.heartbeatAt).toBeInstanceOf(Date)
			expect(claimed?.startedAt).toBeInstanceOf(Date)
			expect(await worker.claimNext()).toBeNull()
		})

		it('reclaims a running job whose heartbeat went stale, keeping its started_at', async () => {
			const startedAt = new Date('2020-01-01T00:00:00Z')
			const stale = await makeJob({ status: MigrationJobStatus.running, startedAt, heartbeatAt: sql`now() - interval '5 minutes'` as never })

			const claimed = await worker.claimNext()

			expect(claimed?.guid).toBe(stale.guid)
			expect(claimed?.startedAt).toEqual(startedAt)
			expect((claimed?.heartbeatAt?.getTime() ?? 0)).toBeGreaterThan(Date.now() - 10_000)
		})

		it('leaves a running job with a fresh heartbeat alone', async () => {
			await makeJob({ status: MigrationJobStatus.running, heartbeatAt: new Date() })
			expect(await worker.claimNext()).toBeNull()
		})

		it('ignores finished jobs', async () => {
			await makeJob({ status: MigrationJobStatus.completed })
			await makeJob({ status: MigrationJobStatus.cancelled })
			expect(await worker.claimNext()).toBeNull()
		})
	})

	describe('run', () => {
		const files = {
			'a.txt': { body: 'aaa' },
			'b.txt': { body: 'bbbb', lastModified: new Date('2019-02-03T04:05:06.000Z') },
			'dir/c.txt': { body: 'c' },
		}

		it('creates the bucket and copies objects with their headers and original LastModified', async () => {
			serveSource(files, 2)
			mockSource.getVersioning.mockResolvedValue('Enabled')
			mockSource.getPolicy.mockResolvedValue(JSON.stringify({ Version: '2012-10-17', Statement: [{ Effect: 'Allow', Principal: '*', Action: 's3:GetObject', Resource: 'arn:aws:s3:::photos/*' }] }))
			const job = await makeJob({ status: MigrationJobStatus.running })
			const bucketRow = await makeJobBucket(job.guid)

			await worker.run(job)

			const { job: done, rows } = await reload(job.guid)
			expect(done.status).toBe(MigrationJobStatus.completed)
			expect(done.finishedAt).toBeInstanceOf(Date)
			expect(rows[0]).toEqual(expect.objectContaining({
				status: MigrationBucketStatus.completed,
				objectsTotal: 3,
				bytesTotal: 8,
				objectsDone: 3,
				objectsFailed: 0,
				objectsSkipped: 0,
				bytesDone: 8,
				policyMigrated: true,
			}))

			const local = await buckets.getByName('photos')
			expect(local.ownerUserGuid).toBe(admin.guid)
			expect(local.versioning).toBe(BucketVersioning.enabled)

			const version = await objects.getVersion({ bucketGuid: local.guid, key: 'b.txt' })
			expect(version).toEqual(expect.objectContaining({
				size: 4,
				contentType: 'text/plain',
				cacheControl: 'max-age=60',
				metadata: { owner: 'tom' },
			}))
			expect(version.lastModified).toEqual(files['b.txt'].lastModified)
			expect(bucketRow.guid).toBe(rows[0].guid)
		})

		it('skips what an earlier run already copied, making a rerun idempotent', async () => {
			serveSource(files)
			const job = await makeJob({ status: MigrationJobStatus.running })
			await makeJobBucket(job.guid)
			await worker.run(job)
			mockSource.getObject.mockClear()

			const again = await makeJob({ status: MigrationJobStatus.running })
			await makeJobBucket(again.guid, { mode: MigrationBucketMode.merge, overwrite: true, targetBucketGuid: (await buckets.getByName('photos')).guid })
			await worker.run(again)

			expect(mockSource.getObject).not.toHaveBeenCalled()
			const { rows } = await reload(again.guid)
			expect(rows[0]).toEqual(expect.objectContaining({ objectsDone: 3, objectsSkipped: 3, bytesDone: 8 }))
		})

		it('does not touch a differing object in merge mode without overwrite', async () => {
			const local = await seed.bucket({ name: 'photos', ownerUserGuid: admin.guid })
			await objects.put({ bucket: local, key: 'a.txt', stream: Readable.from([Buffer.from('local-version')]) })
			serveSource({ 'a.txt': { body: 'aaa' }, 'new.txt': { body: 'n' } })
			const job = await makeJob({ status: MigrationJobStatus.running })
			await makeJobBucket(job.guid, { mode: MigrationBucketMode.merge, targetBucketGuid: local.guid })

			await worker.run(job)

			expect(mockSource.getObject).toHaveBeenCalledTimes(1)
			expect(mockSource.getObject).toHaveBeenCalledWith(expect.objectContaining({ key: 'new.txt' }))
			const kept = await objects.getVersion({ bucketGuid: local.guid, key: 'a.txt' })
			expect(kept.size).toBe('local-version'.length)
			const { rows } = await reload(job.guid)
			expect(rows[0]).toEqual(expect.objectContaining({ objectsDone: 2, objectsSkipped: 1 }))
		})

		it('records a failed object and carries on', async () => {
			serveSource({ 'a.txt': { body: 'aaa' }, broken: { body: 'xx' }, 'z.txt': { body: 'z' } })
			const job = await makeJob({ status: MigrationJobStatus.running })
			await makeJobBucket(job.guid)

			await worker.run(job)

			const { job: done, rows } = await reload(job.guid)
			expect(done.status).toBe(MigrationJobStatus.completed)
			expect(rows[0]).toEqual(expect.objectContaining({ objectsDone: 2, objectsFailed: 1 }))
			const errors = await testDb.db.select().from(coreSchema.migrationJobError)
			expect(errors).toEqual([expect.objectContaining({ key: 'broken', message: 'boom', jobGuid: job.guid })])
		})

		it('fails a bucket with an invalid name and still migrates the next one', async () => {
			serveSource({ 'a.txt': { body: 'aaa' } })
			const job = await makeJob({ status: MigrationJobStatus.running })
			await makeJobBucket(job.guid, { sourceName: 'Bad_Name' })
			await makeJobBucket(job.guid, { sourceName: 'good' })

			await worker.run(job)

			const { job: done, rows } = await reload(job.guid)
			expect(done.status).toBe(MigrationJobStatus.completed)
			expect(rows.find((row) => row.sourceName === 'Bad_Name')).toEqual(expect.objectContaining({ status: MigrationBucketStatus.failed, error: 'invalid_bucket_name' }))
			expect(rows.find((row) => row.sourceName === 'good')?.status).toBe(MigrationBucketStatus.completed)
		})

		it('does not overwrite an existing policy in merge mode', async () => {
			const local = await seed.bucket({ name: 'photos', ownerUserGuid: admin.guid })
			const existing: PoliciesTypes.PolicyDocument = { Version: '2012-10-17', Statement: [{ Effect: 'Deny', Action: '*', Resource: '*' }] }
			await new PoliciesService(provider()).set({ bucketGuid: local.guid, document: existing })
			mockSource.getPolicy.mockResolvedValue(JSON.stringify({ Version: '2012-10-17', Statement: [{ Effect: 'Allow', Action: '*', Resource: '*' }] }))
			serveSource({})
			const job = await makeJob({ status: MigrationJobStatus.running })
			await makeJobBucket(job.guid, { mode: MigrationBucketMode.merge, targetBucketGuid: local.guid })

			await worker.run(job)

			const { rows } = await reload(job.guid)
			expect(rows[0]).toEqual(expect.objectContaining({ policyMigrated: false, policyWarnings: ['policy_not_overwritten'] }))
			expect(await new PoliciesService(provider()).get(local.guid)).toEqual(existing)
		})

		it('stops at the next page once the job is cancelled and marks the bucket cancelled', async () => {
			let cancelled = false
			serveSource({ 'a.txt': { body: 'a' }, 'b.txt': { body: 'b' }, 'c.txt': { body: 'c' } }, 1, async () => {
				if (cancelled) return
				cancelled = true
				await testDb.db.update(coreSchema.migrationJob).set({ status: MigrationJobStatus.cancelled }).where(eq(coreSchema.migrationJob.status, MigrationJobStatus.running))
			})
			const job = await makeJob({ status: MigrationJobStatus.running })
			await makeJobBucket(job.guid)

			await worker.run(job)

			expect(mockSource.getObject).toHaveBeenCalledTimes(1)
			const { job: after, rows } = await reload(job.guid)
			expect(after.status).toBe(MigrationJobStatus.cancelled)
			expect(rows[0].status).toBe(MigrationBucketStatus.cancelled)
		})

		it('resumes from the persisted continuation token', async () => {
			serveSource({ 'a.txt': { body: 'a' }, 'b.txt': { body: 'b' }, 'c.txt': { body: 'c' } }, 1)
			const job = await makeJob({ status: MigrationJobStatus.running })
			await makeJobBucket(job.guid, { totalsComputed: true, objectsTotal: 3, bytesTotal: 3, objectsDone: 1, bytesDone: 1, continuationToken: '1' })

			await worker.run(job)

			expect(mockSource.getObject).toHaveBeenCalledTimes(2)
			expect(mockSource.getObject).not.toHaveBeenCalledWith(expect.objectContaining({ key: 'a.txt' }))
			const { rows } = await reload(job.guid)
			expect(rows[0]).toEqual(expect.objectContaining({ objectsDone: 3, bytesDone: 3, continuationToken: null }))
		})

		it('fails the job when the source becomes unreachable', async () => {
			mockSource.listObjects.mockRejectedValue(new MigrationTypes.MigrationSourceUnreachableError())
			const job = await makeJob({ status: MigrationJobStatus.running })
			await makeJobBucket(job.guid)

			await worker.run(job)

			const { job: done, rows } = await reload(job.guid)
			expect(done).toEqual(expect.objectContaining({ status: MigrationJobStatus.failed, error: 'migration_source_unreachable' }))
			expect(rows[0].status).toBe(MigrationBucketStatus.failed)
		})
	})
})
