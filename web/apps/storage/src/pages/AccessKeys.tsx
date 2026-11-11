import { useCallback, useEffect, useState } from 'react'

import { type AccessKeyItem, AccessKeyStatus, api, type CreatedAccessKey } from '../api/client'
import { EmptyState } from '../components/EmptyState'
import { ErrorText } from '../components/ErrorText'
import { TableSkeleton } from '../components/Skeleton'
import { useI18n } from '../i18n'
import { formatDate } from '../lib/format'

const PAGE_SIZE = 25

export function AccessKeysPage() {
	const { t } = useI18n()
	const [keys, setKeys] = useState<AccessKeyItem[]>([])
	const [totalPages, setTotalPages] = useState(1)
	const [page, setPage] = useState(1)
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState<unknown>(null)
	const [description, setDescription] = useState('')
	const [created, setCreated] = useState<CreatedAccessKey | null>(null)

	const refresh = useCallback(async () => {
		setLoading(true)
		try {
			const response = await api.listAccessKeys({ limit: PAGE_SIZE, page })
			setKeys(response.data)
			setTotalPages(Math.max(1, response.pagination.totalPages))
		} catch (err) {
			setError(err)
		} finally {
			setLoading(false)
		}
	}, [page])

	useEffect(() => { void refresh() }, [refresh])

	const create = async (event: React.FormEvent) => {
		event.preventDefault()
		setError(null)
		try {
			setCreated(await api.createAccessKey({ description: description || undefined }))
			setDescription('')
			await refresh()
		} catch (err) {
			setError(err)
		}
	}

	const toggleStatus = async (key: AccessKeyItem) => {
		setError(null)
		try {
			const status = key.status === AccessKeyStatus.active ? AccessKeyStatus.inactive : AccessKeyStatus.active
			await api.setAccessKeyStatus(key.accessKeyId, { status })
			await refresh()
		} catch (err) {
			setError(err)
		}
	}

	const remove = async (accessKeyId: string) => {
		if (!confirm(t('accessKeys.deleteConfirm', { id: accessKeyId }))) return
		setError(null)
		try {
			await api.deleteAccessKey(accessKeyId)
			await refresh()
		} catch (err) {
			setError(err)
		}
	}

	return (
		<>
			<div className="page-header">
				<h1>{t('accessKeys.title')}</h1>
				<form className="row" onSubmit={(event) => void create(event)}>
					<input placeholder={t('accessKeys.description')} value={description} onChange={(event) => setDescription(event.target.value)} />
					<button className="primary" type="submit">{t('common.create')}</button>
				</form>
			</div>

			{created && (
				<div className="card section secret-callout">
					<p><strong>{t('accessKeys.secretOnce')}</strong></p>
					<p><code>{created.accessKeyId}</code></p>
					<p><code>{created.secretAccessKey}</code></p>
					<button onClick={() => setCreated(null)}>{t('accessKeys.understood')}</button>
				</div>
			)}

			<ErrorText error={error} />

			<div className="card">
				<table>
					<thead>
						<tr>
							<th>Access key ID</th>
							<th>{t('accessKeys.description')}</th>
							<th>{t('accessKeys.status')}</th>
							<th>{t('accessKeys.lastUsed')}</th>
							<th />
						</tr>
					</thead>
					<tbody>
						{loading && <TableSkeleton columns={5} />}
						{!loading && keys.map((key) => (
							<tr key={key.accessKeyId}>
								<td><code>{key.accessKeyId}</code></td>
								<td>{key.description ?? '—'}</td>
								<td>
									<span className={key.status === AccessKeyStatus.active ? 'badge success' : 'badge'}>{key.status}</span>
								</td>
								<td>{formatDate(key.lastUsedAt)}</td>
								<td className="right nowrap actions">
									<button onClick={() => void toggleStatus(key)}>
										{t(key.status === AccessKeyStatus.active ? 'accessKeys.deactivate' : 'accessKeys.activate')}
									</button>
									<button className="danger" onClick={() => void remove(key.accessKeyId)}>{t('common.delete')}</button>
								</td>
							</tr>
						))}
					</tbody>
				</table>

				{!loading && keys.length === 0 && (
					<EmptyState icon="🔑" title={t('accessKeys.empty')} hint={t('accessKeys.emptyHint')} />
				)}
			</div>

			{totalPages > 1 && (
				<div className="row pager">
					<button disabled={page === 1} onClick={() => setPage((current) => current - 1)}>{t('common.previous')}</button>
					<span className="muted">{t('common.page', { page })} / {totalPages}</span>
					<button disabled={page >= totalPages} onClick={() => setPage((current) => current + 1)}>{t('common.next')}</button>
				</div>
			)}
		</>
	)
}
