// Five-language UI (SPEC G). Every module registers its own namespace with defineStrings(ns, …);
// TextRef keys are "ns.key" and resolve from anywhere, re-resolving on every locale switch.
import { useSyncExternalStore } from 'react'
import { SONG_BY_ID } from '../data/songs'
import type { TextRef, TextVar, Locale } from '../core/types'

export type { Locale }

export const LOCALES: { id: Locale; label: string; short: string; htmlLang: string }[] = [
  { id: 'ja', label: '日本語', short: 'JA', htmlLang: 'ja' },
  { id: 'en', label: 'English', short: 'EN', htmlLang: 'en' },
  { id: 'zhHant', label: '繁體中文', short: '繁', htmlLang: 'zh-Hant' },
  { id: 'zhHans', label: '简体中文', short: '简', htmlLang: 'zh-Hans' },
  { id: 'ko', label: '한국어', short: 'KO', htmlLang: 'ko' },
]
export const LOCALE_IDS: Locale[] = LOCALES.map(l => l.id)

const KEY = 'shin-navi:locale'

function readParam(): Locale | null {
  try {
    const v = new URLSearchParams(location.search).get('locale') as Locale | null
    return v && LOCALE_IDS.includes(v) ? v : null
  } catch {
    return null
  }
}
function readStored(): Locale | null {
  try {
    const v = localStorage.getItem(KEY) as Locale | null
    return v && LOCALE_IDS.includes(v) ? v : null
  } catch {
    return null
  }
}
function fromNavigator(): Locale {
  try {
    const n = (navigator.language || 'ja').toLowerCase()
    if (n.startsWith('ko')) return 'ko'
    if (n.startsWith('zh-tw') || n.startsWith('zh-hk') || n.startsWith('zh-hant')) return 'zhHant'
    if (n.startsWith('zh')) return 'zhHans'
    if (n.startsWith('en')) return 'en'
  } catch {
    /* ignore */
  }
  return 'ja'
}

let current: Locale = typeof window === 'undefined' ? 'ja' : readParam() ?? readStored() ?? fromNavigator()
const subs = new Set<() => void>()
const changeHooks = new Set<(l: Locale) => void>()

function applyHtmlLang(l: Locale) {
  try {
    document.documentElement.lang = LOCALES.find(x => x.id === l)?.htmlLang ?? 'ja'
  } catch {
    /* no document */
  }
}
if (typeof document !== 'undefined') applyHtmlLang(current)

export function getLocale(): Locale {
  return current
}

export function setLocale(l: Locale): void {
  if (l === current || !LOCALE_IDS.includes(l)) return
  current = l
  try {
    localStorage.setItem(KEY, l)
  } catch {
    /* storage unavailable */
  }
  applyHtmlLang(l)
  subs.forEach(fn => fn())
  changeHooks.forEach(fn => fn(l))
}

/** For core wiring (emits locale/changed on the bus without i18n importing the bus). */
export function onLocaleChange(fn: (l: Locale) => void): () => void {
  changeHooks.add(fn)
  return () => changeHooks.delete(fn)
}

export function useLocale(): Locale {
  return useSyncExternalStore(
    fn => {
      subs.add(fn)
      return () => subs.delete(fn)
    },
    () => current,
    () => current,
  )
}

// ---------- registry

type Dict = Record<string, string>
export type Strings<K extends string> = { ja: Record<K, string> } & Partial<Record<Exclude<Locale, 'ja'>, Partial<Record<K, string>>>>

const registry = new Map<string, Strings<string>>()

/** Namespaces that may fall back to English (internal tools, SPEC G-2). */
export const INTERNAL_NAMESPACES = new Set(['presenter', 'planner'])

export type Translate<K extends string> = (key: K, vars?: Record<string, TextVar>) => string

/**
 * Register a namespace. Returns a typed local translator for convenience;
 * keys are also resolvable globally as "ns.key" through tr()/useTr().
 */
export function defineStrings<K extends string>(ns: string, strings: Strings<K>) {
  registry.set(ns, strings as Strings<string>)
  const t: Translate<K> = (key, vars) => resolve(ns, key, vars, current)
  const useT = (): Translate<K> => {
    const l = useLocale()
    return (key, vars) => resolve(ns, key, vars, l)
  }
  return { t, useT, ref: (key: K, vars?: Record<string, TextVar>): TextRef => ({ key: `${ns}.${key}`, vars }) }
}

