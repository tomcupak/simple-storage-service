import { Injectable } from '@nestjs/common'
import * as crypto from 'crypto'

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 12
const SALT = 'storage-secret-key'

/** Reversible encryption for values the server must be able to read back - S3 secret keys,
 *  which SigV4 verification needs in plain text. Passwords are hashed instead (see AuthService). */
@Injectable()
export class CryptographicService {
	private key: Buffer

	constructor(
		private config: CryptographicConfig,
	) {
		this.key = crypto.scryptSync(this.config.password, SALT, 32)
	}

	encrypt(plain: string): string {
		const iv = crypto.randomBytes(IV_LENGTH)
		const cipher = crypto.createCipheriv(ALGORITHM, this.key, iv)
		const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
		const authTag = cipher.getAuthTag()
		return [iv.toString('base64'), authTag.toString('base64'), encrypted.toString('base64')].join('.')
	}

	decrypt(encrypted: string): string {
		const [ivPart, authTagPart, dataPart] = encrypted.split('.')
		if (!ivPart || !authTagPart || !dataPart) throw new Error('Malformed encrypted value')

		const decipher = crypto.createDecipheriv(ALGORITHM, this.key, Buffer.from(ivPart, 'base64'))
		decipher.setAuthTag(Buffer.from(authTagPart, 'base64'))
		return Buffer.concat([decipher.update(Buffer.from(dataPart, 'base64')), decipher.final()]).toString('utf8')
	}
}

export interface CryptographicConfig {
	password: string
}
