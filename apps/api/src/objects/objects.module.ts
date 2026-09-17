import { Module } from '@nestjs/common'
import { BucketsModule } from '@storage/domains/buckets'
import { ObjectsModule } from '@storage/domains/objects'

import { ObjectsControllerV1 } from './objects.controller.v1'

@Module({
	imports: [BucketsModule, ObjectsModule],
	controllers: [ObjectsControllerV1],
})
export class ApiObjectsModule {}
