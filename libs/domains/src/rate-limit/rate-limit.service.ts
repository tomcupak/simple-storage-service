import { Injectable, Logger } from '@nestjs/common'
import { createClient, RedisClientType } from 'redis'

import { RateLimitTypes } from './rate-limit.types'

/** Fixed-window request counter kept in Valkey, so every instance of an app shares one budget
 *  instead of each granting the full allowance on its own.
 *
 *  The window is counted with `INCR` plus an `EXPIRE` on the first hit of a key: two commands,
 *  no read-modify-write, and a key that disappears by itself once the window is over.
 *
 *  Valkey being unreachable opens the gate rather than closing it. A counter store is an
 *  accessory to the storage service, not a dependency of it - an outage of it must not turn
 *  every upload into a 503. The failure is logged once per state change, not per request. */
@Injectable()
export class RateLimitService {
	private logger = new Logger(RateLimitService.name)
	private client?: RedisClientType
	private available = false
	/** One line per outage, not per request - a dead Valkey must not also flood the log. */
	private outageLogged = false

	constructor(
		private readonly config: RateLimitTypes.Config,
		private readonly valkey: RateLimitTypes.ValkeyConfig,
	) {}

	async onApplicationBootstrap(): Promise<void> {
		if (!this.config.enabled) {
			this.logger.warn('Rate limiting is disabled')
			return
		}

		this.client = createClient({
			socket: { host: this.valkey.host, port: this.valkey.port, reconnectStrategy: (retries) => Math.min(retries * 200, 5_000) },
			password: this.valkey.password,
		}) as RedisClientType

		// Without a listener the client throws on a connection drop and takes the process with it.
		this.client.on('error', (err: unknown) => this.markUnavailable(err))
		this.client.on('ready', () => this.markAvailable())

		try {
			await this.client.connect()
		} catch (err) {
			this.markUnavailable(err)
		}
	}

	onModuleDestroy(): void {
		this.client?.destroy()
	}

	/** Counts one request against a subject's window and says whether it may proceed. */
	async consume(subject: RateLimitTypes.Subject): Promise<RateLimitTypes.Decision> {
		if (!this.config.enabled || !this.client || !this.available) return this.allowAll()

		const key = `ratelimit:${subject.kind}:${subject.id}:${this.windowIndex()}`

		try {
			const count = await this.client.incr(key)
			// Only the first hit sets the deadline; re-arming it on every hit would let a
			// steady stream of requests keep one window alive indefinitely.
			if (count === 1) await this.client.expire(key, this.config.windowSeconds)

			return {
				allowed: count <= this.config.max,
				limit: this.config.max,
				remaining: Math.max(this.config.max - count, 0),
				retryAfterSeconds: this.retryAfterSeconds(),
			}
		} catch (err) {
			this.markUnavailable(err)
			return this.allowAll()
		}
	}

	/** Windows are derived from the clock rather than from first contact, so every instance
	 *  agrees on which window a given moment belongs to without coordinating. */
	private windowIndex(): number {
		return Math.floor(Date.now() / 1000 / this.config.windowSeconds)
	}

	private retryAfterSeconds(): number {
		const elapsed = Math.floor(Date.now() / 1000) % this.config.windowSeconds
		return Math.max(this.config.windowSeconds - elapsed, 1)
	}

	private allowAll(): RateLimitTypes.Decision {
		return { allowed: true, limit: this.config.max, remaining: this.config.max, retryAfterSeconds: 0 }
	}

	private markAvailable(): void {
		if (this.available) return
		this.available = true
		this.outageLogged = false
		this.logger.log(`Rate limiting active: ${this.config.max} requests per ${this.config.windowSeconds}s`)
	}

	private markUnavailable(err: unknown): void {
		this.available = false
		if (this.outageLogged) return

		this.outageLogged = true
		this.logger.error(
			'Valkey unreachable - rate limiting is passing every request through',
			err instanceof Error ? err.stack : undefined,
		)
	}
}
