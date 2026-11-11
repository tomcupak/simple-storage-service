import { Controller, Delete, Get, Head, Options, Post, Put, Req, Res, UseGuards } from '@nestjs/common'
import { BucketVersioning } from '@storage/database'
import { BucketsService } from '@storage/domains/buckets'
import { ObjectsService, ObjectsTypes } from '@storage/domains/objects'
import { PoliciesService, PoliciesTypes } from '@storage/domains/policies'
import {
	S3AuthorizationService,
	S3Exception,
	S3RequestService,
	S3ResponseService,
	S3Types,
	S3XmlService,
} from '@storage/domains/s3'
import { Request, Response } from 'express'

import { config } from '../app.config'
import { S3Identity } from './s3.decorators'
import { S3Guard } from './s3.guard'
import { S3RateLimitGuard } from './s3.rate-limit.guard'

/** Bucket-level S3 operations: `/:bucket` with the operation selected by the HTTP verb and the
 *  `?subresource` query parameter (`?versioning`, `?policy`, `?cors`, `?uploads`, ...). */
@Controller(':bucket')
@UseGuards(S3Guard, S3RateLimitGuard)
export class S3BucketControllerV1 {
	constructor(
		private readonly bucketsService: BucketsService,
		private readonly objectsService: ObjectsService,
		private readonly policiesService: PoliciesService,
		private readonly authorizationService: S3AuthorizationService,
		private readonly requestService: S3RequestService,
		private readonly responseService: S3ResponseService,
	) {}

	/** `CreateBucket`, `PutBucketAcl`, `PutBucketVersioning`, `PutBucketPolicy`, `PutBucketCors`. */
	@Put()
	async put(@Req() req: Request, @Res() res: Response, @S3Identity() identity: S3Types.RequestIdentity): Promise<void> {
		const subResource = this.requestService.subResource(req)
		const { bucket: bucketName } = this.requestService.bucketAndKey(req)

		if (subResource === S3Types.SubResource.none) {
			if (identity.anonymous) throw new S3Exception('AccessDenied', bucketName)

			const existing = await this.bucketsService.findByName(bucketName)
			if (existing) {
				throw new S3Exception(existing.ownerUserGuid === identity.userGuid ? 'BucketAlreadyOwnedByYou' : 'BucketAlreadyExists', bucketName)
			}

			const created = await this.bucketsService.create({ name: bucketName, ownerUserGuid: identity.userGuid, region: config.s3.region })

			const acl = this.requestService.cannedAcl(req)
			if (acl) await this.bucketsService.setAcl({ guid: created.guid, acl })

			res.setHeader('Location', `/${bucketName}`)
			res.status(200).end()
			return
		}

		if (subResource === S3Types.SubResource.acl) {
			const bucket = await this.authorizationService.resolveBucket({ req, name: bucketName, identity, action: S3Types.Action.putBucketAcl })
			// `x-amz-acl` wins over a body, as in S3; only the canned ACLs have a representation here.
			const acl = this.requestService.cannedAcl(req) ?? S3XmlService.parseAccessControlPolicy(await this.requestService.readBody(req))

			await this.bucketsService.setAcl({ guid: bucket.guid, acl })
			res.status(200).end()
			return
		}

		if (subResource === S3Types.SubResource.versioning) {
			const bucket = await this.authorizationService.resolveBucket({ req, name: bucketName, identity, action: S3Types.Action.putBucketVersioning })
			const status = S3XmlService.parseVersioningConfiguration(await this.requestService.readBody(req))

			await this.bucketsService.setVersioning({
				guid: bucket.guid,
				versioning: status === 'Enabled' ? BucketVersioning.enabled : BucketVersioning.suspended,
			})
			res.status(200).end()
			return
		}

		if (subResource === S3Types.SubResource.policy) {
			const bucket = await this.authorizationService.resolveBucket({ req, name: bucketName, identity, action: S3Types.Action.putBucketPolicy })
			const body = await this.requestService.readBody(req)

			let document: PoliciesTypes.PolicyDocument
			try {
				document = JSON.parse(body) as PoliciesTypes.PolicyDocument
			} catch {
				throw new S3Exception('MalformedPolicy', bucketName)
			}

			await this.policiesService.set({ bucketGuid: bucket.guid, document, updatedByUserGuid: identity.userGuid || undefined })
			res.status(204).end()
			return
		}

		if (subResource === S3Types.SubResource.cors) {
			const bucket = await this.authorizationService.resolveBucket({ req, name: bucketName, identity, action: S3Types.Action.putBucketCors })
			const configuration = S3XmlService.parseCorsConfiguration(await this.requestService.readBody(req))

			await this.bucketsService.setCors({ guid: bucket.guid, configuration })
			res.status(200).end()
			return
		}

		throw new S3Exception('NotImplemented', bucketName)
	}

