try { process.loadEnvFile() } catch {}

export class ConfigProvider {
	static postgresCore = {
		db: {
			host: process.env.POSTGRES_HOST || 'localhost',
			port: Number(process.env.POSTGRES_PORT || 10400),
			database: process.env.POSTGRES_DB || 'core',
			user: process.env.POSTGRES_USER || 'postgres',
			password: process.env.POSTGRES_PASSWORD || 'postgres',
			pool: Number(process.env.POSTGRES_POOL || 4),
		},
		dbMigrationsPath: process.env.MIGRATIONS_CORE_PATH || '../../../libs/database/src/core/migrations',
	} as const

	static redis = {
		redis: {
			host: process.env.REDIS_HOST || 'localhost',
			port: Number(process.env.REDIS_PORT || 10401),
			password: process.env.REDIS_PASSWORD,
		},
	} as const

	/** Where object blobs live. Every version's `storagePath` is relative to this root. */
	static storage = {
		storage: {
			dataPath: process.env.STORAGE_DATA_PATH || './data/objects',
		},
	} as const

	/** HS256 secret for the management UI's access/refresh tokens. */
	static jwt = {
		jwt: {
			secret: process.env.JWT_SECRET || 'dev-secret-change-me',
			accessTtl: Number(process.env.JWT_ACCESS_TTL || 900),
			refreshTtl: Number(process.env.JWT_REFRESH_TTL || 2_592_000),
			issuer: process.env.JWT_ISSUER || 'storage',
		},
	} as const

	/** Encrypts S3 secret keys at rest - they must be recoverable to verify SigV4 signatures,
	 *  so they cannot be one-way hashed like passwords. */
	static cryptographic = {
		cryptographic: {
			password: process.env.CRYPTOGRAPHIC_PASSWORD || 'dev-secret-password-32-chars-min',
		},
	} as const

	static s3 = {
		s3: {
			region: process.env.S3_REGION || 'us-east-1',
			/** Base domain enabling virtual-host style addressing (`<bucket>.<domain>`). */
			endpointDomain: process.env.S3_ENDPOINT_DOMAIN || '',
			/** Origin the S3 endpoint is reachable at from outside - the base of presigned URLs. */
			publicUrl: process.env.S3_PUBLIC_URL || `http://localhost:${process.env.S3_PORT || 10411}`,
			service: 's3',
		},
	} as const
}
