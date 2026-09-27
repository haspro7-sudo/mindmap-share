// Persistence (SPEC K-8). Every access is guarded: without storage one full night still works.
import type { NaviApi, NaviState } from './store/types'
import { params } from './params'
import { freshCollection, freshDeck, freshMetrics, freshOrders, freshRoom, freshUi } from './store/initial'
import { isObj, sanitizeCollection, sanitizeDeck, sanitizeMetrics, sanitizeOrders, sanitizeRoom, sanitizeSession } from './validate'

export const KEYS = {
  locale: 'shin-navi:locale',
  collection: 'shin-navi:v1:collection',
  night: 'shin-navi:v1:night',
  settings: 'shin-navi:v1:settings',
} as const

export function safeGet<T = unknown>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    return raw == null ? null : (JSON.parse(raw) as T)
  } catch {
    return null
  }
}

export function safeSet(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value))
    return true
  } catch {
    return false
  }
}

export function safeRemove(key: string): void {
  try {
    localStorage.removeItem(key)
  } catch {
    /* ignore */
  }
}

export function clearAllStorage(): void {
  safeRemove(KEYS.collection)
  safeRemove(KEYS.night)
  safeRemove(KEYS.settings)
}

type Versioned<T> = { v: 1; data: T }

export function serializeNight(s: NaviState) {
  return {
    session: { nightId: s.session.nightId, seed: s.session.seed, phase: s.session.phase, simMs: s.session.simMs, visit: s.session.visit, linked: s.session.linked, enteredAt: s.session.enteredAt },
    room: s.room,
    deck: { cards: s.deck.cards, round: s.deck.round, consumedInRound: s.deck.consumedInRound, offers: s.deck.offers, history: s.deck.history.slice(-20), selection: s.deck.selection, passStreak: s.deck.passStreak },
    orders: s.orders,
    metrics: s.metrics,
  }
}
export type NightSnapshot = ReturnType<typeof serializeNight>

export function serializeSettings(s: NaviState) {
  return { muted: s.session.muted, noDuck: s.session.noDuck, view: s.session.view, coach: s.ui.coach, speed: s.session.speed }
}
type Settings = ReturnType<typeof serializeSettings>

/** Collection from any older/other build: per-field shape checks (see validate.ts). */
export function migrateCollection(c: unknown): NaviState['col'] {
  return sanitizeCollection(c)
}

/**
 * Restore what we can, then start or continue the night.
 * live/wrap → continue with the short intro (also with ?seed= when it is the same seed: a
 * presenter's F5 on the demo URL keeps the night, SPEC N backup R6); closed → next visit
 * ("おかえり"); nothing, another seed or reset=1 → new night.
 * Any malformed snapshot falls back per field; if hydration still throws, storage is wiped and a
 * fresh night starts (QA ROBUST#1: never a blank page before a demo).
 */
export function loadPersisted(api: NaviApi): void {
  if (params.reset) clearAllStorage()
  try {
    hydrate(api)
  } catch (e) {
    console.warn('[storage] could not restore, starting fresh', e)
    clearAllStorage()
    const st = api.getState()
    api.setState({ room: freshRoom(), deck: freshDeck(), col: freshCollection(), orders: freshOrders(), metrics: freshMetrics(), ui: { ...freshUi(), reduced: st.ui.reduced } })
    api.getState().startNight(params.seed ? { seed: params.seed } : undefined)
  }
  if (params.speed) api.getState().setSpeed(params.speed)
  if (params.script) api.getState().setScript(true)
  if (params.view) api.getState().setView(params.view)
  if (params.seedNights) api.getState().seedPastNights(params.seedNights)
}

/** Whether a stored night may be continued under the current URL. */
export function canContinue(storedSeed: string, urlSeed: string | undefined): boolean {
  return !urlSeed || storedSeed === urlSeed
}

function hydrate(api: NaviApi): void {
  const settings = safeGet<Versioned<Settings>>(KEYS.settings)
  if (settings?.v === 1 && isObj(settings.data)) {
    const d = settings.data
    const view = d.view === 'phone' || d.view === 'room' || d.view === 'dual' ? d.view : 'auto'
    const speed = d.speed === 4 || d.speed === 8 ? d.speed : 1
    api.setState(st => ({
      session: { ...st.session, muted: !!d.muted, noDuck: !!d.noDuck, view, speed },
      ui: { ...st.ui, coach: { ghostHand: !!d.coach?.ghostHand, mixHint: !!d.coach?.mixHint } },
    }))
  }
  const col = safeGet<Versioned<unknown>>(KEYS.collection)
  if (col?.v === 1) api.setState({ col: migrateCollection(col.data) })

  const raw = safeGet<Versioned<Record<string, unknown>>>(KEYS.night)
  const data = raw?.v === 1 && isObj(raw.data) ? raw.data : null
  const session = data ? sanitizeSession(data.session) : null
  const haveNight = !!session && api.getState().col.nights.some(n => n.id === session.nightId)
  if (haveNight && data && session && (session.phase === 'live' || session.phase === 'wrap') && canContinue(session.seed, params.seed)) {
    const room = sanitizeRoom(data.room)
    const deck = sanitizeDeck(data.deck)
    api.setState(st => ({
      session: { ...st.session, ...session, intro: params.intro0 ? 'none' : 'short', introStartedAt: Date.now() },
      room,
      deck: { ...st.deck, ...deck, undo: null, primary: null, flippedId: null, redeal: null },
      orders: sanitizeOrders(data.orders),
      metrics: sanitizeMetrics(data.metrics),
      ui: session.phase === 'wrap' ? { ...st.ui, overlay: 'wrap' } : st.ui,
    }))
  } else if (haveNight && session && session.phase === 'closed') {
    api.setState(st => ({ session: { ...st.session, visit: session.visit, linked: session.linked } }))
    api.getState().startNight({ nextVisit: true })
  } else {
    api.getState().startNight(params.seed ? { seed: params.seed } : undefined)
  }
}

let frozen = false
/**
 * Stop all writes for the rest of this page's life (the root error panel's reset: the pending
 * write-behind flush on pagehide must not put the broken state back after the wipe).
 */
export function freezePersistence(): void {
  frozen = true
}

/** Write-behind persistence: collection and night throttled to 300ms, settings on change. */
export function installPersistence(api: NaviApi): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null
  let lastSettings = ''
  const flush = () => {
    timer = null
    if (frozen) return
    const s = api.getState()
    safeSet(KEYS.collection, { v: 1, data: s.col })
    safeSet(KEYS.night, { v: 1, data: serializeNight(s) })
  }
  const unsub = api.subscribe((s, prev) => {
    if (s.col !== prev.col || s.room !== prev.room || s.deck !== prev.deck || s.orders !== prev.orders || s.session.phase !== prev.session.phase || s.metrics !== prev.metrics) {
      if (!timer) timer = setTimeout(flush, 300)
    }
    if (frozen) return
    const settings = JSON.stringify(serializeSettings(s))
    if (settings !== lastSettings) {
      lastSettings = settings
      safeSet(KEYS.settings, { v: 1, data: serializeSettings(s) })
    }
  })
  const onHide = () => {
    if (timer) {
      clearTimeout(timer)
      flush()
    }
  }
  if (typeof window !== 'undefined') window.addEventListener('pagehide', onHide)
  return () => {
    unsub()
    if (typeof window !== 'undefined') window.removeEventListener('pagehide', onHide)
    if (timer) clearTimeout(timer)
  }
}
