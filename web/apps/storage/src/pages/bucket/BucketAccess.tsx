import { useCallback, useEffect, useState } from 'react'

import { api, type BucketDetail, type BucketGrantItem, BucketPermission, type UserItem, UserRole } from '../../api/client'
import { EmptyState } from '../../components/EmptyState'
import { ErrorText } from '../../components/ErrorText'
import { TableSkeleton } from '../../components/Skeleton'
import { useI18n } from '../../i18n'
import { useAuth } from '../../store/auth'

const PERMISSIONS = Object.values(BucketPermission)

/** Who may reach this bucket through the management API and the S3 fallback rules.
 *
 *  Editing needs the user list, and `GET /v1/users` is admin-only - so a non-admin owner sees
 *  the grants read-only rather than a picker that cannot be filled. */
export function BucketAccess({ bucket }: { bucket: BucketDetail }) {
	const { t } = useI18n()
	const { user } = useAuth()
	const isAdmin = user?.role === UserRole.admin

	const [grants, setGrants] = useState<BucketGrantItem[]>([])
	const [users, setUsers] = useState<UserItem[]>([])
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState<unknown>(null)
	const [newUserGuid, setNewUserGuid] = useState('')

	const refresh = useCallback(async () => {
		setLoading(true)
		setError(null)
		try {
			setGrants(await api.listBucketGrants(bucket.name))
			if (isAdmin) setUsers((await api.listUsers({ limit: 200, page: 1 })).data)
		} catch (err) {
			setError(err)
		} finally {
			setLoading(false)
		}
	}, [bucket.name, isAdmin])

	useEffect(() => { void refresh() }, [refresh])

	const emailOf = (userGuid: string) => users.find((candidate) => candidate.guid === userGuid)?.email ?? userGuid

	const setPermissions = async (userGuid: string, permissions: BucketPermission[]) => {
		setError(null)
		try {
			if (permissions.length === 0) {
				await api.removeBucketGrant(bucket.name, userGuid)
			} else {
				await api.setBucketGrant(bucket.name, { userGuid, permissions })
			}
			await refresh()
		} catch (err) {
			setError(err)
		}
	}

	const toggle = (grant: BucketGrantItem, permission: BucketPermission) => {
		const permissions = grant.permissions.includes(permission)
			? grant.permissions.filter((value) => value !== permission)
			: [...grant.permissions, permission]

		void setPermissions(grant.userGuid, permissions)
	}

	const add = async () => {
		if (!newUserGuid) return
		await setPermissions(newUserGuid, [BucketPermission.read])
		setNewUserGuid('')
	}

	const grantable = users.filter((candidate) =>
		candidate.guid !== bucket.ownerUserGuid && !grants.some((grant) => grant.userGuid === candidate.guid))

	return (
		<>
			<div className="row space-between wrap">
				<h2>{t('access.title')}</h2>
				{isAdmin && (
					<div className="row">
						<select value={newUserGuid} onChange={(event) => setNewUserGuid(event.target.value)}>
							<option value="">{t('access.selectUser')}</option>
							{grantable.map((candidate) => (
								<option key={candidate.guid} value={candidate.guid}>{candidate.email}</option>
							))}
						</select>
						<button className="primary" disabled={!newUserGuid} onClick={() => void add()}>{t('common.add')}</button>
					</div>
				)}
			</div>

			{!isAdmin && <p className="muted">{t('access.adminOnly')}</p>}
			<ErrorText error={error} />

			<div className="card">
				<table>
					<thead>
						<tr>
							<th>{t('access.user')}</th>
							<th>{t('access.permissions')}</th>
							<th />
						</tr>
					</thead>
					<tbody>
						{loading && <TableSkeleton columns={3} rows={3} />}

						{!loading && (
							<tr>
								<td>{emailOf(bucket.ownerUserGuid)} <span className="badge">{t('access.owner')}</span></td>
								<td className="muted">{PERMISSIONS.join(', ')}</td>
								<td />
							</tr>
						)}

						{!loading && grants.map((grant) => (
							<tr key={grant.userGuid}>
								<td>{emailOf(grant.userGuid)}</td>
								<td>
									<div className="row wrap">
										{PERMISSIONS.map((permission) => (
											<label key={permission} className="checkbox">
												<input
													type="checkbox"
													disabled={!isAdmin}
													checked={grant.permissions.includes(permission)}
													onChange={() => toggle(grant, permission)}
												/>
												{permission}
											</label>
										))}
									</div>
								</td>
								<td className="right">
									{isAdmin && (
										<button className="danger" onClick={() => void setPermissions(grant.userGuid, [])}>
											{t('common.delete')}
										</button>
									)}
								</td>
							</tr>
						))}
					</tbody>
				</table>

				{!loading && grants.length === 0 && <EmptyState icon="🔐" title={t('access.empty')} />}
			</div>
		</>
	)
}
