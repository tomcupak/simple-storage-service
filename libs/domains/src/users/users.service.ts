import { Injectable, Logger } from '@nestjs/common'
import { coreSchema, DbProvider, isUniqueViolation,UserRole, UserStatus } from '@storage/database'
import { Api } from '@storage/shared'
import { and, asc, count, eq, isNull } from 'drizzle-orm'

import { AuthService } from '../auth/auth.service'
import { UsersTypes } from './users.types'

@Injectable()
export class UsersService {
	private logger = new Logger(UsersService.name)

	constructor(
		private db: DbProvider,
		private authService: AuthService,
	) {}

	async list({ limit, page }: { limit: number, page: number }): Promise<Api.Pagination<UsersTypes.UserItem>> {
		const rows = await this.db.core
			.select()
			.from(coreSchema.user)
			.where(isNull(coreSchema.user.deletedAt))
			.orderBy(asc(coreSchema.user.email))
			.limit(limit)
			.offset((page - 1) * limit)

		const [{ value: totalRecords }] = await this.db.core
			.select({ value: count() })
			.from(coreSchema.user)
			.where(isNull(coreSchema.user.deletedAt))

		return Api.paginate({ data: rows.map((row) => this.toItem(row)), totalRecords, limit, page })
	}

	/** Everyone a grant could name, reduced to guid, e-mail and name. `list` is admin-only
	 *  because it exposes roles, quotas and sign-in times; this carries none of that, so a
	 *  bucket manager can be handed it to turn the guids on their grants into people. */
	async listDirectory(): Promise<UsersTypes.UserDirectoryItem[]> {
		const rows = await this.db.core
			.select({
				guid: coreSchema.user.guid,
				email: coreSchema.user.email,
				name: coreSchema.user.name,
			})
			.from(coreSchema.user)
			.where(and(eq(coreSchema.user.status, UserStatus.active), isNull(coreSchema.user.deletedAt)))
			.orderBy(asc(coreSchema.user.email))

		return rows
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
			if (isUniqueViolation(err)) throw new UsersTypes.EmailAlreadyUsedError()
			throw err
		}
	}

	/** Renames a user or changes their global role. The last admin cannot be demoted - doing so
	 *  would leave the deployment with nobody able to manage it. */
	async update({ guid, name, role }: { guid: string, name?: string | null, role?: UserRole }): Promise<UsersTypes.UserItem> {
		const user = await this.get(guid)

		if (role && role !== user.role && user.role === UserRole.admin && await this.countAdmins() <= 1) {
			throw new UsersTypes.LastAdminDemotedError()
		}

		const [updated] = await this.db.core
			.update(coreSchema.user)
			.set({
				...(name === undefined ? {} : { name }),
				...(role === undefined ? {} : { role }),
				updatedAt: new Date(),
			})
			.where(and(eq(coreSchema.user.guid, guid), isNull(coreSchema.user.deletedAt)))
			.returning()

		if (!updated) throw new UsersTypes.UserNotFoundError()
		return this.toItem(updated)
	}

	/** Deactivation keeps the account, its buckets and its access keys; only signing in stops.
	 *  It is the reversible half of `delete`, which soft-deletes the row. */
	async setStatus(guid: string, status: UserStatus): Promise<void> {
		const user = await this.get(guid)

		if (status === UserStatus.disabled && user.role === UserRole.admin && await this.countAdmins() <= 1) {
			throw new UsersTypes.LastAdminDemotedError()
		}

		const updated = await this.db.core
			.update(coreSchema.user)
			.set({ status, updatedAt: new Date() })
			.where(and(eq(coreSchema.user.guid, guid), isNull(coreSchema.user.deletedAt)))
			.returning()

		if (updated.length === 0) throw new UsersTypes.UserNotFoundError()
	}

	/** Storage limit across the buckets this user owns; null lifts it. */
	async setQuota(guid: string, quotaBytes: number | null): Promise<void> {
		const updated = await this.db.core
			.update(coreSchema.user)
			.set({ quotaBytes, updatedAt: new Date() })
			.where(and(eq(coreSchema.user.guid, guid), isNull(coreSchema.user.deletedAt)))
			.returning()

		if (updated.length === 0) throw new UsersTypes.UserNotFoundError()
	}

	/** Sets a password, and ends every session the account had.
	 *
	 *  Whether the current password has to be proven is decided here from `actorGuid` rather
	 *  than by the caller passing a flag: someone changing their own password must know it - a
	 *  stolen access token is otherwise enough to take the account over - while an admin
	 *  resetting somebody else's cannot know it and is trusted by role instead.
	 *
	 *  Revoking the sessions is the other half. A refresh token outlives an access token by
	 *  weeks, so a password change that left them alive would lock nobody out. */
	async setPassword({ guid, password, currentPassword, actorGuid }: {
		guid: string
		password: string
		currentPassword?: string
		/** Who is making the change; the same guid means it is a self-service change. */
		actorGuid: string
	}): Promise<void> {
		const [found] = await this.db.core
			.select()
			.from(coreSchema.user)
			.where(and(eq(coreSchema.user.guid, guid), isNull(coreSchema.user.deletedAt)))
			.limit(1)

		if (!found) throw new UsersTypes.UserNotFoundError()

		if (actorGuid === guid && !this.authService.verifyPassword(currentPassword ?? '', found.passwordHash)) {
			throw new UsersTypes.InvalidCurrentPasswordError()
		}

		await this.db.core
			.update(coreSchema.user)
			.set({ passwordHash: this.authService.hashPassword(password), updatedAt: new Date() })
			.where(eq(coreSchema.user.guid, guid))

		await this.authService.revokeSessions(guid)
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

	/** Admins who could still sign in - a disabled admin is no safeguard against lock-out. */
	private async countAdmins(): Promise<number> {
		const [{ value }] = await this.db.core
			.select({ value: count() })
			.from(coreSchema.user)
			.where(and(
				eq(coreSchema.user.role, UserRole.admin),
				eq(coreSchema.user.status, UserStatus.active),
				isNull(coreSchema.user.deletedAt),
			))
		return value
	}

	private toItem(row: typeof coreSchema.user.$inferSelect): UsersTypes.UserItem {
		return {
			guid: row.guid,
			email: row.email,
			name: row.name,
			role: row.role,
			status: row.status,
			quotaBytes: row.quotaBytes,
			lastLoginAt: row.lastLoginAt,
			createdAt: row.createdAt,
		}
	}

}
