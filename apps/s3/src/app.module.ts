import { Module } from '@nestjs/common'
import { DbModule } from '@storage/database'
import { AccessKeysModule } from '@storage/domains/access-keys'
import { BucketsModule } from '@storage/domains/buckets'
import { CryptographicModule } from '@storage/domains/cryptographic'
import { ObjectsModule } from '@storage/domains/objects'
import { PoliciesModule } from '@storage/domains/policies'
import { S3Module } from '@storage/domains/s3'
import { StorageModule } from '@storage/domains/storage'

import { config } from './app.config'
import { S3ServiceControllerV1 } from './s3/s3.service.controller'

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
		S3ServiceControllerV1,
	],
})
export class AppModule {}
