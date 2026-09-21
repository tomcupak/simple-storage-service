import { Injectable, Logger } from '@nestjs/common'
import { DbProvider } from '@storage/database'
import { StorageService } from '@storage/domains/storage'
import { sql } from 'drizzle-orm'

import { HealthTypes } from './health.types'

/** Liveness and readiness of the S3 endpoint.
 *
 *  Liveness is about the process: if the event loop answers, the container is alive and a
 *  restart would fix nothing. Readiness is about the dependencies an S3 request actually needs
 *  - the metadata database and the blob directory - so a load balancer stops sending traffic to
 *  an instance that would only answer `InternalError`. */
@Injectable()
export class HealthService {
	private logger = new Logger(HealthService.name)

	constructor(
		private readonly db: DbProvider,
		private readonly storageService: StorageService,
	) {}

	live(): HealthTypes.LivenessResult {
		return { status: HealthTypes.Status.ok }
	}

	/** Both checks always run: an instance failing on two counts should say so in one answer
	 *  rather than reveal the second only once the first is fixed. */
	async ready(): Promise<HealthTypes.ReadinessResult> {
		const [database, storage] = await Promise.all([this.checkDatabase(), this.checkStorage()])
		const status = database === HealthTypes.Status.ok && storage === HealthTypes.Status.ok
			? HealthTypes.Status.ok
			: HealthTypes.Status.failing

		return { status, database, storage }
	}

	private async checkDatabase(): Promise<HealthTypes.Status> {
		try {
			await this.db.core.execute(sql`SELECT 1`)
			return HealthTypes.Status.ok
		} catch (err) {
			this.logger.error(err)
			return HealthTypes.Status.failing
		}
	}

	/** Writable, not merely present: a read-only or full data volume fails every upload while
	 *  a directory listing would still succeed. */
	private async checkStorage(): Promise<HealthTypes.Status> {
		try {
			await this.storageService.assertWritable()
			return HealthTypes.Status.ok
		} catch (err) {
			this.logger.error(err)
			return HealthTypes.Status.failing
		}
	}
}
