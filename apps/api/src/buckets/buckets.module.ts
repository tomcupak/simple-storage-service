import { Module } from '@nestjs/common'
import { BucketsModule } from '@storage/domains/buckets'

import { BucketsControllerV1 } from './buckets.controller.v1'

@Module({
	imports: [BucketsModule],
	controllers: [BucketsControllerV1],
})
export class ApiBucketsModule {}
