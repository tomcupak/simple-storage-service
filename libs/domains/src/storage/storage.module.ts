import { DynamicModule, Module } from '@nestjs/common'

import { StorageConfig, StorageService } from './storage.service'

@Module({})
export class StorageModule {
	static forRoot(config: StorageConfig): DynamicModule {
		return {
			module: StorageModule,
			providers: [
				{
					provide: StorageService,
					useFactory: () => new StorageService(config),
				},
			],
			exports: [StorageService],
			global: true,
		}
	}
}
