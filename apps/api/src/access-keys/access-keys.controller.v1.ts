import { Body, Controller, Delete, ForbiddenException, Get, HttpCode, HttpStatus, Param, Post, Put, Version } from '@nestjs/common'
import { ApiBearerAuth, ApiForbiddenResponse, ApiNotFoundResponse, ApiOkResponse, ApiQuery, ApiTags } from '@nestjs/swagger'
import { AuditAction, UserRole } from '@storage/database'
import { AccessKeysDto, AccessKeysService } from '@storage/domains/access-keys'
import { Audited } from '@storage/domains/audit'
import { AuthTypes, AuthUser, SecuredEp } from '@storage/domains/auth'
import { Api } from '@storage/shared'

@ApiTags('access-keys')
@ApiBearerAuth()
@Controller('access-keys')
export class AccessKeysControllerV1 {
	constructor(
		private readonly accessKeysService: AccessKeysService,
	) {}

	@Get()
	@Version('1')
	@SecuredEp()
	@ApiQuery({ name: 'limit', type: 'integer', required: false })
	@ApiQuery({ name: 'page', type: 'integer', required: false })
	@ApiOkResponse({ type: AccessKeysDto.AccessKeyPage })
	list(
		@AuthUser() user: AuthTypes.Identity,
		@Api.PagingQuery({ limit: 50, page: 1 }) paging: Api.PaginationQueryDto,
	): Promise<AccessKeysDto.AccessKeyPage> {
		// Admins see every key in the deployment; everyone else only their own.
		return this.accessKeysService.list({
			userGuid: user.role === UserRole.admin ? undefined : user.guid,
			limit: paging.limit,
			page: paging.page,
		})
	}

	@Post()
	@Version('1')
	@SecuredEp()
	@Audited(AuditAction.accessKeyCreate)
	@ApiOkResponse({ type: AccessKeysDto.CreatedAccessKey })
	@ApiForbiddenResponse({ type: AccessKeysDto.AccessKeyForbiddenError })
	create(@Body() body: AccessKeysDto.CreateAccessKeyBody, @AuthUser() user: AuthTypes.Identity): Promise<AccessKeysDto.CreatedAccessKey> {
		if (body.userGuid && body.userGuid !== user.guid && user.role !== UserRole.admin) {
			throw Api.gatewayException(ForbiddenException, AccessKeysDto.ErrorCodes.PERMISSION_DENIED)
		}

		return this.accessKeysService.create({
			userGuid: body.userGuid ?? user.guid,
			description: body.description,
			expiresAt: body.expiresAt ? new Date(body.expiresAt) : undefined,
		})
	}

	@Put(':accessKeyId/status')
	@Version('1')
	@SecuredEp()
	@Audited(AuditAction.accessKeySetStatus)
	@HttpCode(HttpStatus.NO_CONTENT)
	@ApiNotFoundResponse({ type: AccessKeysDto.AccessKeyNotFoundError })
	async setStatus(
		@Param('accessKeyId') accessKeyId: string,
		@Body() body: AccessKeysDto.SetAccessKeyStatusBody,
		@AuthUser() user: AuthTypes.Identity,
	): Promise<void> {
		await this.accessKeysService.assertAccessible({ accessKeyId, userGuid: user.guid, role: user.role })
		await this.accessKeysService.setStatus(accessKeyId, body.status)
	}

	@Delete(':accessKeyId')
	@Version('1')
	@SecuredEp()
	@Audited(AuditAction.accessKeyDelete)
	@HttpCode(HttpStatus.NO_CONTENT)
	@ApiNotFoundResponse({ type: AccessKeysDto.AccessKeyNotFoundError })
	async delete(@Param('accessKeyId') accessKeyId: string, @AuthUser() user: AuthTypes.Identity): Promise<void> {
		await this.accessKeysService.assertAccessible({ accessKeyId, userGuid: user.guid, role: user.role })
		await this.accessKeysService.delete(accessKeyId)
	}
}
