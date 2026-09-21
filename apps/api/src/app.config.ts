import { ConfigProvider } from '@storage/domains/config/config.provider'

export const config = {
	port: Number(process.env.API_PORT || 10410),
	cors: process.env.CORS ?? 'http://localhost:10412',

	openApi: {
		version: '1.0.0',
		title: 'Storage API',
		description: 'Management API for buckets, access keys, policies and the file browser',
	},

	...ConfigProvider.postgresCore,
	...ConfigProvider.storage,
	...ConfigProvider.jwt,
	...ConfigProvider.cryptographic,
	...ConfigProvider.s3,
	...ConfigProvider.valkey,
	...ConfigProvider.rateLimit,
	...ConfigProvider.gc,

	/** Lifetime a shared presigned link gets when the caller does not ask for one. */
	presignDefaultSeconds: Number(process.env.API_PRESIGN_DEFAULT_SECONDS || 3600),

	body: {
		/** Largest JSON/form body accepted; object payloads bypass the parsers entirely. */
		maxBytes: process.env.API_MAX_BODY_BYTES || '1mb',
		/** Routes whose body is an object payload and must reach the handler as a raw stream. */
		rawPathPattern: /^\/v1\/buckets\/[^/]+\/objects$/,
		/** Ceiling on a single upload through the management API. A quota bounds what a bucket
		 *  may hold in total; this bounds what one request may push at the disk before any
		 *  quota is consulted, including in a deployment that sets no quotas at all. */
		maxUploadBytes: Number(process.env.API_MAX_UPLOAD_BYTES || 5 * 1024 * 1024 * 1024),
	},

	/** Created on first boot when the deployment has no users yet. */
	bootstrapAdmin: {
		email: process.env.BOOTSTRAP_ADMIN_EMAIL || 'admin@storage.local',
		password: process.env.BOOTSTRAP_ADMIN_PASSWORD || 'admin12345',
	},
}
