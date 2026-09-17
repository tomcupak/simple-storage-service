import { Controller, Delete, Get, Head, Options, Post, Put, Req, Res, UseGuards } from '@nestjs/common'
import { BucketsService } from '@storage/domains/buckets'
import { ObjectsService, ObjectsTypes } from '@storage/domains/objects'
import {
	S3AuthorizationService,
	S3Exception,
	S3RequestService,
	S3ResponseService,
	S3Types,
	S3XmlService,
} from '@storage/domains/s3'
import { Request, Response } from 'express'

import { S3Identity } from './s3.decorators'
import { S3Guard } from './s3.guard'

/** Object-level S3 operations: `/:bucket/:key`, including the multipart upload sub-resources. */
@Controller(':bucket/*key')
@UseGuards(S3Guard)
export class S3ObjectControllerV1 {
	constructor(
		private readonly bucketsService: BucketsService,
		private readonly objectsService: ObjectsService,
		private readonly authorizationService: S3AuthorizationService,
		private readonly requestService: S3RequestService,
		private readonly responseService: S3ResponseService,
	) {}

	/** `PutObject`, `CopyObject`, `UploadPart` and `UploadPartCopy`. */
	@Put()
	async put(@Req() req: Request, @Res() res: Response, @S3Identity() identity: S3Types.RequestIdentity): Promise<void> {
		const { bucket: bucketName, key } = this.requestService.bucketAndKey(req)
		// Reading the sub-resource first is what turns `?acl`, `?tagging` and friends into
		// `NotImplemented` instead of silently writing an object.
		this.requestService.subResource(req)
		const uploadId = this.requestService.query(req, 'uploadId')
		const partNumber = this.requestService.queryNumber(req, 'partNumber')
		const copySource = this.requestService.copySource(req)

		const bucket = await this.authorizationService.resolveBucket({ name: bucketName, identity, action: S3Types.Action.putObject, key })

		if (uploadId && partNumber !== undefined) {
			if (copySource) {
				const source = await this.authorizationService.resolveCopySource({ source: copySource, identity })
				const range = this.requestService.copySourceRange(req, source.size)
				const part = await this.objectsService.uploadPartCopy({ bucketGuid: bucket.guid, uploadId, partNumber, source, range })

				res.type('application/xml').send(this.responseService.copyPartResult(part))
				return
			}

			const part = await this.objectsService.uploadPart({
				bucketGuid: bucket.guid,
				uploadId,
				partNumber,
				stream: this.requestService.payloadStream(req, identity),
				contentMd5: this.requestService.header(req, 'content-md5'),
			})

			res.setHeader('ETag', this.requestService.formatEtag(part.etag))
			res.status(200).end()
			return
		}

		if (copySource) {
			const source = await this.authorizationService.resolveCopySource({ source: copySource, identity })
			const directive = (this.requestService.header(req, 'x-amz-metadata-directive') ?? '').toUpperCase()

			const copied = await this.objectsService.copy({
				source,
				target: { guid: bucket.guid, versioning: bucket.versioning },
				key,
				metadataDirective: directive === String(ObjectsTypes.MetadataDirective.replace)
					? ObjectsTypes.MetadataDirective.replace
					: ObjectsTypes.MetadataDirective.copy,
				accessKeyId: identity.accessKeyId || undefined,
				...this.requestService.objectHeaders(req),
			})

			if (copied.versionId !== ObjectsTypes.NULL_VERSION_ID) res.setHeader('x-amz-version-id', copied.versionId)
			res.type('application/xml').send(this.responseService.copyObjectResult({ etag: copied.etag, lastModified: copied.lastModified }))
			return
		}

		const written = await this.objectsService.put({
			bucket: { guid: bucket.guid, versioning: bucket.versioning },
			key,
			stream: this.requestService.payloadStream(req, identity),
			contentMd5: this.requestService.header(req, 'content-md5'),
			accessKeyId: identity.accessKeyId || undefined,
			...this.requestService.objectHeaders(req),
		})

		res.setHeader('ETag', this.requestService.formatEtag(written.etag))
		if (written.versionId !== ObjectsTypes.NULL_VERSION_ID) res.setHeader('x-amz-version-id', written.versionId)
		res.status(200).end()
	}

