import { BadRequestException, Body, Controller, Delete, Get, Param, Post, Put, Query, Req, Res, Version } from '@nestjs/common'
import {
	ApiBadRequestResponse,
	ApiBearerAuth,
	ApiBody,
	ApiConsumes,
	ApiForbiddenResponse,
	ApiNotFoundResponse,
	ApiOkResponse,
	ApiPayloadTooLargeResponse,
	ApiProduces,
	ApiTags,
} from '@nestjs/swagger'
import { AuditAction, BucketPermission } from '@storage/database'
import { AccessKeysService } from '@storage/domains/access-keys'
import { Audited } from '@storage/domains/audit'
import { AuthTypes, AuthUser, SecuredEp } from '@storage/domains/auth'
import { BucketsService } from '@storage/domains/buckets'
import { ObjectsDto, ObjectsService, ObjectsTypes } from '@storage/domains/objects'
import { S3SignatureService } from '@storage/domains/s3'
import { Api } from '@storage/shared'
import { Request, Response } from 'express'

import { config } from '../app.config'

@ApiTags('objects')
@ApiBearerAuth()
@Controller('buckets/:bucketName/objects')
export class ObjectsControllerV1 {
	constructor(
		private readonly objectsService: ObjectsService,
		private readonly bucketsService: BucketsService,
		private readonly accessKeysService: AccessKeysService,
		private readonly signatureService: S3SignatureService,
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
		const bucket = await this.bucketsService.getForUser({ name: bucketName, userGuid: user.guid, role: user.role, permission: BucketPermission.read })

		return this.objectsService.list({
			bucketGuid: bucket.guid,
			prefix: query.prefix,
			delimiter: query.delimiter,
			maxKeys: query.maxKeys,
			continuationToken: query.continuationToken,
		})
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
		const bucket = await this.bucketsService.getForUser({ name: bucketName, userGuid: user.guid, role: user.role, permission: BucketPermission.read })

		return this.objectsService.listVersions({ bucketGuid: bucket.guid, key })
	}

	/** The raw request body is the payload, so an upload of any size streams straight to disk.
	 *  `multipart/form-data` would have to be parsed before the bytes could be forwarded. */
	@Put()
	@Version('1')
	@SecuredEp()
	@Audited(AuditAction.objectUpload)
	@ApiConsumes('application/octet-stream')
	@ApiBody({ description: 'Raw object payload', schema: { type: 'string', format: 'binary' } })
	@ApiOkResponse({ type: ObjectsDto.UploadObjectResponse })
	@ApiBadRequestResponse({ type: ObjectsDto.ObjectBadRequestError })
	@ApiNotFoundResponse({ type: ObjectsDto.ObjectNotFoundError })
	@ApiForbiddenResponse({ type: ObjectsDto.ObjectForbiddenError })
	@ApiPayloadTooLargeResponse({ type: ObjectsDto.ObjectTooLargeError })
	async upload(
		@Param('bucketName') bucketName: string,
		@Query() query: ObjectsDto.UploadObjectQuery,
		@Req() req: Request,
		@AuthUser() user: AuthTypes.Identity,
	): Promise<ObjectsDto.UploadObjectResponse> {
		const bucket = await this.bucketsService.getForUser({ name: bucketName, userGuid: user.guid, role: user.role, permission: BucketPermission.write })
		const declaredLength = Number(req.headers['content-length'])

		const written = await this.objectsService.put({
			bucket,
			key: query.key,
			stream: req,
			contentType: req.headers['content-type'] ?? null,
			contentMd5: typeof req.headers['content-md5'] === 'string' ? req.headers['content-md5'] : undefined,
			declaredLength: Number.isFinite(declaredLength) ? declaredLength : undefined,
			maxBytes: config.body.maxUploadBytes,
		})

		// Field by field, not a spread: `put` also returns the version's wrapped data key, and
		// nothing about how an object is encrypted belongs in an answer to its uploader.
		return { key: query.key, etag: written.etag, size: written.size, versionId: written.versionId }
	}

	@Get('download')
	@Version('1')
	@SecuredEp()
	@Audited(AuditAction.objectDownload)
	@ApiProduces('application/octet-stream')
	@ApiOkResponse({ description: 'The object payload, streamed' })
	@ApiNotFoundResponse({ type: ObjectsDto.ObjectNotFoundError })
	@ApiForbiddenResponse({ type: ObjectsDto.ObjectForbiddenError })
	async download(
		@Param('bucketName') bucketName: string,
		@Query() query: ObjectsDto.DownloadObjectQuery,
		@Res() res: Response,
		@AuthUser() user: AuthTypes.Identity,
	): Promise<void> {
		const bucket = await this.bucketsService.getForUser({ name: bucketName, userGuid: user.guid, role: user.role, permission: BucketPermission.read })
		const version = await this.objectsService.getVersion({ bucketGuid: bucket.guid, key: query.key, versionId: query.versionId })
		// A delete marker is a key that is no longer there, not an empty download.
		if (version.isDeleteMarker || !version.storagePath) throw new ObjectsTypes.ObjectNotFoundError()

		const payload = await this.objectsService.readPayload({ storagePath: version.storagePath, encryption: version.encryption })

		res.setHeader('Content-Type', version.contentType ?? 'application/octet-stream')
		res.setHeader('Content-Length', String(payload.size))
		res.setHeader('ETag', `"${version.etag}"`)
		res.setHeader('Content-Disposition', Api.contentDisposition(query.key))

		payload.stream.pipe(res)
	}

