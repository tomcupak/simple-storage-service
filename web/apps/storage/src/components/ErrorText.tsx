import { apiErrorKey } from '../api/errors'
import { useI18n } from '../i18n'

/** Renders whatever an API call threw as the message its `{ code }` maps to. */
export function ErrorText({ error }: { error: unknown }) {
	const { t } = useI18n()

	if (error === null || error === undefined) return null

	return <p className="error">{t(apiErrorKey(error))}</p>
}