	/** `GetObject` (with ranges, conditional headers and `?versionId`) and `ListParts`. */
	@Get()
	async get(@Req() req: Request, @Res() res: Response, @S3Identity() identity: S3Types.RequestIdentity): Promise<void> {
		const { bucket: bucketName, key } = this.requestService.bucketAndKey(req)
		this.requestService.subResource(req)
		const uploadId = this.requestService.query(req, 'uploadId')
		const versionId = this.requestService.query(req, 'versionId')

		if (uploadId) {
			const bucket = await this.authorizationService.resolveBucket({ name: bucketName, identity, action: S3Types.Action.listMultipartUploadParts, key })
			const maxParts = this.requestService.queryNumber(req, 'max-parts') ?? ObjectsTypes.MAX_KEYS_LIMIT
			const partNumberMarker = this.requestService.queryNumber(req, 'part-number-marker')

			const result = await this.objectsService.listParts({ bucketGuid: bucket.guid, uploadId, maxParts, partNumberMarker })
			res.type('application/xml').send(this.responseService.listParts({
				bucket: bucketName, key: result.key, uploadId, result, maxParts, partNumberMarker,
			}))
			return
		}

		const action = versionId ? S3Types.Action.getObjectVersion : S3Types.Action.getObject
		const bucket = await this.authorizationService.resolveBucket({ name: bucketName, identity, action, key })
		const version = await this.objectsService.getVersion({ bucketGuid: bucket.guid, key, versionId })

		this.responseService.assertReadable({ res, version })
		this.requestService.assertConditions({ req, etag: version.etag, lastModified: version.lastModified })

		const range = this.requestService.parseRange(req, version.size)
		const payload = await this.objectsService.readPayload({ storagePath: version.storagePath ?? '', range })

		this.responseService.applyObjectHeaders({ res, version, overrides: this.requestService.responseOverrides(req) })
		res.setHeader('Content-Length', String(payload.size))

		if (range) {
			res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${version.size}`)
			res.status(206)
		}

		payload.stream.pipe(res)
	}

	/** `HeadObject`: the same headers as `GetObject`, without the payload. */
	@Head()
	async head(@Req() req: Request, @Res() res: Response, @S3Identity() identity: S3Types.RequestIdentity): Promise<void> {
		const { bucket: bucketName, key } = this.requestService.bucketAndKey(req)
		this.requestService.subResource(req)
		const versionId = this.requestService.query(req, 'versionId')

		const action = versionId ? S3Types.Action.getObjectVersion : S3Types.Action.getObject
		const bucket = await this.authorizationService.resolveBucket({ name: bucketName, identity, action, key })
		const version = await this.objectsService.getVersion({ bucketGuid: bucket.guid, key, versionId })

		this.responseService.assertReadable({ res, version })
		this.requestService.assertConditions({ req, etag: version.etag, lastModified: version.lastModified })

		const range = this.requestService.parseRange(req, version.size)

		this.responseService.applyObjectHeaders({ res, version, overrides: this.requestService.responseOverrides(req) })
		res.setHeader('Content-Length', String(range ? range.end - range.start + 1 : version.size))

		if (range) {
			res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${version.size}`)
			res.status(206)
		}

