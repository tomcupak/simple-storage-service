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
