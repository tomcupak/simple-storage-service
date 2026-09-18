import { Module } from '@nestjs/common'

import { UsageModule } from '../usage/usage.module'
import { ObjectsService } from './objects.service'

@Module({
	imports: [UsageModule],
	providers: [ObjectsService],
	exports: [ObjectsService],
})
export class ObjectsModule {}
