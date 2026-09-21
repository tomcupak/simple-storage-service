import { DynamicModule, Module } from '@nestjs/common'
import { ScheduleModule, SchedulerRegistry } from '@nestjs/schedule'
import { DbProvider } from '@storage/database'

import { ObjectsModule } from '../objects/objects.module'
import { ObjectsService } from '../objects/objects.service'
import { StorageService } from '../storage/storage.service'
import { GcService } from './gc.service'
import { GcTypes } from './gc.types'

@Module({})
export class GcModule {
	static forRoot(config: { gc: GcTypes.Config }): DynamicModule {
		return {
			module: GcModule,
			imports: [ScheduleModule.forRoot(), ObjectsModule],
			providers: [
				{
					provide: GcService,
					inject: [DbProvider, StorageService, ObjectsService, SchedulerRegistry],
					useFactory: (
						db: DbProvider,
						storageService: StorageService,
						objectsService: ObjectsService,
						schedulerRegistry: SchedulerRegistry,
					) => new GcService(config.gc, db, storageService, objectsService, schedulerRegistry),
				},
			],
			exports: [GcService],
		}
	}
}
