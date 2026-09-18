import { Module } from '@nestjs/common'
import { APP_INTERCEPTOR } from '@nestjs/core'
import { DbModule } from '@storage/database'
import { AccessKeysModule } from '@storage/domains/access-keys'
import { AuditInterceptor, AuditModule } from '@storage/domains/audit'
import { AuthModule } from '@storage/domains/auth'
import { BucketsModule } from '@storage/domains/buckets'
import { CryptographicModule } from '@storage/domains/cryptographic'
import { ObjectsModule } from '@storage/domains/objects'
import { PoliciesModule } from '@storage/domains/policies'
import { S3Module } from '@storage/domains/s3'
import { StorageModule } from '@storage/domains/storage'
import { UsageModule } from '@storage/domains/usage'
import { UsersModule } from '@storage/domains/users'

import { ApiAccessKeysModule } from './access-keys/access-keys.module'
import { config } from './app.config'
import { AppController } from './app.controller'
import { AppService } from './app.service'
import { ApiAuditModule } from './audit/audit.module'
import { ApiAuthModule } from './auth/auth.module'
import { ApiBucketsModule } from './buckets/buckets.module'
import { ApiObjectsModule } from './objects/objects.module'
import { ApiPoliciesModule } from './policies/policies.module'
import { ApiUsageModule } from './usage/usage.module'
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
		UsageModule,
		AuditModule,
		// The management API signs presigned share links with the same SigV4 code the S3 app verifies.
		S3Module,

		ApiAuthModule,
		ApiUsersModule,
		ApiAccessKeysModule,
		ApiBucketsModule,
		ApiObjectsModule,
		ApiPoliciesModule,
		ApiUsageModule,
		ApiAuditModule,
	],
	controllers: [
		AppController,
	],
	providers: [
		AppService,
		// Records every handler marked `@Audited(...)`, on success and on failure alike.
		{ provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
	],
})
export class AppModule {}
