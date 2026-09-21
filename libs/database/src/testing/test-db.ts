import { sql } from 'drizzle-orm'
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import * as path from 'path'
import { Pool } from 'pg'

import { coreSchema } from '../index'

/** Connection an integration test gets when it asks for a database, and the two things it then
 *  wants: a schema that is up to date, and a clean slate between tests.
 *
 *  `core_test` lives in the same Postgres as the development database, so a developer needs one
 *  container and not two. It is a separate database, never a separate schema: `TRUNCATE` here
 *  must not be one typo away from emptying `core`. */
export class TestDatabase {
	/** Migrations are schema work, not per-test work: running them once per Jest worker keeps a
	 *  suite of twenty tests from replaying every migration twenty times. */
	private static migrated?: Promise<void>

	private constructor(
		private readonly pool: Pool,
		public readonly db: NodePgDatabase<typeof coreSchema>,
	) {}

	static async connect(): Promise<TestDatabase> {
		const pool = new Pool({
			host: process.env.TEST_POSTGRES_HOST || process.env.POSTGRES_HOST || 'localhost',
			port: Number(process.env.TEST_POSTGRES_PORT || process.env.POSTGRES_PORT || 10400),
			user: process.env.TEST_POSTGRES_USER || process.env.POSTGRES_USER || 'postgres',
			password: process.env.TEST_POSTGRES_PASSWORD || process.env.POSTGRES_PASSWORD || 'postgres',
			database: process.env.TEST_POSTGRES_DB || 'core_test',
			max: 2,
		})

		const db = drizzle(pool, { schema: coreSchema })
		TestDatabase.migrated ??= migrate(db, { migrationsFolder: TestDatabase.migrationsFolder() })
		await TestDatabase.migrated

		return new TestDatabase(pool, db)
	}

	/** Empties every table the schema owns, in one statement so foreign keys never dictate an
	 *  order. The migration bookkeeping table is deliberately left alone - dropping it would
	 *  make the next `connect()` replay the whole schema onto a database that already has it. */
	async truncate(): Promise<void> {
		const tables = await this.db.execute<{ table_name: string }>(sql`
			SELECT table_name
			FROM information_schema.tables
			WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
		`)

		const names = tables.rows
			.map((row) => row.table_name)
			.filter((name) => !name.startsWith('__drizzle'))

		if (names.length === 0) return

		const list = sql.join(names.map((name) => sql.identifier(name)), sql`, `)
		await this.db.execute(sql`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`)
	}

	async close(): Promise<void> {
		await this.pool.end()
	}

	/** Resolved from this file rather than from the working directory, so a test run started
	 *  from anywhere still finds the SQL. */
	private static migrationsFolder(): string {
		return path.resolve(__dirname, '../core/migrations')
	}
}
