import { Module } from '@nestjs/common'
import { UsersModule } from '@storage/domains/users'

import { UsersControllerV1 } from './users.controller.v1'

@Module({
	imports: [UsersModule],
	controllers: [UsersControllerV1],
})
export class ApiUsersModule {}
