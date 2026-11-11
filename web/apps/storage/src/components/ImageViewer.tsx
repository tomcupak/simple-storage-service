import { useCallback, useEffect, useRef, useState } from 'react'

import { type ObjectItem } from '../api/client'
import { downloadObject, saveBlob } from '../api/transfer'
import { useI18n } from '../i18n'
import { isThumbnailable } from '../lib/fileType'
import { baseName, formatSize } from '../lib/format'
import { loadThumbnail } from '../lib/thumbnailCache'
import { useThumbnail } from '../lib/useThumbnail'
import { ErrorText } from './ErrorText'
import { Modal } from './Modal'

const MAX_SCALE = 32
const ZOOM_STEP = 1.25

interface Size { width: number, height: number }
interface ViewerControls { zoom: (factor: number) => void, fit: () => void, actual: () => void }
interface View { fit: boolean, scale: number, x: number, y: number }

const FIT: View = { fit: true, scale: 1, x: 0, y: 0 }

function fitScale(stage: Size, image: Size): number {
	// Fitting never enlarges: a small image is shown at its own size rather than blurred up.
	return Math.min(1, stage.width / image.width, stage.height / image.height)
}

/** The transform a view really renders with: in fit mode it is derived from the current stage
 *  size, so resizing the window keeps the image fitted without any state update. */
function resolve(view: View, stage: Size, image: Size): View {
	if (!view.fit) return view

	const scale = fitScale(stage, image)
	return { fit: true, scale, x: (stage.width - image.width * scale) / 2, y: (stage.height - image.height * scale) / 2 }
}

/** Keeps the image from being dragged out of reach: an axis smaller than the stage is centred,
 *  a larger one may not expose empty space past its edge. */
function clamp(view: View, stage: Size, image: Size): View {
	const width = image.width * view.scale
	const height = image.height * view.scale
	const x = width <= stage.width ? (stage.width - width) / 2 : Math.min(0, Math.max(stage.width - width, view.x))
	const y = height <= stage.height ? (stage.height - height) / 2 : Math.min(0, Math.max(stage.height - height, view.y))

	return { ...view, x, y }
}

/** Scales around a point of the stage so what is under the cursor stays under it. Zooming back
 *  down to the fitted size returns to fit mode, which then tracks window resizes again. */
function zoomAround(current: View, stage: Size, image: Size, factor: number, anchor: { x: number, y: number }, absolute = false): View {
	const base = resolve(current, stage, image)
	const minimum = fitScale(stage, image)
	const target = absolute ? factor : base.scale * factor
	const scale = Math.min(MAX_SCALE, Math.max(minimum, target))

	if (scale <= minimum * 1.001) return FIT

	const ratio = scale / base.scale
	return clamp({
		fit: false,
		scale,
		x: anchor.x - (anchor.x - base.x) * ratio,
		y: anchor.y - (anchor.y - base.y) * ratio,
	}, stage, image)
}

