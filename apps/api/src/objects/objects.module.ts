import { Module } from '@nestjs/common'
import { AccessKeysModule } from '@storage/domains/access-keys'
import { BucketsModule } from '@storage/domains/buckets'
import { ObjectsModule } from '@storage/domains/objects'
import { S3Module } from '@storage/domains/s3'

import { ObjectsControllerV1 } from './objects.controller.v1'

@Module({
	imports: [BucketsModule, ObjectsModule, AccessKeysModule, S3Module],
	controllers: [ObjectsControllerV1],
})
export class ApiObjectsModule {}
