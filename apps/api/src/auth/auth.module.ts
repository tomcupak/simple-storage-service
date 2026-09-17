import { Module } from '@nestjs/common'

import { AuthControllerV1 } from './auth.controller.v1'

@Module({
	controllers: [AuthControllerV1],
})
export class ApiAuthModule {}
