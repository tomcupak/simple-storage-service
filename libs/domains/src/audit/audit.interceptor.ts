import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { AuditAction, AuditResult } from '@storage/database'
import { Request, Response } from 'express'
import { Observable, tap } from 'rxjs'

import { AUDIT_META } from './audit.decorators'
import { AuditService } from './audit.service'
import { AuditTypes } from './audit.types'

/** Records every handler marked with `@Audited(...)`, on success and on failure alike.
 *
 *  The entry is assembled from the request rather than from the handler's arguments, which is
 *  what keeps auditing out of the handlers themselves - they only declare which action they are. */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
	constructor(
		private readonly auditService: AuditService,
		private readonly reflector: Reflector,
	) {}

	intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
		const action = this.reflector.get<AuditAction | undefined>(AUDIT_META, context.getHandler())
		if (!action) return next.handle()

		const req = context.switchToHttp().getRequest<Request>()
		const res = context.switchToHttp().getResponse<Response>()

		return next.handle().pipe(tap({
			// Fire-and-forget: the audit write must not delay the response, and `record` never throws.
			next: () => void this.auditService.record(this.toParams({ action, req, res, result: AuditResult.success })),
			error: (err: unknown) => void this.auditService.record({
				...this.toParams({ action, req, res, result: AuditResult.failure }),
				detail: { ...this.detail(req), error: this.errorCode(err) },
			}),
		}))
	}

	private toParams({ action, req, res, result }: {
		action: AuditAction
		req: Request
		res: Response
		result: AuditResult
	}): AuditTypes.RecordParams {
		// `res.locals.user` is set by the auth guard; a public endpoint (login) has none.
		const user = res.locals.user
		const params = req.params as Record<string, string | undefined>

		return {
			action,
			result,
			userGuid: user?.guid ?? null,
			userEmail: user?.email ?? this.bodyString(req, 'email'),
			bucketName: params.bucketName ?? null,
			objectKey: this.objectKey(req),
			targetGuid: params.userGuid ?? params.accessKeyId ?? null,
			sourceIp: this.sourceIp(req),
			userAgent: req.headers['user-agent'] ?? null,
			detail: this.detail(req),
		}
	}

	/** Body and query of the call, minus anything secret - the audit log is readable by admins
	 *  and must not become a place where passwords or keys can be recovered. */
	private detail(req: Request): Record<string, unknown> {
		const body = (typeof req.body === 'object' && req.body !== null ? req.body : {}) as Record<string, unknown>
		const merged: Record<string, unknown> = { ...req.query, ...body }

		for (const field of AuditTypes.REDACTED_FIELDS) {
			if (field in merged) merged[field] = '[redacted]'
		}

		return merged
	}

	private objectKey(req: Request): string | null {
		const fromQuery = req.query.key ?? req.query.prefix
		if (typeof fromQuery === 'string') return fromQuery

		return this.bodyString(req, 'key') ?? this.bodyString(req, 'sourceKey')
	}

	private bodyString(req: Request, field: string): string | null {
		const body = req.body as Record<string, unknown> | undefined
		const value = body?.[field]
		return typeof value === 'string' ? value : null
	}

	private sourceIp(req: Request): string | null {
		const forwarded = req.headers['x-forwarded-for']
		const header = Array.isArray(forwarded) ? forwarded[0] : forwarded
		if (header) return header.split(',')[0].trim()

		return req.socket.remoteAddress ?? null
	}

	/** Why an attempt was rejected: the `code` of the domain error the handler threw, or - once
	 *  it has been turned into an `HttpException` - the one in its `{ code }` body. */
	private errorCode(err: unknown): string {
		if (typeof err !== 'object' || err === null) return 'unknown'

		const own = (err as { code?: unknown }).code
		if (typeof own === 'string') return own

		const response = (err as { response?: unknown }).response
		if (typeof response === 'object' && response !== null) {
			const code = (response as { code?: unknown }).code
			if (typeof code === 'string') return code
		}

		return err instanceof Error ? err.name : 'unknown'
	}
}
