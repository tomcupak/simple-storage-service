import type { AxiosRequestConfig } from 'axios'
import Axios from 'axios'

export const LS_ACCESS_TOKEN_KEY = 'storage:access_token'
export const LS_REFRESH_TOKEN_KEY = 'storage:refresh_token'

/** Shared for the hand-written transfer calls in `transfer.ts` too, so uploads and downloads
 *  pick up the same base URL, auth header and 401 handling as the generated client. */
export const instance = Axios.create()

instance.interceptors.request.use((config) => {
	// Resolved per-request: window.config is filled from config.json after the app mounts,
	// so baking it into Axios.create() would freeze the index.html placeholder value.
	config.baseURL = window.config?.apiUrl ?? 'http://localhost:10410'
	const token = localStorage.getItem(LS_ACCESS_TOKEN_KEY)
	if (token) {
		config.headers.Authorization = `Bearer ${token}`
	}
	return config
})

instance.interceptors.response.use(undefined, (error) => {
	if (Axios.isAxiosError(error) && error.response?.status === 401) {
		window.dispatchEvent(new CustomEvent('storage:auth:unauthorized'))
	}
	return Promise.reject(error)
})

/** Mutator used by the Orval-generated client (`npm run orval:web-storage`). */
export const customInstance = <T>(config: AxiosRequestConfig): Promise<T> =>
	instance(config).then((res) => res.data)
