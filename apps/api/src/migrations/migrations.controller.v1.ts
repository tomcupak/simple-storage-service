import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post } from '@nestjs/common'
import { ApiBadRequestResponse, ApiBearerAuth, ApiNoContentResponse, ApiNotFoundResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger'
import { AuditAction, UserRole } from '@storage/database'
import { Audited } from '@storage/domains/audit'
import { AuthTypes, AuthUser, SecuredEp } from '@storage/domains/auth'
import { MigrationDto, MigrationService } from '@storage/domains/migration'

/** Moving data in from another S3 server. Admin-only throughout: the server connects to a
 *  host the caller names, which anyone below admin could use to probe the network behind it. */
@ApiTags('migrations')
@ApiBearerAuth()
@Controller({ path: 'migrations', version: '1' })
export class MigrationsControllerV1 {
	constructor(
		private readonly migrationService: MigrationService,
	) {}

	@Post('inspect')
	@SecuredEp([UserRole.admin])
	@HttpCode(HttpStatus.OK)
	@ApiOkResponse({ type: MigrationDto.InspectResponse })
	@ApiBadRequestResponse({ type: MigrationDto.SourceBadRequestError })
	async inspect(@Body() body: MigrationDto.SourceBody): Promise<MigrationDto.InspectResponse> {
		return { buckets: await this.migrationService.inspect(body) }
	}

	@Post()
	@SecuredEp([UserRole.admin])
	@Audited(AuditAction.migrationStart)
	@ApiOkResponse({ type: MigrationDto.MigrationJobDetail })
	@ApiBadRequestResponse({ type: MigrationDto.StartBadRequestError })
	start(@Body() body: MigrationDto.StartMigrationBody, @AuthUser() user: AuthTypes.Identity): Promise<MigrationDto.MigrationJobDetail> {
		return this.migrationService.start({ source: body.source, buckets: body.buckets, userGuid: user.guid })
	}

	@Get()
	@SecuredEp([UserRole.admin])
	@ApiOkResponse({ type: MigrationDto.MigrationJobItem, isArray: true })
	list(): Promise<MigrationDto.MigrationJobItem[]> {
		return this.migrationService.list()
	}

	@Get(':migrationGuid')
	@SecuredEp([UserRole.admin])
	@ApiOkResponse({ type: MigrationDto.MigrationJobDetail })
	@ApiNotFoundResponse({ type: MigrationDto.MigrationNotFoundError })
	get(@Param('migrationGuid', ParseUUIDPipe) migrationGuid: string): Promise<MigrationDto.MigrationJobDetail> {
		return this.migrationService.get(migrationGuid)
	}

	@Post(':migrationGuid/cancel')
	@SecuredEp([UserRole.admin])
	@Audited(AuditAction.migrationCancel)
	@HttpCode(HttpStatus.NO_CONTENT)
	@ApiNoContentResponse()
	@ApiBadRequestResponse({ type: MigrationDto.CancelBadRequestError })
	@ApiNotFoundResponse({ type: MigrationDto.MigrationNotFoundError })
	cancel(@Param('migrationGuid', ParseUUIDPipe) migrationGuid: string): Promise<void> {
		return this.migrationService.cancel(migrationGuid)
	}
}
