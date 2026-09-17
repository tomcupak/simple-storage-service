if (!process.env.TEST_VERBOSE) {
	const suppress = (originalWrite: typeof process.stdout.write): typeof process.stdout.write => {
		function filtered(buffer: Uint8Array | string, cb?: (err?: Error | null) => void): boolean
		function filtered(str: Uint8Array | string, encoding?: BufferEncoding, cb?: (err?: Error | null) => void): boolean
		function filtered(chunk: Uint8Array | string, encodingOrCb?: BufferEncoding | ((err?: Error | null) => void), callback?: (err?: Error | null) => void): boolean {
			if (typeof chunk === 'string' && chunk.includes('[Nest]')) {
				const cb = typeof encodingOrCb === 'function' ? encodingOrCb : callback
				cb?.()
				return true
			}
			return (originalWrite as (chunk: Uint8Array | string, encodingOrCb?: BufferEncoding | ((err?: Error | null) => void), callback?: (err?: Error | null) => void) => boolean)(chunk, encodingOrCb, callback)
		}
		return filtered
	}

	process.stdout.write = suppress(process.stdout.write.bind(process.stdout))
	process.stderr.write = suppress(process.stderr.write.bind(process.stderr))
}
