import { useEffect, useRef, useState } from 'react'

import { type ObjectItem } from '../api/client'
import { fileIcon, fileKind, isThumbnailable } from '../lib/fileType'
import { useThumbnail } from '../lib/useThumbnail'

/** The leading cell of a file row: a lazily loaded thumbnail for raster images, a type icon for
 *  everything else and for any thumbnail that could not be produced. */
export function ObjectThumbnail({ bucketName, object, onClick }: {
	bucketName: string
	object: ObjectItem
	onClick: () => void
}) {
	const kind = fileKind(object.contentType, object.key)
	const thumbnailable = isThumbnailable(object.contentType, object.key)

	const cell = useRef<HTMLButtonElement>(null)
	const [visible, setVisible] = useState(false)

	useEffect(() => {
		const element = cell.current
		if (!thumbnailable || !element) return

		const observer = new IntersectionObserver((observed) => {
			if (!observed.some((item) => item.isIntersecting)) return

			setVisible(true)
			observer.disconnect()
		}, { rootMargin: '200px' })
		observer.observe(element)

		return () => observer.disconnect()
	}, [thumbnailable])

	const { url, failed } = useThumbnail(
		{ bucketName, key: object.key, etag: object.etag, size: 128 },
		thumbnailable && visible,
	)

	return (
		<button ref={cell} type="button" className="thumb" tabIndex={-1} aria-hidden="true" onClick={onClick}>
			{url && !failed
				? <img src={url} alt="" draggable={false} />
				: <span className="thumb-icon">{fileIcon(kind)}</span>}
		</button>
	)
}
