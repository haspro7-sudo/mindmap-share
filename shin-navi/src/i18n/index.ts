// Five-language UI. Each feature module declares its own strings with defineStrings(),
// so modules never edit a shared dictionary file.
import { useSyncExternalStore } from 'react'

export type Locale = 'ja' | 'en' | 'zhHant' | 'zhHans' | 'ko'

export const LOCALES: { id: Locale; label: string; short: string; htmlLang: string }[] = [
  { id: 'ja', label: '日本語', short: 'JA', htmlLang: 'ja' },
  { id: 'en', label: 'English', short: 'EN', htmlLang: 'en' },
  { id: 'zhHant', label: '繁體中文', short: '繁', htmlLang: 'zh-Hant' },
  { id: 'zhHans', label: '简体中文', short: '简', htmlLang: 'zh-Hans' },
  { id: 'ko', label: '한국어', short: 'KO', htmlLang: 'ko' },
]

const KEY = 'shin-navi:locale'
let current: Locale = (() => {
  try {
    const v = localStorage.getItem(KEY) as Locale | null
    if (v && LOCALES.some(l => l.id === v)) return v
  } catch {
    /* storage unavailable */
  }
  return 'ja'
})()
const subs = new Set<() => void>()

export function getLocale(): Locale {
  return current
}

export function setLocale(l: Locale): void {
  if (l === current) return
  current = l
  try {
    localStorage.setItem(KEY, l)
  } catch {
    /* storage unavailable */
  }
  document.documentElement.lang = LOCALES.find(x => x.id === l)?.htmlLang ?? 'ja'
  subs.forEach(fn => fn())
}

export function useLocale(): Locale {
  return useSyncExternalStore(
    fn => {
      subs.add(fn)
      return () => subs.delete(fn)
    },
    () => current,
  )
}

type Dict<K extends string> = Record<K, string>
/** Japanese is required; other locales fall back to English, then Japanese. */
export type Strings<K extends string> = { ja: Dict<K> } & Partial<Record<Exclude<Locale, 'ja'>, Partial<Dict<K>>>>

export type Translate<K extends string> = (key: K, vars?: Record<string, string | number>) => string

function format(s: string, vars?: Record<string, string | number>): string {
  if (!vars) return s
  return s.replace(/\{(\w+)\}/g, (_, k) => (k in vars ? String(vars[k]) : `{${k}}`))
}

export function defineStrings<K extends string>(strings: Strings<K>) {
  const tr = (locale: Locale): Translate<K> => (key, vars) => {
    const s = strings[locale]?.[key] ?? strings.en?.[key] ?? strings.ja[key] ?? key
    return format(s, vars)
  }
  /** Hook: re-renders on locale change. */
  const useT = (): Translate<K> => tr(useLocale())
  /** Non-hook access (event handlers, engine text). */
  const t: Translate<K> = (key, vars) => tr(current)(key, vars)
  return { useT, t, strings }
}

/** Song title as a visitor would search for it: local script, then romaji. */
export function localTitle(titles: { romaji?: string; en?: string; zhHant?: string; zhHans?: string; ko?: string }, original: string, locale: Locale): string | null {
  switch (locale) {
    case 'ja':
      return null
    case 'en':
      return titles.en ?? titles.romaji ?? null
    case 'zhHant':
      return titles.zhHant ?? titles.en ?? titles.romaji ?? null
    case 'zhHans':
      return titles.zhHans ?? titles.en ?? titles.romaji ?? null
    case 'ko':
      return titles.ko ?? titles.en ?? titles.romaji ?? null
  }
  return original
}