function ImageStage({ bucketName, object, onDimensions, onFailed, onScale, onBlob, controls }: {
	bucketName: string
	object: ObjectItem
	onDimensions: (size: Size) => void
	onFailed: (error: unknown) => void
	onScale: (scale: number) => void
	onBlob: (blob: Blob) => void
	controls: React.RefObject<ViewerControls | null>
}) {
	const { t } = useI18n()
	const stageRef = useRef<HTMLDivElement>(null)
	const [stage, setStage] = useState<Size>({ width: 0, height: 0 })
	const [image, setImage] = useState<Size | null>(null)
	const [view, setView] = useState<View>(FIT)
	const [source, setSource] = useState<string | null>(null)
	const [broken, setBroken] = useState(false)
	const pointers = useRef(new Map<number, { x: number, y: number }>())
	const pinch = useRef<number | null>(null)

	// The 512 thumbnail is what appears while the original downloads.
	const placeholder = useThumbnail(
		{ bucketName, key: object.key, etag: object.etag, size: 512 },
		isThumbnailable(object.contentType, object.key),
		true,
	)

	useEffect(() => {
		const controller = new AbortController()
		let url: string | null = null

		downloadObject({ bucketName, key: object.key, signal: controller.signal })
			.then((blob) => {
				onBlob(blob)
				url = URL.createObjectURL(blob)
				setSource(url)
			})
			.catch((error: unknown) => {
				if (!controller.signal.aborted) onFailed(error)
			})

		return () => {
			controller.abort()
			if (url) URL.revokeObjectURL(url)
		}
	}, [bucketName, object.key, onFailed, onBlob])

	useEffect(() => {
		const element = stageRef.current
		if (!element) return

		const measure = () => setStage({ width: element.clientWidth, height: element.clientHeight })
		measure()
		const observer = new ResizeObserver(measure)
		observer.observe(element)

		return () => observer.disconnect()
	}, [])

	const imageRef = useRef(image)
	const stageSizeRef = useRef(stage)
	useEffect(() => {
		imageRef.current = image
		stageSizeRef.current = stage
	}, [image, stage])

	const zoomBy = useCallback((factor: number, anchor?: { x: number, y: number }) => {
		const size = imageRef.current
		const area = stageSizeRef.current
		if (!size) return

		setView((current) => zoomAround(current, area, size, factor, anchor ?? { x: area.width / 2, y: area.height / 2 }))
	}, [])

	useEffect(() => {
		controls.current = {
			zoom: (factor) => zoomBy(factor),
			fit: () => setView(FIT),
			actual: () => {
				const size = imageRef.current
				const area = stageSizeRef.current
				if (!size) return
				setView((current) => zoomAround(current, area, size, 1, { x: area.width / 2, y: area.height / 2 }, true))
			},
		}
		return () => { controls.current = null }
	}, [controls, zoomBy])

	// React registers wheel listeners as passive, which would make preventDefault (needed so the
	// page does not scroll while zooming) a no-op - hence the native listener.
	useEffect(() => {
		const element = stageRef.current
		if (!element) return

		const onWheel = (event: WheelEvent) => {
			event.preventDefault()
			const rect = element.getBoundingClientRect()
			zoomBy(Math.exp(-event.deltaY * 0.0015), { x: event.clientX - rect.left, y: event.clientY - rect.top })
		}
		element.addEventListener('wheel', onWheel, { passive: false })

		return () => element.removeEventListener('wheel', onWheel)
	}, [zoomBy])

	const onPointerDown = (event: React.PointerEvent) => {
		event.currentTarget.setPointerCapture(event.pointerId)
		pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
		if (pointers.current.size === 2) {
			const [first, second] = [...pointers.current.values()]
			pinch.current = Math.hypot(first.x - second.x, first.y - second.y)
		}
	}

	const onPointerMove = (event: React.PointerEvent) => {
		const previous = pointers.current.get(event.pointerId)
		if (!previous || !image) return

		pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
		const rect = event.currentTarget.getBoundingClientRect()

		if (pointers.current.size === 2 && pinch.current) {
			const [first, second] = [...pointers.current.values()]
			const distance = Math.hypot(first.x - second.x, first.y - second.y)
			const anchor = { x: (first.x + second.x) / 2 - rect.left, y: (first.y + second.y) / 2 - rect.top }
			const factor = distance / pinch.current
			pinch.current = distance
			zoomBy(factor, anchor)
			return
		}

		const dx = event.clientX - previous.x
		const dy = event.clientY - previous.y
		setView((current) => {
			if (current.fit) return current // nothing to pan while the whole image is visible
			return clamp({ ...current, x: current.x + dx, y: current.y + dy }, stage, image)
		})
	}

	const onPointerUp = (event: React.PointerEvent) => {
		pointers.current.delete(event.pointerId)
		pinch.current = null
	}

	const onDoubleClick = (event: React.MouseEvent) => {
		if (!image) return

		const rect = event.currentTarget.getBoundingClientRect()
		const anchor = { x: event.clientX - rect.left, y: event.clientY - rect.top }
		setView((current) => (current.fit ? zoomAround(current, stage, image, 1, anchor, true) : FIT))
	}

	const rendered = image ? resolve(view, stage, image) : null
	const zoomable = rendered !== null && !rendered.fit
	const renderedScale = rendered?.scale

	useEffect(() => {
		if (renderedScale !== undefined) onScale(renderedScale)
	}, [renderedScale, onScale])

	return (
		<div
			ref={stageRef}
			className={`viewer-stage${zoomable ? ' zoomed' : ''}`}
			onPointerDown={onPointerDown}
			onPointerMove={onPointerMove}
			onPointerUp={onPointerUp}
			onPointerCancel={onPointerUp}
			onDoubleClick={onDoubleClick}
		>
			{!image && placeholder.url && (
				<img className="viewer-placeholder" src={placeholder.url} alt="" draggable={false} />
			)}
			{!image && !broken && <p className="viewer-status muted">{t('common.loading')}</p>}
			{broken && <p className="viewer-status error">{t('viewer.imageFailed')}</p>}

			{source && !broken && (
				<img
					className="viewer-image"
					src={source}
					alt={baseName(object.key)}
					draggable={false}
					style={rendered && image
						? {
							width: image.width,
							height: image.height,
							transform: `translate(${rendered.x}px, ${rendered.y}px) scale(${rendered.scale})`,
						}
						: { visibility: 'hidden' }}
					onLoad={(event) => {
						const element = event.currentTarget
						// An SVG without intrinsic size reports 0; give it something sensible to fit.
						const size = { width: element.naturalWidth || 800, height: element.naturalHeight || 600 }
						setImage(size)
						onDimensions(size)
					}}
					onError={() => setBroken(true)}
				/>
			)}
		</div>
	)
}

