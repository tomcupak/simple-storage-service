import { DynamicModule, Module } from '@nestjs/common'
import { DbProvider } from '@storage/database'

import { BucketsModule } from '../buckets/buckets.module'
import { BucketsService } from '../buckets/buckets.service'
import { CryptographicService } from '../cryptographic/cryptographic.service'
import { ObjectsModule } from '../objects/objects.module'
import { ObjectsService } from '../objects/objects.service'
import { PoliciesModule } from '../policies/policies.module'
import { PoliciesService } from '../policies/policies.service'
import { MigrationService } from './migration.service'
import { MigrationTypes } from './migration.types'
import { MigrationWorker } from './migration.worker'
import { MigrationSourceService } from './migration-source.service'

/** Global so the management controllers can inject `MigrationService` without importing the
 *  dynamic module a second time. The worker starts polling in whichever app registers this
 *  module - which is `apps/api` only. */
@Module({})
export class MigrationModule {
	static forRoot(config: { migration: MigrationTypes.Config }): DynamicModule {
		return {
			module: MigrationModule,
			global: true,
			imports: [BucketsModule, ObjectsModule, PoliciesModule],
			providers: [
				MigrationSourceService,
				{
					provide: MigrationService,
					inject: [DbProvider, CryptographicService, MigrationSourceService, BucketsService, PoliciesService],
					useFactory: (
						db: DbProvider,
						cryptographic: CryptographicService,
						source: MigrationSourceService,
						buckets: BucketsService,
						policies: PoliciesService,
					) => new MigrationService(db, cryptographic, source, buckets, policies),
				},
				{
					provide: MigrationWorker,
					inject: [DbProvider, CryptographicService, MigrationSourceService, MigrationService, BucketsService, PoliciesService, ObjectsService],
					useFactory: (
						db: DbProvider,
						cryptographic: CryptographicService,
						source: MigrationSourceService,
						migrationService: MigrationService,
						buckets: BucketsService,
						policies: PoliciesService,
						objects: ObjectsService,
					) => new MigrationWorker(config.migration, db, cryptographic, source, migrationService, buckets, policies, objects),
				},
			],
			exports: [MigrationService],
		}
	}
}
