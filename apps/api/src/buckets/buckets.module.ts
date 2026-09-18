import { Module } from '@nestjs/common'
import { BucketsModule } from '@storage/domains/buckets'
import { UsageModule } from '@storage/domains/usage'

import { BucketsControllerV1 } from './buckets.controller.v1'

@Module({
	imports: [BucketsModule, UsageModule],
	controllers: [BucketsControllerV1],
})
export class ApiBucketsModule {}
