import type { Config } from 'drizzle-kit'

// [Development ONLY] Config required by drizzle-kit tool generating migrations
export default {
	schema: './schema.ts',
	out: './migrations',
	dialect: 'postgresql',
	breakpoints: true,
	dbCredentials: {
		host: 'localhost',
		port: 10400,
		user: 'postgres',
		password: 'postgres',
		database: 'core',
		ssl: false,
	},
} satisfies Config
