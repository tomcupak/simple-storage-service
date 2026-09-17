import { Module } from '@nestjs/common'

import { UsersControllerV1 } from './users.controller.v1'

@Module({
	controllers: [UsersControllerV1],
})
export class ApiUsersModule {}
