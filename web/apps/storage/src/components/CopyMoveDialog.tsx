import { useState } from 'react'

import { api, type BucketItem } from '../api/client'
import { useI18n } from '../i18n'
import { baseName } from '../lib/format'
import { ErrorText } from './ErrorText'
import { Modal } from './Modal'

/** One dialog for copy, rename and move - they are the same server-side operation, with
 *  `move` deciding whether the source survives. A source key ending in `/` re-keys the whole
 *  folder, which is what makes renaming a folder a single call. */
export function CopyMoveDialog({ bucketName, sourceKey, move, buckets, onClose, onDone }: {
	bucketName: string
	sourceKey: string
	move: boolean
	buckets: BucketItem[]
	onClose: () => void
	onDone: () => void
}) {
	const { t } = useI18n()
	const [targetKey, setTargetKey] = useState(sourceKey)
	const [targetBucket, setTargetBucket] = useState('')
	const [error, setError] = useState<unknown>(null)
	const [busy, setBusy] = useState(false)

	const submit = async (event: React.FormEvent) => {
		event.preventDefault()
		setBusy(true)
		setError(null)
		try {
			await api.copyObject(bucketName, {
				sourceKey,
				targetKey,
				targetBucket: targetBucket || undefined,
				move,
			})
			onDone()
			onClose()
		} catch (err) {
			setError(err)
		} finally {
			setBusy(false)
		}
	}

	const unchanged = targetKey === sourceKey && !targetBucket

	return (
		<Modal
			title={t(move ? 'files.moveTitle' : 'files.copyTitle', { name: baseName(sourceKey) || sourceKey })}
			onClose={onClose}
			footer={(
				<>
					<button onClick={onClose}>{t('common.cancel')}</button>
					<button className="primary" disabled={busy || !targetKey || unchanged} onClick={(event) => void submit(event)}>
						{t(move ? 'files.move' : 'common.copy')}
					</button>
				</>
			)}
		>
			<form onSubmit={(event) => void submit(event)}>
				<div className="field">
					<label htmlFor="copy-target-key">{t('files.targetKey')}</label>
					<input id="copy-target-key" value={targetKey} onChange={(event) => setTargetKey(event.target.value)} autoFocus />
				</div>

				<div className="field">
					<label htmlFor="copy-target-bucket">{t('files.targetBucket')}</label>
					<select id="copy-target-bucket" value={targetBucket} onChange={(event) => setTargetBucket(event.target.value)}>
						<option value="">{t('files.sameBucket')}</option>
						{buckets.filter((bucket) => bucket.name !== bucketName).map((bucket) => (
							<option key={bucket.guid} value={bucket.name}>{bucket.name}</option>
						))}
					</select>
				</div>
			</form>

			<ErrorText error={error} />
		</Modal>
	)
}
