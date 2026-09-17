import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, HttpCode, HttpStatus, NotFoundException, Param, Post, Put, Version } from '@nestjs/common'
import { ApiBadRequestResponse, ApiBearerAuth, ApiForbiddenResponse, ApiNotFoundResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger'
import { BucketPermission } from '@storage/database'
import { AuthTypes, AuthUser, SecuredEp } from '@storage/domains/auth'
import { BucketsDto, BucketsService, BucketsTypes } from '@storage/domains/buckets'
import { Api } from '@storage/shared'

@ApiTags('buckets')
@ApiBearerAuth()
@Controller('buckets')
export class BucketsControllerV1 {
	constructor(
		private readonly bucketsService: BucketsService,
	) {}

	@Get()
	@Version('1')
	@SecuredEp()
	@ApiOkResponse({ type: BucketsDto.BucketItem, isArray: true })
	list(@AuthUser() user: AuthTypes.Identity): Promise<BucketsDto.BucketItem[]> {
		return this.bucketsService.listForUser({ userGuid: user.guid, role: user.role })
	}

	@Post()
	@Version('1')
	@SecuredEp()
	@ApiOkResponse({ type: BucketsDto.BucketItem })
	@ApiBadRequestResponse({ type: BucketsDto.CreateBucketBadRequestError })
	async create(@Body() body: BucketsDto.CreateBucketBody, @AuthUser() user: AuthTypes.Identity): Promise<BucketsDto.BucketItem> {
		try {
			return await this.bucketsService.create({
				name: body.name,
				ownerUserGuid: user.guid,
				region: body.region ?? 'us-east-1',
			})
		} catch (err) {
			if (err instanceof BucketsTypes.InvalidBucketNameError)
				throw Api.gatewayException(BadRequestException, BucketsDto.ErrorCodes.INVALID_BUCKET_NAME)
			if (err instanceof BucketsTypes.BucketAlreadyExistsError)
				throw Api.gatewayException(BadRequestException, BucketsDto.ErrorCodes.BUCKET_ALREADY_EXISTS)
			throw err
		}
	}

	@Get(':bucketName')
	@Version('1')
	@SecuredEp()
	@ApiOkResponse({ type: BucketsDto.BucketItem })
	@ApiNotFoundResponse({ type: BucketsDto.BucketNotFoundError })
	async get(@Param('bucketName') bucketName: string, @AuthUser() user: AuthTypes.Identity): Promise<BucketsDto.BucketItem> {
		try {
			return await this.bucketsService.getForUser({ name: bucketName, userGuid: user.guid, role: user.role, permission: BucketPermission.read })
		} catch (err) {
			if (err instanceof BucketsTypes.BucketNotFoundError)
				throw Api.gatewayException(NotFoundException, BucketsDto.ErrorCodes.BUCKET_NOT_FOUND)
			throw err
		}
	}

	@Delete(':bucketName')
	@Version('1')
	@SecuredEp()
	@HttpCode(HttpStatus.NO_CONTENT)
	@ApiNotFoundResponse({ type: BucketsDto.BucketNotFoundError })
	@ApiForbiddenResponse({ type: BucketsDto.BucketForbiddenError })
	@ApiBadRequestResponse({ type: BucketsDto.DeleteBucketBadRequestError })
	async delete(@Param('bucketName') bucketName: string, @AuthUser() user: AuthTypes.Identity): Promise<void> {
		try {
			const bucket = await this.bucketsService.getForUser({ name: bucketName, userGuid: user.guid, role: user.role, permission: BucketPermission.manage })
			await this.bucketsService.delete(bucket.guid)
		} catch (err) {
			if (err instanceof BucketsTypes.BucketNotFoundError)
				throw Api.gatewayException(NotFoundException, BucketsDto.ErrorCodes.BUCKET_NOT_FOUND)
			if (err instanceof BucketsTypes.PermissionDeniedError)
				throw Api.gatewayException(ForbiddenException, BucketsDto.ErrorCodes.PERMISSION_DENIED)
			if (err instanceof BucketsTypes.BucketNotEmptyError)
				throw Api.gatewayException(BadRequestException, BucketsDto.ErrorCodes.BUCKET_NOT_EMPTY)
			throw err
		}
	}

	@Get(':bucketName/grants')
	@Version('1')
	@SecuredEp()
	@ApiOkResponse({ type: BucketsDto.BucketGrantItem, isArray: true })
	@ApiNotFoundResponse({ type: BucketsDto.BucketNotFoundError })
	@ApiForbiddenResponse({ type: BucketsDto.BucketForbiddenError })
	async listGrants(@Param('bucketName') bucketName: string, @AuthUser() user: AuthTypes.Identity): Promise<BucketsDto.BucketGrantItem[]> {
		try {
			const bucket = await this.bucketsService.getForUser({ name: bucketName, userGuid: user.guid, role: user.role, permission: BucketPermission.manage })
			const grants = await this.bucketsService.listGrants(bucket.guid)
			return grants.map((grant) => ({ userGuid: grant.userGuid, permissions: grant.permissions }))
		} catch (err) {
			if (err instanceof BucketsTypes.BucketNotFoundError)
				throw Api.gatewayException(NotFoundException, BucketsDto.ErrorCodes.BUCKET_NOT_FOUND)
			if (err instanceof BucketsTypes.PermissionDeniedError)
				throw Api.gatewayException(ForbiddenException, BucketsDto.ErrorCodes.PERMISSION_DENIED)
			throw err
		}
	}

	@Put(':bucketName/grants')
	@Version('1')
	@SecuredEp()
	@HttpCode(HttpStatus.NO_CONTENT)
	@ApiNotFoundResponse({ type: BucketsDto.BucketNotFoundError })
	@ApiForbiddenResponse({ type: BucketsDto.BucketForbiddenError })
	async setGrant(
		@Param('bucketName') bucketName: string,
		@Body() body: BucketsDto.SetBucketGrantBody,
		@AuthUser() user: AuthTypes.Identity,
	): Promise<void> {
		try {
			const bucket = await this.bucketsService.getForUser({ name: bucketName, userGuid: user.guid, role: user.role, permission: BucketPermission.manage })
			await this.bucketsService.setGrant({ bucketGuid: bucket.guid, userGuid: body.userGuid, permissions: body.permissions })
		} catch (err) {
			if (err instanceof BucketsTypes.BucketNotFoundError)
				throw Api.gatewayException(NotFoundException, BucketsDto.ErrorCodes.BUCKET_NOT_FOUND)
			if (err instanceof BucketsTypes.PermissionDeniedError)
				throw Api.gatewayException(ForbiddenException, BucketsDto.ErrorCodes.PERMISSION_DENIED)
			throw err
		}
	}

	@Delete(':bucketName/grants/:userGuid')
	@Version('1')
	@SecuredEp()
	@HttpCode(HttpStatus.NO_CONTENT)
	@ApiNotFoundResponse({ type: BucketsDto.BucketNotFoundError })
	@ApiForbiddenResponse({ type: BucketsDto.BucketForbiddenError })
	async removeGrant(
		@Param('bucketName') bucketName: string,
		@Param('userGuid') userGuid: string,
		@AuthUser() user: AuthTypes.Identity,
	): Promise<void> {
		try {
			const bucket = await this.bucketsService.getForUser({ name: bucketName, userGuid: user.guid, role: user.role, permission: BucketPermission.manage })
			await this.bucketsService.removeGrant({ bucketGuid: bucket.guid, userGuid })
		} catch (err) {
			if (err instanceof BucketsTypes.BucketNotFoundError)
				throw Api.gatewayException(NotFoundException, BucketsDto.ErrorCodes.BUCKET_NOT_FOUND)
			if (err instanceof BucketsTypes.PermissionDeniedError)
				throw Api.gatewayException(ForbiddenException, BucketsDto.ErrorCodes.PERMISSION_DENIED)
			throw err
		}
	}
}
