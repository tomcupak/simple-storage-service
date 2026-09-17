import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common'
import { AccessKeysService, AccessKeysTypes } from '@storage/domains/access-keys'
import { S3Exception, S3SignatureService, S3Types } from '@storage/domains/s3'
import { Request, Response } from 'express'

/** Verifies AWS SigV4 on every S3 request - from the `Authorization` header or, for presigned
 *  URLs, from the query string - and puts the resolved identity on `res.locals.s3`.
 *  Requests without either pass through as anonymous; whether that is actually allowed is
 *  decided later by the bucket policy. */
@Injectable()
export class S3Guard implements CanActivate {
	constructor(
		private readonly signatureService: S3SignatureService,
		private readonly accessKeysService: AccessKeysService,
	) {}

	async canActivate(context: ExecutionContext): Promise<boolean> {
		const req = context.switchToHttp().getRequest<Request>()
		const res = context.switchToHttp().getResponse<Response>()

		try {
			const authorization = req.headers.authorization
			const presigned = authorization ? null : this.signatureService.parseQuerySignature(req)

			if (!authorization && !presigned) {
				res.locals.s3 = { accessKeyId: '', userGuid: '', anonymous: true } satisfies S3Types.RequestIdentity
				return true
			}

			const identity = presigned
				? await this.verifyPresigned(req, presigned)
				: await this.verifyHeader(req, authorization ?? '')

			res.locals.s3 = identity

			// Fire-and-forget: last-used tracking must never delay or fail the request.
			void this.accessKeysService.markUsed(identity.accessKeyId)

			return true
		} catch (err) {
			if (err instanceof AccessKeysTypes.AccessKeyNotFoundError) throw new S3Exception('InvalidAccessKeyId')
			if (err instanceof AccessKeysTypes.AccessKeyInactiveError) throw new S3Exception('InvalidAccessKeyId')
			if (err instanceof S3Types.SignatureMismatchError) throw new S3Exception('SignatureDoesNotMatch')
			if (err instanceof S3Types.ClockSkewError) throw new S3Exception('RequestTimeTooSkewed')
			if (err instanceof S3Types.ExpiredSignatureError) throw new S3Exception('AccessDenied', undefined, 'Request has expired')
			if (err instanceof S3Types.MalformedAuthorizationError) throw new S3Exception('InvalidArgument')
			throw err
		}
	}

	private async verifyHeader(req: Request, authorization: string): Promise<S3Types.RequestIdentity> {
		const parsed = this.signatureService.parseAuthorizationHeader(authorization)
		const credentials = await this.accessKeysService.resolveCredentials(parsed.accessKeyId)

		const payloadHash = (req.headers['x-amz-content-sha256'] as string | undefined) ?? S3Types.UNSIGNED_PAYLOAD
		const chunkSigning = this.signatureService.verify({
			req,
			parsed,
			secretAccessKey: credentials.secretAccessKey,
			payloadHash,
		})

		return {
			accessKeyId: credentials.accessKeyId,
			userGuid: credentials.userGuid,
			anonymous: false,
			// Only an `aws-chunked` body needs the seed material; keeping it out otherwise means
			// a request that claims chunked framing without signing it cannot slip through.
			chunkSigning: this.isChunkedPayload(payloadHash) ? chunkSigning : undefined,
		}
	}

	private async verifyPresigned(req: Request, parsed: S3Types.SignatureV4Query): Promise<S3Types.RequestIdentity> {
		const credentials = await this.accessKeysService.resolveCredentials(parsed.accessKeyId)
		this.signatureService.verifyPresigned({ req, parsed, secretAccessKey: credentials.secretAccessKey })

		return { accessKeyId: credentials.accessKeyId, userGuid: credentials.userGuid, anonymous: false }
	}

	private isChunkedPayload(payloadHash: string): boolean {
		return payloadHash === S3Types.STREAMING_SIGNED_PAYLOAD || payloadHash === S3Types.STREAMING_SIGNED_PAYLOAD_TRAILER
	}
}
