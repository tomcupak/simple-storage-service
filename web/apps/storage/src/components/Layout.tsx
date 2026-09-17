import { NavLink } from 'react-router'

import { UserRole } from '../api/client'
import { AppPaths } from '../App'
import { useAuth } from '../store/auth'

export function Layout({ children }: { children: React.ReactNode }) {
	const { user, logout } = useAuth()

	return (
		<div className="layout">
			<aside className="sidebar">
				<div className="brand">Storage</div>
				<nav>
					<NavLink to={AppPaths.Buckets} className={({ isActive }) => (isActive ? 'active' : '')}>Buckety</NavLink>
					<NavLink to={AppPaths.AccessKeys} className={({ isActive }) => (isActive ? 'active' : '')}>Přístupové klíče</NavLink>
					{user?.role === UserRole.admin && (
						<NavLink to={AppPaths.Users} className={({ isActive }) => (isActive ? 'active' : '')}>Uživatelé</NavLink>
					)}
				</nav>
				<div className="spacer" />
				<div className="muted" style={{ padding: '8px 12px' }}>{user?.email}</div>
				<button onClick={() => void logout()}>Odhlásit</button>
			</aside>
			<main className="content">{children}</main>
		</div>
	)
}
