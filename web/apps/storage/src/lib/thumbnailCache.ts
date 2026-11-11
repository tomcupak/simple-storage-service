import Axios from 'axios'

import { fetchThumbnail, type ThumbnailSize } from '../api/transfer'

/** Thumbnails are fetched through a small queue and kept as object URLs in an LRU, so scrolling
 *  a big folder does not fire hundreds of requests at once and coming back to a folder does not
 *  refetch anything.
 *
 *  An entry is reference counted: a mounted component holds it with `acquire` and lets go with
 *  `release`. Eviction only ever drops entries nobody holds, so a URL that is on screen is never
 *  revoked; the cache may temporarily exceed its limit while everything is held. */

const MAX_ENTRIES = 300
const MAX_CONCURRENT = 4
const MAX_FAILURES = 1000

interface Entry {
	url: string
	refs: number
}

// Map iteration order is insertion order, so re-inserting on use makes the first entry the oldest.
const entries = new Map<string, Entry>()

/** Thumbnails the server answered definitively (4xx) that it cannot produce. The etag is part of
 *  the key, so an overwritten object is tried again. Network errors, 5xx and aborts are not
 *  remembered - those may well succeed next time. */
const failures = new Set<string>()

function rememberFailure(cacheKey: string, error: unknown): void {
	const status = Axios.isAxiosError(error) ? error.response?.status : undefined
	if (status === undefined || status < 400 || status >= 500 || status === 429 || status === 408) return

	failures.add(cacheKey)
	if (failures.size > MAX_FAILURES) {
		const oldest = failures.values().next().value
		if (oldest !== undefined) failures.delete(oldest)
	}
}

interface Task {
	run: () => void
}

const queue: Task[] = []
let active = 0

export interface ThumbnailRef {
	bucketName: string
	key: string
	etag: string
	size: ThumbnailSize
	versionId?: string
}

export function thumbnailCacheKey({ bucketName, key, etag, size }: ThumbnailRef): string {
	return `${bucketName}|${key}|${etag}|${size}`
}

function evict(keep?: string): void {
	for (const [key, entry] of entries) {
		if (entries.size <= MAX_ENTRIES) return
		if (entry.refs > 0 || key === keep) continue

		URL.revokeObjectURL(entry.url)
		entries.delete(key)
	}
}

/** Returns the cached URL and holds it, or `undefined` on a miss. */
export function acquireThumbnail(cacheKey: string): string | undefined {
	const entry = entries.get(cacheKey)
	if (!entry) return undefined

	entry.refs += 1
	entries.delete(cacheKey)
	entries.set(cacheKey, entry)

	return entry.url
}

export function releaseThumbnail(cacheKey: string): void {
	const entry = entries.get(cacheKey)
	if (!entry) return

	entry.refs = Math.max(0, entry.refs - 1)
	evict()
}

function pump(): void {
	while (active < MAX_CONCURRENT) {
		const task = queue.shift()
		if (!task) return

		active += 1
		task.run()
	}
}

/** Fetches a thumbnail into the cache (not held - call `acquireThumbnail` right after). A request
 *  whose signal aborts while still queued never starts. `priority` jumps the queue, for the
 *  placeholder of an image the user just opened. */
export function loadThumbnail(ref: ThumbnailRef, signal: AbortSignal, priority = false): Promise<void> {
	const cacheKey = thumbnailCacheKey(ref)

	return new Promise<void>((resolve, reject) => {
		if (signal.aborted) {
			reject(new DOMException('Aborted', 'AbortError'))
			return
		}
		if (failures.has(cacheKey)) {
			reject(new Error('thumbnail_unavailable'))
			return
		}
		if (entries.has(cacheKey)) {
			resolve()
			return
		}

		const task: Task = {
			run: () => {
				fetchThumbnail({ ...ref, signal })
					.then((blob) => {
						if (!entries.has(cacheKey)) {
							entries.set(cacheKey, { url: URL.createObjectURL(blob), refs: 0 })
							evict(cacheKey)
						}
						resolve()
					})
					.catch((error: unknown) => {
						rememberFailure(cacheKey, error)
						reject(error)
					})
					.finally(() => {
						active -= 1
						pump()
					})
			},
		}

		signal.addEventListener('abort', () => {
			const index = queue.indexOf(task)
			if (index === -1) return // already running: axios aborts the request itself

			queue.splice(index, 1)
			reject(new DOMException('Aborted', 'AbortError'))
		}, { once: true })

		if (priority) queue.unshift(task)
		else queue.push(task)
		pump()
	})
}
