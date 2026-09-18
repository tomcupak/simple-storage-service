import { useCallback, useEffect, useState } from 'react'

import { type AccessKeyItem, api, type CreatedAccessKey } from '../api/client'

export function AccessKeysPage() {
	const [keys, setKeys] = useState<AccessKeyItem[]>([])
	const [description, setDescription] = useState('')
	const [created, setCreated] = useState<CreatedAccessKey | null>(null)

	const refresh = useCallback(async () => {
		setKeys((await api.listAccessKeys()).data)
	}, [])

	useEffect(() => { void refresh() }, [refresh])

	const create = async (event: React.FormEvent) => {
		event.preventDefault()
		const key = await api.createAccessKey({ description: description || undefined })
		setCreated(key)
		setDescription('')
		await refresh()
	}

	const remove = async (accessKeyId: string) => {
		if (!confirm(`Smazat klíč ${accessKeyId}?`)) return
		await api.deleteAccessKey(accessKeyId)
		await refresh()
	}

	return (
		<>
			<div className="page-header">
				<h1>Přístupové klíče</h1>
				<form className="row" onSubmit={(e) => void create(e)}>
					<input placeholder="popis" value={description} onChange={(e) => setDescription(e.target.value)} />
					<button className="primary" type="submit">Vytvořit</button>
				</form>
			</div>

			{created && (
				<div className="card" style={{ padding: 16, marginBottom: 16 }}>
					<p>Secret access key se zobrazí <strong>pouze teď</strong>:</p>
					<p><code>{created.accessKeyId}</code></p>
					<p><code>{created.secretAccessKey}</code></p>
					<button onClick={() => setCreated(null)}>Rozumím</button>
				</div>
			)}

			<div className="card">
				<table>
					<thead>
						<tr>
							<th>Access key ID</th>
							<th>Popis</th>
							<th>Stav</th>
							<th>Naposledy použit</th>
							<th />
						</tr>
					</thead>
					<tbody>
						{keys.map((key) => (
							<tr key={key.accessKeyId}>
								<td><code>{key.accessKeyId}</code></td>
								<td>{key.description ?? '—'}</td>
								<td>{key.status}</td>
								<td>{key.lastUsedAt ? new Date(key.lastUsedAt).toLocaleString() : '—'}</td>
								<td style={{ textAlign: 'right' }}>
									<button className="danger" onClick={() => void remove(key.accessKeyId)}>Smazat</button>
								</td>
							</tr>
						))}
						{keys.length === 0 && <tr><td colSpan={5} className="muted">Žádné klíče</td></tr>}
					</tbody>
				</table>
			</div>
		</>
	)
}
