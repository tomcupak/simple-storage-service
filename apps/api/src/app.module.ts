import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common'
import { APP_INTERCEPTOR } from '@nestjs/core'
import { DbModule } from '@storage/database'
import { AccessKeysModule } from '@storage/domains/access-keys'
import { AuditInterceptor, AuditModule } from '@storage/domains/audit'
import { AuthModule } from '@storage/domains/auth'
import { BucketsModule } from '@storage/domains/buckets'
import { CryptographicModule } from '@storage/domains/cryptographic'
import { GcModule } from '@storage/domains/gc'
import { ObjectsModule } from '@storage/domains/objects'
import { PoliciesModule } from '@storage/domains/policies'
import { RateLimitModule } from '@storage/domains/rate-limit'
import { S3Module } from '@storage/domains/s3'
import { StorageModule } from '@storage/domains/storage'
import { UsageModule } from '@storage/domains/usage'
import { UsersModule } from '@storage/domains/users'
import { RequestLogService } from '@storage/shared'

import { ApiAccessKeysModule } from './access-keys/access-keys.module'
import { ApiLoggingMiddleware } from './api.logging.middleware'
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
		RateLimitModule.forRoot({ rateLimit: config.rateLimit, valkey: config.valkey }),
		// Housekeeping runs here and not in `apps/s3`: one sweeper, in the app that is not on
		// the hot path of every object read.
		GcModule.forRoot({ gc: config.gc }),

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
		RequestLogService,
		// Records every handler marked `@Audited(...)`, on success and on failure alike.
		{ provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
	],
})
export class AppModule implements NestModule {
	configure(consumer: MiddlewareConsumer): void {
		consumer.apply(ApiLoggingMiddleware).forRoutes({ path: '{*splat}', method: RequestMethod.ALL })
	}
}
