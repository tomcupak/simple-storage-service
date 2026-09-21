import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common'
import { DbModule } from '@storage/database'
import { AccessKeysModule } from '@storage/domains/access-keys'
import { BucketsModule } from '@storage/domains/buckets'
import { CryptographicModule } from '@storage/domains/cryptographic'
import { ObjectsModule } from '@storage/domains/objects'
import { PoliciesModule } from '@storage/domains/policies'
import { RateLimitModule } from '@storage/domains/rate-limit'
import { S3Module } from '@storage/domains/s3'
import { StorageModule } from '@storage/domains/storage'
import { RequestLogService } from '@storage/shared'

import { config } from './app.config'
import { HealthControllerV1 } from './health/health.controller'
import { HealthService } from './health/health.service'
import { S3BucketControllerV1 } from './s3/s3.bucket.controller'
import { S3LoggingMiddleware } from './s3/s3.logging.middleware'
import { S3ObjectControllerV1 } from './s3/s3.object.controller'
import { S3ServiceControllerV1 } from './s3/s3.service.controller'
import { S3VirtualHostMiddleware } from './s3/s3.virtual-host.middleware'

@Module({
	imports: [
		DbModule.forRoot({ core: config.db }),
		CryptographicModule.forRoot(config.cryptographic),
		StorageModule.forRoot(config.storage),
		RateLimitModule.forRoot({ rateLimit: config.rateLimit, valkey: config.valkey }),

		AccessKeysModule,
		BucketsModule,
		ObjectsModule,
		PoliciesModule,
		S3Module,
	],
	controllers: [
		// Order matters: the service routes (`/`) are the most specific, the object routes the
		// least - Express matches in registration order. Health therefore lives here rather
		// than in a module of its own: routes of an imported module are registered after this
		// list, which would put `/_health` behind `/:bucket` and answer a probe with
		// `NoSuchBucket`.
		HealthControllerV1,
		S3ServiceControllerV1,
		S3BucketControllerV1,
		S3ObjectControllerV1,
	],
	providers: [
		HealthService,
		RequestLogService,
	],
})
export class AppModule implements NestModule {
	configure(consumer: MiddlewareConsumer): void {
		// Rewriting runs before routing so `<bucket>.<domain>/<key>` reaches the path-style
		// controllers; `{*splat}` (path-to-regexp v8) is the pattern that also covers the root
		// path, which a virtual-host `PUT https://<bucket>.<domain>/` needs.
		// Logging is applied after it, so a log line names the bucket the request resolved to.
		consumer
			.apply(S3VirtualHostMiddleware, S3LoggingMiddleware)
			.forRoutes({ path: '{*splat}', method: RequestMethod.ALL })
	}
}