		res.end()
	}

	/** `DeleteObject` and `AbortMultipartUpload`. */
	@Delete()
	async delete(@Req() req: Request, @Res() res: Response, @S3Identity() identity: S3Types.RequestIdentity): Promise<void> {
		const { bucket: bucketName, key } = this.requestService.bucketAndKey(req)
		this.requestService.subResource(req)
		const uploadId = this.requestService.query(req, 'uploadId')
		const versionId = this.requestService.query(req, 'versionId')

		if (uploadId) {
			const bucket = await this.authorizationService.resolveBucket({ name: bucketName, identity, action: S3Types.Action.abortMultipartUpload, key })
			await this.objectsService.abortMultipartUpload({ bucketGuid: bucket.guid, uploadId })
			res.status(204).end()
			return
		}

		const action = versionId ? S3Types.Action.deleteObjectVersion : S3Types.Action.deleteObject
		const bucket = await this.authorizationService.resolveBucket({ name: bucketName, identity, action, key })

		const result = await this.objectsService.delete({
			bucket: { guid: bucket.guid, versioning: bucket.versioning },
			key,
			versionId,
			accessKeyId: identity.accessKeyId || undefined,
		})

		if (result.isDeleteMarker) res.setHeader('x-amz-delete-marker', 'true')
		if (result.versionId) res.setHeader('x-amz-version-id', result.versionId)
		res.status(204).end()
	}

	/** `CreateMultipartUpload` (`?uploads`) and `CompleteMultipartUpload` (`?uploadId`). */
	@Post()
	async post(@Req() req: Request, @Res() res: Response, @S3Identity() identity: S3Types.RequestIdentity): Promise<void> {
		const { bucket: bucketName, key } = this.requestService.bucketAndKey(req)
		const subResource = this.requestService.subResource(req)
		const uploadId = this.requestService.query(req, 'uploadId')

		const bucket = await this.authorizationService.resolveBucket({ name: bucketName, identity, action: S3Types.Action.putObject, key })

		if (subResource === S3Types.SubResource.uploads) {
			const created = await this.objectsService.createMultipartUpload({
				bucket: { guid: bucket.guid, versioning: bucket.versioning },
				key,
				accessKeyId: identity.accessKeyId || undefined,
				...this.requestService.objectHeaders(req),
			})

			// Nest answers a POST with 201 by default; every S3 POST result is a 200.
			res.status(200).type('application/xml').send(this.responseService.initiateMultipartUpload({ bucket: bucketName, key, uploadId: created }))
			return
		}

		if (!uploadId) throw new S3Exception('NotImplemented', key)

		const request = S3XmlService.parseCompleteMultipartUpload(await this.requestService.readBody(req))
		const completed = await this.objectsService.completeMultipartUpload({
			bucket: { guid: bucket.guid, versioning: bucket.versioning },
			uploadId,
			parts: request.parts,
		})

		if (completed.versionId !== ObjectsTypes.NULL_VERSION_ID) res.setHeader('x-amz-version-id', completed.versionId)
		res.status(200).type('application/xml').send(this.responseService.completeMultipartUpload({
			bucket: bucketName,
			key: completed.key,
			etag: completed.etag,
			location: `${req.protocol}://${req.headers.host ?? ''}/${bucketName}/${completed.key}`,
		}))
	}

	/** CORS preflight for browser clients uploading or downloading objects directly. */
	@Options()
	async options(@Req() req: Request, @Res() res: Response): Promise<void> {
		const { bucket: bucketName, key } = this.requestService.bucketAndKey(req)
		const origin = this.requestService.header(req, 'origin')
		const method = this.requestService.header(req, 'access-control-request-method') ?? 'GET'
		if (!origin) throw new S3Exception('InvalidRequest', key, 'Insufficient information. Origin request header needed.')

		const bucket = await this.bucketsService.getByName(bucketName)
		const rule = this.bucketsService.matchCorsRule({
			cors: bucket.cors,
			origin,
			method,
			requestHeaders: (this.requestService.header(req, 'access-control-request-headers') ?? '').split(',').map((header) => header.trim()).filter(Boolean),
		})

		if (!rule) throw new S3Exception('AccessDenied', key, 'CORSResponse: This CORS request is not allowed.')

		this.responseService.applyCorsHeaders({ res, rule, origin, method })
		res.status(200).end()
	}
}
