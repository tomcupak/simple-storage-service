import { useState } from 'react'

import { api } from '../api/client'
import { useI18n } from '../i18n'
import { baseName, formatDate } from '../lib/format'
import { ErrorText } from './ErrorText'
import { Modal } from './Modal'

const VALIDITY_OPTIONS = [
	{ seconds: 3600, labelKey: 'files.shareHour' },
	{ seconds: 24 * 3600, labelKey: 'files.shareDay' },
	{ seconds: 7 * 24 * 3600, labelKey: 'files.shareWeek' },
] as const

export function ShareLinkDialog({ bucketName, objectKey, versionId, onClose }: {
	bucketName: string
	objectKey: string
	versionId?: string
	onClose: () => void
}) {
	const { t } = useI18n()
	const [expiresIn, setExpiresIn] = useState<number>(VALIDITY_OPTIONS[0].seconds)
	const [link, setLink] = useState<{ url: string, expiresAt: string } | null>(null)
	const [error, setError] = useState<unknown>(null)
	const [copied, setCopied] = useState(false)
	const [busy, setBusy] = useState(false)

	const generate = async () => {
		setBusy(true)
		setError(null)
		setCopied(false)
		try {
			setLink(await api.presignObject(bucketName, { key: objectKey, expiresIn, versionId }))
		} catch (err) {
			setError(err)
		} finally {
			setBusy(false)
		}
	}

	const copy = async () => {
		if (!link) return
		try {
			await navigator.clipboard.writeText(link.url)
			setCopied(true)
		} catch {
			// Clipboard access can be refused (insecure context, denied permission); the input
			// below still holds the link, so selecting it by hand remains possible.
			setCopied(false)
		}
	}

	return (
		<Modal
			title={t('files.shareTitle', { name: baseName(objectKey) })}
			onClose={onClose}
			footer={(
				<>
					<button onClick={onClose}>{t('common.close')}</button>
					<button className="primary" disabled={busy} onClick={() => void generate()}>{t('files.shareGenerate')}</button>
				</>
			)}
		>
			<div className="field">
				<label htmlFor="share-validity">{t('files.shareValidity')}</label>
				<select id="share-validity" value={expiresIn} onChange={(event) => setExpiresIn(Number(event.target.value))}>
					{VALIDITY_OPTIONS.map((option) => (
						<option key={option.seconds} value={option.seconds}>{t(option.labelKey)}</option>
					))}
				</select>
			</div>

			<ErrorText error={error} />

			{link && (
				<>
					<div className="field">
						<input readOnly value={link.url} onFocus={(event) => event.target.select()} />
					</div>
					<div className="row">
						<button onClick={() => void copy()}>{copied ? t('common.copied') : t('common.copy')}</button>
						<span className="muted">{t('files.shareExpires', { date: formatDate(link.expiresAt) })}</span>
					</div>
				</>
			)}

			<p className="muted">{t('files.shareNote')}</p>
		</Modal>
	)
}
