import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common'
import { RateLimitService, RateLimitTypes } from '@storage/domains/rate-limit'
import { S3Exception } from '@storage/domains/s3'
import { Request, Response } from 'express'

/** Counts every S3 request against its caller's window and answers `SlowDown` once the window
 *  is spent - the code AWS uses for the same thing, so an SDK backs off and retries instead of
 *  surfacing the failure to the application.
 *
 *  It is applied after `S3Guard` on purpose: the budget is then spent by whoever actually holds
 *  the credential, not by whoever wrote an access key id into a header. Requests that never
 *  present a credential are counted by address, which is all there is to count them by. */
@Injectable()
export class S3RateLimitGuard implements CanActivate {
	constructor(
		private readonly rateLimitService: RateLimitService,
	) {}

	async canActivate(context: ExecutionContext): Promise<boolean> {
		const req = context.switchToHttp().getRequest<Request>()
		const res = context.switchToHttp().getResponse<Response>()

		const decision = await this.rateLimitService.consume(this.subjectOf(req, res))

		res.setHeader('x-ratelimit-limit', String(decision.limit))
		res.setHeader('x-ratelimit-remaining', String(decision.remaining))

		if (!decision.allowed) {
			res.setHeader('Retry-After', String(decision.retryAfterSeconds))
			throw new S3Exception('SlowDown')
		}

		return true
	}

	private subjectOf(req: Request, res: Response): RateLimitTypes.Subject {
		const identity = res.locals.s3
		if (identity && !identity.anonymous && identity.accessKeyId) {
			return { kind: 'key', id: identity.accessKeyId }
		}

		return { kind: 'ip', id: this.sourceIp(req) }
	}

	private sourceIp(req: Request): string {
		const forwarded = req.headers['x-forwarded-for']
		const value = Array.isArray(forwarded) ? forwarded[0] : forwarded
		if (value) return value.split(',')[0].trim()

		return req.socket.remoteAddress ?? 'unknown'
	}
}
