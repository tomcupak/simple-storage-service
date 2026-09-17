import { Injectable } from '@nestjs/common'
import { AccessKeyStatus, coreSchema, DbProvider, UserRole } from '@storage/database'
import * as crypto from 'crypto'
import { and, eq, isNull } from 'drizzle-orm'

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

	async list(userGuid?: string): Promise<AccessKeysTypes.AccessKeyItem[]> {
		const rows = await this.db.core
			.select()
			.from(coreSchema.accessKey)
			.where(userGuid
				? and(eq(coreSchema.accessKey.userGuid, userGuid), isNull(coreSchema.accessKey.deletedAt))
				: isNull(coreSchema.accessKey.deletedAt))

		return rows.map((row) => this.toItem(row))
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
