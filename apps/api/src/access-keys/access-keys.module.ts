import { Module } from '@nestjs/common'
import { AccessKeysModule } from '@storage/domains/access-keys'

import { AccessKeysControllerV1 } from './access-keys.controller.v1'

@Module({
	imports: [AccessKeysModule],
	controllers: [AccessKeysControllerV1],
})
export class ApiAccessKeysModule {}
