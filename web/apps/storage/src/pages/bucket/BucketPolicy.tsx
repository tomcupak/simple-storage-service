import { useCallback, useEffect, useState } from 'react'

import { api } from '../../api/client'
import { ErrorText } from '../../components/ErrorText'
import { useI18n } from '../../i18n'
import type { TranslationKey } from '../../i18n/translations'

/** Starting points for the policies people actually write. They are dropped into the editor
 *  rather than applied directly, so the document stays reviewable before it is saved. */
const TEMPLATES: { labelKey: TranslationKey, build: (bucketName: string) => unknown }[] = [
	{
		labelKey: 'policy.template.publicRead',
		build: (bucketName) => ({
			Version: '2012-10-17',
			Statement: [{
				Sid: 'PublicReadObjects',
				Effect: 'Allow',
				Principal: '*',
				Action: ['s3:GetObject'],
				Resource: [`arn:aws:s3:::${bucketName}/*`],
			}],
		}),
	},
	{
		labelKey: 'policy.template.readOnlyUser',
		build: (bucketName) => ({
			Version: '2012-10-17',
			Statement: [{
				Sid: 'ReadOnlyUser',
				Effect: 'Allow',
				Principal: { AWS: ['arn:aws:iam::storage:user/REPLACE-WITH-USER-GUID'] },
				Action: ['s3:GetObject', 's3:ListBucket'],
				Resource: [`arn:aws:s3:::${bucketName}`, `arn:aws:s3:::${bucketName}/*`],
			}],
		}),
	},
	{
		labelKey: 'policy.template.requireTls',
		build: (bucketName) => ({
			Version: '2012-10-17',
			Statement: [{
				Sid: 'DenyInsecureTransport',
				Effect: 'Deny',
				Principal: '*',
				Action: ['s3:*'],
				Resource: [`arn:aws:s3:::${bucketName}`, `arn:aws:s3:::${bucketName}/*`],
				Condition: { Bool: { 'aws:SecureTransport': 'false' } },
			}],
		}),
	},
]

export function BucketPolicy({ bucketName }: { bucketName: string }) {
	const { t } = useI18n()
	const [document, setDocument] = useState('')
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState<unknown>(null)
	const [jsonError, setJsonError] = useState<string | null>(null)
	const [saved, setSaved] = useState(false)
	const [hasPolicy, setHasPolicy] = useState(false)

	const refresh = useCallback(async () => {
		setLoading(true)
		setError(null)
		try {
			const response = await api.getBucketPolicy(bucketName)
			setHasPolicy(Boolean(response.document))
			setDocument(response.document ? JSON.stringify(response.document, null, 2) : '')
		} catch (err) {
			setError(err)
		} finally {
			setLoading(false)
		}
	}, [bucketName])

	useEffect(() => { void refresh() }, [refresh])

	const save = async () => {
		setError(null)
		setJsonError(null)
		setSaved(false)

		// An empty editor means "no policy", which is the delete endpoint rather than an empty document.
		if (!document.trim()) {
			try {
				await api.deleteBucketPolicy(bucketName)
				setSaved(true)
				await refresh()
			} catch (err) {
				setError(err)
			}
			return
		}

		let parsed: unknown
		try {
			parsed = JSON.parse(document)
		} catch (err) {
			setJsonError(t('policy.invalidJson', { message: err instanceof Error ? err.message : '' }))
			return
		}

		try {
			await api.setBucketPolicy(bucketName, parsed as Record<string, unknown>)
			setSaved(true)
			await refresh()
		} catch (err) {
			setError(err)
		}
	}

	const remove = async () => {
		if (!confirm(t('policy.deleteConfirm'))) return
		setError(null)
		try {
			await api.deleteBucketPolicy(bucketName)
			await refresh()
		} catch (err) {
			setError(err)
		}
	}

	return (
		<>
			<div className="row space-between wrap">
				<h2>{t('policy.title')}</h2>
				<div className="row wrap">
					<span className="muted">{t('policy.templates')}:</span>
					{TEMPLATES.map((template) => (
						<button
							key={template.labelKey}
							onClick={() => {
								setDocument(JSON.stringify(template.build(bucketName), null, 2))
								setJsonError(null)
								setSaved(false)
							}}
						>
							{t(template.labelKey)}
						</button>
					))}
				</div>
			</div>

			<p className="muted">{t('policy.hint')}</p>
			{!loading && !hasPolicy && !document && <p className="muted">{t('policy.empty')}</p>}

			<textarea
				className="policy-editor"
				spellCheck={false}
				rows={22}
				value={document}
				placeholder={loading ? t('common.loading') : '{ "Version": "2012-10-17", "Statement": [] }'}
				onChange={(event) => { setDocument(event.target.value); setJsonError(null); setSaved(false) }}
			/>

			{jsonError && <p className="error">{jsonError}</p>}
			<ErrorText error={error} />
			{saved && <p className="success">{t('common.saved')}</p>}

			<div className="row">
				<button className="primary" onClick={() => void save()}>{t('common.save')}</button>
				<button className="danger" disabled={!hasPolicy} onClick={() => void remove()}>{t('common.delete')}</button>
			</div>
		</>
	)
}
