import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'

import { api, type BucketItem, type ListObjectsResponse, type ObjectItem } from '../../api/client'
import { downloadObject, saveBlob } from '../../api/transfer'
import { CopyMoveDialog } from '../../components/CopyMoveDialog'
import { EmptyState } from '../../components/EmptyState'
import { ErrorText } from '../../components/ErrorText'
import { Modal } from '../../components/Modal'
import { ObjectPreview } from '../../components/ObjectPreview'
import { ObjectVersions } from '../../components/ObjectVersions'
import { ShareLinkDialog } from '../../components/ShareLinkDialog'
import { TableSkeleton } from '../../components/Skeleton'
import { UploadPanel } from '../../components/UploadPanel'
import { useI18n } from '../../i18n'
import { baseName, formatDate, formatSize } from '../../lib/format'

const DELIMITER = '/'
const PAGE_SIZE = 100

type SortColumn = 'name' | 'size' | 'modified'
type SortDirection = 'asc' | 'desc'

interface Dialog {
	kind: 'preview' | 'share' | 'versions' | 'copy' | 'move' | 'newFolder'
	object?: ObjectItem
	key?: string
}

export function FileBrowser({ bucketName, versioned }: { bucketName: string, versioned: boolean }) {
	const { t } = useI18n()
	const [searchParams, setSearchParams] = useSearchParams()
	const prefix = searchParams.get('prefix') ?? ''

	const [listing, setListing] = useState<ListObjectsResponse | null>(null)
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState<unknown>(null)
	const [buckets, setBuckets] = useState<BucketItem[]>([])
	const [dialog, setDialog] = useState<Dialog | null>(null)
	const [folderName, setFolderName] = useState('')
	const [sort, setSort] = useState<{ column: SortColumn, direction: SortDirection }>({ column: 'name', direction: 'asc' })

	// One entry per page visited, so Previous can go back without re-walking from the start.
	// The API hands out opaque continuation tokens, which is the only way back it offers.
	const [tokens, setTokens] = useState<(string | undefined)[]>([undefined])
	const [pageIndex, setPageIndex] = useState(0)

	const load = useCallback(async (continuationToken: string | undefined) => {
		setLoading(true)
		setError(null)
		try {
			setListing(await api.listObjects(bucketName, {
				prefix,
				delimiter: DELIMITER,
				maxKeys: PAGE_SIZE,
				continuationToken,
			}))
		} catch (err) {
			setError(err)
		} finally {
			setLoading(false)
		}
	}, [bucketName, prefix])

	useEffect(() => { void load(tokens[pageIndex]) }, [load, tokens, pageIndex])

	useEffect(() => { void api.listBuckets().then(setBuckets).catch(() => setBuckets([])) }, [])

	const refresh = useCallback(() => { void load(tokens[pageIndex]) }, [load, tokens, pageIndex])

	const navigateTo = (newPrefix: string) => {
		setTokens([undefined])
		setPageIndex(0)
		setSearchParams(newPrefix ? { prefix: newPrefix } : {})
	}

	const nextPage = () => {
		const token = listing?.nextContinuationToken
		if (!token) return

		setTokens((current) => (pageIndex + 1 < current.length ? current : [...current, token]))
		setPageIndex((index) => index + 1)
	}

	const toggleSort = (column: SortColumn) => {
		setSort((current) => ({
			column,
			direction: current.column === column && current.direction === 'asc' ? 'desc' : 'asc',
		}))
	}

	/** Sorting is page-local on purpose: the API lists keys in byte order and hands out a
	 *  continuation token for that order, so sorting across pages would mean pulling the whole
	 *  bucket into the browser. Folders stay on top either way, as in every file manager. */
	const sortedObjects = useMemo(() => {
		const objects = [...(listing?.objects ?? [])]
		const factor = sort.direction === 'asc' ? 1 : -1

		return objects.sort((left, right) => {
			if (sort.column === 'size') return (left.size - right.size) * factor
			if (sort.column === 'modified') {
				return (new Date(left.lastModified).getTime() - new Date(right.lastModified).getTime()) * factor
			}
			return left.key.localeCompare(right.key) * factor
		})
	}, [listing, sort])

	const sortedPrefixes = useMemo(() => {
		const prefixes = [...(listing?.commonPrefixes ?? [])]
		const factor = sort.column === 'name' && sort.direction === 'desc' ? -1 : 1

		return prefixes.sort((left, right) => left.localeCompare(right) * factor)
	}, [listing, sort])

	const download = async (object: ObjectItem) => {
		setError(null)
		try {
			saveBlob(await downloadObject({ bucketName, key: object.key }), baseName(object.key))
		} catch (err) {
			setError(err)
		}
	}

	const removeObject = async (object: ObjectItem) => {
		if (!confirm(t('files.deleteConfirm', { name: baseName(object.key) }))) return
		setError(null)
		try {
			await api.deleteObject(bucketName, { key: object.key })
			refresh()
		} catch (err) {
			setError(err)
		}
	}

	const removeFolder = async (commonPrefix: string) => {
		if (!confirm(t('files.deleteFolderConfirm', { name: commonPrefix.slice(prefix.length) }))) return
		setError(null)
		try {
			await api.deleteObject(bucketName, { prefix: commonPrefix })
			refresh()
		} catch (err) {
			setError(err)
		}
	}

	const createFolder = async (event: React.FormEvent) => {
		event.preventDefault()
		setError(null)
		try {
			await api.createFolder(bucketName, { key: `${prefix}${folderName}` })
			setFolderName('')
			setDialog(null)
			refresh()
		} catch (err) {
			setError(err)
		}
	}

	const segments = prefix.split(DELIMITER).filter(Boolean)
	const isEmpty = !loading && listing && listing.objects.length === 0 && listing.commonPrefixes.length === 0

	const sortIndicator = (column: SortColumn) =>
		(sort.column === column ? <span className="sort-arrow">{sort.direction === 'asc' ? '▲' : '▼'}</span> : null)

	return (
		<>
			<div className="row space-between wrap">
				<div className="breadcrumb">
					<a href="#" onClick={(event) => { event.preventDefault(); navigateTo('') }}>{bucketName}</a>
					{segments.map((segment, index) => {
						const target = `${segments.slice(0, index + 1).join(DELIMITER)}${DELIMITER}`
						return (
							<span key={target}>
								<span className="muted"> / </span>
								<a href="#" onClick={(event) => { event.preventDefault(); navigateTo(target) }}>{segment}</a>
							</span>
						)
					})}
				</div>
				<button onClick={() => setDialog({ kind: 'newFolder' })}>{t('files.newFolder')}</button>
			</div>

			<UploadPanel bucketName={bucketName} prefix={prefix} onUploaded={refresh} />

			<ErrorText error={error} />

			<div className="card">
				<table>
					<thead>
						<tr>
							<th className="sortable" onClick={() => toggleSort('name')}>{t('common.name')}{sortIndicator('name')}</th>
							<th className="sortable" onClick={() => toggleSort('size')}>{t('common.size')}{sortIndicator('size')}</th>
							<th>{t('common.type')}</th>
							<th className="sortable" onClick={() => toggleSort('modified')}>{t('common.modified')}{sortIndicator('modified')}</th>
							<th />
						</tr>
					</thead>
					<tbody>
						{loading && <TableSkeleton columns={5} />}

						{!loading && sortedPrefixes.map((commonPrefix) => (
							<tr key={commonPrefix}>
								<td>
									<a href="#" onClick={(event) => { event.preventDefault(); navigateTo(commonPrefix) }}>
										📁 {commonPrefix.slice(prefix.length)}
									</a>
								</td>
								<td className="muted">—</td>
								<td className="muted">{t('files.folder')}</td>
								<td className="muted">—</td>
								<td className="right nowrap actions">
									<button title={t('files.rename')} onClick={() => setDialog({ kind: 'move', key: commonPrefix })}>✎</button>
									<button className="danger" title={t('common.delete')} onClick={() => void removeFolder(commonPrefix)}>🗑</button>
								</td>
							</tr>
						))}

						{!loading && sortedObjects.map((object) => (
							<tr key={object.key}>
								<td className="ellipsis">{object.key.slice(prefix.length)}</td>
								<td>{formatSize(object.size)}</td>
								<td className="muted">{object.contentType ?? '—'}</td>
								<td>{formatDate(object.lastModified)}</td>
								<td className="right nowrap actions">
									<button title={t('files.preview')} onClick={() => setDialog({ kind: 'preview', object })}>👁</button>
									<button title={t('files.download')} onClick={() => void download(object)}>⤓</button>
									<button title={t('files.share')} onClick={() => setDialog({ kind: 'share', object })}>🔗</button>
									{versioned && (
										<button title={t('files.versions')} onClick={() => setDialog({ kind: 'versions', object })}>🕘</button>
									)}
									<button title={t('files.duplicate')} onClick={() => setDialog({ kind: 'copy', key: object.key })}>⧉</button>
									<button title={t('files.rename')} onClick={() => setDialog({ kind: 'move', key: object.key })}>✎</button>
									<button className="danger" title={t('common.delete')} onClick={() => void removeObject(object)}>🗑</button>
								</td>
							</tr>
						))}
					</tbody>
				</table>

				{isEmpty && <EmptyState icon="📂" title={t('files.empty')} hint={t('files.emptyHint')} />}
			</div>

			<div className="row space-between pager">
				<span className="muted">{t('files.sortHint')}</span>
				<div className="row">
					<button disabled={pageIndex === 0} onClick={() => setPageIndex((index) => index - 1)}>{t('common.previous')}</button>
					<span className="muted">{t('common.page', { page: pageIndex + 1 })}</span>
					<button disabled={!listing?.nextContinuationToken} onClick={nextPage}>{t('common.next')}</button>
				</div>
			</div>

			{dialog?.kind === 'newFolder' && (
				<Modal
					title={t('files.newFolder')}
					onClose={() => setDialog(null)}
					footer={(
						<>
							<button onClick={() => setDialog(null)}>{t('common.cancel')}</button>
							<button className="primary" disabled={!folderName} onClick={(event) => void createFolder(event)}>
								{t('common.create')}
							</button>
						</>
					)}
				>
					<form onSubmit={(event) => void createFolder(event)}>
						<div className="field">
							<label htmlFor="folder-name">{t('files.folderName')}</label>
							<input id="folder-name" value={folderName} onChange={(event) => setFolderName(event.target.value)} autoFocus />
						</div>
					</form>
					<p className="muted"><code>{prefix}{folderName}/</code></p>
				</Modal>
			)}

			{dialog?.kind === 'preview' && dialog.object && (
				<ObjectPreview
					bucketName={bucketName}
					objectKey={dialog.object.key}
					contentType={dialog.object.contentType}
					size={dialog.object.size}
					onClose={() => setDialog(null)}
				/>
			)}

			{dialog?.kind === 'share' && dialog.object && (
				<ShareLinkDialog bucketName={bucketName} objectKey={dialog.object.key} onClose={() => setDialog(null)} />
			)}

			{dialog?.kind === 'versions' && dialog.object && (
				<ObjectVersions
					bucketName={bucketName}
					objectKey={dialog.object.key}
					onClose={() => setDialog(null)}
					onChanged={refresh}
				/>
			)}

			{(dialog?.kind === 'copy' || dialog?.kind === 'move') && dialog.key && (
				<CopyMoveDialog
					bucketName={bucketName}
					sourceKey={dialog.key}
					move={dialog.kind === 'move'}
					buckets={buckets}
					onClose={() => setDialog(null)}
					onDone={refresh}
				/>
			)}
		</>
	)
}
