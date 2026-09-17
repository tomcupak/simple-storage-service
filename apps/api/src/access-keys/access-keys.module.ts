import { Module } from '@nestjs/common'

import { AccessKeysControllerV1 } from './access-keys.controller.v1'

@Module({
	controllers: [AccessKeysControllerV1],
})
export class ApiAccessKeysModule {}
