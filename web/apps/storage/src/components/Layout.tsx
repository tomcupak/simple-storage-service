import { NavLink } from 'react-router'

import { UserRole } from '../api/client'
import { AppPaths } from '../App'
import { type Language, LANGUAGES, useI18n } from '../i18n'
import { useAuth } from '../store/auth'

export function Layout({ children }: { children: React.ReactNode }) {
	const { user, logout } = useAuth()
	const { t, language, setLanguage } = useI18n()

	const linkClass = ({ isActive }: { isActive: boolean }) => (isActive ? 'active' : '')

	return (
		<div className="layout">
			<aside className="sidebar">
				<div className="brand">Storage</div>
				<nav>
					<NavLink to={AppPaths.Buckets} className={linkClass}>{t('nav.buckets')}</NavLink>
					<NavLink to={AppPaths.AccessKeys} className={linkClass}>{t('nav.accessKeys')}</NavLink>
					{user?.role === UserRole.admin && (
						<NavLink to={AppPaths.Users} className={linkClass}>{t('nav.users')}</NavLink>
					)}
					<NavLink to={AppPaths.Profile} className={linkClass}>{t('nav.profile')}</NavLink>
				</nav>

				<div className="spacer" />

				<div className="language-switch">
					{LANGUAGES.map((code) => (
						<button
							key={code}
							className={code === language ? 'active' : ''}
							onClick={() => setLanguage(code as Language)}
						>
							{code.toUpperCase()}
						</button>
					))}
				</div>
				<div className="muted sidebar-user">{user?.email}</div>
				<button onClick={() => void logout()}>{t('nav.logout')}</button>
			</aside>
			<main className="content">{children}</main>
		</div>
	)
}
