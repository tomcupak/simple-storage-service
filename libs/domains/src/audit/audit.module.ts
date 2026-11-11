import { Module } from '@nestjs/common'

import { AuditInterceptor } from './audit.interceptor'
import { AuditService } from './audit.service'

@Module({
	providers: [AuditService, AuditInterceptor],
	exports: [AuditService, AuditInterceptor],
})
export class AuditModule {}
