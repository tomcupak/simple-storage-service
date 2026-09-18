import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'

import { type Language, type TranslationKey,translations } from './translations'

export type { Language, TranslationKey } from './translations'

export const LS_LANGUAGE_KEY = 'storage:language'

export const LANGUAGES = Object.keys(translations) as Language[]

/** Placeholders are `{name}`, filled from the values passed to `t`. */
export type TranslationValues = Record<string, string | number>

interface I18nContextValue {
	language: Language
	setLanguage: (language: Language) => void
	t: (key: TranslationKey, values?: TranslationValues) => string
}

const I18nContext = createContext<I18nContextValue>({
	language: 'cs',
	setLanguage: () => {},
	t: (key) => key,
})

function detectLanguage(): Language {
	const stored = localStorage.getItem(LS_LANGUAGE_KEY)
	if (stored && LANGUAGES.includes(stored as Language)) return stored as Language

	return navigator.language.toLowerCase().startsWith('cs') ? 'cs' : 'en'
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
	const [language, setLanguageState] = useState<Language>(detectLanguage)

	useEffect(() => {
		localStorage.setItem(LS_LANGUAGE_KEY, language)
		document.documentElement.lang = language
	}, [language])

	const t = useCallback((key: TranslationKey, values?: TranslationValues) => {
		const template = translations[language][key]

		return values
			? template.replace(/\{(\w+)\}/g, (match, name: string) => String(values[name] ?? match))
			: template
	}, [language])

	const value = useMemo(() => ({ language, setLanguage: setLanguageState, t }), [language, t])

	return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n(): I18nContextValue {
	return useContext(I18nContext)
}
