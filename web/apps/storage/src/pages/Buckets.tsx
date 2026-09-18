import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'

import { api, type BucketItem, type BucketUsageItem } from '../api/client'
import { buildPath } from '../App'
import { EmptyState } from '../components/EmptyState'
import { ErrorText } from '../components/ErrorText'
import { TableSkeleton } from '../components/Skeleton'
import { useI18n } from '../i18n'
import { formatDate, formatSize } from '../lib/format'

export function BucketsPage() {
	const { t } = useI18n()
	const [buckets, setBuckets] = useState<BucketItem[]>([])
	const [usage, setUsage] = useState<Record<string, BucketUsageItem>>({})
	const [name, setName] = useState('')
	const [error, setError] = useState<unknown>(null)
	const [loading, setLoading] = useState(true)

	const refresh = useCallback(async () => {
		setLoading(true)
		try {
			setBuckets(await api.listBuckets())
		} catch (err) {
			setError(err)
		} finally {
			setLoading(false)
		}

		// Usage is a second, heavier query; the table renders without it rather than waiting.
		try {
			const rows = await api.bucketsUsage()
			setUsage(Object.fromEntries(rows.map((row) => [row.bucketName, row])))
		} catch {
			setUsage({})
		}
	}, [])

	useEffect(() => { void refresh() }, [refresh])

	const create = async (event: React.FormEvent) => {
		event.preventDefault()
		setError(null)
		try {
			await api.createBucket({ name })
			setName('')
			await refresh()
		} catch (err) {
			setError(err)
		}
	}

	const remove = async (bucketName: string) => {
		if (!confirm(t('buckets.deleteConfirm', { name: bucketName }))) return
		setError(null)
		try {
			await api.deleteBucket(bucketName)
			await refresh()
		} catch (err) {
			setError(err)
		}
	}

	return (
		<>
			<div className="page-header">
				<h1>{t('buckets.title')}</h1>
				<form className="row" onSubmit={(event) => void create(event)}>
					<input placeholder={t('buckets.namePlaceholder')} value={name} onChange={(event) => setName(event.target.value)} />
					<button className="primary" type="submit" disabled={!name}>{t('common.create')}</button>
				</form>
			</div>

			<ErrorText error={error} />

			<div className="card">
				<table>
					<thead>
						<tr>
							<th>{t('common.name')}</th>
							<th>{t('buckets.region')}</th>
							<th>{t('buckets.versioning')}</th>
							<th>{t('settings.objectCount')}</th>
							<th>{t('common.size')}</th>
							<th>{t('common.created')}</th>
							<th />
						</tr>
					</thead>
					<tbody>
						{loading && <TableSkeleton columns={7} />}
						{!loading && buckets.map((bucket) => (
							<tr key={bucket.guid}>
								<td><Link to={buildPath.bucketDetail(bucket.name)}>{bucket.name}</Link></td>
								<td>{bucket.region}</td>
								<td>{bucket.versioning}</td>
								<td>{usage[bucket.name]?.objectCount ?? '—'}</td>
								<td>{usage[bucket.name] ? formatSize(usage[bucket.name].totalBytes) : '—'}</td>
								<td>{formatDate(bucket.createdAt)}</td>
								<td className="right">
									<button className="danger" onClick={() => void remove(bucket.name)}>{t('common.delete')}</button>
								</td>
							</tr>
						))}
					</tbody>
				</table>

				{!loading && buckets.length === 0 && (
					<EmptyState icon="🪣" title={t('buckets.empty')} hint={t('buckets.emptyHint')} />
				)}
			</div>
		</>
	)
}
