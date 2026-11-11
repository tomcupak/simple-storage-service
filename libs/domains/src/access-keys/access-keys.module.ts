import { Module } from '@nestjs/common'

import { AccessKeysService } from './access-keys.service'

@Module({
	providers: [AccessKeysService],
	exports: [AccessKeysService],
})
export class AccessKeysModule {}
