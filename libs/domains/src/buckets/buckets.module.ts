import { Module } from '@nestjs/common'

import { BucketsService } from './buckets.service'

@Module({
	providers: [BucketsService],
	exports: [BucketsService],
})
export class BucketsModule {}
