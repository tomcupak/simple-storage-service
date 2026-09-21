import { Injectable, Logger } from '@nestjs/common'

import { RequestLogTypes } from './request-log.types'

/** Writes one machine-readable line per finished request.
 *
 *  The payload is JSON so a log shipper can index `bucket`, `accessKeyId` or `durationMs`
 *  without parsing prose; it goes through Nest's logger rather than straight to stdout so it
 *  keeps the timestamp and context every other line of the app already carries.
 *
 *  The level follows the status code: a 5xx is the deployment's problem and is an error, a 4xx
 *  is the caller's and is a warning, everything else is routine. */
@Injectable()
export class RequestLogService {
	private logger = new Logger('request')

	write(entry: RequestLogTypes.Entry): void {
		const line = JSON.stringify(this.compact(entry))

		if (entry.status >= 500) {
			this.logger.error(line)
			return
		}
		if (entry.status >= 400) {
			this.logger.warn(line)
			return
		}

		this.logger.log(line)
	}

	/** Milliseconds since a `process.hrtime.bigint()` mark, rounded to a tenth. */
	elapsedMs(startedAt: bigint): number {
		return Math.round(Number(process.hrtime.bigint() - startedAt) / 1e5) / 10
	}

	/** Client address as the logs should name it: the first `X-Forwarded-For` hop behind a
	 *  proxy, otherwise the socket peer. */
	sourceIp(headers: Record<string, string | string[] | undefined>, remoteAddress?: string): string | undefined {
		const forwarded = headers['x-forwarded-for']
		const value = Array.isArray(forwarded) ? forwarded[0] : forwarded
		if (value) return value.split(',')[0].trim()

		return remoteAddress
	}

	/** An absent field says "this request had no such thing" more clearly than a null does,
	 *  and keeps the line short enough to read in a terminal. */
	private compact(entry: RequestLogTypes.Entry): Record<string, unknown> {
		return Object.fromEntries(
			Object.entries(entry).filter(([, value]) => value !== undefined && value !== ''),
		)
	}
}
