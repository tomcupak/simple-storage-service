import { ServerSideEncryption } from '@storage/database'
import { Readable } from 'stream'

export namespace StorageTypes {
	export interface EncryptionConfig {
		/** Off stores payloads in the clear. Turning it on encrypts new writes; blobs already
		 *  on disk stay readable because each one records how it was stored. */
		enabled: boolean
		/** Wraps the per-blob data keys. Losing it loses every encrypted object. */
		masterKey: string
	}

	/** What has to be stored next to an object version for its blob to be readable again. */
	export interface BlobEncryption {
		algorithm: ServerSideEncryption.aes256
		/** The blob's data key and IV, encrypted with the deployment master key. */
		wrappedKey: string
	}

	/** An unwrapped data key, in memory for the length of one read or write. */
	export interface BlobKey {
		key: Buffer
		iv: Buffer
		descriptor: BlobEncryption
	}

	export interface WriteResult {
		/** Path of the blob relative to the configured data root - stored on `object_version`. */
		storagePath: string
		/** Size of the plaintext: what the object is, not what the file on disk weighs. With
		 *  a stream cipher the two are the same, but callers must not have to know that. */
		size: number
		/** MD5 of the payload, i.e. the S3 ETag of a single-part upload. */
		etag: string
		/** How the blob was encrypted, or undefined when it was stored in the clear. */
		encryption?: BlobEncryption
	}

	/** One source of a `concat`: where the bytes are and how to decrypt them. */
	export interface ConcatSource {
		storagePath: string
		encryption?: BlobEncryption | null
	}

	export interface ReadOptions {
		range?: ReadRange
		encryption?: BlobEncryption | null
	}

	export interface WriteOptions {
		/** Hard ceiling on the payload. The stream is cut off and the partial blob removed the
		 *  moment it is crossed, so a client that under-declares its `Content-Length` cannot
		 *  fill the disk by simply sending more than it announced. */
		maxBytes?: number
	}

	export interface ReadRange {
		start: number
		end: number
	}

	/** One blob as the garbage collector sees it: where it is, and how old. */
	export interface BlobEntry {
		storagePath: string
		modifiedAt: Date
		size: number
	}

	export interface ReadResult {
		stream: Readable
		size: number
	}

	export class BlobNotFoundError extends Error { public code = 'blob_not_found' }
	export class PayloadTooLargeError extends Error { public code = 'payload_too_large' }
	/** The stored data key could not be unwrapped - almost always a changed master key. */
	export class EncryptionKeyError extends Error { public code = 'encryption_key_invalid' }
}
