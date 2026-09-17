import { Injectable } from '@nestjs/common'
import { BucketAcl, BucketPermission, UserRole } from '@storage/database'

import { BucketsService } from '../buckets/buckets.service'
import { BucketsTypes } from '../buckets/buckets.types'
import { ObjectsService } from '../objects/objects.service'
import { ObjectsTypes } from '../objects/objects.types'
import { PoliciesService } from '../policies/policies.service'
import { PoliciesTypes } from '../policies/policies.types'
import { S3Exception } from './s3.exception'
import { S3Types } from './s3.types'

/** Management permission an action needs when no policy statement decides it. */
const ACTION_PERMISSIONS: Record<S3Types.Action, BucketPermission> = {
	[S3Types.Action.abortMultipartUpload]: BucketPermission.write,
	[S3Types.Action.createBucket]: BucketPermission.manage,
	[S3Types.Action.deleteBucket]: BucketPermission.manage,
	[S3Types.Action.deleteBucketPolicy]: BucketPermission.manage,
	[S3Types.Action.deleteObject]: BucketPermission.delete,
	[S3Types.Action.deleteObjectVersion]: BucketPermission.delete,
	[S3Types.Action.getBucketCors]: BucketPermission.read,
	[S3Types.Action.getBucketLocation]: BucketPermission.read,
	[S3Types.Action.getBucketPolicy]: BucketPermission.manage,
	[S3Types.Action.getBucketVersioning]: BucketPermission.read,
	[S3Types.Action.getObject]: BucketPermission.read,
	[S3Types.Action.getObjectVersion]: BucketPermission.read,
	[S3Types.Action.listBucket]: BucketPermission.read,
	[S3Types.Action.listBucketMultipartUploads]: BucketPermission.read,
	[S3Types.Action.listBucketVersions]: BucketPermission.read,
	[S3Types.Action.listMultipartUploadParts]: BucketPermission.read,
	[S3Types.Action.putBucketCors]: BucketPermission.manage,
	[S3Types.Action.putBucketPolicy]: BucketPermission.manage,
	[S3Types.Action.putBucketVersioning]: BucketPermission.manage,
	[S3Types.Action.putObject]: BucketPermission.write,
}

/** Decides whether an S3 request may proceed.
 *
 *  The bucket policy comes first, exactly as in AWS: an explicit Deny ends the request, an
 *  Allow lets it through. When no statement matches, the fallback is ownership, the bucket's
 *  management grants and its canned ACL. `Condition` evaluation is not wired up yet. */
@Injectable()
export class S3AuthorizationService {
	constructor(
		private readonly bucketsService: BucketsService,
		private readonly policiesService: PoliciesService,
		private readonly objectsService: ObjectsService,
	) {}

	/** Resolves the bucket an operation names and authorises the operation in one step - the
	 *  shape every bucket- and object-level handler starts with. */
	async resolveBucket({ name, identity, action, key }: {
		name: string
		identity: S3Types.RequestIdentity
		action: S3Types.Action
		key?: string
	}): Promise<BucketsTypes.BucketItem> {
		const bucket = await this.bucketsService.getByName(name)
		await this.authorize({ identity, bucket, action, key })
		return bucket
	}

	/** Resolves the version a `CopyObject`/`UploadPartCopy` reads from, authorising the read
	 *  against the source bucket - which may be a different one than the target. */
	async resolveCopySource({ source, identity }: {
		source: S3Types.CopySource
		identity: S3Types.RequestIdentity
	}): Promise<ObjectsTypes.ObjectVersionDetail> {
		const bucket = await this.resolveBucket({
			name: source.bucket,
			identity,
			action: source.versionId ? S3Types.Action.getObjectVersion : S3Types.Action.getObject,
			key: source.key,
		})

		const version = await this.objectsService.getVersion({ bucketGuid: bucket.guid, key: source.key, versionId: source.versionId })
		if (version.isDeleteMarker) throw new S3Exception('NoSuchKey', source.key)

		return version
	}

	/** Throws `AccessDenied` unless the identity may perform `action` on the bucket (or key). */
	async authorize({ identity, bucket, action, key }: {
		identity: S3Types.RequestIdentity
		bucket: BucketsTypes.BucketItem
		action: S3Types.Action
		key?: string
	}): Promise<void> {
		const document = await this.policiesService.get(bucket.guid)
		const decision = this.policiesService.evaluate(document, {
			action,
			resource: this.resourceArn({ bucket: bucket.name, key }),
			principalUserGuid: identity.anonymous ? undefined : identity.userGuid,
			accessKeyId: identity.anonymous ? undefined : identity.accessKeyId,
		})

		if (decision === PoliciesTypes.Decision.deny) throw new S3Exception('AccessDenied', key ?? bucket.name)
		if (decision === PoliciesTypes.Decision.allow) return

		const permission = ACTION_PERMISSIONS[action]
		if (await this.allowedByOwnershipOrAcl({ identity, bucket, permission })) return

		throw new S3Exception('AccessDenied', key ?? bucket.name)
	}

	/** `arn:aws:s3:::<bucket>` for bucket-level actions, `.../<key>` for object-level ones. */
	resourceArn({ bucket, key }: { bucket: string, key?: string }): string {
		return key ? `arn:aws:s3:::${bucket}/${key}` : `arn:aws:s3:::${bucket}`
	}

	private async allowedByOwnershipOrAcl({ identity, bucket, permission }: {
		identity: S3Types.RequestIdentity
		bucket: BucketsTypes.BucketItem
		permission: BucketPermission
	}): Promise<boolean> {
		if (identity.anonymous) return this.allowedByAcl({ acl: bucket.acl, permission, anonymous: true })
		if (bucket.ownerUserGuid === identity.userGuid) return true

		const granted = await this.bucketsService.hasPermission({
			bucketGuid: bucket.guid,
			userGuid: identity.userGuid,
			role: UserRole.user,
			permission,
		})

		return granted || this.allowedByAcl({ acl: bucket.acl, permission, anonymous: false })
	}

	/** Canned ACLs only ever open up reads, or reads and writes - never bucket management. */
	private allowedByAcl({ acl, permission, anonymous }: {
		acl: BucketAcl
		permission: BucketPermission
		anonymous: boolean
	}): boolean {
		if (permission === BucketPermission.manage) return false

		if (acl === BucketAcl.publicReadWrite) return true
		if (acl === BucketAcl.publicRead) return permission === BucketPermission.read
		if (acl === BucketAcl.authenticatedRead) return !anonymous && permission === BucketPermission.read

		return false
	}
}
