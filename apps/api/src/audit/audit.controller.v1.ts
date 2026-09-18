import { Controller, Get, Query, Version } from '@nestjs/common'
import { ApiBearerAuth, ApiOkResponse, ApiQuery, ApiTags } from '@nestjs/swagger'
import { AuditAction, UserRole } from '@storage/database'
import { AuditDto, AuditService } from '@storage/domains/audit'
import { SecuredEp } from '@storage/domains/auth'
import { Api } from '@storage/shared'

@ApiTags('audit')
@ApiBearerAuth()
@Controller('audit')
export class AuditControllerV1 {
	constructor(
		private readonly auditService: AuditService,
	) {}

	@Get()
	@Version('1')
	@SecuredEp([UserRole.admin])
	@ApiQuery({ name: 'limit', type: 'integer', required: false })
	@ApiQuery({ name: 'page', type: 'integer', required: false })
	@ApiOkResponse({ type: AuditDto.AuditPage })
	list(
		@Query() query: AuditDto.ListAuditQuery,
		@Api.PagingQuery({ limit: 50, page: 1 }) paging: Api.PaginationQueryDto,
	): Promise<AuditDto.AuditPage> {
		return this.auditService.list({ ...query, limit: paging.limit, page: paging.page })
	}

	@Get('actions')
	@Version('1')
	@SecuredEp([UserRole.admin])
	@ApiOkResponse({ schema: { type: 'array', items: { type: 'string', enum: Object.values(AuditAction) } } })
	actions(): AuditAction[] {
		return this.auditService.actions()
	}
}
