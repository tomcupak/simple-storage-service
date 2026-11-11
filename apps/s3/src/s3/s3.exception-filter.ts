import { ArgumentsHost, Catch, ExceptionFilter, Logger } from '@nestjs/common'
import { BucketsTypes } from '@storage/domains/buckets'
import { ObjectsTypes } from '@storage/domains/objects'
import { PoliciesTypes } from '@storage/domains/policies'
import { S3Exception, S3Types, S3XmlService } from '@storage/domains/s3'
import { StorageTypes } from '@storage/domains/storage'
import { UsageTypes } from '@storage/domains/usage'
import { Response } from 'express'

/** Domain errors, in the S3 error code each one means. Services throw framework-free typed
 *  errors; turning them into the S3 wire format happens here, once. */
const DOMAIN_ERRORS: [new (...args: never[]) => Error, S3Types.ErrorCode][] = [
	[BucketsTypes.BucketNotFoundError, 'NoSuchBucket'],
	[BucketsTypes.BucketAlreadyExistsError, 'BucketAlreadyExists'],
	[BucketsTypes.BucketNotEmptyError, 'BucketNotEmpty'],
	[BucketsTypes.InvalidBucketNameError, 'InvalidBucketName'],
	[BucketsTypes.PermissionDeniedError, 'AccessDenied'],
	[BucketsTypes.CorsNotConfiguredError, 'NoSuchCORSConfiguration'],
	[BucketsTypes.InvalidCorsConfigurationError, 'MalformedXML'],
	[ObjectsTypes.ObjectNotFoundError, 'NoSuchKey'],
	[ObjectsTypes.VersionNotFoundError, 'NoSuchVersion'],
	[ObjectsTypes.InvalidRangeError, 'InvalidRange'],
	[ObjectsTypes.UploadNotFoundError, 'NoSuchUpload'],
	[ObjectsTypes.InvalidPartError, 'InvalidPart'],
	[ObjectsTypes.InvalidPartOrderError, 'InvalidPartOrder'],
	[ObjectsTypes.PartTooSmallError, 'EntityTooSmall'],
	[ObjectsTypes.BadDigestError, 'BadDigest'],
	[ObjectsTypes.InvalidKeyError, 'InvalidArgument'],
	[ObjectsTypes.ObjectAlreadyExistsError, 'InvalidRequest'],
	// S3 has no quota code of its own; `EntityTooLarge` is what AWS answers when a write would
	// exceed a configured limit, and SDKs already treat it as non-retryable.
	[UsageTypes.BucketQuotaExceededError, 'EntityTooLarge'],
	[UsageTypes.UserQuotaExceededError, 'EntityTooLarge'],
	[PoliciesTypes.InvalidPolicyDocumentError, 'MalformedPolicy'],
	[PoliciesTypes.PolicyNotFoundError, 'NoSuchBucketPolicy'],
	[S3Types.MalformedXmlError, 'MalformedXML'],
	[S3Types.MalformedBodyError, 'IncompleteBody'],
	[S3Types.SignatureMismatchError, 'SignatureDoesNotMatch'],
	[StorageTypes.BlobNotFoundError, 'NoSuchKey'],
	[StorageTypes.PayloadTooLargeError, 'EntityTooLarge'],
	// The object is there and its key is right; the deployment cannot open it. That is an
	// internal fault, not something the caller could have sent differently.
	[StorageTypes.EncryptionKeyError, 'InternalError'],
]

/** Every failure leaving the S3 app must be an S3-shaped XML `<Error>` document - AWS SDKs
 *  parse the body to decide whether to retry, and a JSON error would break them. */
@Catch()
export class S3ExceptionFilter implements ExceptionFilter {
	private logger = new Logger(S3ExceptionFilter.name)

	catch(exception: unknown, host: ArgumentsHost): void {
		const res = host.switchToHttp().getResponse<Response>()

		if (res.headersSent) {
			// A failure mid-stream cannot be turned into an error document any more.
			res.destroy()
			return
		}

		const s3Exception = exception instanceof S3Exception ? exception : this.fromDomainError(exception)
		if (s3Exception) {
			this.send(res, s3Exception)
			return
		}

		this.logger.error(exception)
		res.locals.s3ErrorCode = 'InternalError'
		const definition = S3Types.ErrorCodes.InternalError
		res
			.status(definition.status)
			.type('application/xml')
			.send(S3XmlService.buildError({ code: 'InternalError', message: definition.message }))
	}

	private send(res: Response, exception: S3Exception): void {
		// Left for the request log, which runs on `finish` and would otherwise only see a status.
		res.locals.s3ErrorCode = exception.errorCode

		// 304 must not carry a body, and Express drops one silently only for some transports.
		if (exception.getStatus() === S3Types.ErrorCodes.NotModified.status) {
			res.status(exception.getStatus()).end()
			return
		}

		res.status(exception.getStatus()).type('application/xml').send(exception.getResponse())
	}

	private fromDomainError(exception: unknown): S3Exception | undefined {
		const match = DOMAIN_ERRORS.find(([type]) => exception instanceof type)
		if (!match) return undefined

		return new S3Exception(match[1], undefined, exception instanceof Error ? exception.message || undefined : undefined)
	}
}
