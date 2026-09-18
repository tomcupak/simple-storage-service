import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Put, Version } from '@nestjs/common'
import { ApiBadRequestResponse, ApiBearerAuth, ApiForbiddenResponse, ApiNotFoundResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger'
import { AuditAction, BucketPermission } from '@storage/database'
import { Audited } from '@storage/domains/audit'
import { AuthTypes, AuthUser, SecuredEp } from '@storage/domains/auth'
import { BucketsService } from '@storage/domains/buckets'
import { PoliciesDto, PoliciesService, PoliciesTypes } from '@storage/domains/policies'

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
		const bucket = await this.bucketsService.getForUser({ name: bucketName, userGuid: user.guid, role: user.role, permission: BucketPermission.manage })

		return { document: await this.policiesService.get(bucket.guid) }
	}

	@Put()
	@Version('1')
	@SecuredEp()
	@Audited(AuditAction.bucketSetPolicy)
	@HttpCode(HttpStatus.NO_CONTENT)
	@ApiBadRequestResponse({ type: PoliciesDto.PolicyBadRequestError })
	@ApiNotFoundResponse({ type: PoliciesDto.PolicyNotFoundError })
	@ApiForbiddenResponse({ type: PoliciesDto.PolicyForbiddenError })
	async set(
		@Param('bucketName') bucketName: string,
		@Body() body: PoliciesDto.SetPolicyBody,
		@AuthUser() user: AuthTypes.Identity,
	): Promise<void> {
		const bucket = await this.bucketsService.getForUser({ name: bucketName, userGuid: user.guid, role: user.role, permission: BucketPermission.manage })
		await this.policiesService.set({
			bucketGuid: bucket.guid,
			document: body.document as unknown as PoliciesTypes.PolicyDocument,
			updatedByUserGuid: user.guid,
		})
	}

	@Delete()
	@Version('1')
	@SecuredEp()
	@Audited(AuditAction.bucketDeletePolicy)
	@HttpCode(HttpStatus.NO_CONTENT)
	@ApiNotFoundResponse({ type: PoliciesDto.PolicyNotFoundError })
	@ApiForbiddenResponse({ type: PoliciesDto.PolicyForbiddenError })
	async delete(@Param('bucketName') bucketName: string, @AuthUser() user: AuthTypes.Identity): Promise<void> {
		const bucket = await this.bucketsService.getForUser({ name: bucketName, userGuid: user.guid, role: user.role, permission: BucketPermission.manage })
		await this.policiesService.delete(bucket.guid)
	}
}
