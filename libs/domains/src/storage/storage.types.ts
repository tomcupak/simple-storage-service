import { Readable } from 'stream'

export namespace StorageTypes {
	export interface WriteResult {
		/** Path of the blob relative to the configured data root - stored on `object_version`. */
		storagePath: string
		size: number
		/** MD5 of the payload, i.e. the S3 ETag of a single-part upload. */
		etag: string
	}

	export interface ReadRange {
		start: number
		end: number
	}

	export interface ReadResult {
		stream: Readable
		size: number
	}

	export class BlobNotFoundError extends Error { public code = 'blob_not_found' }
}
