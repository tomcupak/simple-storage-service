import { useCallback, useEffect, useState } from 'react'

import { api, type UserItem, UserRole, UserStatus } from '../api/client'
import { EmptyState } from '../components/EmptyState'
import { ErrorText } from '../components/ErrorText'
import { Modal } from '../components/Modal'
import { TableSkeleton } from '../components/Skeleton'
import { useI18n } from '../i18n'
import { formatDate, formatSize } from '../lib/format'

const PAGE_SIZE = 25

export function UsersPage() {
	const { t } = useI18n()
	const [users, setUsers] = useState<UserItem[]>([])
	const [totalPages, setTotalPages] = useState(1)
	const [page, setPage] = useState(1)
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState<unknown>(null)

	const [email, setEmail] = useState('')
	const [password, setPassword] = useState('')
	const [role, setRole] = useState<UserRole>(UserRole.user)

	const [editing, setEditing] = useState<UserItem | null>(null)
	const [editName, setEditName] = useState('')
	const [editRole, setEditRole] = useState<UserRole>(UserRole.user)
	const [editQuota, setEditQuota] = useState('')

	const refresh = useCallback(async () => {
		setLoading(true)
		try {
			const response = await api.listUsers({ limit: PAGE_SIZE, page })
			setUsers(response.data)
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
			await api.createUser({ email, password, role })
			setEmail('')
			setPassword('')
			await refresh()
		} catch (err) {
			setError(err)
		}
	}

	const remove = async (user: UserItem) => {
		if (!confirm(t('users.deleteConfirm', { email: user.email }))) return
		setError(null)
		try {
			await api.deleteUser(user.guid)
			await refresh()
		} catch (err) {
			setError(err)
		}
	}

	const toggleStatus = async (user: UserItem) => {
		setError(null)
		try {
			const status = user.status === UserStatus.active ? UserStatus.disabled : UserStatus.active
			await api.setUserStatus(user.guid, { status })
			await refresh()
		} catch (err) {
			setError(err)
		}
	}

	const openEdit = (user: UserItem) => {
		setEditing(user)
		setEditName(user.name ?? '')
		setEditRole(user.role)
		setEditQuota(user.quotaBytes === null ? '' : String(user.quotaBytes))
	}

	const saveEdit = async () => {
		if (!editing) return
		setError(null)
		try {
			await api.updateUser(editing.guid, { name: editName || null, role: editRole })
			await api.setUserQuota(editing.guid, { quotaBytes: editQuota === '' ? null : Number(editQuota) })
			setEditing(null)
			await refresh()
		} catch (err) {
			setError(err)
		}
	}

	return (
		<>
			<div className="page-header">
				<h1>{t('users.title')}</h1>
				<form className="row" onSubmit={(event) => void create(event)}>
					<input placeholder={t('users.email')} type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
					<input placeholder={t('users.password')} type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
					<select value={role} onChange={(event) => setRole(event.target.value as UserRole)}>
						{Object.values(UserRole).map((value) => <option key={value} value={value}>{value}</option>)}
					</select>
					<button className="primary" type="submit" disabled={!email || password.length < 8}>{t('common.add')}</button>
				</form>
			</div>

			<ErrorText error={error} />

			<div className="card">
				<table>
					<thead>
						<tr>
							<th>{t('users.email')}</th>
							<th>{t('users.role')}</th>
							<th>{t('users.status')}</th>
							<th>{t('users.quota')}</th>
							<th>{t('users.lastLogin')}</th>
							<th />
						</tr>
					</thead>
					<tbody>
						{loading && <TableSkeleton columns={6} />}
						{!loading && users.map((user) => (
							<tr key={user.guid}>
								<td>
									{user.email}
									{user.name && <span className="muted"> · {user.name}</span>}
								</td>
								<td>{user.role}</td>
								<td>
									<span className={user.status === UserStatus.active ? 'badge success' : 'badge'}>
										{t(user.status === UserStatus.active ? 'users.status.active' : 'users.status.disabled')}
									</span>
								</td>
								<td>{user.quotaBytes === null ? t('common.unlimited') : formatSize(user.quotaBytes)}</td>
								<td>{formatDate(user.lastLoginAt)}</td>
								<td className="right nowrap actions">
									<button title={t('common.save')} onClick={() => openEdit(user)}>✎</button>
									<button onClick={() => void toggleStatus(user)}>
										{t(user.status === UserStatus.active ? 'users.deactivate' : 'users.activate')}
									</button>
									<button className="danger" onClick={() => void remove(user)}>{t('common.delete')}</button>
								</td>
							</tr>
						))}
					</tbody>
				</table>

				{!loading && users.length === 0 && <EmptyState icon="👤" title={t('users.empty')} />}
			</div>

			{totalPages > 1 && (
				<div className="row pager">
					<button disabled={page === 1} onClick={() => setPage((current) => current - 1)}>{t('common.previous')}</button>
					<span className="muted">{t('common.page', { page })} / {totalPages}</span>
					<button disabled={page >= totalPages} onClick={() => setPage((current) => current + 1)}>{t('common.next')}</button>
				</div>
			)}

			{editing && (
				<Modal
					title={t('users.editTitle', { email: editing.email })}
					onClose={() => setEditing(null)}
					footer={(
						<>
							<button onClick={() => setEditing(null)}>{t('common.cancel')}</button>
							<button className="primary" onClick={() => void saveEdit()}>{t('common.save')}</button>
						</>
					)}
				>
					<div className="field">
						<label htmlFor="user-name">{t('users.name')}</label>
						<input id="user-name" value={editName} onChange={(event) => setEditName(event.target.value)} autoFocus />
					</div>
					<div className="field">
						<label htmlFor="user-role">{t('users.role')}</label>
						<select id="user-role" value={editRole} onChange={(event) => setEditRole(event.target.value as UserRole)}>
							{Object.values(UserRole).map((value) => <option key={value} value={value}>{value}</option>)}
						</select>
					</div>
					<div className="field">
						<label htmlFor="user-quota">{t('users.setQuota')}</label>
						<input
							id="user-quota"
							type="number"
							min={0}
							value={editQuota}
							placeholder={t('common.unlimited')}
							onChange={(event) => setEditQuota(event.target.value)}
						/>
					</div>
				</Modal>
			)}
		</>
	)
}
