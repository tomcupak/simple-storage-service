import { Module } from '@nestjs/common'

import { MigrationsControllerV1 } from './migrations.controller.v1'

/** `MigrationService` comes from the global `MigrationModule.forRoot(...)` in `AppModule`. */
@Module({
	controllers: [MigrationsControllerV1],
})
export class ApiMigrationsModule {}
