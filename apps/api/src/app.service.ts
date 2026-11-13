import { Injectable, Logger } from '@nestjs/common'
import { DbProvider } from '@storage/database'
import { AccessKeysService } from '@storage/domains/access-keys'
import { UsersService } from '@storage/domains/users'
import { sql } from 'drizzle-orm'

import { config } from './app.config'

@Injectable()
export class AppService {
	private dbCheckInterval: NodeJS.Timeout
	private dbOk = false
	private logger = new Logger(AppService.name)

	constructor(
		private db: DbProvider,
		private usersService: UsersService,
		private accessKeysService: AccessKeysService,
	) {}

	async onApplicationBootstrap() {
		await this.testDb()
		await this.usersService.bootstrapAdmin(config.bootstrapAdmin)

		if (config.bootstrapAccessKey) {
			await this.accessKeysService.ensureBootstrapKey({ ownerEmail: config.bootstrapAdmin.email, ...config.bootstrapAccessKey })
		}

		this.dbCheckInterval = setInterval(() => {
			void this.testDb()
		}, 10_000)
	}

	onModuleDestroy() {
		clearInterval(this.dbCheckInterval)
	}

	getStatus() {
		return {
			api: 'ok',
			db: this.dbOk ? 'ok' : 'failing',
		}
	}

	private async testDb() {
		try {
			await this.db.core.execute(sql`SELECT 1`)
			this.dbOk = true
		} catch (err) {
			this.logger.error(err)
			this.dbOk = false
		}
	}
}
