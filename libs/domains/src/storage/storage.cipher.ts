import { ServerSideEncryption } from '@storage/database'
import * as crypto from 'crypto'
import { Transform, TransformCallback } from 'stream'

import { StorageTypes } from './storage.types'

const DATA_ALGORITHM = 'aes-256-ctr'
const WRAP_ALGORITHM = 'aes-256-gcm'
const KEY_BYTES = 32
const IV_BYTES = 16
const WRAP_IV_BYTES = 12
const BLOCK_BYTES = 16
const MASTER_KEY_SALT = 'storage-object-encryption'

/** SSE-S3: every blob is encrypted with its own data key, and that key is stored - wrapped
 *  with the deployment's master key - next to the object's metadata. Losing the master key
 *  therefore loses every object, and rotating it is a re-wrap of the stored keys rather than a
 *  re-encryption of the payloads.
 *
 *  The payload cipher is AES-256-CTR rather than GCM, because a `GetObject` with a `Range`
 *  header must stay proportional to the range asked for. CTR is seekable: the keystream for
 *  byte `n` depends only on the counter, so a read can start in the middle of a 5 GB object
 *  without touching the bytes before it. The price is that CTR authenticates nothing - this
 *  protects a stolen disk from being read, not a writable disk from being tampered with, which
 *  is the same guarantee SSE-S3 makes. The wrapped data keys do use GCM: they are small, they
 *  are never read by range, and a forged key must not decrypt to something usable.
 *
 *  The IV is derived per blob and stored with the key, so two blobs never share a keystream. */
export class StorageCipher {
	private masterKey: Buffer

	constructor(
		private readonly config: StorageTypes.EncryptionConfig,
	) {
		this.masterKey = crypto.scryptSync(this.config.masterKey, MASTER_KEY_SALT, KEY_BYTES)
	}

	get enabled(): boolean {
		return this.config.enabled
	}

	/** A fresh data key for one blob, wrapped ready to be stored. */
	createKey(): StorageTypes.BlobKey {
		const key = crypto.randomBytes(KEY_BYTES)
		const iv = crypto.randomBytes(IV_BYTES)

		return {
			key,
			iv,
			descriptor: {
				algorithm: ServerSideEncryption.aes256,
				wrappedKey: this.wrap(Buffer.concat([key, iv])),
			},
		}
	}

	/** Recovers the data key of a stored blob from its descriptor. */
	openKey(descriptor: StorageTypes.BlobEncryption): StorageTypes.BlobKey {
		const material = this.unwrap(descriptor.wrappedKey)
		if (material.length !== KEY_BYTES + IV_BYTES) throw new StorageTypes.EncryptionKeyError()

		return {
			key: material.subarray(0, KEY_BYTES),
			iv: material.subarray(KEY_BYTES),
			descriptor,
		}
	}

	encryptStream(blobKey: StorageTypes.BlobKey): Transform {
		return crypto.createCipheriv(DATA_ALGORITHM, blobKey.key, blobKey.iv)
	}

	/** The stages a read starting at plaintext byte `offset` has to be piped through.
	 *
	 *  The counter is advanced by the number of whole blocks before the offset; the bytes of
	 *  the block the offset falls inside still have to be produced and thrown away, which is
	 *  the second stage. The caller must therefore start reading the file at `alignedOffset`
	 *  and not at `offset`. */
	decryptStages(blobKey: StorageTypes.BlobKey, offset = 0): { stages: Transform[], alignedOffset: number } {
		const alignedOffset = offset - (offset % BLOCK_BYTES)
		const counter = this.advanceIv(blobKey.iv, alignedOffset / BLOCK_BYTES)
		const decipher = crypto.createDecipheriv(DATA_ALGORITHM, blobKey.key, counter)

		const stages = alignedOffset === offset ? [decipher] : [decipher, this.skip(offset - alignedOffset)]
		return { stages, alignedOffset }
	}

	/** CTR treats the IV as a big-endian counter; seeking `blocks` blocks forward is adding
	 *  `blocks` to it, with the carry running through all 16 bytes. */
	private advanceIv(iv: Buffer, blocks: number): Buffer {
		const counter = Buffer.from(iv)
		let carry = BigInt(blocks)

		for (let index = counter.length - 1; index >= 0 && carry > 0n; index -= 1) {
			const sum = BigInt(counter[index]) + (carry & 0xffn)
			counter[index] = Number(sum & 0xffn)
			carry = (carry >> 8n) + (sum >> 8n)
		}

		return counter
	}

	/** Drops the first `count` bytes of a stream - the remainder of the block a range started
	 *  inside, which had to be decrypted to get the keystream right. */
	private skip(count: number): Transform {
		let remaining = count

		return new Transform({
			transform(chunk: Buffer, _encoding, callback: TransformCallback) {
				if (remaining <= 0) {
					callback(null, chunk)
					return
				}

				if (chunk.length <= remaining) {
					remaining -= chunk.length
					callback()
					return
				}

				const rest = chunk.subarray(remaining)
				remaining = 0
				callback(null, rest)
			},
		})
	}

	private wrap(material: Buffer): string {
		const iv = crypto.randomBytes(WRAP_IV_BYTES)
		const cipher = crypto.createCipheriv(WRAP_ALGORITHM, this.masterKey, iv)
		const wrapped = Buffer.concat([cipher.update(material), cipher.final()])

		return [iv, cipher.getAuthTag(), wrapped].map((part) => part.toString('base64')).join('.')
	}

	private unwrap(wrappedKey: string): Buffer {
		const [ivPart, authTagPart, dataPart] = wrappedKey.split('.')
		if (!ivPart || !authTagPart || !dataPart) throw new StorageTypes.EncryptionKeyError()

		try {
			const decipher = crypto.createDecipheriv(WRAP_ALGORITHM, this.masterKey, Buffer.from(ivPart, 'base64'))
			decipher.setAuthTag(Buffer.from(authTagPart, 'base64'))

			return Buffer.concat([decipher.update(Buffer.from(dataPart, 'base64')), decipher.final()])
		} catch {
			// A key that will not unwrap means the master key is not the one it was wrapped
			// with - a misconfiguration worth naming, not an unreadable object.
			throw new StorageTypes.EncryptionKeyError()
		}
	}
}
