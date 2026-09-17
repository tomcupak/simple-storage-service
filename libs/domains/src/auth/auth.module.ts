import { DynamicModule, Module } from '@nestjs/common'
import { DbProvider } from '@storage/database'

import { AuthConfig, AuthService } from './auth.service'

@Module({})
export class AuthModule {
	static forRoot(config: AuthConfig): DynamicModule {
		return {
			module: AuthModule,
			providers: [
				{
					provide: AuthService,
					useFactory: (db: DbProvider) => new AuthService(db, config),
					inject: [DbProvider],
				},
			],
			exports: [AuthService],
			global: true,
		}
	}
}
