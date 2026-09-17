import { useCallback, useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'react-router'

import { api, type ListObjectsResponse } from '../api/client'

const DELIMITER = '/'

function formatSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`
	const units = ['kB', 'MB', 'GB', 'TB']
	let value = bytes / 1024
	let unitIndex = 0
	while (value >= 1024 && unitIndex < units.length - 1) {
		value /= 1024
		unitIndex += 1
	}
	return `${value.toFixed(1)} ${units[unitIndex]}`
}

/** File browser for a single bucket. Folders are the common prefixes the API derives
 *  from the `/` delimiter - the storage itself has no directories. */
export function BucketDetailPage() {
	const { bucketName = '' } = useParams()
	const [searchParams, setSearchParams] = useSearchParams()
	const prefix = searchParams.get('prefix') ?? ''

	const [listing, setListing] = useState<ListObjectsResponse | null>(null)
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState<string | null>(null)

	const refresh = useCallback(async () => {
		setLoading(true)
		setError(null)
		try {
			setListing(await api.listObjects(bucketName, { prefix, delimiter: DELIMITER }))
		} catch {
			setError('Obsah bucketu se nepodařilo načíst')
		} finally {
			setLoading(false)
		}
	}, [bucketName, prefix])

	useEffect(() => { void refresh() }, [refresh])

	const navigateTo = (newPrefix: string) => {
		setSearchParams(newPrefix ? { prefix: newPrefix } : {})
	}

	const segments = prefix.split(DELIMITER).filter(Boolean)

	return (
		<>
			<div className="page-header">
				<h1>{bucketName}</h1>
			</div>

			<div className="breadcrumb">
				<a href="#" onClick={(e) => { e.preventDefault(); navigateTo('') }}>/</a>
				{segments.map((segment, index) => {
					const target = `${segments.slice(0, index + 1).join(DELIMITER)}${DELIMITER}`
					return (
						<span key={target}>
							<a href="#" onClick={(e) => { e.preventDefault(); navigateTo(target) }}>{segment}</a>
							<span> / </span>
						</span>
					)
				})}
			</div>

			{error && <p className="error">{error}</p>}

			<div className="card">
				<table>
					<thead>
						<tr>
							<th>Název</th>
							<th>Velikost</th>
							<th>Typ</th>
							<th>Změněno</th>
						</tr>
					</thead>
					<tbody>
						{listing?.commonPrefixes.map((commonPrefix) => (
							<tr key={commonPrefix}>
								<td>
									<a href="#" onClick={(e) => { e.preventDefault(); navigateTo(commonPrefix) }}>
										📁 {commonPrefix.slice(prefix.length)}
									</a>
								</td>
								<td className="muted">—</td>
								<td className="muted">složka</td>
								<td className="muted">—</td>
							</tr>
						))}
						{listing?.objects.map((object) => (
							<tr key={object.key}>
								<td>{object.key.slice(prefix.length)}</td>
								<td>{formatSize(object.size)}</td>
								<td className="muted">{object.contentType ?? '—'}</td>
								<td>{new Date(object.lastModified).toLocaleString()}</td>
							</tr>
						))}
						{!loading && listing && listing.objects.length === 0 && listing.commonPrefixes.length === 0 && (
							<tr><td colSpan={4} className="muted">Prázdné</td></tr>
						)}
					</tbody>
				</table>
			</div>
		</>
	)
}
