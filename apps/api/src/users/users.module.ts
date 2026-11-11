import { Module } from '@nestjs/common'
import { UsageModule } from '@storage/domains/usage'
import { UsersModule } from '@storage/domains/users'

import { UsersControllerV1 } from './users.controller.v1'

@Module({
	imports: [UsersModule, UsageModule],
	controllers: [UsersControllerV1],
})
export class ApiUsersModule {}
