import { ConfigProvider } from '@storage/domains/config/config.provider'

export const config = {
	port: Number(process.env.S3_PORT || 10411),

	...ConfigProvider.postgresCore,
	...ConfigProvider.storage,
	...ConfigProvider.cryptographic,
	...ConfigProvider.s3,

	/** Largest single PUT accepted; larger payloads must use multipart upload (as in S3). */
	maxSingleUploadBytes: Number(process.env.S3_MAX_SINGLE_UPLOAD_BYTES || 5 * 1024 * 1024 * 1024),
}
