import { S3Types } from '@storage/domains/s3'

declare global {
	namespace Express {
		interface Locals {
			s3?: S3Types.RequestIdentity
			/** Bucket a virtual-host style request was addressed to, set by the rewriting middleware. */
			virtualHostBucket?: string
			/** S3 error code the exception filter answered with, picked up by the request log. */
			s3ErrorCode?: S3Types.ErrorCode
		}
	}
}
