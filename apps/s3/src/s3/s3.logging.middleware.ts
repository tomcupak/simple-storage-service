import { Injectable, NestMiddleware } from '@nestjs/common'
import { S3RequestService } from '@storage/domains/s3'
import { RequestLogService } from '@storage/shared'
import { NextFunction, Request, Response } from 'express'

import { HealthTypes } from '../health/health.types'

/** One structured line per S3 request: what was asked of which bucket and key, under which
 *  access key, and how long it took.
 *
 *  It records on `finish` rather than around the handler: object payloads are streamed, so a
 *  handler returns long before the last byte is written, and only the response event knows the
 *  real duration and the status a failure ended with. */
@Injectable()
export class S3LoggingMiddleware implements NestMiddleware {
	constructor(
		private readonly requestLogService: RequestLogService,
		private readonly requestService: S3RequestService,
	) {}

	use(req: Request, res: Response, next: NextFunction): void {
		// Probes are polled every few seconds and would drown the log they are meant to sit in.
		if (this.isProbe(req)) {
			next()
			return
		}

		const startedAt = process.hrtime.bigint()

		res.on('finish', () => {
			// Read after routing: virtual-host rewriting and the guard have both run by now,
			// so the bucket is the one that was actually addressed.
			const { bucket, key } = this.requestService.bucketAndKey(req)
			const identity = res.locals.s3

			this.requestLogService.write({
				method: req.method,
				path: req.originalUrl.split('?')[0],
				status: res.statusCode,
				durationMs: this.requestLogService.elapsedMs(startedAt),
				bucket: bucket || undefined,
				key: key || undefined,
				accessKeyId: identity?.accessKeyId || undefined,
				userGuid: identity?.userGuid || undefined,
				sourceIp: this.requestLogService.sourceIp(req.headers, req.socket.remoteAddress),
				userAgent: this.requestService.header(req, 'user-agent'),
				bytesIn: this.numeric(this.requestService.header(req, 'content-length')),
				bytesOut: this.numeric(res.getHeader('content-length')),
				errorCode: res.locals.s3ErrorCode,
			})
		})

		next()
	}

	private isProbe(req: Request): boolean {
		const [path] = req.originalUrl.split('?')
		return path === `/${HealthTypes.LIVENESS_PATH}` || path === `/${HealthTypes.READINESS_PATH}`
	}

	private numeric(value: string | number | string[] | undefined): number | undefined {
		const parsed = Number(Array.isArray(value) ? value[0] : value)
		return Number.isFinite(parsed) ? parsed : undefined
	}
}
