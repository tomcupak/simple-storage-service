export namespace S3Types {
	/** S3 error codes, paired with the HTTP status S3 returns for them. */
	export const ErrorCodes = {
		AccessDenied: { status: 403, message: 'Access Denied' },
		BucketAlreadyExists: { status: 409, message: 'The requested bucket name is not available' },
		BucketAlreadyOwnedByYou: { status: 409, message: 'You already own this bucket' },
		BucketNotEmpty: { status: 409, message: 'The bucket you tried to delete is not empty' },
		EntityTooLarge: { status: 400, message: 'Your proposed upload exceeds the maximum allowed object size' },
		InternalError: { status: 500, message: 'We encountered an internal error. Please try again.' },
		InvalidAccessKeyId: { status: 403, message: 'The access key id you provided does not exist in our records' },
		InvalidArgument: { status: 400, message: 'Invalid Argument' },
		InvalidBucketName: { status: 400, message: 'The specified bucket is not valid' },
		InvalidDigest: { status: 400, message: 'The Content-MD5 you specified is not valid' },
		InvalidPart: { status: 400, message: 'One or more of the specified parts could not be found' },
		InvalidRange: { status: 416, message: 'The requested range is not satisfiable' },
		MalformedPolicy: { status: 400, message: 'The policy is not in the valid JSON format' },
		MalformedXML: { status: 400, message: 'The XML you provided was not well-formed' },
		MethodNotAllowed: { status: 405, message: 'The specified method is not allowed against this resource' },
		MissingContentLength: { status: 411, message: 'You must provide the Content-Length HTTP header' },
		NoSuchBucket: { status: 404, message: 'The specified bucket does not exist' },
		NoSuchBucketPolicy: { status: 404, message: 'The bucket policy does not exist' },
		NoSuchKey: { status: 404, message: 'The specified key does not exist' },
		NoSuchUpload: { status: 404, message: 'The specified multipart upload does not exist' },
		NoSuchVersion: { status: 404, message: 'The specified version does not exist' },
		NotImplemented: { status: 501, message: 'A header or feature you provided implies functionality that is not implemented' },
		RequestTimeTooSkewed: { status: 403, message: 'The difference between the request time and the current time is too large' },
		SignatureDoesNotMatch: { status: 403, message: 'The request signature we calculated does not match the signature you provided' },
	} as const

	export type ErrorCode = keyof typeof ErrorCodes

	/** Parsed `Authorization: AWS4-HMAC-SHA256 ...` header of an incoming S3 request. */
	export interface SignatureV4Header {
		accessKeyId: string
		date: string
		region: string
		service: string
		signedHeaders: string[]
		signature: string
	}

	/** What a signed S3 request resolves to once verified. */
	export interface RequestIdentity {
		accessKeyId: string
		userGuid: string
		/** Anonymous requests carry no credentials and are only allowed by a public policy. */
		anonymous: boolean
	}

	export class SignatureMismatchError extends Error { public code: ErrorCode = 'SignatureDoesNotMatch' }
	export class MalformedAuthorizationError extends Error { public code: ErrorCode = 'InvalidArgument' }
	export class ClockSkewError extends Error { public code: ErrorCode = 'RequestTimeTooSkewed' }
}
