import { Injectable, NestMiddleware } from '@nestjs/common'
import { RequestLogService } from '@storage/shared'
import { NextFunction, Request, Response } from 'express'

/** One structured line per management request, in the same shape the S3 app writes.
 *
 *  The bucket and key come from the URL rather than from route parameters: middleware runs
 *  before routing, and the object endpoints are exactly the ones worth correlating with the S3
 *  log, where the same bucket and key appear. */
@Injectable()
export class ApiLoggingMiddleware implements NestMiddleware {
	/** `/v1/buckets/<name>/...` - the only shape a bucket name arrives in. */
	private static readonly BUCKET_PATH = /^\/v1\/buckets\/([^/]+)/

	constructor(
		private readonly requestLogService: RequestLogService,
	) {}

	use(req: Request, res: Response, next: NextFunction): void {
		if (this.isProbe(req)) {
			next()
			return
		}

		const startedAt = process.hrtime.bigint()

		res.on('finish', () => {
			const user = res.locals.user

			this.requestLogService.write({
				method: req.method,
				path: req.originalUrl.split('?')[0],
				status: res.statusCode,
				durationMs: this.requestLogService.elapsedMs(startedAt),
				bucket: this.bucketOf(req),
				key: this.queryValue(req, 'key') ?? this.queryValue(req, 'prefix'),
				userGuid: user?.guid,
				sourceIp: this.requestLogService.sourceIp(req.headers, req.socket.remoteAddress),
				userAgent: this.headerValue(req, 'user-agent'),
				bytesIn: this.numeric(this.headerValue(req, 'content-length')),
				bytesOut: this.numeric(res.getHeader('content-length')),
			})
		})

		next()
	}

	private isProbe(req: Request): boolean {
		return req.originalUrl.split('?')[0] === '/'
	}

	private bucketOf(req: Request): string | undefined {
		const match = ApiLoggingMiddleware.BUCKET_PATH.exec(req.originalUrl.split('?')[0])
		return match ? decodeURIComponent(match[1]) : undefined
	}

	/** Read off the raw URL: the parsed query is not on the request yet when this runs, and the
	 *  object routes deliberately keep their body unparsed. */
	private queryValue(req: Request, name: string): string | undefined {
		return new URLSearchParams(req.originalUrl.split('?')[1] ?? '').get(name) ?? undefined
	}

	private headerValue(req: Request, name: string): string | undefined {
		const value = req.headers[name]
		return Array.isArray(value) ? value.join(',') : value
	}

	private numeric(value: string | number | string[] | undefined): number | undefined {
		const parsed = Number(Array.isArray(value) ? value[0] : value)
		return Number.isFinite(parsed) ? parsed : undefined
	}
}
