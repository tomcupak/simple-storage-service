import { useState } from 'react'

import { ErrorText } from '../components/ErrorText'
import { type Language, LANGUAGES, useI18n } from '../i18n'
import { useAuth } from '../store/auth'

export function LoginPage() {
	const { login } = useAuth()
	const { t, language, setLanguage } = useI18n()
	const [email, setEmail] = useState('')
	const [password, setPassword] = useState('')
	const [error, setError] = useState<unknown>(null)
	const [submitting, setSubmitting] = useState(false)

	const submit = async (event: React.FormEvent) => {
		event.preventDefault()
		setSubmitting(true)
		setError(null)
		try {
			await login(email, password)
		} catch (err) {
			setError(err)
		} finally {
			setSubmitting(false)
		}
	}

	return (
		<div className="centered">
			<form className="card login-card" onSubmit={(event) => void submit(event)}>
				<h1>{t('login.title')}</h1>
				<div className="field">
					<label htmlFor="email">{t('login.email')}</label>
					<input id="email" type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} autoFocus />
				</div>
				<div className="field">
					<label htmlFor="password">{t('login.password')}</label>
					<input id="password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} />
				</div>

				<ErrorText error={error} />

				<button className="primary block" type="submit" disabled={submitting}>
					{submitting ? t('login.submitting') : t('login.submit')}
				</button>

				<div className="language-switch centered-row">
					{LANGUAGES.map((code) => (
						<button key={code} type="button" className={code === language ? 'active' : ''} onClick={() => setLanguage(code as Language)}>
							{code.toUpperCase()}
						</button>
					))}
				</div>
			</form>
		</div>
	)
}
