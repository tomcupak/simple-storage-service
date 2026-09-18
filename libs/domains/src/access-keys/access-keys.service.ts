import { Injectable } from '@nestjs/common'
import { AccessKeyStatus, coreSchema, DbProvider, UserRole } from '@storage/database'
import { Api } from '@storage/shared'
import * as crypto from 'crypto'
import { and, asc, count, eq, isNull } from 'drizzle-orm'

import { CryptographicService } from '../cryptographic/cryptographic.service'
import { AccessKeysTypes } from './access-keys.types'

const ACCESS_KEY_ID_LENGTH = 20
const SECRET_KEY_BYTES = 30

@Injectable()
export class AccessKeysService {
	constructor(
		private db: DbProvider,
		private cryptographicService: CryptographicService,
	) {}

	async list({ userGuid, limit, page }: { userGuid?: string, limit: number, page: number }): Promise<Api.Pagination<AccessKeysTypes.AccessKeyItem>> {
		const where = userGuid
			? and(eq(coreSchema.accessKey.userGuid, userGuid), isNull(coreSchema.accessKey.deletedAt))
			: isNull(coreSchema.accessKey.deletedAt)

		const rows = await this.db.core
			.select()
			.from(coreSchema.accessKey)
			.where(where)
			.orderBy(asc(coreSchema.accessKey.createdAt))
			.limit(limit)
			.offset((page - 1) * limit)

		const [{ value: totalRecords }] = await this.db.core
			.select({ value: count() })
			.from(coreSchema.accessKey)
			.where(where)

		return Api.paginate({ data: rows.map((row) => this.toItem(row)), totalRecords, limit, page })
	}

	/** Credentials the management API signs a presigned URL with on the user's behalf: their
	 *  oldest usable key, so the same link keeps working as newer keys come and go.
	 *
	 *  Signing with the user's own key is what makes the link carry their permissions - the S3
	 *  endpoint has no notion of the management session the UI holds. */
	async resolveSigningCredentials(userGuid: string): Promise<AccessKeysTypes.ResolvedCredentials> {
		const rows = await this.db.core
			.select()
			.from(coreSchema.accessKey)
			.where(and(
				eq(coreSchema.accessKey.userGuid, userGuid),
				eq(coreSchema.accessKey.status, AccessKeyStatus.active),
				isNull(coreSchema.accessKey.deletedAt),
			))
			.orderBy(asc(coreSchema.accessKey.createdAt))

		const usable = rows.find((row) => !row.expiresAt || row.expiresAt.getTime() > Date.now())
		if (!usable) throw new AccessKeysTypes.NoUsableAccessKeyError()

		return {
			accessKeyId: usable.accessKeyId,
			secretAccessKey: this.cryptographicService.decrypt(usable.secretKeyEncrypted),
			userGuid: usable.userGuid,
		}
	}

	async create({ userGuid, description, expiresAt }: { userGuid: string, description?: string, expiresAt?: Date }): Promise<AccessKeysTypes.CreatedAccessKey> {
		const accessKeyId = this.generateAccessKeyId()
		const secretAccessKey = crypto.randomBytes(SECRET_KEY_BYTES).toString('base64').replace(/[+/=]/g, '').slice(0, 40)

		const [created] = await this.db.core
			.insert(coreSchema.accessKey)
			.values({
				accessKeyId,
				userGuid,
				secretKeyEncrypted: this.cryptographicService.encrypt(secretAccessKey),
				description: description ?? null,
				expiresAt: expiresAt ?? null,
			})
			.returning()

		return { ...this.toItem(created), secretAccessKey }
	}

	/** Admins manage every key; a plain user only their own. A key belonging to someone else
	 *  is reported as missing rather than forbidden, so key ids stay unguessable. */
	async assertAccessible({ accessKeyId, userGuid, role }: { accessKeyId: string, userGuid: string, role: UserRole }): Promise<void> {
		if (role === UserRole.admin) return

		const [found] = await this.db.core
			.select()
			.from(coreSchema.accessKey)
			.where(and(eq(coreSchema.accessKey.accessKeyId, accessKeyId), isNull(coreSchema.accessKey.deletedAt)))
			.limit(1)

		if (!found || found.userGuid !== userGuid) throw new AccessKeysTypes.AccessKeyNotFoundError()
	}

	async setStatus(accessKeyId: string, status: AccessKeyStatus): Promise<void> {
		const updated = await this.db.core
			.update(coreSchema.accessKey)
			.set({ status })
			.where(and(eq(coreSchema.accessKey.accessKeyId, accessKeyId), isNull(coreSchema.accessKey.deletedAt)))
			.returning()

		if (updated.length === 0) throw new AccessKeysTypes.AccessKeyNotFoundError()
	}

	async delete(accessKeyId: string): Promise<void> {
		const updated = await this.db.core
			.update(coreSchema.accessKey)
			.set({ deletedAt: new Date() })
			.where(and(eq(coreSchema.accessKey.accessKeyId, accessKeyId), isNull(coreSchema.accessKey.deletedAt)))
			.returning()

		if (updated.length === 0) throw new AccessKeysTypes.AccessKeyNotFoundError()
	}

	/** Used by the S3 SigV4 verifier - the only place the secret is decrypted. */
	async resolveCredentials(accessKeyId: string): Promise<AccessKeysTypes.ResolvedCredentials> {
		const [found] = await this.db.core
			.select()
			.from(coreSchema.accessKey)
			.where(and(eq(coreSchema.accessKey.accessKeyId, accessKeyId), isNull(coreSchema.accessKey.deletedAt)))
			.limit(1)

		if (!found) throw new AccessKeysTypes.AccessKeyNotFoundError()
		if (found.status !== AccessKeyStatus.active) throw new AccessKeysTypes.AccessKeyInactiveError()
		if (found.expiresAt && found.expiresAt.getTime() < Date.now()) throw new AccessKeysTypes.AccessKeyInactiveError()

		return {
			accessKeyId: found.accessKeyId,
			secretAccessKey: this.cryptographicService.decrypt(found.secretKeyEncrypted),
			userGuid: found.userGuid,
		}
	}

	async markUsed(accessKeyId: string): Promise<void> {
		await this.db.core
			.update(coreSchema.accessKey)
			.set({ lastUsedAt: new Date() })
			.where(eq(coreSchema.accessKey.accessKeyId, accessKeyId))
	}

	/** AWS-shaped id: 20 uppercase alphanumerics, prefixed so keys are recognisable in logs. */
	private generateAccessKeyId(): string {
		const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
		const random = crypto.randomBytes(ACCESS_KEY_ID_LENGTH)
		const body = Array.from(random).map((byte) => alphabet[byte % alphabet.length]).join('')
		return `ST${body.slice(0, ACCESS_KEY_ID_LENGTH - 2)}`
	}

	private toItem(row: typeof coreSchema.accessKey.$inferSelect): AccessKeysTypes.AccessKeyItem {
		return {
			accessKeyId: row.accessKeyId,
			userGuid: row.userGuid,
			description: row.description,
			status: row.status,
			expiresAt: row.expiresAt,
			lastUsedAt: row.lastUsedAt,
			createdAt: row.createdAt,
		}
	}
}
