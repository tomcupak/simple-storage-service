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

	/** Valkey, spoken to with the `redis` client - the protocol is the same. */
	static valkey = {
		valkey: {
			host: process.env.VALKEY_HOST || 'localhost',
			port: Number(process.env.VALKEY_PORT || 10401),
			password: process.env.VALKEY_PASSWORD,
		},
	} as const

	/** Request rate limiting, backed by Valkey so every instance shares one counter.
	 *  Without a reachable Valkey the limiter is a no-op rather than a closed door - an
	 *  outage of the counter store must not take the storage endpoints down with it. */
	static rateLimit = {
		rateLimit: {
			enabled: (process.env.RATE_LIMIT_ENABLED ?? 'true') !== 'false',
			/** Length of the fixed window the counter is kept for, in seconds. */
			windowSeconds: Number(process.env.RATE_LIMIT_WINDOW_SECONDS || 60),
			/** Requests one caller may make per window. */
			max: Number(process.env.RATE_LIMIT_MAX || 600),
		},
	} as const

	/** Where object blobs live. Every version's `storagePath` is relative to this root. */
	static storage = {
		storage: {
			dataPath: process.env.STORAGE_DATA_PATH || './data/objects',
			/** SSE-S3. The master key wraps the per-object data keys, so it must outlive every
			 *  object written under it - losing it makes them unreadable. It defaults to the
			 *  secret-key password so a single-secret deployment still works, but a deployment
			 *  that means it should set its own and never rotate it without re-wrapping. */
			encryption: {
				enabled: (process.env.STORAGE_ENCRYPTION ?? 'true') !== 'false',
				masterKey: process.env.STORAGE_ENCRYPTION_KEY
					|| process.env.CRYPTOGRAPHIC_PASSWORD
					|| 'dev-secret-password-32-chars-min',
			},
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

	/** Reclaims blobs the write paths deliberately left behind, and aborts multipart uploads
	 *  a client never finished. Runs in one app only - see `apps/api`. */
	static gc = {
		gc: {
			enabled: (process.env.GC_ENABLED ?? 'true') !== 'false',
			cron: process.env.GC_CRON || '17 3 * * *',
			multipartMaxAgeHours: Number(process.env.GC_MULTIPART_MAX_AGE_HOURS || 7 * 24),
			blobMinAgeHours: Number(process.env.GC_BLOB_MIN_AGE_HOURS || 24),
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
