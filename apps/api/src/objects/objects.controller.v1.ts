import { BadRequestException, Body, Controller, Delete, Get, Param, Post, Put, Query, Req, Res } from '@nestjs/common'
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
	ApiResponse,
	ApiTags,
	ApiUnsupportedMediaTypeResponse,
} from '@nestjs/swagger'
import { AuditAction, BucketPermission } from '@storage/database'
import { AccessKeysService } from '@storage/domains/access-keys'
import { Audited } from '@storage/domains/audit'
import { AuthTypes, AuthUser, SecuredEp } from '@storage/domains/auth'
import { BucketsService } from '@storage/domains/buckets'
import { ObjectsDto, ObjectsService, ObjectsTypes } from '@storage/domains/objects'
import { RateLimitBudget } from '@storage/domains/rate-limit'
import { S3SignatureService } from '@storage/domains/s3'
import { ThumbnailsDto, ThumbnailsService, ThumbnailsTypes } from '@storage/domains/thumbnails'
import { Api } from '@storage/shared'
import { Request, Response } from 'express'

import { config } from '../app.config'

@ApiTags('objects')
@ApiBearerAuth()
@Controller({ path: 'buckets/:bucketName/objects', version: '1' })
export class ObjectsControllerV1 {
	constructor(
		private readonly objectsService: ObjectsService,
		private readonly bucketsService: BucketsService,
		private readonly accessKeysService: AccessKeysService,
		private readonly signatureService: S3SignatureService,
		private readonly thumbnailsService: ThumbnailsService,
	) {}

	@Get()
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

	/** Deliberately not `@Audited`: a listing page asks for up to a hundred of these at once and
	 *  they would drown the entries that matter. It has its own rate budget for the same reason.
	 *  Nothing is cached here - `no-cache` makes the browser revalidate, and the ETag answers
	 *  that with a 304 before the blob is read, so an overwritten key is never served stale. */
	@Get('thumbnail')
	@SecuredEp()
	@RateLimitBudget('thumbnail')
	@ApiProduces('image/webp')
	@ApiOkResponse({ description: 'A WebP thumbnail fitting inside the requested size' })
	@ApiResponse({ status: 304, description: 'If-None-Match matched the thumbnail ETag' })
	@ApiNotFoundResponse({ type: ObjectsDto.ObjectNotFoundError })
	@ApiForbiddenResponse({ type: ObjectsDto.ObjectForbiddenError })
	@ApiPayloadTooLargeResponse({ type: ThumbnailsDto.ThumbnailSourceTooLargeError })
	@ApiUnsupportedMediaTypeResponse({ type: ThumbnailsDto.ThumbnailUnsupportedError })
	async thumbnail(
		@Param('bucketName') bucketName: string,
		@Query() query: ThumbnailsDto.ThumbnailQuery,
		@Req() req: Request,
		@Res() res: Response,
		@AuthUser() user: AuthTypes.Identity,
	): Promise<void> {
		const bucket = await this.bucketsService.getForUser({ name: bucketName, userGuid: user.guid, role: user.role, permission: BucketPermission.read })
		const version = await this.objectsService.getVersion({ bucketGuid: bucket.guid, key: query.key, versionId: query.versionId })
		if (version.isDeleteMarker || !version.storagePath) throw new ObjectsTypes.ObjectNotFoundError()

		const size = query.size ?? ThumbnailsTypes.DEFAULT_SIZE
		const etag = `"${version.etag}-t${size}"`

		if (this.thumbnailsService.matchesEtag(req.headers['if-none-match'], etag)) {
			res.setHeader('ETag', etag)
			res.setHeader('Cache-Control', 'private, no-cache')
			res.status(304).end()
			return
		}

		if (!this.thumbnailsService.isSupported(version.contentType, query.key)) throw new ThumbnailsTypes.ThumbnailUnsupportedError()
		this.thumbnailsService.assertSourceSize(version.size)

		const payload = await this.objectsService.readPayload({ storagePath: version.storagePath, encryption: version.encryption })
		const image = await this.thumbnailsService.render({ stream: payload.stream, contentType: version.contentType, size, key: query.key })

		res.setHeader('ETag', etag)
		res.setHeader('Cache-Control', 'private, no-cache')
		res.setHeader('Content-Type', ThumbnailsTypes.OUTPUT_CONTENT_TYPE)
		res.setHeader('Content-Length', String(image.length))
		res.status(200).end(image)
	}

	@Get('download')
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
