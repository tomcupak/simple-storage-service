import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'

import { api, type Identity } from '../api/client'
import { LS_ACCESS_TOKEN_KEY, LS_REFRESH_TOKEN_KEY } from '../api/customInstance'

interface AuthContextValue {
	initialized: boolean
	user: Identity | null
	login: (email: string, password: string) => Promise<void>
	logout: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue>({
	initialized: false,
	user: null,
	login: async () => {},
	logout: async () => {},
})

export function AuthProvider({ children }: { children: React.ReactNode }) {
	const [initialized, setInitialized] = useState(false)
	const [user, setUser] = useState<Identity | null>(null)

	const clearSession = useCallback(() => {
		localStorage.removeItem(LS_ACCESS_TOKEN_KEY)
		localStorage.removeItem(LS_REFRESH_TOKEN_KEY)
		setUser(null)
	}, [])

	const restore = useCallback(async () => {
		const accessToken = localStorage.getItem(LS_ACCESS_TOKEN_KEY)
		const refreshToken = localStorage.getItem(LS_REFRESH_TOKEN_KEY)

		if (accessToken) {
			try {
				setUser(await api.me())
				setInitialized(true)
				return
			} catch {
				// Falls through to the refresh attempt below - the access token is short-lived,
				// so an expired one on page load is the normal case, not an error.
			}
		}

		if (refreshToken) {
			try {
				const tokens = await api.refresh({ refreshToken })
				localStorage.setItem(LS_ACCESS_TOKEN_KEY, tokens.accessToken)
				localStorage.setItem(LS_REFRESH_TOKEN_KEY, tokens.refreshToken)
				setUser(await api.me())
				setInitialized(true)
				return
			} catch {
				clearSession()
			}
		}

		setInitialized(true)
	}, [clearSession])

	useEffect(() => { void restore() }, [restore])

	useEffect(() => {
		const onUnauthorized = () => clearSession()
		window.addEventListener('storage:auth:unauthorized', onUnauthorized)
		return () => window.removeEventListener('storage:auth:unauthorized', onUnauthorized)
	}, [clearSession])

	const login = useCallback(async (email: string, password: string) => {
		const tokens = await api.login({ email, password })
		localStorage.setItem(LS_ACCESS_TOKEN_KEY, tokens.accessToken)
		localStorage.setItem(LS_REFRESH_TOKEN_KEY, tokens.refreshToken)
		setUser(await api.me())
	}, [])

	const logout = useCallback(async () => {
		const refreshToken = localStorage.getItem(LS_REFRESH_TOKEN_KEY)
		if (refreshToken) await api.logout({ refreshToken }).catch(() => undefined)
		clearSession()
	}, [clearSession])

	const value = useMemo(() => ({ initialized, user, login, logout }), [initialized, user, login, logout])

	return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
	return useContext(AuthContext)
}
