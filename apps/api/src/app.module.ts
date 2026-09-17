import { Module } from '@nestjs/common'
import { DbModule } from '@storage/database'
import { AccessKeysModule } from '@storage/domains/access-keys'
import { AuthModule } from '@storage/domains/auth'
import { BucketsModule } from '@storage/domains/buckets'
import { CryptographicModule } from '@storage/domains/cryptographic'
import { ObjectsModule } from '@storage/domains/objects'
import { PoliciesModule } from '@storage/domains/policies'
import { StorageModule } from '@storage/domains/storage'
import { UsersModule } from '@storage/domains/users'

import { ApiAccessKeysModule } from './access-keys/access-keys.module'
import { config } from './app.config'
import { AppController } from './app.controller'
import { AppService } from './app.service'
import { ApiAuthModule } from './auth/auth.module'
import { ApiBucketsModule } from './buckets/buckets.module'
import { ApiObjectsModule } from './objects/objects.module'
import { ApiPoliciesModule } from './policies/policies.module'
import { ApiUsersModule } from './users/users.module'

@Module({
	imports: [
		DbModule.forRoot({ core: config.db }),
		AuthModule.forRoot(config.jwt),
		CryptographicModule.forRoot(config.cryptographic),
		StorageModule.forRoot(config.storage),

		UsersModule,
		AccessKeysModule,
		BucketsModule,
		ObjectsModule,
		PoliciesModule,

		ApiAuthModule,
		ApiUsersModule,
		ApiAccessKeysModule,
		ApiBucketsModule,
		ApiObjectsModule,
		ApiPoliciesModule,
	],
	controllers: [
		AppController,
	],
	providers: [
		AppService,
	],
})
export class AppModule {}
