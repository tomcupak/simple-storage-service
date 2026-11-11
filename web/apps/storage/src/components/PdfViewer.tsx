import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist'
import { useCallback, useEffect, useRef, useState } from 'react'

import { downloadObject, saveBlob } from '../api/transfer'
import { type TranslationKey, useI18n } from '../i18n'
import { baseName } from '../lib/format'
import { ErrorText } from './ErrorText'
import { Modal } from './Modal'

const PAGE_GAP = 12
const MIN_ZOOM = 0.5
const MAX_ZOOM = 4
const ZOOM_STEP = 1.25

interface PageSize { width: number, height: number }

function PdfPage({ page, size, scale, number }: {
	page: PDFPageProxy
	size: PageSize
	scale: number
	number: number
}) {
	const holder = useRef<HTMLDivElement>(null)
	const canvas = useRef<HTMLCanvasElement>(null)
	const [visible, setVisible] = useState(false)

	const width = Math.floor(size.width * scale)
	const height = Math.floor(size.height * scale)

	useEffect(() => {
		const element = holder.current
		if (!element) return

		// The scroll container is the nearest scrollable ancestor, so the default root would
		// be the viewport and still work, but a generous margin renders just ahead of scrolling.
		const observer = new IntersectionObserver((observed) => {
			setVisible(observed.some((item) => item.isIntersecting))
		}, { rootMargin: '600px 0px' })
		observer.observe(element)

		return () => observer.disconnect()
	}, [])

	useEffect(() => {
		const element = canvas.current
		if (!element) return

		if (!visible) {
			// Off-screen pages give their pixels back; a long PDF would otherwise hold them all.
			element.width = 0
			element.height = 0
			return
		}

		const ratio = window.devicePixelRatio || 1
		const viewport = page.getViewport({ scale: scale * ratio })
		element.width = Math.floor(viewport.width)
		element.height = Math.floor(viewport.height)

		let task: RenderTask | null = page.render({ canvas: element, viewport })
		task.promise.catch(() => { /* a cancelled render rejects; nothing to report */ })

		return () => {
			task?.cancel()
			task = null
		}
	}, [visible, page, scale])

	return (
		<div ref={holder} className="pdf-page" data-page={number} style={{ width, height }}>
			<canvas ref={canvas} style={{ width, height }} />
		</div>
	)
}

