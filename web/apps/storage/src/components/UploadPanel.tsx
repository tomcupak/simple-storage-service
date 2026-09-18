import { useCallback, useRef, useState } from 'react'

import { apiErrorKey } from '../api/errors'
import { uploadObject } from '../api/transfer'
import { useI18n } from '../i18n'
import { formatSize } from '../lib/format'

type UploadStatus = 'pending' | 'uploading' | 'done' | 'error'

interface QueueItem {
	id: string
	file: File
	progress: number
	status: UploadStatus
	error?: unknown
}

/** Drop zone plus the queue of what it is sending.
 *
 *  Files go up one at a time: the bytes stream straight to disk on the server, and a browser
 *  that opens six parallel PUTs would only make each of them slower while making the progress
 *  bars meaningless. */
export function UploadPanel({ bucketName, prefix, onUploaded }: {
	bucketName: string
	prefix: string
	onUploaded: () => void
}) {
	const { t } = useI18n()
	const [queue, setQueue] = useState<QueueItem[]>([])
	const [dragging, setDragging] = useState(false)
	const inputRef = useRef<HTMLInputElement>(null)
	const uploading = useRef(false)

	const update = useCallback((id: string, patch: Partial<QueueItem>) => {
		setQueue((items) => items.map((item) => (item.id === id ? { ...item, ...patch } : item)))
	}, [])

	const send = useCallback(async (items: QueueItem[]) => {
		// A second drop while the first batch is in flight just appends to the queue; the loop
		// below is the only place that uploads, so two of them must never run at once.
		if (uploading.current) return
		uploading.current = true

		try {
			for (const item of items) {
				update(item.id, { status: 'uploading', progress: 0 })
				try {
					await uploadObject({
						bucketName,
						key: `${prefix}${item.file.name}`,
						file: item.file,
						onProgress: (progress) => update(item.id, { progress }),
					})
					update(item.id, { status: 'done', progress: 100 })
				} catch (err) {
					update(item.id, { status: 'error', error: err })
				}
			}
		} finally {
			uploading.current = false
			onUploaded()
		}
	}, [bucketName, prefix, update, onUploaded])

	const enqueue = useCallback((files: File[]) => {
		if (files.length === 0) return

		const items: QueueItem[] = files.map((file) => ({
			id: `${file.name}:${file.size}:${Date.now()}:${Math.random()}`,
			file,
			progress: 0,
			status: 'pending',
		}))

		setQueue((current) => [...current, ...items])
		void send(items)
	}, [send])

	const onDrop = (event: React.DragEvent) => {
		event.preventDefault()
		setDragging(false)
		enqueue(Array.from(event.dataTransfer.files))
	}

	const done = queue.filter((item) => item.status === 'done' || item.status === 'error').length
	const active = queue.length > 0 && done < queue.length

	return (
		<div className="card upload-panel">
			<div
				className={`dropzone${dragging ? ' dragging' : ''}`}
				onDragOver={(event) => { event.preventDefault(); setDragging(true) }}
				onDragLeave={() => setDragging(false)}
				onDrop={onDrop}
				onClick={() => inputRef.current?.click()}
				role="button"
				tabIndex={0}
				onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') inputRef.current?.click() }}
			>
				<strong>{t('files.dropHere')}</strong>
				<span className="muted">{t('files.dropHint')}</span>
				<input
					ref={inputRef}
					type="file"
					multiple
					hidden
					onChange={(event) => {
						enqueue(Array.from(event.target.files ?? []))
						// Clearing it lets the same file be picked again right after.
						event.target.value = ''
					}}
				/>
			</div>

			{queue.length > 0 && (
				<div className="upload-queue">
					<div className="row space-between">
						<span className="muted">
							{active ? t('files.uploading', { done, total: queue.length }) : t('files.uploadDone')}
						</span>
						{!active && <button onClick={() => setQueue([])}>{t('common.close')}</button>}
					</div>

					{queue.map((item) => (
						<div key={item.id} className="upload-item">
							<div className="row space-between">
								<span className="ellipsis">{item.file.name}</span>
								<span className="muted">{formatSize(item.file.size)}</span>
							</div>
							<div className={`progress${item.status === 'error' ? ' failed' : ''}`}>
								<div className="progress-bar" style={{ width: `${item.status === 'done' ? 100 : item.progress}%` }} />
							</div>
							{item.status === 'error' && <span className="error">{t(apiErrorKey(item.error))}</span>}
						</div>
					))}
				</div>
			)}
		</div>
	)
}
