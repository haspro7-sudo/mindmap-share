// Persistence (SPEC K-8). Every access is guarded: without storage one full night still works.
import type { NaviApi, NaviState } from './store/types'
import { params } from './params'
import { freshCollection } from './store/initial'

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
type NightSnapshot = ReturnType<typeof serializeNight>

export function serializeSettings(s: NaviState) {
  return { muted: s.session.muted, noDuck: s.session.noDuck, view: s.session.view, coach: s.ui.coach, speed: s.session.speed }
}
type Settings = ReturnType<typeof serializeSettings>

function migrateCollection(c: Partial<NaviState['col']> | null | undefined): NaviState['col'] {
  const base = freshCollection()
  if (!c || typeof c !== 'object') return base
  return {
    faces: c.faces ?? base.faces,
    links: c.links ?? base.links,
    nights: c.nights ?? base.nights,
    pins: c.pins ?? base.pins,
    voices: c.voices ?? base.voices,
    saved: c.saved ?? base.saved,
    imports: c.imports ?? base.imports,
    passReasons: c.passReasons ?? base.passReasons,
  }
}

/**
 * Restore what we can, then start or continue the night.
 * live → continue with the short intro; closed → next visit ("おかえり"); nothing → new night.
 */
export function loadPersisted(api: NaviApi): void {
  if (params.reset) clearAllStorage()
  const settings = safeGet<Versioned<Settings>>(KEYS.settings)
  if (settings?.v === 1 && settings.data) {
    const d = settings.data
    api.setState(st => ({
      session: { ...st.session, muted: !!d.muted, noDuck: !!d.noDuck, view: d.view ?? 'auto', speed: d.speed ?? 1 },
      ui: { ...st.ui, coach: { ghostHand: !!d.coach?.ghostHand, mixHint: !!d.coach?.mixHint } },
    }))
  }
  const col = safeGet<Versioned<NaviState['col']>>(KEYS.collection)
  if (col?.v === 1) api.setState({ col: migrateCollection(col.data) })

  const night = safeGet<Versioned<NightSnapshot>>(KEYS.night)
  const haveNight = night?.v === 1 && night.data?.session && api.getState().col.nights.some(n => n.id === night.data.session.nightId)
  if (haveNight && (night!.data.session.phase === 'live' || night!.data.session.phase === 'wrap') && !params.seed) {
    const d = night!.data
    api.setState(st => ({
      session: { ...st.session, ...d.session, intro: params.intro0 ? 'none' : 'short', introStartedAt: Date.now() },
      room: { ...st.room, ...d.room },
      deck: { ...st.deck, ...d.deck, undo: null, primary: null, flippedId: null, redeal: null },
      orders: d.orders,
      metrics: { ...st.metrics, ...d.metrics },
      ui: d.session.phase === 'wrap' ? { ...st.ui, overlay: 'wrap' } : st.ui,
    }))
  } else if (haveNight && night!.data.session.phase === 'closed') {
    api.setState(st => ({ session: { ...st.session, visit: night!.data.session.visit, linked: night!.data.session.linked } }))
    api.getState().startNight({ nextVisit: true })
  } else {
    api.getState().startNight(params.seed ? { seed: params.seed } : undefined)
  }

  if (params.speed) api.getState().setSpeed(params.speed)
  if (params.script) api.getState().setScript(true)
  if (params.view) api.getState().setView(params.view)
  if (params.seedNights) api.getState().seedPastNights(params.seedNights)
}

/** Write-behind persistence: collection and night throttled to 300ms, settings on change. */
export function installPersistence(api: NaviApi): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null
  let lastSettings = ''
  const flush = () => {
    timer = null
    const s = api.getState()
    safeSet(KEYS.collection, { v: 1, data: s.col })
    safeSet(KEYS.night, { v: 1, data: serializeNight(s) })
  }
  const unsub = api.subscribe((s, prev) => {
    if (s.col !== prev.col || s.room !== prev.room || s.deck !== prev.deck || s.orders !== prev.orders || s.session.phase !== prev.session.phase || s.metrics !== prev.metrics) {
      if (!timer) timer = setTimeout(flush, 300)
    }
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
