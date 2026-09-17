import { Module } from '@nestjs/common'

import { PoliciesControllerV1 } from './policies.controller.v1'

@Module({
	controllers: [PoliciesControllerV1],
})
export class ApiPoliciesModule {}