/** Near full-screen viewer for the images of the current listing page: zoom, pan, and
 *  previous/next through the same list. */
export function ImageViewer({ bucketName, object, gallery, onNavigate, onClose }: {
	bucketName: string
	object: ObjectItem
	gallery: ObjectItem[]
	onNavigate: (object: ObjectItem) => void
	onClose: () => void
}) {
	const { t } = useI18n()
	const [dimensions, setDimensions] = useState<(Size & { key: string }) | null>(null)
	const [error, setError] = useState<unknown>(null)
	const [percent, setPercent] = useState(100)
	const blob = useRef<{ key: string, blob: Blob } | null>(null)
	const controls = useRef<ViewerControls | null>(null)

	const index = gallery.findIndex((item) => item.key === object.key)
	const previous = index > 0 ? gallery[index - 1] : undefined
	const next = index >= 0 && index < gallery.length - 1 ? gallery[index + 1] : undefined

	const onDimensions = useCallback((size: Size) => setDimensions({ ...size, key: object.key }), [object.key])
	const onFailed = useCallback((err: unknown) => setError(err), [])
	const onScale = useCallback((scale: number) => setPercent(Math.round(scale * 100)), [])
	const onBlob = useCallback((loaded: Blob) => { blob.current = { key: object.key, blob: loaded } }, [object.key])

	// Warm the 512 thumbnails of the neighbours so stepping with the arrow keys shows a
	// placeholder at once. Originals are deliberately not prefetched.
	const previousKey = previous?.key
	const nextKey = next?.key
	useEffect(() => {
		const controller = new AbortController()
		for (const neighbour of [previous, next]) {
			if (!neighbour || !isThumbnailable(neighbour.contentType, neighbour.key)) continue

			loadThumbnail(
				{ bucketName, key: neighbour.key, etag: neighbour.etag, size: 512 },
				controller.signal,
			).catch(() => { /* a warm-up that fails changes nothing */ })
		}

		return () => controller.abort()
		// eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by the neighbours' keys
	}, [bucketName, previousKey, nextKey])

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === 'ArrowLeft' && previous) onNavigate(previous)
			else if (event.key === 'ArrowRight' && next) onNavigate(next)
			else if (event.key === '+' || event.key === '=') controls.current?.zoom(ZOOM_STEP)
			else if (event.key === '-') controls.current?.zoom(1 / ZOOM_STEP)
			else if (event.key === '0') controls.current?.fit()
		}
		document.addEventListener('keydown', onKeyDown)
		return () => document.removeEventListener('keydown', onKeyDown)
	}, [previous, next, onNavigate])

	const download = async () => {
		setError(null)
		try {
			const cached = blob.current?.key === object.key ? blob.current.blob : null
			saveBlob(cached ?? await downloadObject({ bucketName, key: object.key }), baseName(object.key))
		} catch (err) {
			setError(err)
		}
	}

	const current = dimensions?.key === object.key ? dimensions : null

	return (
		<Modal
			fullscreen
			title={baseName(object.key)}
			onClose={onClose}
			footer={(
				<div className="viewer-bar">
					<div className="viewer-info muted">
						{index >= 0 && <span>{t('viewer.counter', { index: index + 1, total: gallery.length })}</span>}
						{current && <span>{t('viewer.dimensions', { width: current.width, height: current.height })}</span>}
						<span>{formatSize(object.size)}</span>
					</div>
					<div className="row viewer-controls">
						<button title={t('viewer.zoomOut')} onClick={() => controls.current?.zoom(1 / ZOOM_STEP)}>−</button>
						<span className="viewer-zoom muted">{percent}%</span>
						<button title={t('viewer.zoomIn')} onClick={() => controls.current?.zoom(ZOOM_STEP)}>+</button>
						<button onClick={() => controls.current?.fit()}>{t('viewer.fit')}</button>
						<button onClick={() => controls.current?.actual()}>100%</button>
						<button className="primary" onClick={() => void download()}>{t('files.download')}</button>
					</div>
				</div>
			)}
		>
			<ErrorText error={error} />
			<ImageStage
				key={object.key}
				bucketName={bucketName}
				object={object}
				onDimensions={onDimensions}
				onFailed={onFailed}
				onScale={onScale}
				onBlob={onBlob}
				controls={controls}
			/>
			{previous && (
				<button className="viewer-nav prev" title={t('viewer.previous')} onClick={() => onNavigate(previous)}>‹</button>
			)}
			{next && (
				<button className="viewer-nav next" title={t('viewer.next')} onClick={() => onNavigate(next)}>›</button>
			)}
		</Modal>
	)
}
