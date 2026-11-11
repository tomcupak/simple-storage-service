import { createParamDecorator, ExecutionContext } from '@nestjs/common'
import { S3Types } from '@storage/domains/s3'
import { Response } from 'express'

/** Identity resolved by `S3Guard` from the request's SigV4 signature. */
export const S3Identity = createParamDecorator(
	(data: unknown, ctx: ExecutionContext): S3Types.RequestIdentity => {
		const response = ctx.switchToHttp().getResponse<Response>()
		const identity = response.locals.s3
		if (!identity) throw new Error('S3 identity missing - is S3Guard applied?')
		return identity
	},
)
