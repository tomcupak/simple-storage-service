export namespace S3Types {
	/** S3 error codes, paired with the HTTP status S3 returns for them. */
	export const ErrorCodes = {
		AccessDenied: { status: 403, message: 'Access Denied' },
		BadDigest: { status: 400, message: 'The Content-MD5 you specified did not match what we received' },
		BucketAlreadyExists: { status: 409, message: 'The requested bucket name is not available' },
		BucketAlreadyOwnedByYou: { status: 409, message: 'You already own this bucket' },
		BucketNotEmpty: { status: 409, message: 'The bucket you tried to delete is not empty' },
		EntityTooLarge: { status: 400, message: 'Your proposed upload exceeds the maximum allowed object size' },
		EntityTooSmall: { status: 400, message: 'Your proposed upload is smaller than the minimum allowed object size' },
		IncompleteBody: { status: 400, message: 'The request body terminated unexpectedly' },
		InternalError: { status: 500, message: 'We encountered an internal error. Please try again.' },
		InvalidAccessKeyId: { status: 403, message: 'The access key id you provided does not exist in our records' },
		InvalidArgument: { status: 400, message: 'Invalid Argument' },
		InvalidBucketName: { status: 400, message: 'The specified bucket is not valid' },
		InvalidDigest: { status: 400, message: 'The Content-MD5 you specified is not valid' },
		InvalidPart: { status: 400, message: 'One or more of the specified parts could not be found' },
		InvalidPartOrder: { status: 400, message: 'The list of parts was not in ascending order' },
		InvalidRange: { status: 416, message: 'The requested range is not satisfiable' },
		InvalidRequest: { status: 400, message: 'The request cannot be handled as submitted' },
		MalformedPolicy: { status: 400, message: 'The policy is not in the valid JSON format' },
		MalformedXML: { status: 400, message: 'The XML you provided was not well-formed' },
		MethodNotAllowed: { status: 405, message: 'The specified method is not allowed against this resource' },
		MissingContentLength: { status: 411, message: 'You must provide the Content-Length HTTP header' },
		NoSuchBucket: { status: 404, message: 'The specified bucket does not exist' },
		NoSuchBucketPolicy: { status: 404, message: 'The bucket policy does not exist' },
		NoSuchCORSConfiguration: { status: 404, message: 'The CORS configuration does not exist' },
		NoSuchKey: { status: 404, message: 'The specified key does not exist' },
		NoSuchUpload: { status: 404, message: 'The specified multipart upload does not exist' },
		NoSuchVersion: { status: 404, message: 'The specified version does not exist' },
		NotImplemented: { status: 501, message: 'A header or feature you provided implies functionality that is not implemented' },
		NotModified: { status: 304, message: 'Not Modified' },
		PreconditionFailed: { status: 412, message: 'At least one of the preconditions you specified did not hold' },
		RequestTimeTooSkewed: { status: 403, message: 'The difference between the request time and the current time is too large' },
		SignatureDoesNotMatch: { status: 403, message: 'The request signature we calculated does not match the signature you provided' },
		XAmzContentSHA256Mismatch: { status: 400, message: 'The provided x-amz-content-sha256 header does not match what was computed' },
	} as const

	export type ErrorCode = keyof typeof ErrorCodes

	/** Payload hash sent by clients that stream a body they cannot hash upfront. */
	export const UNSIGNED_PAYLOAD = 'UNSIGNED-PAYLOAD'
	/** `aws-chunked` body whose chunks each carry their own signature (AWS CLI default). */
	export const STREAMING_SIGNED_PAYLOAD = 'STREAMING-AWS4-HMAC-SHA256-PAYLOAD'
	/** `aws-chunked` framing without per-chunk signatures, used when checksums are trailed. */
	export const STREAMING_UNSIGNED_PAYLOAD = 'STREAMING-UNSIGNED-PAYLOAD-TRAILER'
	export const STREAMING_SIGNED_PAYLOAD_TRAILER = 'STREAMING-AWS4-HMAC-SHA256-PAYLOAD-TRAILER'

	/** Parsed `Authorization: AWS4-HMAC-SHA256 ...` header of an incoming S3 request. */
	export interface SignatureV4Header {
		accessKeyId: string
		date: string
		region: string
		service: string
		signedHeaders: string[]
		signature: string
	}

	/** SigV4 carried in the query string instead of the header, i.e. a presigned URL. */
	export interface SignatureV4Query extends SignatureV4Header {
		amzDate: string
		expires: number
	}

	/** Seed material a chunked (`aws-chunked`) body needs to verify its per-chunk signatures.
	 *  Each chunk is signed with the previous chunk's signature, seeded by the request signature. */
	export interface ChunkSigningContext {
		signingKey: Buffer
		seedSignature: string
		amzDate: string
		credentialScope: string
	}

	/** What a signed S3 request resolves to once verified. */
	export interface RequestIdentity {
		accessKeyId: string
		userGuid: string
		/** Anonymous requests carry no credentials and are only allowed by a public policy. */
		anonymous: boolean
		/** Present only for header-signed requests with an `aws-chunked` body. */
		chunkSigning?: ChunkSigningContext
	}

	/** Query-string sub-resource selecting an operation on a bucket or object
	 *  (`?versioning`, `?uploads`, ...). `none` is the plain operation for the verb. */
	export enum SubResource {
		none = 'none',
		acl = 'acl',
		cors = 'cors',
		delete = 'delete',
		location = 'location',
		policy = 'policy',
		uploadId = 'uploadId',
		uploads = 'uploads',
		versioning = 'versioning',
		versions = 'versions',
	}

	/** Sub-resources a real S3 would answer but this deployment does not implement.
	 *  They must fail as `NotImplemented` rather than fall through to a 404. */
	export const UNIMPLEMENTED_SUBRESOURCES = [
		'accelerate', 'analytics', 'encryption', 'inventory', 'lifecycle', 'legal-hold', 'logging',
		'metrics', 'notification', 'object-lock', 'ownershipControls', 'publicAccessBlock',
		'replication', 'requestPayment', 'restore', 'retention', 'select', 'tagging', 'torrent',
		'website',
	] as const

	/** Byte range resolved against a known object size (inclusive on both ends, as in HTTP). */
	export interface ResolvedRange {
		start: number
		end: number
	}

	/** `CORSRule` of a bucket's `CORSConfiguration`. */
	export interface CorsRule {
		id?: string
		allowedOrigins: string[]
		allowedMethods: string[]
		allowedHeaders?: string[]
		exposeHeaders?: string[]
		maxAgeSeconds?: number
	}

	export interface CorsConfiguration {
		rules: CorsRule[]
	}

	/** Conditional request headers evaluated before a GET/HEAD body is produced. */
	export interface ConditionalHeaders {
		ifMatch?: string
		ifNoneMatch?: string
		ifModifiedSince?: Date
		ifUnmodifiedSince?: Date
	}

	/** Parsed `<CompleteMultipartUpload>` body. */
	export interface CompleteMultipartUploadRequest {
		parts: { partNumber: number, etag: string }[]
	}

	/** Parsed `<Delete>` body of a `DeleteObjects` (`POST ?delete`) request. */
	export interface DeleteRequest {
		quiet: boolean
		objects: { key: string, versionId?: string }[]
	}

	/** S3 action names used in policy statements, one per operation this API implements. */
	export enum Action {
		abortMultipartUpload = 's3:AbortMultipartUpload',
		createBucket = 's3:CreateBucket',
		deleteBucket = 's3:DeleteBucket',
		deleteBucketPolicy = 's3:DeleteBucketPolicy',
		deleteObject = 's3:DeleteObject',
		deleteObjectVersion = 's3:DeleteObjectVersion',
		getBucketAcl = 's3:GetBucketAcl',
		getBucketCors = 's3:GetBucketCORS',
		getBucketLocation = 's3:GetBucketLocation',
		getBucketPolicy = 's3:GetBucketPolicy',
		getBucketVersioning = 's3:GetBucketVersioning',
		getObject = 's3:GetObject',
		getObjectVersion = 's3:GetObjectVersion',
		listBucket = 's3:ListBucket',
		listBucketMultipartUploads = 's3:ListBucketMultipartUploads',
		listBucketVersions = 's3:ListBucketVersions',
		listMultipartUploadParts = 's3:ListMultipartUploadParts',
		putBucketAcl = 's3:PutBucketAcl',
		putBucketCors = 's3:PutBucketCORS',
		putBucketPolicy = 's3:PutBucketPolicy',
		putBucketVersioning = 's3:PutBucketVersioning',
		putObject = 's3:PutObject',
	}

	/** Canned ACL grants a `GetBucketAcl` response spells out, per `BucketAcl`. */
	export const ACL_GROUP_URIS = {
		allUsers: 'http://acs.amazonaws.com/groups/global/AllUsers',
		authenticatedUsers: 'http://acs.amazonaws.com/groups/global/AuthenticatedUsers',
	} as const

	/** `x-amz-copy-source` split into its parts (`/bucket/key?versionId=...`). */
	export interface CopySource {
		bucket: string
		key: string
		versionId?: string
	}

	export class SignatureMismatchError extends Error { public code: ErrorCode = 'SignatureDoesNotMatch' }
	export class MalformedAuthorizationError extends Error { public code: ErrorCode = 'InvalidArgument' }
	export class ClockSkewError extends Error { public code: ErrorCode = 'RequestTimeTooSkewed' }
	export class ExpiredSignatureError extends Error { public code: ErrorCode = 'AccessDenied' }
	export class MalformedBodyError extends Error { public code: ErrorCode = 'IncompleteBody' }
	export class MalformedXmlError extends Error { public code: ErrorCode = 'MalformedXML' }
}
