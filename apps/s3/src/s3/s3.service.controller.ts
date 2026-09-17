import { Controller, Get, Header, UseGuards } from '@nestjs/common'
import { UserRole } from '@storage/database'
import { BucketsService } from '@storage/domains/buckets'
import { S3Exception, S3Types, S3XmlService } from '@storage/domains/s3'

import { S3Identity } from './s3.decorators'
import { S3Guard } from './s3.guard'

/** Service-level S3 operations (no bucket in the path): today only `ListBuckets`. */
@Controller()
@UseGuards(S3Guard)
export class S3ServiceControllerV1 {
	constructor(
		private readonly bucketsService: BucketsService,
	) {}

	@Get()
	@Header('Content-Type', 'application/xml')
	async listBuckets(@S3Identity() identity: S3Types.RequestIdentity): Promise<string> {
		if (identity.anonymous) throw new S3Exception('AccessDenied')

		const buckets = await this.bucketsService.listForUser({ userGuid: identity.userGuid, role: UserRole.user })

		return S3XmlService.build('ListAllMyBucketsResult', {
			Owner: {
				ID: identity.userGuid,
				DisplayName: identity.accessKeyId,
			},
			Buckets: {
				Bucket: buckets.map((bucket) => ({
					Name: bucket.name,
					CreationDate: bucket.createdAt.toISOString(),
				})),
			},
		})
	}
}