export function PdfViewer({ bucketName, objectKey, onClose }: {
	bucketName: string
	objectKey: string
	onClose: () => void
}) {
	const { t } = useI18n()
	const scroller = useRef<HTMLDivElement>(null)
	const payload = useRef<Blob | null>(null)
	const [pages, setPages] = useState<{ proxy: PDFPageProxy, size: PageSize }[]>([])
	const [loadFailure, setLoadFailure] = useState<TranslationKey | null>(null)
	const [error, setError] = useState<unknown>(null)
	const [loading, setLoading] = useState(true)
	const [containerWidth, setContainerWidth] = useState(0)
	const [zoom, setZoom] = useState(1)
	const [current, setCurrent] = useState(1)
	const [pageInput, setPageInput] = useState('1')

	useEffect(() => {
		const controller = new AbortController()
		let document: PDFDocumentProxy | null = null
		let destroyTask: (() => Promise<void>) | null = null

		const load = async () => {
			try {
				const [blob, { pdfjs }] = await Promise.all([
					downloadObject({ bucketName, key: objectKey, signal: controller.signal }),
					import('../lib/pdfjs'),
				])
				payload.current = blob
				const task = pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) })
				destroyTask = () => task.destroy()
				document = await task.promise
				if (controller.signal.aborted) return

				const proxies = await Promise.all(
					Array.from({ length: document.numPages }, (_, index) => document?.getPage(index + 1)),
				)
				if (controller.signal.aborted) return

				setPages(proxies.flatMap((proxy) => {
					if (!proxy) return []
					const viewport = proxy.getViewport({ scale: 1 })
					return [{ proxy, size: { width: viewport.width, height: viewport.height } }]
				}))
			} catch (err) {
				if (controller.signal.aborted) return

				const name = (err as { name?: string } | null)?.name
				if (name === 'PasswordException') setLoadFailure('pdf.password')
				else if (name === 'InvalidPDFException' || name === 'FormatError' || name === 'MissingPDFException') setLoadFailure('pdf.broken')
				else if ((err as { isAxiosError?: boolean } | null)?.isAxiosError) setError(err)
				else setLoadFailure('pdf.broken')
			} finally {
				if (!controller.signal.aborted) setLoading(false)
			}
		}
		void load()

		return () => {
			controller.abort()
			// Destroying the loading task also destroys the document and stops the worker.
			void destroyTask?.()
		}
	}, [bucketName, objectKey])

	useEffect(() => {
		const element = scroller.current
		if (!element) return

		const measure = () => setContainerWidth(element.clientWidth)
		measure()
		const observer = new ResizeObserver(measure)
		observer.observe(element)

		return () => observer.disconnect()
	}, [])

	// Fit-to-width is the 100% of this viewer, so every page gets its own scale: pages of a
	// document do not all have the same width.
	const available = Math.max(0, containerWidth - 2 * PAGE_GAP)
	const scaleFor = (size: PageSize) => (size.width > 0 ? (available / size.width) * zoom : 1)

	const onScroll = useCallback(() => {
		const element = scroller.current
		if (!element) return

		const line = element.scrollTop + element.clientHeight / 3
		let found = 1
		for (const node of element.querySelectorAll<HTMLElement>('[data-page]')) {
			if (node.offsetTop > line) break
			found = Number(node.dataset.page)
		}
		setCurrent(found)
		setPageInput(String(found))
	}, [])

	const goTo = (number: number) => {
		const element = scroller.current
		const target = Math.min(pages.length, Math.max(1, number))
		const node = element?.querySelector<HTMLElement>(`[data-page="${target}"]`)
		if (!element || !node) return

		element.scrollTo({ top: node.offsetTop - PAGE_GAP })
		setCurrent(target)
		setPageInput(String(target))
	}

	const changeZoom = (factor: number) => setZoom((value) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value * factor)))

	const download = async () => {
		setError(null)
		try {
			saveBlob(payload.current ?? await downloadObject({ bucketName, key: objectKey }), baseName(objectKey))
		} catch (err) {
			setError(err)
		}
	}

	return (
		<Modal
			fullscreen
			title={baseName(objectKey)}
			onClose={onClose}
			footer={(
				<div className="viewer-bar">
					<div className="row viewer-controls">
						<button disabled={current <= 1} title={t('viewer.previous')} onClick={() => goTo(current - 1)}>‹</button>
						<form
							className="row pdf-page-form"
							onSubmit={(event) => { event.preventDefault(); goTo(Number.parseInt(pageInput, 10) || 1) }}
						>
							<input
								className="pdf-page-input"
								inputMode="numeric"
								aria-label={t('pdf.goToPage')}
								value={pageInput}
								onChange={(event) => setPageInput(event.target.value)}
							/>
							<span className="muted">{t('pdf.pageCount', { total: pages.length })}</span>
						</form>
						<button disabled={current >= pages.length} title={t('viewer.next')} onClick={() => goTo(current + 1)}>›</button>
					</div>
					<div className="row viewer-controls">
						<button title={t('viewer.zoomOut')} disabled={zoom <= MIN_ZOOM} onClick={() => changeZoom(1 / ZOOM_STEP)}>−</button>
						<span className="viewer-zoom muted">{Math.round(zoom * 100)}%</span>
						<button title={t('viewer.zoomIn')} disabled={zoom >= MAX_ZOOM} onClick={() => changeZoom(ZOOM_STEP)}>+</button>
						<button onClick={() => setZoom(1)}>{t('pdf.fitWidth')}</button>
						<button className="primary" onClick={() => void download()}>{t('files.download')}</button>
					</div>
				</div>
			)}
		>
			<ErrorText error={error} />
			{loadFailure && <p className="error pdf-status">{t(loadFailure)}</p>}
			{loading && <p className="muted pdf-status">{t('common.loading')}</p>}
			<div ref={scroller} className="pdf-scroller" onScroll={onScroll}>
				{pages.map(({ proxy, size }, index) => (
					<PdfPage key={index} page={proxy} size={size} scale={scaleFor(size)} number={index + 1} />
				))}
			</div>
		</Modal>
	)
}
