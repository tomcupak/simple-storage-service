import { useEffect, useState } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router'

import { UserRole } from './api/client'
import { Layout } from './components/Layout'
import { AccessKeysPage } from './pages/AccessKeys'
import { BucketDetailPage } from './pages/BucketDetail'
import { BucketsPage } from './pages/Buckets'
import { LoadingPage } from './pages/Loading'
import { LoginPage } from './pages/Login'
import { UsersPage } from './pages/Users'
import { AuthProvider, useAuth } from './store/auth'

export enum AppPaths {
	Buckets = '/',
	BucketDetail = '/buckets/:bucketName',
	AccessKeys = '/access-keys',
	Users = '/users',
}

export const buildPath = {
	bucketDetail: (bucketName: string) => `/buckets/${bucketName}`,
}

export interface AppConfig {
	apiUrl: string
}

export default function App() {
	const [config, setConfig] = useState<AppConfig | undefined>()

	useEffect(() => {
		fetch('/config.json')
			.then((res) => res.json())
			.then((cfg: AppConfig) => {
				if (typeof cfg?.apiUrl !== 'string') throw new Error('Invalid config')
				window.config = { apiUrl: cfg.apiUrl }
				setConfig(cfg)
			})
			.catch((err) => {
				console.error(err)
				setTimeout(() => window.location.reload(), 5_000)
			})
	}, [])

	if (!config) return <LoadingPage />

	return (
		<AuthProvider>
			<Router />
		</AuthProvider>
	)
}

function Router() {
	const { initialized, user } = useAuth()

	if (!initialized) return <LoadingPage />
	if (!user) return <LoginPage />

	return (
		<BrowserRouter>
			<Layout>
				<Routes>
					<Route path={AppPaths.Buckets} element={<BucketsPage />} />
					<Route path={AppPaths.BucketDetail} element={<BucketDetailPage />} />
					<Route path={AppPaths.AccessKeys} element={<AccessKeysPage />} />
					{user.role === UserRole.admin && <Route path={AppPaths.Users} element={<UsersPage />} />}
					<Route path="*" element={<Navigate to={AppPaths.Buckets} replace />} />
				</Routes>
			</Layout>
		</BrowserRouter>
	)
}
