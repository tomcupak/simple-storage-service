import { Injectable, Logger } from '@nestjs/common'
import { coreSchema, DbProvider, DrizzleErrorCode, UserRole } from '@storage/database'
import { and, count, eq, isNull } from 'drizzle-orm'

import { AuthService } from '../auth/auth.service'
import { UsersTypes } from './users.types'

@Injectable()
export class UsersService {
	private logger = new Logger(UsersService.name)

	constructor(
		private db: DbProvider,
		private authService: AuthService,
	) {}

	async list(): Promise<UsersTypes.UserItem[]> {
		const rows = await this.db.core
			.select()
			.from(coreSchema.user)
			.where(isNull(coreSchema.user.deletedAt))

		return rows.map((row) => this.toItem(row))
	}

	async get(guid: string): Promise<UsersTypes.UserItem> {
		const [found] = await this.db.core
			.select()
			.from(coreSchema.user)
			.where(and(eq(coreSchema.user.guid, guid), isNull(coreSchema.user.deletedAt)))
			.limit(1)

		if (!found) throw new UsersTypes.UserNotFoundError()
		return this.toItem(found)
	}

	async create({ email, password, name, role }: { email: string, password: string, name?: string, role: UserRole }): Promise<UsersTypes.UserItem> {
		try {
			const [created] = await this.db.core
				.insert(coreSchema.user)
				.values({
					email: email.toLowerCase(),
					name: name ?? null,
					passwordHash: this.authService.hashPassword(password),
					role,
				})
				.returning()

			return this.toItem(created)
		} catch (err) {
			if (this.isUniqueViolation(err)) throw new UsersTypes.EmailAlreadyUsedError()
			throw err
		}
	}

	async setPassword(guid: string, password: string): Promise<void> {
		const updated = await this.db.core
			.update(coreSchema.user)
			.set({ passwordHash: this.authService.hashPassword(password), updatedAt: new Date() })
			.where(and(eq(coreSchema.user.guid, guid), isNull(coreSchema.user.deletedAt)))
			.returning()

		if (updated.length === 0) throw new UsersTypes.UserNotFoundError()
	}

	async delete(guid: string): Promise<void> {
		const user = await this.get(guid)
		if (user.role === UserRole.admin && await this.countAdmins() <= 1) throw new UsersTypes.LastAdminError()

		await this.db.core
			.update(coreSchema.user)
			.set({ deletedAt: new Date() })
			.where(eq(coreSchema.user.guid, guid))
	}

	/** Creates the initial admin on an empty deployment so the UI is reachable after a fresh install. */
	async bootstrapAdmin({ email, password }: { email: string, password: string }): Promise<void> {
		const [{ value: total }] = await this.db.core
			.select({ value: count() })
			.from(coreSchema.user)
			.where(isNull(coreSchema.user.deletedAt))

		if (total > 0) return

		await this.create({ email, password, role: UserRole.admin })
		this.logger.warn(`Bootstrapped initial admin user '${email}' - change the password after first login`)
	}

	private async countAdmins(): Promise<number> {
		const [{ value }] = await this.db.core
			.select({ value: count() })
			.from(coreSchema.user)
			.where(and(eq(coreSchema.user.role, UserRole.admin), isNull(coreSchema.user.deletedAt)))
		return value
	}

	private toItem(row: typeof coreSchema.user.$inferSelect): UsersTypes.UserItem {
		return {
			guid: row.guid,
			email: row.email,
			name: row.name,
			role: row.role,
			lastLoginAt: row.lastLoginAt,
			createdAt: row.createdAt,
		}
	}

	private isUniqueViolation(err: unknown): boolean {
		return typeof err === 'object' && err !== null && 'code' in err && err.code === DrizzleErrorCode.UNIQUE_CONSTRAINT_VIOLATION
	}
}
