import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common'
import { AccessKeysTypes } from '@storage/domains/access-keys'
import { AuthTypes } from '@storage/domains/auth'
import { BucketsTypes } from '@storage/domains/buckets'
import { ObjectsTypes } from '@storage/domains/objects'
import { PoliciesTypes } from '@storage/domains/policies'
import { StorageTypes } from '@storage/domains/storage'
import { UsageTypes } from '@storage/domains/usage'
import { UsersTypes } from '@storage/domains/users'
import { Response } from 'express'

/** Domain errors, in the HTTP status each one means. The `{ code }` the response carries is the
 *  error's own `code` property, which is also what the DTO error enums are built from - so a
 *  new domain error only has to be listed here to reach the UI with a stable code.
 *
 *  Handlers therefore do not wrap service calls in try/catch just to remap an error; they only
 *  do so when the mapping depends on the endpoint rather than on the error. */
const DOMAIN_ERRORS: [new (...args: never[]) => Error, HttpStatus][] = [
	[AuthTypes.InvalidCredentialsError, HttpStatus.UNAUTHORIZED],
	[AuthTypes.InvalidRefreshTokenError, HttpStatus.UNAUTHORIZED],
	[AuthTypes.UserDisabledError, HttpStatus.UNAUTHORIZED],

	[UsersTypes.UserNotFoundError, HttpStatus.NOT_FOUND],
	[UsersTypes.EmailAlreadyUsedError, HttpStatus.BAD_REQUEST],
	[UsersTypes.LastAdminError, HttpStatus.BAD_REQUEST],
	[UsersTypes.LastAdminDemotedError, HttpStatus.BAD_REQUEST],
	[UsersTypes.InvalidCurrentPasswordError, HttpStatus.BAD_REQUEST],

	[AccessKeysTypes.AccessKeyNotFoundError, HttpStatus.NOT_FOUND],
	[AccessKeysTypes.AccessKeyInactiveError, HttpStatus.BAD_REQUEST],
	[AccessKeysTypes.NoUsableAccessKeyError, HttpStatus.BAD_REQUEST],

	[BucketsTypes.BucketNotFoundError, HttpStatus.NOT_FOUND],
	[BucketsTypes.BucketAlreadyExistsError, HttpStatus.BAD_REQUEST],
	[BucketsTypes.InvalidBucketNameError, HttpStatus.BAD_REQUEST],
	[BucketsTypes.BucketNotEmptyError, HttpStatus.BAD_REQUEST],
	[BucketsTypes.PermissionDeniedError, HttpStatus.FORBIDDEN],
	[BucketsTypes.CorsNotConfiguredError, HttpStatus.NOT_FOUND],
	[BucketsTypes.InvalidCorsConfigurationError, HttpStatus.BAD_REQUEST],

	[ObjectsTypes.ObjectNotFoundError, HttpStatus.NOT_FOUND],
	[ObjectsTypes.VersionNotFoundError, HttpStatus.NOT_FOUND],
	[ObjectsTypes.InvalidKeyError, HttpStatus.BAD_REQUEST],
	[ObjectsTypes.ObjectAlreadyExistsError, HttpStatus.BAD_REQUEST],
	[ObjectsTypes.BadDigestError, HttpStatus.BAD_REQUEST],
	[ObjectsTypes.InvalidRangeError, HttpStatus.BAD_REQUEST],
	[StorageTypes.PayloadTooLargeError, HttpStatus.PAYLOAD_TOO_LARGE],
	[StorageTypes.EncryptionKeyError, HttpStatus.INTERNAL_SERVER_ERROR],

	[PoliciesTypes.InvalidPolicyDocumentError, HttpStatus.BAD_REQUEST],
	[PoliciesTypes.PolicyNotFoundError, HttpStatus.NOT_FOUND],

	[UsageTypes.BucketQuotaExceededError, HttpStatus.BAD_REQUEST],
	[UsageTypes.UserQuotaExceededError, HttpStatus.BAD_REQUEST],
]

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
	private logger = new Logger(ApiExceptionFilter.name)

	catch(exception: unknown, host: ArgumentsHost): void {
		const res = host.switchToHttp().getResponse<Response>()

		// A failure once the payload started streaming cannot be turned into a JSON body.
		if (res.headersSent) {
			res.destroy()
			return
		}

		if (exception instanceof HttpException) {
			res.status(exception.getStatus()).json(exception.getResponse())
			return
		}

		const match = DOMAIN_ERRORS.find(([type]) => exception instanceof type)
		if (match) {
			res.status(match[1]).json({ code: (exception as { code?: string }).code ?? 'unknown_error' })
			return
		}

		this.logger.error(exception)
		res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ code: 'internal_error' })
	}
}
