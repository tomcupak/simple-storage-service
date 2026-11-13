import { Logger } from '@nestjs/common'
import { AccessKeyStatus, coreSchema, DbProvider } from '@storage/database'
import { TestDatabase, TestSeed } from '@storage/database/testing'
import { eq } from 'drizzle-orm'

import { CryptographicService } from '../cryptographic/cryptographic.service'
import { AccessKeysService } from './access-keys.service'
import { AccessKeysTypes } from './access-keys.types'

const KEY_ID = 'BOOTSTRAPKEY1234567890'
const SECRET = 'bootstrap-secret-0123456789-abcdefghij'

describe('AccessKeysTypes.parseBootstrapKey', () => {
	it('is off when both are unset or empty', () => {
		expect(AccessKeysTypes.parseBootstrapKey({})).toBeNull()
		expect(AccessKeysTypes.parseBootstrapKey({ accessKeyId: '', secretAccessKey: '' })).toBeNull()
	})

	it('returns a valid pair', () => {
		expect(AccessKeysTypes.parseBootstrapKey({ accessKeyId: KEY_ID, secretAccessKey: SECRET }))
			.toEqual({ accessKeyId: KEY_ID, secretAccessKey: SECRET })
	})

	it.each([
		['only the id', { accessKeyId: KEY_ID }],
		['only the secret', { secretAccessKey: SECRET }],
		['a lowercase id', { accessKeyId: KEY_ID.toLowerCase(), secretAccessKey: SECRET }],
		['a too short id', { accessKeyId: 'A'.repeat(15), secretAccessKey: SECRET }],
		['a too long id', { accessKeyId: 'A'.repeat(129), secretAccessKey: SECRET }],
		['a too short secret', { accessKeyId: KEY_ID, secretAccessKey: 'x'.repeat(31) }],
	])('rejects %s', (_name, env) => {
		expect(() => AccessKeysTypes.parseBootstrapKey(env)).toThrow()
	})
})

describe('DB', () => {
	let testDb: TestDatabase
	let seed: TestSeed
	let service: AccessKeysService

	const provider = () => ({ core: testDb.db }) as unknown as DbProvider
	const rows = () => testDb.db.select().from(coreSchema.accessKey).where(eq(coreSchema.accessKey.accessKeyId, KEY_ID))

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
		service = new AccessKeysService(provider(), new CryptographicService({ password: 'test-password-32-characters-min!!' }))
	})

	it('creates the key for the admin once and leaves a second run alone', async () => {
		const admin = await seed.user({ email: 'admin@storage.local' })

		await service.ensureBootstrapKey({ ownerEmail: 'Admin@Storage.local', accessKeyId: KEY_ID, secretAccessKey: SECRET })
		await service.ensureBootstrapKey({ ownerEmail: 'admin@storage.local', accessKeyId: KEY_ID, secretAccessKey: 'another-secret-0123456789-abcdefghij' })

		const stored = await rows()
		expect(stored).toHaveLength(1)
		expect(stored[0]).toEqual(expect.objectContaining({ userGuid: admin.guid, status: AccessKeyStatus.active, expiresAt: null, deletedAt: null }))
		await expect(service.resolveCredentials(KEY_ID)).resolves.toEqual(expect.objectContaining({ secretAccessKey: SECRET, userGuid: admin.guid }))
	})

	it('does not resurrect a deleted key or re-enable a disabled one', async () => {
		const admin = await seed.user({ email: 'admin@storage.local' })
		const other = await seed.user()
		const deletedId = 'DELETEDKEY1234567890'
		const disabledId = KEY_ID

		const cryptographic = new CryptographicService({ password: 'test-password-32-characters-min!!' })
		const encrypted = cryptographic.encrypt('original-secret-0123456789-abcdefghij')
		const deletedAt = new Date('2024-01-01')
		await testDb.db.insert(coreSchema.accessKey).values([
			{ accessKeyId: deletedId, userGuid: other.guid, secretKeyEncrypted: encrypted, deletedAt },
			{ accessKeyId: disabledId, userGuid: admin.guid, secretKeyEncrypted: encrypted, status: AccessKeyStatus.inactive },
		])

		const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
		await service.ensureBootstrapKey({ ownerEmail: admin.email, accessKeyId: deletedId, secretAccessKey: SECRET })
		await service.ensureBootstrapKey({ ownerEmail: admin.email, accessKeyId: disabledId, secretAccessKey: SECRET })
		expect(warn).toHaveBeenCalledWith(expect.stringContaining('was deleted'))
		expect(warn).toHaveBeenCalledWith(expect.stringContaining('is disabled'))
		warn.mockRestore()

		const all = await testDb.db.select().from(coreSchema.accessKey)
		expect(all).toHaveLength(2)
		const deleted = all.find((row) => row.accessKeyId === deletedId)
		const disabled = all.find((row) => row.accessKeyId === disabledId)
		expect(deleted).toEqual(expect.objectContaining({ userGuid: other.guid, deletedAt, secretKeyEncrypted: encrypted }))
		expect(disabled).toEqual(expect.objectContaining({ status: AccessKeyStatus.inactive, deletedAt: null, secretKeyEncrypted: encrypted }))
	})

	it('skips quietly when the owner does not exist or is deleted', async () => {
		await seed.user({ email: 'admin@storage.local', deletedAt: new Date() })

		await expect(service.ensureBootstrapKey({ ownerEmail: 'admin@storage.local', accessKeyId: KEY_ID, secretAccessKey: SECRET })).resolves.toBeUndefined()
		await expect(service.ensureBootstrapKey({ ownerEmail: 'nobody@storage.local', accessKeyId: KEY_ID, secretAccessKey: SECRET })).resolves.toBeUndefined()

		expect(await rows()).toHaveLength(0)
	})
})
