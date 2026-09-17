import { useState } from 'react'

import { useAuth } from '../store/auth'

export function LoginPage() {
	const { login } = useAuth()
	const [email, setEmail] = useState('')
	const [password, setPassword] = useState('')
	const [error, setError] = useState<string | null>(null)
	const [submitting, setSubmitting] = useState(false)

	const submit = async (event: React.FormEvent) => {
		event.preventDefault()
		setSubmitting(true)
		setError(null)
		try {
			await login(email, password)
		} catch {
			setError('Přihlášení se nezdařilo')
		} finally {
			setSubmitting(false)
		}
	}

	return (
		<div className="centered">
			<form className="card login-card" onSubmit={(e) => void submit(e)}>
				<h1 style={{ fontSize: 18, marginTop: 0 }}>Přihlášení</h1>
				<div className="field">
					<label htmlFor="email">E-mail</label>
					<input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
				</div>
				<div className="field">
					<label htmlFor="password">Heslo</label>
					<input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
				</div>
				{error && <p className="error">{error}</p>}
				<button className="primary" type="submit" disabled={submitting} style={{ width: '100%' }}>
					{submitting ? 'Přihlašuji…' : 'Přihlásit'}
				</button>
			</form>
		</div>
	)
}
