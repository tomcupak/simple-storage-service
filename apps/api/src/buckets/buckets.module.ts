import { Module } from '@nestjs/common'
import { BucketsModule } from '@storage/domains/buckets'
import { UsageModule } from '@storage/domains/usage'
import { UsersModule } from '@storage/domains/users'

import { BucketsControllerV1 } from './buckets.controller.v1'

@Module({
	imports: [BucketsModule, UsageModule, UsersModule],
	controllers: [BucketsControllerV1],
})
export class ApiBucketsModule {}