export function registeredNamespaces(): string[] {
  return [...registry.keys()]
}
export function namespaceStrings(ns: string): Strings<string> | undefined {
  return registry.get(ns)
}

function lookup(ns: string, key: string, l: Locale): string | undefined {
  const s = registry.get(ns)
  if (!s) return undefined
  const d = s as unknown as Record<Locale, Dict | undefined>
  return d[l]?.[key] ?? d.en?.[key] ?? d.ja?.[key]
}

function resolve(ns: string, key: string, vars: Record<string, TextVar> | undefined, l: Locale): string {
  const raw = lookup(ns, key, l)
  if (raw == null) return `${ns}.${key}`
  return format(raw, vars, l)
}

function format(s: string, vars: Record<string, TextVar> | undefined, l: Locale): string {
  if (!vars) return s
  return s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? varText(vars[k], l) : m))
}

/** Resolve a variable in the viewing language. */
export function varText(v: TextVar, l: Locale = current): string {
  if (typeof v === 'string' || typeof v === 'number') return String(v)
  if ('song' in v) return songTitle(v.song, l).main
  if ('member' in v) return lookup('vocab', `member.${v.member}`, l) ?? v.member
  if ('genre' in v) return lookup('vocab', `genre.${v.genre}`, l) ?? v.genre
  if ('tempo' in v) return lookup('vocab', `tempo.${v.tempo}`, l) ?? v.tempo
  if ('locale' in v) return lookup('vocab', `locale.${v.locale}`, l) ?? v.locale
  if ('vibe' in v) return lookup('vocab', `vibe.${v.vibe}`, l) ?? v.vibe
  if ('date' in v) return formatDate(v.date, l)
  if ('pair' in v) {
    const [a, b] = [...v.pair].sort()
    return lookup('vocab', `pair.${a}_${b}`, l) ?? `${a}×${b}`
  }
  return ''
}

function formatDate(ms: number, l: Locale): string {
  const tag = LOCALES.find(x => x.id === l)?.htmlLang ?? 'ja'
  try {
    return new Intl.DateTimeFormat(tag, { month: 'numeric', day: 'numeric' }).format(new Date(ms))
  } catch {
    const d = new Date(ms)
    return `${d.getMonth() + 1}/${d.getDate()}`
  }
}

/** Resolve a TextRef ("ns.key") in a given locale. */
export function trIn(ref: TextRef, l: Locale): string {
  const dot = ref.key.indexOf('.')
  if (dot < 0) return ref.key
  return resolve(ref.key.slice(0, dot), ref.key.slice(dot + 1), ref.vars, l)
}

/** Non-hook resolution in the current locale. */
export function tr(ref: TextRef): string {
  return trIn(ref, current)
}

/** Hook: returns a resolver bound to the current locale (re-renders on switch). */
export function useTr(): (ref: TextRef) => string {
  const l = useLocale()
  return ref => trIn(ref, l)
}

// ---------- song titles (SPEC G-4)

export type TitleParts = { main: string; sub: string | null; romaji: string | null; original: string }

export function songTitle(songId: string, l: Locale = current): TitleParts {
  const s = SONG_BY_ID[songId]
  if (!s) return { main: songId, sub: null, romaji: null, original: songId }
  const t = s.inboundTitle
  const romaji = t.romaji && t.romaji !== s.title ? t.romaji : null
  switch (l) {
    case 'ja':
      return { main: s.title, sub: null, romaji, original: s.title }
    case 'en': {
      const main = t.en ?? t.romaji ?? s.title
      return { main, sub: main !== s.title ? s.title : null, romaji, original: s.title }
    }
    case 'zhHant':
    case 'zhHans':
    case 'ko': {
      const local = t[l]
      const main = local ?? t.en ?? t.romaji ?? s.title
      const sub = main !== s.title ? s.title : null
      return { main, sub, romaji, original: s.title }
    }
  }
}

/** Backwards-compatible helper used by early code. */
export function localTitle(titles: { romaji?: string; en?: string; zhHant?: string; zhHans?: string; ko?: string }, _original: string, locale: Locale): string | null {
  switch (locale) {
    case 'ja':
      return null
    case 'en':
      return titles.en ?? titles.romaji ?? null
    default:
      return titles[locale] ?? titles.en ?? titles.romaji ?? null
  }
}
