import { useEffect, useState } from 'react'

import { api, type UsageItem } from '../api/client'
import { ErrorText } from '../components/ErrorText'
import { BlockSkeleton } from '../components/Skeleton'
import { type Language, LANGUAGES, useI18n } from '../i18n'
import { formatSize } from '../lib/format'
import { useAuth } from '../store/auth'

const MIN_PASSWORD_LENGTH = 8

export function ProfilePage() {
	const { t, language, setLanguage } = useI18n()
	const { user } = useAuth()

	const [usage, setUsage] = useState<UsageItem | null>(null)
	const [usageError, setUsageError] = useState<unknown>(null)

	const [currentPassword, setCurrentPassword] = useState('')
	const [password, setPassword] = useState('')
	const [repeated, setRepeated] = useState('')
	const [passwordError, setPasswordError] = useState<unknown>(null)
	const [validationKey, setValidationKey] = useState<'profile.passwordMismatch' | 'profile.passwordTooShort' | null>(null)
	const [changed, setChanged] = useState(false)
	const [busy, setBusy] = useState(false)

	useEffect(() => {
		if (!user) return

		void api.userUsage(user.guid).then(setUsage).catch(setUsageError)
	}, [user])

	const submit = async (event: React.FormEvent) => {
		event.preventDefault()
		if (!user) return

		setPasswordError(null)
		setChanged(false)

		if (password.length < MIN_PASSWORD_LENGTH) {
			setValidationKey('profile.passwordTooShort')
			return
		}
		if (password !== repeated) {
			setValidationKey('profile.passwordMismatch')
			return
		}
		setValidationKey(null)

		setBusy(true)
		try {
			// The current password is what the API demands of a self-service change, and the
			// change signs every other session out - including this browser's refresh token.
			await api.setUserPassword(user.guid, { currentPassword, password })
			setCurrentPassword('')
			setPassword('')
			setRepeated('')
			setChanged(true)
		} catch (err) {
			setPasswordError(err)
		} finally {
			setBusy(false)
		}
	}

	return (
		<>
			<div className="page-header">
				<h1>{t('profile.title')}</h1>
			</div>

			<div className="settings-grid">
				<div className="card section">
					<h2>{t('profile.title')}</h2>
					<dl className="stats">
						<dt>{t('profile.email')}</dt>
						<dd>{user?.email}</dd>
						<dt>{t('profile.role')}</dt>
						<dd>{user?.role}</dd>
						<dt>{t('profile.usage')}</dt>
						<dd>{usage ? formatSize(usage.totalBytes) : <BlockSkeleton width={80} />}</dd>
					</dl>
					<ErrorText error={usageError} />

					<div className="field">
						<label htmlFor="profile-language">{t('profile.language')}</label>
						<select id="profile-language" value={language} onChange={(event) => setLanguage(event.target.value as Language)}>
							{LANGUAGES.map((code) => <option key={code} value={code}>{code.toUpperCase()}</option>)}
						</select>
					</div>
				</div>

				<div className="card section">
					<h2>{t('profile.changePassword')}</h2>
					<form onSubmit={(event) => void submit(event)}>
						<div className="field">
							<label htmlFor="profile-current-password">{t('profile.currentPassword')}</label>
							<input
								id="profile-current-password"
								type="password"
								autoComplete="current-password"
								value={currentPassword}
								onChange={(event) => setCurrentPassword(event.target.value)}
							/>
						</div>
						<div className="field">
							<label htmlFor="profile-password">{t('profile.newPassword')}</label>
							<input
								id="profile-password"
								type="password"
								autoComplete="new-password"
								value={password}
								onChange={(event) => setPassword(event.target.value)}
							/>
						</div>
						<div className="field">
							<label htmlFor="profile-password-repeat">{t('profile.repeatPassword')}</label>
							<input
								id="profile-password-repeat"
								type="password"
								autoComplete="new-password"
								value={repeated}
								onChange={(event) => setRepeated(event.target.value)}
							/>
						</div>

						{validationKey && <p className="error">{t(validationKey)}</p>}
						<ErrorText error={passwordError} />
						{changed && <p className="success">{t('profile.passwordChanged')}</p>}

						<button className="primary" type="submit" disabled={busy || !password}>{t('common.save')}</button>
					</form>
				</div>
			</div>
		</>
	)
}
