import { Module } from '@nestjs/common'
import { BucketsModule } from '@storage/domains/buckets'
import { PoliciesModule } from '@storage/domains/policies'

import { PoliciesControllerV1 } from './policies.controller.v1'

@Module({
	imports: [BucketsModule, PoliciesModule],
	controllers: [PoliciesControllerV1],
})
export class ApiPoliciesModule {}
