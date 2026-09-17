import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common'
import { DbModule } from '@storage/database'
import { AccessKeysModule } from '@storage/domains/access-keys'
import { BucketsModule } from '@storage/domains/buckets'
import { CryptographicModule } from '@storage/domains/cryptographic'
import { ObjectsModule } from '@storage/domains/objects'
import { PoliciesModule } from '@storage/domains/policies'
import { S3Module } from '@storage/domains/s3'
import { StorageModule } from '@storage/domains/storage'

import { config } from './app.config'
import { S3BucketControllerV1 } from './s3/s3.bucket.controller'
import { S3ObjectControllerV1 } from './s3/s3.object.controller'
import { S3ServiceControllerV1 } from './s3/s3.service.controller'
import { S3VirtualHostMiddleware } from './s3/s3.virtual-host.middleware'

@Module({
	imports: [
		DbModule.forRoot({ core: config.db }),
		CryptographicModule.forRoot(config.cryptographic),
		StorageModule.forRoot(config.storage),

		AccessKeysModule,
		BucketsModule,
		ObjectsModule,
		PoliciesModule,
		S3Module,
	],
	controllers: [
		// Order matters: the service routes (`/`) are the most specific, the object routes the
		// least - Express matches in registration order.
		S3ServiceControllerV1,
		S3BucketControllerV1,
		S3ObjectControllerV1,
	],
})
export class AppModule implements NestModule {
	configure(consumer: MiddlewareConsumer): void {
		// Runs before routing so `<bucket>.<domain>/<key>` reaches the path-style controllers.
		// `{*splat}` (path-to-regexp v8) is the pattern that also covers the root path, which a
		// virtual-host `PUT https://<bucket>.<domain>/` needs.
		consumer.apply(S3VirtualHostMiddleware).forRoutes({ path: '{*splat}', method: RequestMethod.ALL })
	}
}
