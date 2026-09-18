import { Body, Controller, Delete, Get, HttpCode, HttpStatus, NotFoundException, Param, Patch, Post, Put, Version } from '@nestjs/common'
import { ApiBadRequestResponse, ApiBearerAuth, ApiNotFoundResponse, ApiOkResponse, ApiQuery, ApiTags } from '@nestjs/swagger'
import { AuditAction, UserRole } from '@storage/database'
import { Audited } from '@storage/domains/audit'
import { AuthTypes, AuthUser, SecuredEp } from '@storage/domains/auth'
import { UsageDto, UsageService } from '@storage/domains/usage'
import { UsersDto, UsersService } from '@storage/domains/users'
import { Api } from '@storage/shared'

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
export class UsersControllerV1 {
	constructor(
		private readonly usersService: UsersService,
		private readonly usageService: UsageService,
	) {}

	@Get()
	@Version('1')
	@SecuredEp([UserRole.admin])
	@ApiQuery({ name: 'limit', type: 'integer', required: false })
	@ApiQuery({ name: 'page', type: 'integer', required: false })
	@ApiOkResponse({ type: UsersDto.UserPage })
	list(@Api.PagingQuery({ limit: 50, page: 1 }) paging: Api.PaginationQueryDto): Promise<UsersDto.UserPage> {
		return this.usersService.list(paging)
	}

	@Post()
	@Version('1')
	@SecuredEp([UserRole.admin])
	@Audited(AuditAction.userCreate)
	@ApiOkResponse({ type: UsersDto.UserItem })
	@ApiBadRequestResponse({ type: UsersDto.CreateUserBadRequestError })
	create(@Body() body: UsersDto.CreateUserBody): Promise<UsersDto.UserItem> {
		return this.usersService.create(body)
	}

	@Patch(':userGuid')
	@Version('1')
	@SecuredEp([UserRole.admin])
	@Audited(AuditAction.userUpdate)
	@ApiOkResponse({ type: UsersDto.UserItem })
	@ApiNotFoundResponse({ type: UsersDto.UserNotFoundError })
	@ApiBadRequestResponse({ type: UsersDto.DeleteUserBadRequestError })
	update(@Param('userGuid') userGuid: string, @Body() body: UsersDto.UpdateUserBody): Promise<UsersDto.UserItem> {
		return this.usersService.update({ guid: userGuid, name: body.name, role: body.role })
	}

	@Put(':userGuid/status')
	@Version('1')
	@SecuredEp([UserRole.admin])
	@Audited(AuditAction.userSetStatus)
	@HttpCode(HttpStatus.NO_CONTENT)
	@ApiNotFoundResponse({ type: UsersDto.UserNotFoundError })
	@ApiBadRequestResponse({ type: UsersDto.DeleteUserBadRequestError })
	async setStatus(@Param('userGuid') userGuid: string, @Body() body: UsersDto.SetUserStatusBody): Promise<void> {
		await this.usersService.setStatus(userGuid, body.status)
	}

	@Put(':userGuid/quota')
	@Version('1')
	@SecuredEp([UserRole.admin])
	@Audited(AuditAction.userSetQuota)
	@HttpCode(HttpStatus.NO_CONTENT)
	@ApiNotFoundResponse({ type: UsersDto.UserNotFoundError })
	async setQuota(@Param('userGuid') userGuid: string, @Body() body: UsageDto.SetQuotaBody): Promise<void> {
		await this.usersService.setQuota(userGuid, body.quotaBytes ?? null)
	}

	@Get(':userGuid/usage')
	@Version('1')
	@SecuredEp()
	@ApiOkResponse({ type: UsageDto.UsageItem })
	@ApiNotFoundResponse({ type: UsersDto.UserNotFoundError })
	async usage(@Param('userGuid') userGuid: string, @AuthUser() user: AuthTypes.Identity): Promise<UsageDto.UsageItem> {
		// A plain user may only look at their own consumption; admins at anyone's.
		if (user.role !== UserRole.admin && user.guid !== userGuid)
			throw Api.gatewayException(NotFoundException, UsersDto.ErrorCodes.USER_NOT_FOUND)

		await this.usersService.get(userGuid)
		return this.usageService.userUsage(userGuid)
	}

	@Put(':userGuid/password')
	@Version('1')
	@SecuredEp()
	@Audited(AuditAction.userSetPassword)
	@HttpCode(HttpStatus.NO_CONTENT)
	@ApiNotFoundResponse({ type: UsersDto.UserNotFoundError })
	async setPassword(
		@Param('userGuid') userGuid: string,
		@Body() body: UsersDto.SetPasswordBody,
		@AuthUser() user: AuthTypes.Identity,
	): Promise<void> {
		// A plain user may only change their own password; admins may change anyone's.
		if (user.role !== UserRole.admin && user.guid !== userGuid)
			throw Api.gatewayException(NotFoundException, UsersDto.ErrorCodes.USER_NOT_FOUND)

		await this.usersService.setPassword(userGuid, body.password)
	}

	@Delete(':userGuid')
	@Version('1')
	@SecuredEp([UserRole.admin])
	@Audited(AuditAction.userDelete)
	@HttpCode(HttpStatus.NO_CONTENT)
	@ApiNotFoundResponse({ type: UsersDto.UserNotFoundError })
	@ApiBadRequestResponse({ type: UsersDto.DeleteUserBadRequestError })
	async delete(@Param('userGuid') userGuid: string): Promise<void> {
		await this.usersService.delete(userGuid)
	}
}
