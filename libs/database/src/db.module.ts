import { DynamicModule, Module } from '@nestjs/common'

import { DbProvider, DbProviderConfig } from './db.provider'

@Module({})
export class DbModule {
	static forRoot(config: DbProviderConfig): DynamicModule {
		return {
			module: DbModule,
			imports: [],
			providers: [
				{
					provide: DbProvider,
					useFactory: () => new DbProvider(config),
				}
			],
			exports: [
				DbProvider,
			],
			global: true,
		}
	}
}
