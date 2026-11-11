import { coreSchema, DbProvider, MigrationBucketMode, MigrationJobStatus } from '@storage/database'
import { TestDatabase, TestSeed } from '@storage/database/testing'

import { BucketsService } from '../buckets/buckets.service'
import { CryptographicService } from '../cryptographic/cryptographic.service'
import { PoliciesService } from '../policies/policies.service'
import { MigrationService } from './migration.service'
import { MigrationTypes } from './migration.types'
import { MigrationSourceService } from './migration-source.service'

const mockDb = { core: {} } as unknown as DbProvider
const mockCryptographic = { encrypt: jest.fn((plain: string) => `enc(${plain})`) }
const mockSource = {
	open: jest.fn(() => ({})),
	close: jest.fn(),
	listBuckets: jest.fn(),
	listObjects: jest.fn(),
	getPolicy: jest.fn(),
	getVersioning: jest.fn(),
}
const mockBuckets = { isValidName: jest.fn(), findByName: jest.fn() }

const makePolicies = () => new PoliciesService(mockDb)

const input: MigrationTypes.SourceInput = {
	host: 'minio.local',
	port: 9000,
	useSsl: false,
	accessKeyId: 'root',
	secretAccessKey: 'rootpass',
}

const makeService = (db: DbProvider = mockDb) => new MigrationService(
	db,
	mockCryptographic as unknown as CryptographicService,
	mockSource as unknown as MigrationSourceService,
	mockBuckets as unknown as BucketsService,
	makePolicies(),
)

describe('MigrationService', () => {
	let service: MigrationService

	beforeEach(() => {
		jest.clearAllMocks()
		service = makeService()
	})

	describe('toSourceConfig', () => {
		it('builds the endpoint from scheme, host and port and defaults the region', () => {
			expect(service.toSourceConfig({ ...input, useSsl: true })).toEqual(expect.objectContaining({
				endpoint: 'https://minio.local:9000',
				region: 'us-east-1',
			}))
		})
	})

	describe('analysePolicy', () => {
		it('reports no policy as absent', () => {
			expect(service.analysePolicy(null)).toEqual({ present: false, document: null, warnings: [] })
		})

		it('flags an unparseable or invalid policy and does not hand out a document', () => {
			expect(service.analysePolicy('{not json')).toEqual(expect.objectContaining({ present: true, document: null, warnings: ['policy_invalid'] }))
			expect(service.analysePolicy('{"Statement":[{"Effect":"Maybe"}]}')).toEqual(expect.objectContaining({ document: null, warnings: ['policy_invalid'] }))
		})

		it('flags unsupported condition operators but keeps the document', () => {
			const raw = JSON.stringify({
				Version: '2012-10-17',
				Statement: [{ Effect: 'Allow', Action: 's3:GetObject', Resource: '*', Condition: { BinaryEquals: { k: 'v' } } }],
			})

			const analysis = service.analysePolicy(raw)
			expect(analysis.document).not.toBeNull()
			expect(analysis.warnings).toEqual(['policy_unsupported_condition:BinaryEquals'])
		})
	})

	describe('inspect', () => {
		it('reports counts, versioning, policy, name validity and local existence per bucket', async () => {
			mockSource.listBuckets.mockResolvedValue(['photos', 'Bad_Name'])
			mockSource.listObjects
				.mockResolvedValueOnce({ objects: [{ key: 'a', size: 10, lastModified: new Date() }], nextToken: 't' })
				.mockResolvedValueOnce({ objects: [{ key: 'b', size: 5, lastModified: new Date() }] })
				.mockResolvedValueOnce({ objects: [] })
			mockSource.getPolicy.mockResolvedValueOnce('{"Statement":[{"Effect":"Maybe"}]}').mockResolvedValueOnce(null)
			mockSource.getVersioning.mockResolvedValueOnce('Enabled').mockResolvedValueOnce(null)
			mockBuckets.isValidName.mockImplementation((name: string) => name === 'photos')
			mockBuckets.findByName.mockImplementation((name: string) => Promise.resolve(name === 'photos' ? { guid: 'g' } : null))

			const result = await service.inspect(input)

			expect(result).toEqual([
				expect.objectContaining({ name: 'photos', objectCount: 2, totalBytes: 15, versioning: 'Enabled', hasPolicy: true, policyWarnings: ['policy_invalid'], nameValid: true, existsLocally: true }),
				expect.objectContaining({ name: 'Bad_Name', objectCount: 0, totalBytes: 0, versioning: null, hasPolicy: false, policyWarnings: [], nameValid: false, existsLocally: false }),
			])
			expect(mockSource.close).toHaveBeenCalled()
		})
	})
})

describe('DB', () => {
	let testDb: TestDatabase
	let seed: TestSeed
	let service: MigrationService
	let admin: Awaited<ReturnType<TestSeed['user']>>

	beforeAll(async () => {
		testDb = await TestDatabase.connect()
	})

	afterAll(async () => {
		await testDb.close()
	})

	beforeEach(async () => {
		jest.clearAllMocks()
		await testDb.truncate()
		seed = new TestSeed(testDb.db)
		admin = await seed.user()
		service = makeService({ core: testDb.db } as unknown as DbProvider)
		mockSource.listBuckets.mockResolvedValue(['photos', 'docs'])
		mockBuckets.findByName.mockImplementation(async (name: string) => (name === 'docs' ? { guid: (await seed.bucket({ name: 'docs-local' })).guid } : null))
	})

	describe('start', () => {
		it('picks merge for a bucket that exists locally and create otherwise, and encrypts the secret', async () => {
			const job = await service.start({ source: input, buckets: [{ name: 'photos' }, { name: 'docs', overwrite: true }], userGuid: admin.guid })

			expect(job.status).toBe(MigrationJobStatus.queued)
			expect(job.buckets).toEqual([
				expect.objectContaining({ sourceName: 'docs', mode: MigrationBucketMode.merge, overwrite: true }),
				expect.objectContaining({ sourceName: 'photos', mode: MigrationBucketMode.create, overwrite: false }),
			])

			const [row] = await testDb.db.select().from(coreSchema.migrationJob)
			expect(row.sourceSecret).toBe('enc(rootpass)')
			expect(JSON.stringify(job)).not.toContain('rootpass')
			expect(job).not.toHaveProperty('sourceSecret')
		})

		it('refuses a second job while one is queued', async () => {
			await service.start({ source: input, buckets: [{ name: 'photos' }], userGuid: admin.guid })

			await expect(service.start({ source: input, buckets: [{ name: 'photos' }], userGuid: admin.guid }))
				.rejects.toThrow(MigrationTypes.MigrationAlreadyRunningError)
		})

		it('refuses a bucket the source does not have', async () => {
			await expect(service.start({ source: input, buckets: [{ name: 'nope' }], userGuid: admin.guid }))
				.rejects.toThrow(MigrationTypes.MigrationSourceBucketNotFoundError)
		})
	})

	describe('cancel', () => {
		it('cancels a queued job, then refuses to cancel it again', async () => {
			const job = await service.start({ source: input, buckets: [{ name: 'photos' }], userGuid: admin.guid })

			await service.cancel(job.guid)
			expect((await service.get(job.guid)).status).toBe(MigrationJobStatus.cancelled)
			await expect(service.cancel(job.guid)).rejects.toThrow(MigrationTypes.MigrationNotCancellableError)
		})

		it('reports an unknown job', async () => {
			await expect(service.cancel('00000000-0000-0000-0000-000000000000')).rejects.toThrow(MigrationTypes.MigrationNotFoundError)
		})
	})
})
