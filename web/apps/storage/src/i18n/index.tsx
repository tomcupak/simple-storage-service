import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'

import { type Language, type TranslationKey,translations } from './translations'

export type { Language, TranslationKey } from './translations'

export const LS_LANGUAGE_KEY = 'storage:language'

export const LANGUAGES = Object.keys(translations) as Language[]

/** English is what an unconfigured UI speaks. Czech is the source of truth of the translation
 *  file, but not of the interface - a new visitor gets the language the most people read. */
export const DEFAULT_LANGUAGE: Language = 'en'

/** Placeholders are `{name}`, filled from the values passed to `t`. */
export type TranslationValues = Record<string, string | number>

interface I18nContextValue {
	language: Language
	setLanguage: (language: Language) => void
	t: (key: TranslationKey, values?: TranslationValues) => string
}

const I18nContext = createContext<I18nContextValue>({
	language: DEFAULT_LANGUAGE,
	setLanguage: () => {},
	t: (key) => key,
})

/** Only an explicit choice moves the UI off English; the browser's own language does not,
 *  so the interface does not change under a user who never asked it to. */
function detectLanguage(): Language {
	const stored = localStorage.getItem(LS_LANGUAGE_KEY)
	if (stored && LANGUAGES.includes(stored as Language)) return stored as Language

	return DEFAULT_LANGUAGE
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
	const [language, setLanguageState] = useState<Language>(detectLanguage)

	useEffect(() => {
		document.documentElement.lang = language
	}, [language])

	// Only a choice is stored - the default is left unrecorded, so it keeps following
	// `DEFAULT_LANGUAGE` instead of being frozen into every visitor's browser on first load.
	const setLanguage = useCallback((next: Language) => {
		localStorage.setItem(LS_LANGUAGE_KEY, next)
		setLanguageState(next)
	}, [])

	const t = useCallback((key: TranslationKey, values?: TranslationValues) => {
		const template = translations[language][key]

		return values
			? template.replace(/\{(\w+)\}/g, (match, name: string) => String(values[name] ?? match))
			: template
	}, [language])

	const value = useMemo(() => ({ language, setLanguage, t }), [language, setLanguage, t])

	return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n(): I18nContextValue {
	return useContext(I18nContext)
}
