import { useCallback, useEffect, useState } from 'react'

import { api } from '../api/client'
import type { ObjectVersionItem } from '../api/schema/models'
import { downloadObject, saveBlob } from '../api/transfer'
import { useI18n } from '../i18n'
import { baseName, formatDate, formatSize } from '../lib/format'
import { EmptyState } from './EmptyState'
import { ErrorText } from './ErrorText'
import { Modal } from './Modal'
import { TableSkeleton } from './Skeleton'

/** Version history of one key. Deleting here removes that exact version for good - unlike
 *  deleting the key, which in a versioned bucket only writes a delete marker. */
export function ObjectVersions({ bucketName, objectKey, onClose, onChanged }: {
	bucketName: string
	objectKey: string
	onClose: () => void
	onChanged: () => void
}) {
	const { t } = useI18n()
	const [versions, setVersions] = useState<ObjectVersionItem[]>([])
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState<unknown>(null)

	const refresh = useCallback(async () => {
		setLoading(true)
		setError(null)
		try {
			setVersions(await api.listObjectVersions(bucketName, objectKey))
		} catch (err) {
			setError(err)
		} finally {
			setLoading(false)
		}
	}, [bucketName, objectKey])

	useEffect(() => { void refresh() }, [refresh])

	const download = async (versionId: string) => {
		setError(null)
		try {
			saveBlob(await downloadObject({ bucketName, key: objectKey, versionId }), baseName(objectKey))
		} catch (err) {
			setError(err)
		}
	}

	const remove = async (versionId: string) => {
		if (!confirm(t('versions.deleteConfirm'))) return
		setError(null)
		try {
			await api.deleteObject(bucketName, { key: objectKey, versionId })
			onChanged()
			await refresh()
		} catch (err) {
			setError(err)
		}
	}

	return (
		<Modal wide title={t('versions.title', { name: baseName(objectKey) })} onClose={onClose}>
			<ErrorText error={error} />

			<table>
				<thead>
					<tr>
						<th>{t('versions.versionId')}</th>
						<th>{t('common.size')}</th>
						<th>{t('common.created')}</th>
						<th />
					</tr>
				</thead>
				<tbody>
					{loading && <TableSkeleton columns={4} rows={3} />}
					{!loading && versions.map((version) => (
						<tr key={version.versionId}>
							<td>
								<code>{version.versionId}</code>
								{version.isLatest && <span className="badge">{t('versions.current')}</span>}
								{version.isDeleteMarker && <span className="badge">{t('versions.deleteMarker')}</span>}
							</td>
							<td>{version.isDeleteMarker ? '—' : formatSize(version.size)}</td>
							<td>{formatDate(version.createdAt)}</td>
							<td className="right nowrap">
								{!version.isDeleteMarker && (
									<button onClick={() => void download(version.versionId)}>{t('files.download')}</button>
								)}
								<button className="danger" onClick={() => void remove(version.versionId)}>{t('common.delete')}</button>
							</td>
						</tr>
					))}
				</tbody>
			</table>

			{!loading && versions.length === 0 && <EmptyState title={t('versions.empty')} />}
		</Modal>
	)
}
