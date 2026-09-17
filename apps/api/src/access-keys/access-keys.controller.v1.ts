import { Body, Controller, Delete, ForbiddenException, Get, HttpCode, HttpStatus, NotFoundException, Param, Post, Put, Version } from '@nestjs/common'
import { ApiBearerAuth, ApiNotFoundResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger'
import { UserRole } from '@storage/database'
import { AccessKeysDto, AccessKeysService, AccessKeysTypes } from '@storage/domains/access-keys'
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
	@ApiOkResponse({ type: AccessKeysDto.AccessKeyItem, isArray: true })
	list(@AuthUser() user: AuthTypes.Identity): Promise<AccessKeysDto.AccessKeyItem[]> {
		// Admins see every key in the deployment; everyone else only their own.
		return this.accessKeysService.list(user.role === UserRole.admin ? undefined : user.guid)
	}

	@Post()
	@Version('1')
	@SecuredEp()
	@ApiOkResponse({ type: AccessKeysDto.CreatedAccessKey })
	create(@Body() body: AccessKeysDto.CreateAccessKeyBody, @AuthUser() user: AuthTypes.Identity): Promise<AccessKeysDto.CreatedAccessKey> {
		if (body.userGuid && body.userGuid !== user.guid && user.role !== UserRole.admin) {
			throw new ForbiddenException({ code: 'permission_denied' })
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
	@HttpCode(HttpStatus.NO_CONTENT)
	@ApiNotFoundResponse({ type: AccessKeysDto.AccessKeyNotFoundError })
	async setStatus(
		@Param('accessKeyId') accessKeyId: string,
		@Body() body: AccessKeysDto.SetAccessKeyStatusBody,
		@AuthUser() user: AuthTypes.Identity,
	): Promise<void> {
		try {
			await this.accessKeysService.assertAccessible({ accessKeyId, userGuid: user.guid, role: user.role })
			await this.accessKeysService.setStatus(accessKeyId, body.status)
		} catch (err) {
			if (err instanceof AccessKeysTypes.AccessKeyNotFoundError)
				throw Api.gatewayException(NotFoundException, AccessKeysDto.ErrorCodes.ACCESS_KEY_NOT_FOUND)
			throw err
		}
	}

	@Delete(':accessKeyId')
	@Version('1')
	@SecuredEp()
	@HttpCode(HttpStatus.NO_CONTENT)
	@ApiNotFoundResponse({ type: AccessKeysDto.AccessKeyNotFoundError })
	async delete(@Param('accessKeyId') accessKeyId: string, @AuthUser() user: AuthTypes.Identity): Promise<void> {
		try {
			await this.accessKeysService.assertAccessible({ accessKeyId, userGuid: user.guid, role: user.role })
			await this.accessKeysService.delete(accessKeyId)
		} catch (err) {
			if (err instanceof AccessKeysTypes.AccessKeyNotFoundError)
				throw Api.gatewayException(NotFoundException, AccessKeysDto.ErrorCodes.ACCESS_KEY_NOT_FOUND)
			throw err
		}
	}

}
