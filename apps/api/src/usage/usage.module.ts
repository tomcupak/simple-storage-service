import { Module } from '@nestjs/common'
import { BucketsModule } from '@storage/domains/buckets'
import { UsageModule } from '@storage/domains/usage'

import { UsageControllerV1 } from './usage.controller.v1'

@Module({
	imports: [UsageModule, BucketsModule],
	controllers: [UsageControllerV1],
})
export class ApiUsageModule {}
