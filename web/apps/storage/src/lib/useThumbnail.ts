import { useEffect, useState } from 'react'

import { acquireThumbnail, loadThumbnail, releaseThumbnail, thumbnailCacheKey,type ThumbnailRef } from './thumbnailCache'

interface State {
	cacheKey: string
	url: string | null
	failed: boolean
}

/** Resolves a thumbnail to an object URL while the component is mounted. Nothing is requested
 *  until `enabled`, which is how the listing defers off-screen rows. The URL stays valid for as
 *  long as the hook holds it; changing the target or unmounting releases it. */
export function useThumbnail(ref: ThumbnailRef, enabled: boolean, priority = false): { url: string | null, failed: boolean } {
	const cacheKey = thumbnailCacheKey(ref)
	const { bucketName, key, etag, size, versionId } = ref
	const [state, setState] = useState<State | null>(null)

	useEffect(() => {
		if (!enabled) return

		const controller = new AbortController()
		let held = false

		const hold = () => {
			const url = acquireThumbnail(cacheKey)
			if (url === undefined) return false

			held = true
			setState({ cacheKey, url, failed: false })
			return true
		}

		if (!hold()) {
			loadThumbnail({ bucketName, key, etag, size, versionId }, controller.signal, priority)
				.then(() => {
					if (controller.signal.aborted) return
					if (!hold()) setState({ cacheKey, url: null, failed: true })
				})
				.catch(() => {
					if (!controller.signal.aborted) setState({ cacheKey, url: null, failed: true })
				})
		}

		return () => {
			controller.abort()
			if (held) releaseThumbnail(cacheKey)
		}
	}, [enabled, cacheKey, bucketName, key, etag, size, versionId, priority])

	// A state left over from a previous target must not be shown for the current one.
	const current = state?.cacheKey === cacheKey ? state : null

	return { url: current?.url ?? null, failed: current?.failed ?? false }
}
