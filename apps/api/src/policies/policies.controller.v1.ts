import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, HttpCode, HttpStatus, NotFoundException, Param, Put, Version } from '@nestjs/common'
import { ApiBadRequestResponse, ApiBearerAuth, ApiForbiddenResponse, ApiNotFoundResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger'
import { BucketPermission } from '@storage/database'
import { AuthTypes, AuthUser, SecuredEp } from '@storage/domains/auth'
import { BucketsService, BucketsTypes } from '@storage/domains/buckets'
import { PoliciesDto, PoliciesService, PoliciesTypes } from '@storage/domains/policies'
import { Api } from '@storage/shared'

@ApiTags('policies')
@ApiBearerAuth()
@Controller('buckets/:bucketName/policy')
export class PoliciesControllerV1 {
	constructor(
		private readonly policiesService: PoliciesService,
		private readonly bucketsService: BucketsService,
	) {}

	@Get()
	@Version('1')
	@SecuredEp()
	@ApiOkResponse({ type: PoliciesDto.PolicyResponse })
	@ApiNotFoundResponse({ type: PoliciesDto.PolicyNotFoundError })
	@ApiForbiddenResponse({ type: PoliciesDto.PolicyForbiddenError })
	async get(@Param('bucketName') bucketName: string, @AuthUser() user: AuthTypes.Identity): Promise<PoliciesDto.PolicyResponse> {
		try {
			const bucket = await this.bucketsService.getForUser({ name: bucketName, userGuid: user.guid, role: user.role, permission: BucketPermission.manage })
			return { document: await this.policiesService.get(bucket.guid) }
		} catch (err) {
			if (err instanceof BucketsTypes.BucketNotFoundError)
				throw Api.gatewayException(NotFoundException, PoliciesDto.ErrorCodes.BUCKET_NOT_FOUND)
			if (err instanceof BucketsTypes.PermissionDeniedError)
				throw Api.gatewayException(ForbiddenException, PoliciesDto.ErrorCodes.PERMISSION_DENIED)
			throw err
		}
	}

	@Put()
	@Version('1')
	@SecuredEp()
	@HttpCode(HttpStatus.NO_CONTENT)
	@ApiBadRequestResponse({ type: PoliciesDto.PolicyBadRequestError })
	@ApiNotFoundResponse({ type: PoliciesDto.PolicyNotFoundError })
	@ApiForbiddenResponse({ type: PoliciesDto.PolicyForbiddenError })
	async set(
		@Param('bucketName') bucketName: string,
		@Body() body: PoliciesDto.SetPolicyBody,
		@AuthUser() user: AuthTypes.Identity,
	): Promise<void> {
		try {
			const bucket = await this.bucketsService.getForUser({ name: bucketName, userGuid: user.guid, role: user.role, permission: BucketPermission.manage })
			await this.policiesService.set({
				bucketGuid: bucket.guid,
				document: body.document as unknown as PoliciesTypes.PolicyDocument,
				updatedByUserGuid: user.guid,
			})
		} catch (err) {
			if (err instanceof BucketsTypes.BucketNotFoundError)
				throw Api.gatewayException(NotFoundException, PoliciesDto.ErrorCodes.BUCKET_NOT_FOUND)
			if (err instanceof BucketsTypes.PermissionDeniedError)
				throw Api.gatewayException(ForbiddenException, PoliciesDto.ErrorCodes.PERMISSION_DENIED)
			if (err instanceof PoliciesTypes.InvalidPolicyDocumentError)
				throw Api.gatewayException(BadRequestException, PoliciesDto.ErrorCodes.INVALID_POLICY_DOCUMENT)
			throw err
		}
	}

	@Delete()
	@Version('1')
	@SecuredEp()
	@HttpCode(HttpStatus.NO_CONTENT)
	@ApiNotFoundResponse({ type: PoliciesDto.PolicyNotFoundError })
	@ApiForbiddenResponse({ type: PoliciesDto.PolicyForbiddenError })
	async delete(@Param('bucketName') bucketName: string, @AuthUser() user: AuthTypes.Identity): Promise<void> {
		try {
			const bucket = await this.bucketsService.getForUser({ name: bucketName, userGuid: user.guid, role: user.role, permission: BucketPermission.manage })
			await this.policiesService.delete(bucket.guid)
		} catch (err) {
			if (err instanceof BucketsTypes.BucketNotFoundError)
				throw Api.gatewayException(NotFoundException, PoliciesDto.ErrorCodes.BUCKET_NOT_FOUND)
			if (err instanceof BucketsTypes.PermissionDeniedError)
				throw Api.gatewayException(ForbiddenException, PoliciesDto.ErrorCodes.PERMISSION_DENIED)
			throw err
		}
	}
}
