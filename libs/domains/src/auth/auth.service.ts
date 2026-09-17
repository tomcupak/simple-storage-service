import { Injectable, Logger } from '@nestjs/common'
import { coreSchema, DbProvider } from '@storage/database'
import * as crypto from 'crypto'
import { and, eq, isNull } from 'drizzle-orm'
import * as jwt from 'jsonwebtoken'

import { AuthTypes } from './auth.types'

const SCRYPT_KEY_LENGTH = 64

@Injectable()
export class AuthService {
	private logger = new Logger(AuthService.name)

	constructor(
		private db: DbProvider,
		private config: AuthConfig,
	) {}

	async login({ email, password, userAgent }: { email: string, password: string, userAgent?: string }): Promise<AuthTypes.Tokens> {
		const [found] = await this.db.core
			.select()
			.from(coreSchema.user)
			.where(and(eq(coreSchema.user.email, email.toLowerCase()), isNull(coreSchema.user.deletedAt)))
			.limit(1)

		if (!found || !this.verifyPassword(password, found.passwordHash)) {
			throw new AuthTypes.InvalidCredentialsError()
		}

		await this.db.core
			.update(coreSchema.user)
			.set({ lastLoginAt: new Date() })
			.where(eq(coreSchema.user.guid, found.guid))

		return this.issueTokens({ guid: found.guid, email: found.email, role: found.role }, userAgent)
	}

	async refresh(refreshToken: string): Promise<AuthTypes.Tokens> {
		const tokenHash = this.hashRefreshToken(refreshToken)
		const [session] = await this.db.core
			.select()
			.from(coreSchema.userSession)
			.where(and(eq(coreSchema.userSession.refreshTokenHash, tokenHash), isNull(coreSchema.userSession.revokedAt)))
			.limit(1)

		if (!session || session.expiresAt.getTime() < Date.now()) throw new AuthTypes.InvalidRefreshTokenError()

		const [found] = await this.db.core
			.select()
			.from(coreSchema.user)
			.where(and(eq(coreSchema.user.guid, session.userGuid), isNull(coreSchema.user.deletedAt)))
			.limit(1)

		if (!found) throw new AuthTypes.UserDisabledError()

		// Refresh tokens rotate: the presented one is revoked as soon as it is exchanged,
		// so a leaked token stops working after its first use.
		await this.db.core
			.update(coreSchema.userSession)
			.set({ revokedAt: new Date() })
			.where(eq(coreSchema.userSession.guid, session.guid))

		return this.issueTokens({ guid: found.guid, email: found.email, role: found.role }, session.userAgent ?? undefined)
	}

	async logout(refreshToken: string): Promise<void> {
		await this.db.core
			.update(coreSchema.userSession)
			.set({ revokedAt: new Date() })
			.where(eq(coreSchema.userSession.refreshTokenHash, this.hashRefreshToken(refreshToken)))
	}

	verifyAccessToken(token: string): AuthTypes.Identity | null {
		try {
			const payload = jwt.verify(token, this.config.secret, { issuer: this.config.issuer }) as AuthTypes.AccessTokenPayload
			if (payload.type !== 'access') return null
			return { guid: payload.sub, email: payload.email, role: payload.role }
		} catch {
			return null
		}
	}

	hashPassword(password: string): string {
		const salt = crypto.randomBytes(16)
		const derived = crypto.scryptSync(password, salt, SCRYPT_KEY_LENGTH)
		return `${salt.toString('base64')}.${derived.toString('base64')}`
	}

	verifyPassword(password: string, storedHash: string): boolean {
		const [saltPart, hashPart] = storedHash.split('.')
		if (!saltPart || !hashPart) return false

		const expected = Buffer.from(hashPart, 'base64')
		const derived = crypto.scryptSync(password, Buffer.from(saltPart, 'base64'), expected.length)
		return expected.length === derived.length && crypto.timingSafeEqual(expected, derived)
	}

	private async issueTokens(identity: AuthTypes.Identity, userAgent?: string): Promise<AuthTypes.Tokens> {
		const payload: AuthTypes.AccessTokenPayload = {
			sub: identity.guid,
			email: identity.email,
			role: identity.role,
			type: 'access',
		}
		const accessToken = jwt.sign(payload, this.config.secret, {
			issuer: this.config.issuer,
			expiresIn: this.config.accessTtl,
		})

		const refreshToken = crypto.randomBytes(48).toString('base64url')
		await this.db.core.insert(coreSchema.userSession).values({
			userGuid: identity.guid,
			refreshTokenHash: this.hashRefreshToken(refreshToken),
			userAgent: userAgent ?? null,
			expiresAt: new Date(Date.now() + this.config.refreshTtl * 1000),
		})

		return { accessToken, refreshToken, expiresIn: this.config.accessTtl }
	}

	private hashRefreshToken(token: string): string {
		return crypto.createHash('sha256').update(token).digest('hex')
	}
}

export interface AuthConfig {
	secret: string
	issuer: string
	accessTtl: number
	refreshTtl: number
}
