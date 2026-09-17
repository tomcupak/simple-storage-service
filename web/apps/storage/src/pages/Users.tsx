import { useCallback, useEffect, useState } from 'react'

import { api, type UserItem,UserRole } from '../api/client'

export function UsersPage() {
	const [users, setUsers] = useState<UserItem[]>([])
	const [email, setEmail] = useState('')
	const [password, setPassword] = useState('')
	const [role, setRole] = useState<UserRole>(UserRole.user)
	const [error, setError] = useState<string | null>(null)

	const refresh = useCallback(async () => {
		setUsers(await api.listUsers())
	}, [])

	useEffect(() => { void refresh() }, [refresh])

	const create = async (event: React.FormEvent) => {
		event.preventDefault()
		setError(null)
		try {
			await api.createUser({ email, password, role })
			setEmail('')
			setPassword('')
			await refresh()
		} catch {
			setError('Uživatele se nepodařilo vytvořit')
		}
	}

	const remove = async (userGuid: string) => {
		if (!confirm('Smazat uživatele?')) return
		setError(null)
		try {
			await api.deleteUser(userGuid)
			await refresh()
		} catch {
			setError('Uživatele nelze smazat')
		}
	}

	return (
		<>
			<div className="page-header">
				<h1>Uživatelé</h1>
				<form className="row" onSubmit={(e) => void create(e)}>
					<input placeholder="e-mail" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
					<input placeholder="heslo" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
					<select value={role} onChange={(e) => setRole(e.target.value as UserRole)}>
						<option value={UserRole.user}>user</option>
						<option value={UserRole.admin}>admin</option>
					</select>
					<button className="primary" type="submit" disabled={!email || password.length < 8}>Přidat</button>
				</form>
			</div>

			{error && <p className="error">{error}</p>}

			<div className="card">
				<table>
					<thead>
						<tr>
							<th>E-mail</th>
							<th>Role</th>
							<th>Poslední přihlášení</th>
							<th />
						</tr>
					</thead>
					<tbody>
						{users.map((user) => (
							<tr key={user.guid}>
								<td>{user.email}</td>
								<td>{user.role}</td>
								<td>{user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString() : '—'}</td>
								<td style={{ textAlign: 'right' }}>
									<button className="danger" onClick={() => void remove(user.guid)}>Smazat</button>
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</>
	)
}
