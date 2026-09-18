import { useState } from 'react'

import { api, BucketAcl, type BucketDetail, BucketVersioning, UserRole } from '../../api/client'
import { ErrorText } from '../../components/ErrorText'
import { useI18n } from '../../i18n'
import { formatSize } from '../../lib/format'
import { useAuth } from '../../store/auth'

/** S3 never goes back to unversioned, so `disabled` is a state a bucket can be in but not one
 *  it can be put into - it is offered only while it is still the current value. */
const VERSIONING_CHOICES = [BucketVersioning.enabled, BucketVersioning.suspended]

export function BucketSettings({ bucket, onChanged }: { bucket: BucketDetail, onChanged: () => void }) {
	const { t } = useI18n()
	const { user } = useAuth()
	const isAdmin = user?.role === UserRole.admin

	const [error, setError] = useState<unknown>(null)
	const [saved, setSaved] = useState(false)
	const [quota, setQuota] = useState(bucket.quotaBytes === null ? '' : String(bucket.quotaBytes))

	const run = async (action: () => Promise<unknown>) => {
		setError(null)
		setSaved(false)
		try {
			await action()
			setSaved(true)
			onChanged()
		} catch (err) {
			setError(err)
		}
	}

	return (
		<>
			<ErrorText error={error} />
			{saved && <p className="success">{t('common.saved')}</p>}

			<div className="settings-grid">
				<div className="card section">
					<h2>{t('settings.title')}</h2>

					<div className="field">
						<label htmlFor="bucket-region">{t('settings.region')}</label>
						<input id="bucket-region" value={bucket.region} readOnly />
					</div>

					<div className="field">
						<label htmlFor="bucket-acl">{t('settings.acl')}</label>
						<select
							id="bucket-acl"
							value={bucket.acl}
							onChange={(event) => void run(() => api.setBucketAcl(bucket.name, { acl: event.target.value as BucketAcl }))}
						>
							{Object.values(BucketAcl).map((acl) => <option key={acl} value={acl}>{acl}</option>)}
						</select>
					</div>

					<div className="field">
						<label htmlFor="bucket-versioning">{t('settings.versioning')}</label>
						<select
							id="bucket-versioning"
							value={bucket.versioning}
							onChange={(event) => void run(() => api.setBucketVersioning(bucket.name, { versioning: event.target.value as BucketVersioning }))}
						>
							{bucket.versioning === BucketVersioning.disabled && (
								<option value={BucketVersioning.disabled}>{BucketVersioning.disabled}</option>
							)}
							{VERSIONING_CHOICES.map((value) => <option key={value} value={value}>{value}</option>)}
						</select>
						<span className="muted">{t('settings.versioningHint')}</span>
					</div>

					<div className="field">
						<label htmlFor="bucket-quota">{t('settings.quotaBytes')}</label>
						<div className="row">
							<input
								id="bucket-quota"
								type="number"
								min={0}
								value={quota}
								disabled={!isAdmin}
								placeholder={t('common.unlimited')}
								onChange={(event) => setQuota(event.target.value)}
							/>
							<button
								disabled={!isAdmin}
								onClick={() => void run(() => api.setBucketQuota(bucket.name, { quotaBytes: quota === '' ? null : Number(quota) }))}
							>
								{t('common.save')}
							</button>
						</div>
						<span className="muted">{t('settings.quotaHint')}</span>
					</div>
				</div>

				<div className="card section">
					<h2>{t('settings.usage')}</h2>
					<dl className="stats">
						<dt>{t('settings.objectCount')}</dt>
						<dd>{bucket.usage.objectCount}</dd>
						<dt>{t('settings.versionCount')}</dt>
						<dd>{bucket.usage.versionCount}</dd>
						<dt>{t('settings.multipartBytes')}</dt>
						<dd>{formatSize(bucket.usage.multipartBytes)}</dd>
						<dt>{t('settings.totalBytes')}</dt>
						<dd>
							{formatSize(bucket.usage.totalBytes)}
							<span className="muted"> {t('common.of')} {bucket.quotaBytes === null ? t('common.unlimited') : formatSize(bucket.quotaBytes)}</span>
						</dd>
					</dl>

					{bucket.quotaBytes !== null && bucket.quotaBytes > 0 && (
						<div className="progress">
							<div
								className="progress-bar"
								style={{ width: `${Math.min(100, Math.round((bucket.usage.totalBytes / bucket.quotaBytes) * 100))}%` }}
							/>
						</div>
					)}
				</div>
			</div>
		</>
	)
}
