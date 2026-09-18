import { useEffect, useState } from 'react'

import { downloadObject, saveBlob } from '../api/transfer'
import { useI18n } from '../i18n'
import { baseName, formatSize } from '../lib/format'
import { ErrorText } from './ErrorText'
import { Modal } from './Modal'

/** Anything larger is offered as a download instead - a preview is meant to be a glance, and a
 *  100 MB "text file" would freeze the tab. */
const MAX_PREVIEW_BYTES = 5 * 1024 * 1024

type PreviewKind = 'image' | 'pdf' | 'text' | 'unsupported'

function previewKind(contentType: string | null | undefined, key: string): PreviewKind {
	const type = (contentType ?? '').toLowerCase()

	if (type.startsWith('image/')) return 'image'
	if (type === 'application/pdf') return 'pdf'
	if (type.startsWith('text/') || /^application\/(json|xml|javascript|x-yaml)/.test(type)) return 'text'
	// Some clients upload without a usable type, so the extension gets a say as well.
	if (/\.(txt|md|json|xml|ya?ml|csv|log|ini|conf|ts|tsx|js|css|html?)$/i.test(key)) return 'text'

	return 'unsupported'
}

export function ObjectPreview({ bucketName, objectKey, contentType, size, onClose }: {
	bucketName: string
	objectKey: string
	contentType: string | null | undefined
	size: number
	onClose: () => void
}) {
	const { t } = useI18n()
	const kind = previewKind(contentType, objectKey)
	const tooLarge = size > MAX_PREVIEW_BYTES

	const [blob, setBlob] = useState<Blob | null>(null)
	const [objectUrl, setObjectUrl] = useState<string | null>(null)
	const [text, setText] = useState<string | null>(null)
	const [error, setError] = useState<unknown>(null)
	const [loading, setLoading] = useState(false)

	useEffect(() => {
		if (kind === 'unsupported' || tooLarge) return

		let revoked = false
		let url: string | null = null

		const load = async () => {
			setLoading(true)
			setError(null)
			try {
				const payload = await downloadObject({ bucketName, key: objectKey })
				if (revoked) return

				setBlob(payload)
				if (kind === 'text') {
					setText(await payload.text())
				} else {
					url = URL.createObjectURL(payload)
					setObjectUrl(url)
				}
			} catch (err) {
				setError(err)
			} finally {
				setLoading(false)
			}
		}

		void load()

		return () => {
			revoked = true
			if (url) URL.revokeObjectURL(url)
		}
	}, [bucketName, objectKey, kind, tooLarge])

	const download = async () => {
		try {
			const payload = blob ?? await downloadObject({ bucketName, key: objectKey })
			saveBlob(payload, baseName(objectKey))
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

			{tooLarge && <p className="muted">{t('preview.tooLarge', { size: formatSize(size) })}</p>}
			{!tooLarge && kind === 'unsupported' && <p className="muted">{t('preview.unsupported')}</p>}
			{loading && <p className="muted">{t('common.loading')}</p>}

			{!tooLarge && kind === 'image' && objectUrl && (
				<img className="preview-image" src={objectUrl} alt={baseName(objectKey)} />
			)}
			{!tooLarge && kind === 'pdf' && objectUrl && (
				<iframe className="preview-frame" src={objectUrl} title={baseName(objectKey)} />
			)}
			{!tooLarge && kind === 'text' && text !== null && (
				<pre className="preview-text">{text}</pre>
			)}
		</Modal>
	)
}
