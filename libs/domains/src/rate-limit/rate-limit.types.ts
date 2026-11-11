export namespace RateLimitTypes {
	export interface Config {
		/** Off means every call is allowed without Valkey being contacted at all. */
		enabled: boolean
		/** Length of the fixed counting window, in seconds. */
		windowSeconds: number
		/** Requests one caller may make inside a window. */
		max: number
		/** Requests one caller may make per window against the `thumbnail` budget. */
		thumbnailMax: number
	}

	/** Which budget a request is counted against. Each has its own counter and its own ceiling,
	 *  so spending one never blocks the other. */
	export type Budget = 'default' | 'thumbnail'

	export interface ValkeyConfig {
		host: string
		port: number
		password?: string
	}

	/** What one counted request resolved to. `retryAfterSeconds` is what the caller should be
	 *  told to wait, i.e. the remainder of the current window. */
	export interface Decision {
		allowed: boolean
		limit: number
		remaining: number
		retryAfterSeconds: number
	}

	/** Who the counter is kept for. The verified S3 credential or management user comes first;
	 *  an unauthenticated caller is counted by address, which is all that is known about them. */
	export interface Subject {
		/** Short label of the counted dimension, e.g. `key`, `user`, `ip`. */
		kind: string
		id: string
	}
}
