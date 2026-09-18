import { BadRequestException, Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Put, Version } from '@nestjs/common'
import { ApiBadRequestResponse, ApiBearerAuth, ApiForbiddenResponse, ApiNotFoundResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger'
import { AuditAction, BucketPermission, BucketVersioning, UserRole } from '@storage/database'
import { Audited } from '@storage/domains/audit'
import { AuthTypes, AuthUser, SecuredEp } from '@storage/domains/auth'
import { BucketsDto, BucketsService } from '@storage/domains/buckets'
import { UsageDto, UsageService } from '@storage/domains/usage'
import { Api } from '@storage/shared'

@ApiTags('buckets')
@ApiBearerAuth()
@Controller('buckets')
export class BucketsControllerV1 {
	constructor(
		private readonly bucketsService: BucketsService,
		private readonly usageService: UsageService,
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
	@Audited(AuditAction.bucketCreate)
	@ApiOkResponse({ type: BucketsDto.BucketItem })
	@ApiBadRequestResponse({ type: BucketsDto.CreateBucketBadRequestError })
	create(@Body() body: BucketsDto.CreateBucketBody, @AuthUser() user: AuthTypes.Identity): Promise<BucketsDto.BucketItem> {
		return this.bucketsService.create({
			name: body.name,
			ownerUserGuid: user.guid,
			region: body.region ?? 'us-east-1',
		})
	}

	@Get(':bucketName')
	@Version('1')
	@SecuredEp()
	@ApiOkResponse({ type: BucketsDto.BucketDetail })
	@ApiNotFoundResponse({ type: BucketsDto.BucketNotFoundError })
	async get(@Param('bucketName') bucketName: string, @AuthUser() user: AuthTypes.Identity): Promise<BucketsDto.BucketDetail> {
		const bucket = await this.bucketsService.getForUser({ name: bucketName, userGuid: user.guid, role: user.role, permission: BucketPermission.read })
		const usage = await this.usageService.bucketUsage(bucket.guid)

		return { ...bucket, usage }
	}

	@Delete(':bucketName')
	@Version('1')
	@SecuredEp()
	@Audited(AuditAction.bucketDelete)
	@HttpCode(HttpStatus.NO_CONTENT)
	@ApiNotFoundResponse({ type: BucketsDto.BucketNotFoundError })
	@ApiForbiddenResponse({ type: BucketsDto.BucketForbiddenError })
	@ApiBadRequestResponse({ type: BucketsDto.DeleteBucketBadRequestError })
	async delete(@Param('bucketName') bucketName: string, @AuthUser() user: AuthTypes.Identity): Promise<void> {
		const bucket = await this.bucketsService.getForUser({ name: bucketName, userGuid: user.guid, role: user.role, permission: BucketPermission.manage })
		await this.bucketsService.delete(bucket.guid)
	}

	@Put(':bucketName/acl')
	@Version('1')
	@SecuredEp()
	@Audited(AuditAction.bucketSetAcl)
	@HttpCode(HttpStatus.NO_CONTENT)
	@ApiNotFoundResponse({ type: BucketsDto.BucketNotFoundError })
	@ApiForbiddenResponse({ type: BucketsDto.BucketForbiddenError })
	async setAcl(
		@Param('bucketName') bucketName: string,
		@Body() body: BucketsDto.SetBucketAclBody,
		@AuthUser() user: AuthTypes.Identity,
	): Promise<void> {
		const bucket = await this.bucketsService.getForUser({ name: bucketName, userGuid: user.guid, role: user.role, permission: BucketPermission.manage })
		await this.bucketsService.setAcl({ guid: bucket.guid, acl: body.acl })
	}

	@Put(':bucketName/versioning')
	@Version('1')
	@SecuredEp()
	@Audited(AuditAction.bucketSetVersioning)
	@HttpCode(HttpStatus.NO_CONTENT)
	@ApiNotFoundResponse({ type: BucketsDto.BucketNotFoundError })
	@ApiForbiddenResponse({ type: BucketsDto.BucketForbiddenError })
	@ApiBadRequestResponse({ type: BucketsDto.SetVersioningBadRequestError })
	async setVersioning(
		@Param('bucketName') bucketName: string,
		@Body() body: BucketsDto.SetBucketVersioningBody,
		@AuthUser() user: AuthTypes.Identity,
	): Promise<void> {
		// S3 never returns to `disabled`: versions already recorded would become unreachable.
		if (body.versioning === BucketVersioning.disabled) {
			throw Api.gatewayException(BadRequestException, BucketsDto.ErrorCodes.INVALID_VERSIONING)
		}

		const bucket = await this.bucketsService.getForUser({ name: bucketName, userGuid: user.guid, role: user.role, permission: BucketPermission.manage })
		await this.bucketsService.setVersioning({ guid: bucket.guid, versioning: body.versioning })
	}

	@Put(':bucketName/quota')
	@Version('1')
	@SecuredEp([UserRole.admin])
	@Audited(AuditAction.bucketSetQuota)
	@HttpCode(HttpStatus.NO_CONTENT)
	@ApiNotFoundResponse({ type: BucketsDto.BucketNotFoundError })
	async setQuota(@Param('bucketName') bucketName: string, @Body() body: UsageDto.SetQuotaBody): Promise<void> {
		const bucket = await this.bucketsService.getByName(bucketName)
		await this.bucketsService.setQuota({ guid: bucket.guid, quotaBytes: body.quotaBytes ?? null })
	}

	@Get(':bucketName/usage')
	@Version('1')
	@SecuredEp()
	@ApiOkResponse({ type: UsageDto.UsageItem })
	@ApiNotFoundResponse({ type: BucketsDto.BucketNotFoundError })
	async usage(@Param('bucketName') bucketName: string, @AuthUser() user: AuthTypes.Identity): Promise<UsageDto.UsageItem> {
		const bucket = await this.bucketsService.getForUser({ name: bucketName, userGuid: user.guid, role: user.role, permission: BucketPermission.read })

		return this.usageService.bucketUsage(bucket.guid)
	}

	@Get(':bucketName/grants')
	@Version('1')
	@SecuredEp()
	@ApiOkResponse({ type: BucketsDto.BucketGrantItem, isArray: true })
	@ApiNotFoundResponse({ type: BucketsDto.BucketNotFoundError })
	@ApiForbiddenResponse({ type: BucketsDto.BucketForbiddenError })
	async listGrants(@Param('bucketName') bucketName: string, @AuthUser() user: AuthTypes.Identity): Promise<BucketsDto.BucketGrantItem[]> {
		const bucket = await this.bucketsService.getForUser({ name: bucketName, userGuid: user.guid, role: user.role, permission: BucketPermission.manage })
		const grants = await this.bucketsService.listGrants(bucket.guid)

		return grants.map((grant) => ({ userGuid: grant.userGuid, permissions: grant.permissions }))
	}

	@Put(':bucketName/grants')
	@Version('1')
	@SecuredEp()
	@Audited(AuditAction.bucketSetGrant)
	@HttpCode(HttpStatus.NO_CONTENT)
	@ApiNotFoundResponse({ type: BucketsDto.BucketNotFoundError })
	@ApiForbiddenResponse({ type: BucketsDto.BucketForbiddenError })
	async setGrant(
		@Param('bucketName') bucketName: string,
		@Body() body: BucketsDto.SetBucketGrantBody,
		@AuthUser() user: AuthTypes.Identity,
	): Promise<void> {
		const bucket = await this.bucketsService.getForUser({ name: bucketName, userGuid: user.guid, role: user.role, permission: BucketPermission.manage })
		await this.bucketsService.setGrant({ bucketGuid: bucket.guid, userGuid: body.userGuid, permissions: body.permissions })
	}

	@Delete(':bucketName/grants/:userGuid')
	@Version('1')
	@SecuredEp()
	@Audited(AuditAction.bucketRemoveGrant)
	@HttpCode(HttpStatus.NO_CONTENT)
	@ApiNotFoundResponse({ type: BucketsDto.BucketNotFoundError })
	@ApiForbiddenResponse({ type: BucketsDto.BucketForbiddenError })
	async removeGrant(
		@Param('bucketName') bucketName: string,
		@Param('userGuid') userGuid: string,
		@AuthUser() user: AuthTypes.Identity,
	): Promise<void> {
		const bucket = await this.bucketsService.getForUser({ name: bucketName, userGuid: user.guid, role: user.role, permission: BucketPermission.manage })
		await this.bucketsService.removeGrant({ bucketGuid: bucket.guid, userGuid })
	}
}
