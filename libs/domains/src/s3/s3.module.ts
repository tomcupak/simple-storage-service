import { Module } from '@nestjs/common'

import { S3SignatureService } from './s3.signature.service'

@Module({
	providers: [S3SignatureService],
	exports: [S3SignatureService],
})
export class S3Module {}
