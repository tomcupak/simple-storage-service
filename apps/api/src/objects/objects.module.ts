import { Module } from '@nestjs/common'

import { ObjectsControllerV1 } from './objects.controller.v1'

@Module({
	controllers: [ObjectsControllerV1],
})
export class ApiObjectsModule {}
