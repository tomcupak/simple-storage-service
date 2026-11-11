import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { RATE_LIMIT_BUDGET_KEY, RateLimitService, RateLimitTypes } from '@storage/domains/rate-limit'
import { Request, Response } from 'express'

/** Counts every management request against its caller's window. A signed-in user is counted by
 *  guid so one browser tab cannot spend a whole office's budget behind a shared address; the
 *  requests that arrive without a session - logins above all - are counted by address, which is
 *  what makes this useful against password guessing. */
@Injectable()
export class ApiRateLimitGuard implements CanActivate {
	constructor(
		private readonly rateLimitService: RateLimitService,
		private readonly reflector: Reflector,
	) {}

	async canActivate(context: ExecutionContext): Promise<boolean> {
		const req = context.switchToHttp().getRequest<Request>()
		const res = context.switchToHttp().getResponse<Response>()

		const decision = await this.rateLimitService.consume(this.subjectOf(req, res), this.budgetOf(context))

		res.setHeader('x-ratelimit-limit', String(decision.limit))
		res.setHeader('x-ratelimit-remaining', String(decision.remaining))

		if (!decision.allowed) {
			res.setHeader('Retry-After', String(decision.retryAfterSeconds))
			throw new HttpException({ code: 'rate_limited' }, HttpStatus.TOO_MANY_REQUESTS)
		}

		return true
	}

	/** An endpoint opts into another budget with `@RateLimitBudget`; everything else shares the default. */
	private budgetOf(context: ExecutionContext): RateLimitTypes.Budget {
		return this.reflector.getAllAndOverride<RateLimitTypes.Budget | undefined>(RATE_LIMIT_BUDGET_KEY, [context.getHandler(), context.getClass()]) ?? 'default'
	}

	private subjectOf(req: Request, res: Response): RateLimitTypes.Subject {
		const user = res.locals.user
		if (user) return { kind: 'user', id: user.guid }

		return { kind: 'ip', id: this.sourceIp(req) }
	}

	private sourceIp(req: Request): string {
		const forwarded = req.headers['x-forwarded-for']
		const value = Array.isArray(forwarded) ? forwarded[0] : forwarded
		if (value) return value.split(',')[0].trim()

		return req.socket.remoteAddress ?? 'unknown'
	}
}
