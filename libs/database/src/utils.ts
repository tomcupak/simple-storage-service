import { Logger } from '@nestjs/common'
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import * as path from 'path'
import { Client, Pool } from 'pg'

export type DrizzleCredentials = {
	host: string
	port?: number
	user?: string
	password?: string
	database: string
	pool?: number
}

export async function getDb<Schema extends Record<string, unknown>>({ credentials, schema }: { credentials: DrizzleCredentials; schema: Schema }) {
	const postgresClient = new Pool({
		host: credentials.host,
		port: credentials.port,
		user: credentials.user,
		password: credentials.password,
		database: credentials.database,
		max: credentials.pool || 4,
	})

	await postgresClient.connect()

	return drizzle(postgresClient, { schema }) as NodePgDatabase<Schema>
}

/** Postgres locks migrations table - multiple-instances safe */
export async function migrateDb({ logger, dbCredentials, dbMigrationsPath } : {
	logger: Logger
	dbCredentials: DrizzleCredentials
	dbMigrationsPath: string
}) {
	const postgresClient = new Client({
		host: dbCredentials.host,
		port: dbCredentials.port,
		user: dbCredentials.user,
		password: dbCredentials.password,
		database: dbCredentials.database,
	})
	logger.log('[DB] migrating')
	await postgresClient.connect()
	
	try {
		const migrationsFolder = path.isAbsolute(dbMigrationsPath)
			? dbMigrationsPath
			: path.resolve(__dirname, dbMigrationsPath)
		await migrate(drizzle(postgresClient), { migrationsFolder })
		logger.log('[DB] migration done')
	} finally {
		await postgresClient.end()
	}
}

export function boolEnv(key: string): boolean {
	const v = process.env[key]
	return v === 'yes' || v === 'true' || v === '1'
}

export const DrizzleErrorCode = {
	UNIQUE_CONSTRAINT_VIOLATION: '23505',
}

/** Postgres error code behind a failed query.
 *
 *  Drizzle wraps query failures in a `DrizzleQueryError` and keeps the driver's error as
 *  `cause`, so the `code` is one level down - reading it off the thrown error alone silently
 *  turns every constraint violation into a 500. */
export function drizzleErrorCode(err: unknown): string | undefined {
	for (let current: unknown = err, depth = 0; current && depth < 5; depth += 1) {
		if (typeof current !== 'object') return undefined

		const code = (current as { code?: unknown }).code
		if (typeof code === 'string') return code

		current = (current as { cause?: unknown }).cause
	}

	return undefined
}

export function isUniqueViolation(err: unknown): boolean {
	return drizzleErrorCode(err) === DrizzleErrorCode.UNIQUE_CONSTRAINT_VIOLATION
}