	/** `ListObjects(V2)`, `ListObjectVersions`, `ListMultipartUploads` and the bucket's
	 *  configuration sub-resources. */
	@Get()
	async get(@Req() req: Request, @Res() res: Response, @S3Identity() identity: S3Types.RequestIdentity): Promise<void> {
		const subResource = this.requestService.subResource(req)
		const { bucket: bucketName } = this.requestService.bucketAndKey(req)
		const prefix = this.requestService.query(req, 'prefix')
		const delimiter = this.requestService.query(req, 'delimiter')

		if (subResource === S3Types.SubResource.location) {
			const bucket = await this.authorizationService.resolveBucket({ req, name: bucketName, identity, action: S3Types.Action.getBucketLocation })
			res.type('application/xml').send(this.responseService.bucketLocation(bucket.region))
			return
		}

		if (subResource === S3Types.SubResource.acl) {
			const bucket = await this.authorizationService.resolveBucket({ req, name: bucketName, identity, action: S3Types.Action.getBucketAcl })
			res.type('application/xml').send(S3XmlService.buildAccessControlPolicy({ acl: bucket.acl, ownerId: bucket.ownerUserGuid }))
			return
		}

		if (subResource === S3Types.SubResource.versioning) {
			const bucket = await this.authorizationService.resolveBucket({ req, name: bucketName, identity, action: S3Types.Action.getBucketVersioning })
			res.type('application/xml').send(this.responseService.bucketVersioning(bucket.versioning))
			return
		}

		if (subResource === S3Types.SubResource.policy) {
			const bucket = await this.authorizationService.resolveBucket({ req, name: bucketName, identity, action: S3Types.Action.getBucketPolicy })
			const document = await this.policiesService.get(bucket.guid)
			if (!document) throw new S3Exception('NoSuchBucketPolicy', bucketName)

			res.type('application/json').send(JSON.stringify(document))
			return
		}

		if (subResource === S3Types.SubResource.cors) {
			const bucket = await this.authorizationService.resolveBucket({ req, name: bucketName, identity, action: S3Types.Action.getBucketCors })
			if (!bucket.cors) throw new S3Exception('NoSuchCORSConfiguration', bucketName)

			res.type('application/xml').send(S3XmlService.buildCorsConfiguration(bucket.cors))
			return
		}

		if (subResource === S3Types.SubResource.versions) {
			const bucket = await this.authorizationService.resolveBucket({ req, name: bucketName, identity, action: S3Types.Action.listBucketVersions })
			const maxKeys = this.requestService.queryNumber(req, 'max-keys') ?? ObjectsTypes.MAX_KEYS_LIMIT
			const keyMarker = this.requestService.query(req, 'key-marker')
			const versionIdMarker = this.requestService.query(req, 'version-id-marker')

			const result = await this.objectsService.listAllVersions({
				bucketGuid: bucket.guid, prefix, delimiter, maxKeys, keyMarker, versionIdMarker,
			})

			res.type('application/xml').send(this.responseService.listVersions({
				bucket: bucketName, result, prefix, delimiter, maxKeys, keyMarker, versionIdMarker,
			}))
			return
		}

		if (subResource === S3Types.SubResource.uploads) {
			const bucket = await this.authorizationService.resolveBucket({ req, name: bucketName, identity, action: S3Types.Action.listBucketMultipartUploads })
			const maxUploads = this.requestService.queryNumber(req, 'max-uploads') ?? ObjectsTypes.MAX_KEYS_LIMIT
			const keyMarker = this.requestService.query(req, 'key-marker')
			const uploadIdMarker = this.requestService.query(req, 'upload-id-marker')

			const result = await this.objectsService.listMultipartUploads({
				bucketGuid: bucket.guid, prefix, delimiter, maxUploads, keyMarker, uploadIdMarker,
			})

			res.type('application/xml').send(this.responseService.listMultipartUploads({
				bucket: bucketName, result, prefix, delimiter, maxUploads, keyMarker, uploadIdMarker,
			}))
			return
		}

		const bucket = await this.authorizationService.resolveBucket({ req, name: bucketName, identity, action: S3Types.Action.listBucket })
		const maxKeys = this.requestService.queryNumber(req, 'max-keys') ?? ObjectsTypes.MAX_KEYS_LIMIT
		const isV2 = this.requestService.query(req, 'list-type') === '2'
		const continuationToken = isV2 ? this.requestService.query(req, 'continuation-token') : undefined
		const marker = this.requestService.query(req, 'marker')
		const startAfter = isV2 ? this.requestService.query(req, 'start-after') : marker

		const result = await this.objectsService.list({
			bucketGuid: bucket.guid, prefix, delimiter, maxKeys, continuationToken, startAfter,
		})

		res.type('application/xml').send(isV2
			? this.responseService.listObjectsV2({ bucket: bucketName, result, prefix, delimiter, maxKeys, continuationToken, startAfter })
			: this.responseService.listObjectsV1({ bucket: bucketName, result, prefix, delimiter, maxKeys, marker }))
	}

