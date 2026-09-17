import { Module } from '@nestjs/common'

import { BucketsControllerV1 } from './buckets.controller.v1'

@Module({
	controllers: [BucketsControllerV1],
})
export class ApiBucketsModule {}
