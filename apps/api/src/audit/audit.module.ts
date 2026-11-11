import { Module } from '@nestjs/common'
import { AuditModule } from '@storage/domains/audit'

import { AuditControllerV1 } from './audit.controller.v1'

@Module({
	imports: [AuditModule],
	controllers: [AuditControllerV1],
})
export class ApiAuditModule {}