	@Delete()
	@Version('1')
	@SecuredEp()
	@Audited(AuditAction.objectDelete)
	@ApiOkResponse({ type: ObjectsDto.DeleteObjectResponse })
	@ApiBadRequestResponse({ type: ObjectsDto.ObjectBadRequestError })
	@ApiNotFoundResponse({ type: ObjectsDto.ObjectNotFoundError })
	@ApiForbiddenResponse({ type: ObjectsDto.ObjectForbiddenError })
	async delete(
		@Param('bucketName') bucketName: string,
		@Query() query: ObjectsDto.DeleteObjectQuery,
		@AuthUser() user: AuthTypes.Identity,
	): Promise<ObjectsDto.DeleteObjectResponse> {
		// Exactly one of the two: a request naming both would leave it open which one won.
		if ((query.key ? 1 : 0) + (query.prefix ? 1 : 0) !== 1) {
			throw Api.gatewayException(BadRequestException, ObjectsDto.ErrorCodes.INVALID_KEY)
		}

		const bucket = await this.bucketsService.getForUser({ name: bucketName, userGuid: user.guid, role: user.role, permission: BucketPermission.delete })

		if (query.prefix) {
			const result = await this.objectsService.deleteByPrefix({ bucket, prefix: query.prefix })
			return { deletedCount: result.deletedCount, failedKeys: result.errors.map((entry) => entry.key) }
		}

		await this.objectsService.delete({ bucket, key: query.key ?? '', versionId: query.versionId })
		return { deletedCount: 1, failedKeys: [] }
	}

	@Post('folder')
	@Version('1')
	@SecuredEp()
	@Audited(AuditAction.objectCreateFolder)
	@ApiOkResponse({ type: ObjectsDto.UploadObjectResponse })
	@ApiBadRequestResponse({ type: ObjectsDto.ObjectBadRequestError })
	@ApiNotFoundResponse({ type: ObjectsDto.ObjectNotFoundError })
	@ApiForbiddenResponse({ type: ObjectsDto.ObjectForbiddenError })
	async createFolder(
		@Param('bucketName') bucketName: string,
		@Body() body: ObjectsDto.CreateFolderBody,
		@AuthUser() user: AuthTypes.Identity,
	): Promise<ObjectsDto.UploadObjectResponse> {
		const bucket = await this.bucketsService.getForUser({ name: bucketName, userGuid: user.guid, role: user.role, permission: BucketPermission.write })
		const created = await this.objectsService.createFolder({ bucket, key: body.key })

		return { key: created.key, etag: created.etag, size: created.size, versionId: created.versionId }
	}

	@Post('copy')
	@Version('1')
	@SecuredEp()
	@Audited(AuditAction.objectCopy)
	@ApiOkResponse({ type: ObjectsDto.CopyObjectResponse })
	@ApiBadRequestResponse({ type: ObjectsDto.ObjectBadRequestError })
	@ApiNotFoundResponse({ type: ObjectsDto.ObjectNotFoundError })
	@ApiForbiddenResponse({ type: ObjectsDto.ObjectForbiddenError })
	async copy(
		@Param('bucketName') bucketName: string,
		@Body() body: ObjectsDto.CopyObjectBody,
		@AuthUser() user: AuthTypes.Identity,
	): Promise<ObjectsDto.CopyObjectResponse> {
		// A move deletes from the source afterwards, so it needs delete rights there too.
		const source = await this.bucketsService.getForUser({
			name: bucketName,
			userGuid: user.guid,
			role: user.role,
			permission: body.move ? BucketPermission.delete : BucketPermission.read,
		})
		const target = await this.bucketsService.getForUser({
			name: body.targetBucket ?? bucketName,
			userGuid: user.guid,
			role: user.role,
			permission: BucketPermission.write,
		})

		return this.objectsService.copyKeys({
			source,
			target,
			sourceKey: body.sourceKey,
			targetKey: body.targetKey,
			move: body.move,
		})
	}

	/** Signs the link with the caller's own S3 access key, so it grants exactly what they may
	 *  do - the management session itself means nothing to the S3 endpoint. */
	@Post('presign')
	@Version('1')
	@SecuredEp()
	@Audited(AuditAction.objectPresign)
	@ApiOkResponse({ type: ObjectsDto.PresignObjectResponse })
	@ApiBadRequestResponse({ type: ObjectsDto.ObjectBadRequestError })
	@ApiNotFoundResponse({ type: ObjectsDto.ObjectNotFoundError })
	@ApiForbiddenResponse({ type: ObjectsDto.ObjectForbiddenError })
	async presign(
		@Param('bucketName') bucketName: string,
		@Body() body: ObjectsDto.PresignObjectBody,
		@AuthUser() user: AuthTypes.Identity,
	): Promise<ObjectsDto.PresignObjectResponse> {
		await this.bucketsService.getForUser({ name: bucketName, userGuid: user.guid, role: user.role, permission: BucketPermission.read })
		const credentials = await this.accessKeysService.resolveSigningCredentials(user.guid)
		const expiresIn = body.expiresIn ?? config.presignDefaultSeconds

		const url = this.signatureService.presign({
			method: 'GET',
			endpoint: config.s3.publicUrl,
			bucket: bucketName,
			key: body.key,
			expiresIn,
			accessKeyId: credentials.accessKeyId,
			secretAccessKey: credentials.secretAccessKey,
			region: config.s3.region,
			query: body.versionId ? { versionId: body.versionId } : undefined,
		})

		return { url, expiresAt: new Date(Date.now() + expiresIn * 1000) }
	}
}
