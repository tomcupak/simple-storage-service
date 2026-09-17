import { BadRequestException, Body, Controller, Delete, Get, HttpCode, HttpStatus, NotFoundException, Param, Post, Put, Version } from '@nestjs/common'
import { ApiBadRequestResponse, ApiBearerAuth, ApiNotFoundResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger'
import { UserRole } from '@storage/database'
import { AuthUser, SecuredEp } from '@storage/domains/auth'
import { AuthTypes } from '@storage/domains/auth'
import { UsersDto, UsersService, UsersTypes } from '@storage/domains/users'
import { Api } from '@storage/shared'

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
export class UsersControllerV1 {
	constructor(
		private readonly usersService: UsersService,
	) {}

	@Get()
	@Version('1')
	@SecuredEp([UserRole.admin])
	@ApiOkResponse({ type: UsersDto.UserItem, isArray: true })
	list(): Promise<UsersDto.UserItem[]> {
		return this.usersService.list()
	}

	@Post()
	@Version('1')
	@SecuredEp([UserRole.admin])
	@ApiOkResponse({ type: UsersDto.UserItem })
	@ApiBadRequestResponse({ type: UsersDto.CreateUserBadRequestError })
	async create(@Body() body: UsersDto.CreateUserBody): Promise<UsersDto.UserItem> {
		try {
			return await this.usersService.create(body)
		} catch (err) {
			if (err instanceof UsersTypes.EmailAlreadyUsedError)
				throw Api.gatewayException(BadRequestException, UsersDto.ErrorCodes.EMAIL_ALREADY_USED)
			throw err
		}
	}

	@Put(':userGuid/password')
	@Version('1')
	@SecuredEp()
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

		try {
			await this.usersService.setPassword(userGuid, body.password)
		} catch (err) {
			if (err instanceof UsersTypes.UserNotFoundError)
				throw Api.gatewayException(NotFoundException, UsersDto.ErrorCodes.USER_NOT_FOUND)
			throw err
		}
	}

	@Delete(':userGuid')
	@Version('1')
	@SecuredEp([UserRole.admin])
	@HttpCode(HttpStatus.NO_CONTENT)
	@ApiNotFoundResponse({ type: UsersDto.UserNotFoundError })
	@ApiBadRequestResponse({ type: UsersDto.DeleteUserBadRequestError })
	async delete(@Param('userGuid') userGuid: string): Promise<void> {
		try {
			await this.usersService.delete(userGuid)
		} catch (err) {
			if (err instanceof UsersTypes.UserNotFoundError)
				throw Api.gatewayException(NotFoundException, UsersDto.ErrorCodes.USER_NOT_FOUND)
			if (err instanceof UsersTypes.LastAdminError)
				throw Api.gatewayException(BadRequestException, UsersDto.ErrorCodes.LAST_ADMIN)
			throw err
		}
	}
}
