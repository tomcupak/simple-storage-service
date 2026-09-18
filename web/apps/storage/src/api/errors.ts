import Axios from 'axios'

import { cs, type TranslationKey } from '../i18n/translations'

/** Every management API failure answers with `{ code }`; the UI turns that code into a message
 *  instead of showing one generic sentence for everything.
 *
 *  A code the UI does not know yet falls back to the generic message rather than leaking the
 *  raw identifier - a new backend error stays readable until its translation is added. */
export function apiErrorKey(err: unknown): TranslationKey {
	if (!Axios.isAxiosError(err)) return 'error.unknown'
	// No response at all: the request never reached the API (offline, CORS, server down).
	if (!err.response) return 'error.network'

	const data = err.response.data as { code?: unknown } | undefined
	if (typeof data?.code !== 'string') return 'error.unknown'

	const key = `error.${data.code}`
	return key in cs ? (key as TranslationKey) : 'error.unknown'
}
