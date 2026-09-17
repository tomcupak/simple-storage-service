import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'

import { api, type BucketItem } from '../api/client'
import { buildPath } from '../App'

export function BucketsPage() {
	const [buckets, setBuckets] = useState<BucketItem[]>([])
	const [name, setName] = useState('')
	const [error, setError] = useState<string | null>(null)
	const [loading, setLoading] = useState(true)

	const refresh = useCallback(async () => {
		setLoading(true)
		try {
			setBuckets(await api.listBuckets())
		} finally {
			setLoading(false)
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
		} catch {
			setError('Bucket se nepodařilo vytvořit (název musí být unikátní a DNS-kompatibilní)')
		}
	}

	const remove = async (bucketName: string) => {
		if (!confirm(`Smazat bucket ${bucketName}?`)) return
		setError(null)
		try {
			await api.deleteBucket(bucketName)
			await refresh()
		} catch {
			setError('Bucket nelze smazat - musí být prázdný')
		}
	}

	return (
		<>
			<div className="page-header">
				<h1>Buckety</h1>
				<form className="row" onSubmit={(e) => void create(e)}>
					<input placeholder="nazev-bucketu" value={name} onChange={(e) => setName(e.target.value)} />
					<button className="primary" type="submit" disabled={!name}>Vytvořit</button>
				</form>
			</div>

			{error && <p className="error">{error}</p>}

			<div className="card">
				<table>
					<thead>
						<tr>
							<th>Název</th>
							<th>Region</th>
							<th>Verzování</th>
							<th>Vytvořeno</th>
							<th />
						</tr>
					</thead>
					<tbody>
						{buckets.map((bucket) => (
							<tr key={bucket.guid}>
								<td><Link to={buildPath.bucketDetail(bucket.name)}>{bucket.name}</Link></td>
								<td>{bucket.region}</td>
								<td>{bucket.versioning}</td>
								<td>{new Date(bucket.createdAt).toLocaleString()}</td>
								<td style={{ textAlign: 'right' }}>
									<button className="danger" onClick={() => void remove(bucket.name)}>Smazat</button>
								</td>
							</tr>
						))}
						{!loading && buckets.length === 0 && (
							<tr><td colSpan={5} className="muted">Zatím žádné buckety</td></tr>
						)}
					</tbody>
				</table>
			</div>
		</>
	)
}