	/** `HeadBucket`: existence and access, no body. */
	@Head()
	async head(@Req() req: Request, @Res() res: Response, @S3Identity() identity: S3Types.RequestIdentity): Promise<void> {
		const { bucket: bucketName } = this.requestService.bucketAndKey(req)
		const bucket = await this.authorizationService.resolveBucket({ req, name: bucketName, identity, action: S3Types.Action.listBucket })

		res.setHeader('x-amz-bucket-region', bucket.region)
		res.status(200).end()
	}

	/** `DeleteBucket`, `DeleteBucketPolicy`, `DeleteBucketCors`. */
	@Delete()
	async delete(@Req() req: Request, @Res() res: Response, @S3Identity() identity: S3Types.RequestIdentity): Promise<void> {
		const subResource = this.requestService.subResource(req)
		const { bucket: bucketName } = this.requestService.bucketAndKey(req)

		if (subResource === S3Types.SubResource.policy) {
			const bucket = await this.authorizationService.resolveBucket({ req, name: bucketName, identity, action: S3Types.Action.deleteBucketPolicy })
			await this.policiesService.delete(bucket.guid)
			res.status(204).end()
			return
		}

		if (subResource === S3Types.SubResource.cors) {
			const bucket = await this.authorizationService.resolveBucket({ req, name: bucketName, identity, action: S3Types.Action.putBucketCors })
			await this.bucketsService.deleteCors(bucket.guid)
			res.status(204).end()
			return
		}

		if (subResource !== S3Types.SubResource.none) throw new S3Exception('NotImplemented', bucketName)

		const bucket = await this.authorizationService.resolveBucket({ req, name: bucketName, identity, action: S3Types.Action.deleteBucket })
		await this.bucketsService.delete(bucket.guid)
		res.status(204).end()
	}

	/** `DeleteObjects` - the only POST a bucket path answers. */
	@Post()
	async post(@Req() req: Request, @Res() res: Response, @S3Identity() identity: S3Types.RequestIdentity): Promise<void> {
		const subResource = this.requestService.subResource(req)
		const { bucket: bucketName } = this.requestService.bucketAndKey(req)

		if (subResource !== S3Types.SubResource.delete) throw new S3Exception('NotImplemented', bucketName)

		const bucket = await this.authorizationService.resolveBucket({ req, name: bucketName, identity, action: S3Types.Action.deleteObject })
		const request = S3XmlService.parseDelete(await this.requestService.readBody(req))

		const result = await this.objectsService.deleteMany({
			bucket,
			objects: request.objects,
			accessKeyId: identity.accessKeyId || undefined,
		})

		// Nest answers a POST with 201 by default; every S3 POST result is a 200.
		res.status(200).type('application/xml').send(this.responseService.deleteObjects({ ...result, quiet: request.quiet }))
	}

	/** CORS preflight for browser clients, answered from the bucket's `CORSConfiguration`. */
	@Options()
	async options(@Req() req: Request, @Res() res: Response): Promise<void> {
		const { bucket: bucketName } = this.requestService.bucketAndKey(req)
		const origin = this.requestService.header(req, 'origin')
		const method = this.requestService.header(req, 'access-control-request-method') ?? 'GET'
		if (!origin) throw new S3Exception('InvalidRequest', bucketName, 'Insufficient information. Origin request header needed.')

		const bucket = await this.bucketsService.getByName(bucketName)
		const rule = this.bucketsService.matchCorsRule({
			cors: bucket.cors,
			origin,
			method,
			requestHeaders: (this.requestService.header(req, 'access-control-request-headers') ?? '').split(',').map((header) => header.trim()).filter(Boolean),
		})

		if (!rule) throw new S3Exception('AccessDenied', bucketName, 'CORSResponse: This CORS request is not allowed.')

		this.responseService.applyCorsHeaders({ res, rule, origin, method })
		res.status(200).end()
	}
}
