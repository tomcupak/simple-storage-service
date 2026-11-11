import { Injectable } from '@nestjs/common'
import { coreSchema, DrizzleCredentials, getDb } from '@storage/database'
import { NodePgDatabase } from 'drizzle-orm/node-postgres'

@Injectable()
export class DbProvider {
	public core!: NodePgDatabase<typeof coreSchema>

	constructor(
		private config: DbProviderConfig,
	) {}

	async onApplicationBootstrap() {
		if (this.config.core) {
			this.core = await getDb({
				credentials: this.config.core,
				schema: coreSchema,
			})
		}
	}
}

export interface DbProviderConfig {
	core?: DrizzleCredentials
}
