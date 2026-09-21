import { coreSchema, DbProvider, UserRole, UserStatus } from '@storage/database'
import { TestDatabase, TestSeed } from '@storage/database/testing'
import { and, eq, isNull } from 'drizzle-orm'

import { AuthService } from '../auth/auth.service'
import { UsersService } from './users.service'
import { UsersTypes } from './users.types'

describe('DB', () => {
	let testDb: TestDatabase
	let seed: TestSeed
	let service: UsersService
	let authService: AuthService

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

		seed = new TestSeed(testDb.db)
		authService = new AuthService(provider(), {
			secret: 'test-secret',
			issuer: 'storage-test',
			accessTtl: 900,
			refreshTtl: 3600,
		})
		service = new UsersService(provider(), authService)
	})

	/** A password that can be replaced by anyone holding a stolen access token is no password,
	 *  and a change that leaves the old sessions alive locks nobody out - so both halves are
	 *  pinned here. */
	describe('setPassword', () => {
		const createUser = async (password: string) =>
			service.create({ email: `user-${Date.now()}@test.local`, password, role: UserRole.user })

		it('changes the password when the current one is given', async () => {
			const user = await createUser('original-password')

			await service.setPassword({
				guid: user.guid, password: 'a-new-password', currentPassword: 'original-password', actorGuid: user.guid,
			})

			await expect(authService.login({ email: user.email, password: 'a-new-password' })).resolves.toBeDefined()
		})

		it('refuses a self-service change without the current password', async () => {
			const user = await createUser('original-password')

			await expect(service.setPassword({ guid: user.guid, password: 'a-new-password', actorGuid: user.guid }))
				.rejects.toThrow(UsersTypes.InvalidCurrentPasswordError)
		})

		it('refuses a self-service change with the wrong current password', async () => {
			const user = await createUser('original-password')

			await expect(service.setPassword({
				guid: user.guid, password: 'a-new-password', currentPassword: 'not-it', actorGuid: user.guid,
			})).rejects.toThrow(UsersTypes.InvalidCurrentPasswordError)
		})

		it('leaves the old password working after a refused change', async () => {
			const user = await createUser('original-password')

			await expect(service.setPassword({
				guid: user.guid, password: 'a-new-password', currentPassword: 'not-it', actorGuid: user.guid,
			})).rejects.toThrow()

			await expect(authService.login({ email: user.email, password: 'original-password' })).resolves.toBeDefined()
		})

		/** An admin resetting a forgotten password cannot know the old one; the role is what
		 *  authorises them, and the controller is what checks the role. */
		it('lets somebody else set it without the current password', async () => {
			const user = await createUser('original-password')
			const admin = await seed.user({ role: UserRole.admin })

			await service.setPassword({ guid: user.guid, password: 'reset-by-admin', actorGuid: admin.guid })

			await expect(authService.login({ email: user.email, password: 'reset-by-admin' })).resolves.toBeDefined()
		})

		it('revokes every session the account had', async () => {
			const user = await createUser('original-password')
			const session = await authService.login({ email: user.email, password: 'original-password' })

			await service.setPassword({
				guid: user.guid, password: 'a-new-password', currentPassword: 'original-password', actorGuid: user.guid,
			})

			await expect(authService.refresh(session.refreshToken)).rejects.toThrow()
		})

		it('reports a user who is not there', async () => {
			await expect(service.setPassword({
				guid: '00000000-0000-0000-0000-000000000000', password: 'whatever-123', actorGuid: 'someone',
			})).rejects.toThrow(UsersTypes.UserNotFoundError)
		})
	})

	describe('listDirectory', () => {
		it('carries only what naming a grantee needs', async () => {
			const user = await seed.user({ email: 'someone@test.local', name: 'Someone' })

			const [listed] = await service.listDirectory()

			expect(listed).toEqual({ guid: user.guid, email: 'someone@test.local', name: 'Someone' })
		})

		it('leaves out disabled and deleted accounts', async () => {
			await seed.user({ email: 'active@test.local' })
			await seed.user({ email: 'disabled@test.local', status: UserStatus.disabled })
			const deleted = await seed.user({ email: 'deleted@test.local' })
			await testDb.db
				.update(coreSchema.user)
				.set({ deletedAt: new Date() })
				.where(eq(coreSchema.user.guid, deleted.guid))

			const listed = await service.listDirectory()

			expect(listed.map((item) => item.email)).toEqual(['active@test.local'])
		})
	})

	describe('create', () => {
		it('lowercases the e-mail so a second sign-up cannot differ only in case', async () => {
			await service.create({ email: 'Mixed.Case@Test.Local', password: 'password123', role: UserRole.user })

			await expect(service.create({ email: 'mixed.case@test.local', password: 'password123', role: UserRole.user }))
				.rejects.toThrow(UsersTypes.EmailAlreadyUsedError)
		})
	})

	/** Locking every admin out of a deployment is unrecoverable through the API, so the three
	 *  ways of doing it all have to be refused. */
	describe('last admin', () => {
		const onlyAdmin = () => seed.user({ role: UserRole.admin, status: UserStatus.active })

		it('cannot be demoted', async () => {
			const admin = await onlyAdmin()
			await expect(service.update({ guid: admin.guid, role: UserRole.user })).rejects.toThrow(UsersTypes.LastAdminDemotedError)
		})

		it('cannot be disabled', async () => {
			const admin = await onlyAdmin()
			await expect(service.setStatus(admin.guid, UserStatus.disabled)).rejects.toThrow(UsersTypes.LastAdminDemotedError)
		})

		it('cannot be deleted', async () => {
			const admin = await onlyAdmin()
			await expect(service.delete(admin.guid)).rejects.toThrow(UsersTypes.LastAdminError)
		})

		it('can be demoted once a second active admin exists', async () => {
			const admin = await onlyAdmin()
			await seed.user({ role: UserRole.admin, status: UserStatus.active })

			await expect(service.update({ guid: admin.guid, role: UserRole.user })).resolves.toBeDefined()
		})

		/** A disabled admin cannot sign in, so it is no safeguard against lock-out. */
		it('is not saved by a second admin who is disabled', async () => {
			const admin = await onlyAdmin()
			await seed.user({ role: UserRole.admin, status: UserStatus.disabled })

			await expect(service.delete(admin.guid)).rejects.toThrow(UsersTypes.LastAdminError)
		})
	})

	describe('bootstrapAdmin', () => {
		it('creates the first admin on an empty deployment', async () => {
			await service.bootstrapAdmin({ email: 'admin@test.local', password: 'admin12345' })

			const [created] = await testDb.db
				.select()
				.from(coreSchema.user)
				.where(and(eq(coreSchema.user.email, 'admin@test.local'), isNull(coreSchema.user.deletedAt)))

			expect(created.role).toBe(UserRole.admin)
		})

		it('does nothing once the deployment has a user', async () => {
			await seed.user()
			await service.bootstrapAdmin({ email: 'admin@test.local', password: 'admin12345' })

			await expect(service.list({ limit: 50, page: 1 })).resolves.toEqual(
				expect.objectContaining({ pagination: expect.objectContaining({ totalRecords: 1 }) }),
			)
		})
	})
})
