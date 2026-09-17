import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common'
import { AccessKeysService, AccessKeysTypes } from '@storage/domains/access-keys'
import { S3Exception, S3SignatureService, S3Types, UNSIGNED_PAYLOAD } from '@storage/domains/s3'
import { Request, Response } from 'express'

/** Verifies AWS SigV4 on every S3 request and puts the resolved identity on `res.locals.s3`.
 *  Requests without an Authorization header pass through as anonymous - whether that is
 *  actually allowed is decided later by the bucket policy. */
@Injectable()
export class S3Guard implements CanActivate {
	constructor(
		private readonly signatureService: S3SignatureService,
		private readonly accessKeysService: AccessKeysService,
	) {}

	async canActivate(context: ExecutionContext): Promise<boolean> {
		const req = context.switchToHttp().getRequest<Request>()
		const res = context.switchToHttp().getResponse<Response>()

		const authorization = req.headers.authorization
		if (!authorization) {
			res.locals.s3 = { accessKeyId: '', userGuid: '', anonymous: true } satisfies S3Types.RequestIdentity
			return true
		}

		try {
			const parsed = this.signatureService.parseAuthorizationHeader(authorization)
			const credentials = await this.accessKeysService.resolveCredentials(parsed.accessKeyId)

			const payloadHash = (req.headers['x-amz-content-sha256'] as string | undefined) ?? UNSIGNED_PAYLOAD
			this.signatureService.verify({
				req,
				parsed,
				secretAccessKey: credentials.secretAccessKey,
				payloadHash,
			})

			res.locals.s3 = {
				accessKeyId: credentials.accessKeyId,
				userGuid: credentials.userGuid,
				anonymous: false,
			} satisfies S3Types.RequestIdentity

			// Fire-and-forget: last-used tracking must never delay or fail the request.
			void this.accessKeysService.markUsed(credentials.accessKeyId)

			return true
		} catch (err) {
			if (err instanceof AccessKeysTypes.AccessKeyNotFoundError) throw new S3Exception('InvalidAccessKeyId')
			if (err instanceof AccessKeysTypes.AccessKeyInactiveError) throw new S3Exception('InvalidAccessKeyId')
			if (err instanceof S3Types.SignatureMismatchError) throw new S3Exception('SignatureDoesNotMatch')
			if (err instanceof S3Types.ClockSkewError) throw new S3Exception('RequestTimeTooSkewed')
			if (err instanceof S3Types.MalformedAuthorizationError) throw new S3Exception('InvalidArgument')
			throw err
		}
	}
}
