import { useEffect, useState } from 'react'

import { type ObjectItem } from '../api/client'
import { downloadObject, saveBlob } from '../api/transfer'
import { useI18n } from '../i18n'
import { type PreviewKind, previewKind } from '../lib/fileType'
import { baseName, formatSize } from '../lib/format'
import { ErrorText } from './ErrorText'
import { ImageViewer } from './ImageViewer'
import { Modal } from './Modal'
import { PdfViewer } from './PdfViewer'

/** Anything larger is offered as a download instead - a preview is meant to be a glance, and a
 *  100 MB "text file" would freeze the tab. Images and PDFs get more room because the browser
 *  decodes them natively / page by page. */
const MAX_TEXT_BYTES = 5 * 1024 * 1024
const MAX_IMAGE_BYTES = 50 * 1024 * 1024
const MAX_PDF_BYTES = 100 * 1024 * 1024

function limitFor(kind: PreviewKind): number {
	if (kind === 'image') return MAX_IMAGE_BYTES
	if (kind === 'pdf') return MAX_PDF_BYTES

	return MAX_TEXT_BYTES
}

export function ObjectPreview({ bucketName, object, gallery, onNavigate, onClose }: {
	bucketName: string
	object: ObjectItem
	/** The previewable images of the current listing page, in display order. */
	gallery: ObjectItem[]
	onNavigate: (object: ObjectItem) => void
	onClose: () => void
}) {
	const kind = previewKind(object.contentType, object.key)
	const tooLarge = object.size > limitFor(kind)

	if (kind === 'image' && !tooLarge) {
		return <ImageViewer bucketName={bucketName} object={object} gallery={gallery} onNavigate={onNavigate} onClose={onClose} />
	}
	if (kind === 'pdf' && !tooLarge) {
		return <PdfViewer bucketName={bucketName} objectKey={object.key} onClose={onClose} />
	}

	return <TextPreview bucketName={bucketName} object={object} kind={kind} tooLarge={tooLarge} onClose={onClose} />
}

function TextPreview({ bucketName, object, kind, tooLarge, onClose }: {
	bucketName: string
	object: ObjectItem
	kind: PreviewKind
	tooLarge: boolean
	onClose: () => void
}) {
	const { t } = useI18n()
	const objectKey = object.key

	const [text, setText] = useState<string | null>(null)
	const [error, setError] = useState<unknown>(null)
	const [loading, setLoading] = useState(false)

	useEffect(() => {
		if (kind !== 'text' || tooLarge) return

		const controller = new AbortController()

		const load = async () => {
			setLoading(true)
			setError(null)
			try {
				const payload = await downloadObject({ bucketName, key: objectKey, signal: controller.signal })
				if (!controller.signal.aborted) setText(await payload.text())
			} catch (err) {
				if (!controller.signal.aborted) setError(err)
			} finally {
				if (!controller.signal.aborted) setLoading(false)
			}
		}

		void load()

		return () => controller.abort()
	}, [bucketName, objectKey, kind, tooLarge])

	const download = async () => {
		try {
			saveBlob(await downloadObject({ bucketName, key: objectKey }), baseName(objectKey))
		} catch (err) {
			setError(err)
		}
	}

	return (
		<Modal
			wide
			title={t('preview.title', { name: baseName(objectKey) })}
			onClose={onClose}
			footer={<button className="primary" onClick={() => void download()}>{t('files.download')}</button>}
		>
			<ErrorText error={error} />

			{tooLarge && <p className="muted">{t('preview.tooLarge', { size: formatSize(object.size) })}</p>}
			{!tooLarge && kind === 'unsupported' && <p className="muted">{t('preview.unsupported')}</p>}
			{loading && <p className="muted">{t('common.loading')}</p>}

			{!tooLarge && kind === 'text' && text !== null && (
				<pre className="preview-text">{text}</pre>
			)}
		</Modal>
	)
}
