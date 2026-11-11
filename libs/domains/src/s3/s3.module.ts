import { Module } from '@nestjs/common'

import { BucketsModule } from '../buckets/buckets.module'
import { ObjectsModule } from '../objects/objects.module'
import { PoliciesModule } from '../policies/policies.module'
import { S3AuthorizationService } from './s3.authorization.service'
import { S3RequestService } from './s3.request.service'
import { S3ResponseService } from './s3.response.service'
import { S3SignatureService } from './s3.signature.service'

@Module({
	imports: [BucketsModule, ObjectsModule, PoliciesModule],
	providers: [S3SignatureService, S3RequestService, S3ResponseService, S3AuthorizationService],
	exports: [S3SignatureService, S3RequestService, S3ResponseService, S3AuthorizationService],
})
export class S3Module {}
