import { Controller, ForbiddenException, Get, NotFoundException, Param, Query, Version } from '@nestjs/common'
import { ApiBearerAuth, ApiForbiddenResponse, ApiNotFoundResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger'
import { BucketPermission } from '@storage/database'
import { AuthTypes, AuthUser, SecuredEp } from '@storage/domains/auth'
import { BucketsService, BucketsTypes } from '@storage/domains/buckets'
import { ObjectsDto, ObjectsService, ObjectsTypes } from '@storage/domains/objects'
import { Api } from '@storage/shared'

@ApiTags('objects')
@ApiBearerAuth()
@Controller('buckets/:bucketName/objects')
export class ObjectsControllerV1 {
	constructor(
		private readonly objectsService: ObjectsService,
		private readonly bucketsService: BucketsService,
	) {}

	@Get()
	@Version('1')
	@SecuredEp()
	@ApiOkResponse({ type: ObjectsDto.ListObjectsResponse })
	@ApiNotFoundResponse({ type: ObjectsDto.ObjectNotFoundError })
	@ApiForbiddenResponse({ type: ObjectsDto.ObjectForbiddenError })
	async list(
		@Param('bucketName') bucketName: string,
		@Query() query: ObjectsDto.ListObjectsQuery,
		@AuthUser() user: AuthTypes.Identity,
	): Promise<ObjectsDto.ListObjectsResponse> {
		try {
			const bucket = await this.bucketsService.getForUser({ name: bucketName, userGuid: user.guid, role: user.role, permission: BucketPermission.read })
			return await this.objectsService.list({
				bucketGuid: bucket.guid,
				prefix: query.prefix,
				delimiter: query.delimiter,
				maxKeys: query.maxKeys,
				continuationToken: query.continuationToken,
			})
		} catch (err) {
			if (err instanceof BucketsTypes.BucketNotFoundError)
				throw Api.gatewayException(NotFoundException, ObjectsDto.ErrorCodes.BUCKET_NOT_FOUND)
			if (err instanceof BucketsTypes.PermissionDeniedError)
				throw Api.gatewayException(ForbiddenException, ObjectsDto.ErrorCodes.PERMISSION_DENIED)
			throw err
		}
	}

	@Get('versions')
	@Version('1')
	@SecuredEp()
	@ApiOkResponse({ type: ObjectsDto.ObjectVersionItem, isArray: true })
	@ApiNotFoundResponse({ type: ObjectsDto.ObjectNotFoundError })
	@ApiForbiddenResponse({ type: ObjectsDto.ObjectForbiddenError })
	async listVersions(
		@Param('bucketName') bucketName: string,
		@Query('key') key: string,
		@AuthUser() user: AuthTypes.Identity,
	): Promise<ObjectsDto.ObjectVersionItem[]> {
		try {
			const bucket = await this.bucketsService.getForUser({ name: bucketName, userGuid: user.guid, role: user.role, permission: BucketPermission.read })
			return await this.objectsService.listVersions({ bucketGuid: bucket.guid, key })
		} catch (err) {
			if (err instanceof BucketsTypes.BucketNotFoundError)
				throw Api.gatewayException(NotFoundException, ObjectsDto.ErrorCodes.BUCKET_NOT_FOUND)
			if (err instanceof BucketsTypes.PermissionDeniedError)
				throw Api.gatewayException(ForbiddenException, ObjectsDto.ErrorCodes.PERMISSION_DENIED)
			if (err instanceof ObjectsTypes.ObjectNotFoundError)
				throw Api.gatewayException(NotFoundException, ObjectsDto.ErrorCodes.OBJECT_NOT_FOUND)
			throw err
		}
	}
}
