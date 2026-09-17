import { S3Types } from '@storage/domains/s3'

declare global {
	namespace Express {
		interface Locals {
			s3?: S3Types.RequestIdentity
		}
	}
}
