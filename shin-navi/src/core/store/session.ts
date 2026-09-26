// Session slice: night lifecycle, simulated time, audio flags, view mode.
import type { StateCreator } from 'zustand'
import type { NaviState, SessionSlice } from './types'
import { freshCollection, freshDeck, freshMetrics, freshNight, freshOrders, freshRoom, freshSession, freshUi, todayKey, uid } from './initial'
import { bus } from '../events'
import { params } from '../params'
import { SONG_BY_ID } from '../../data/songs'
import { IMPORT_DEMO } from '../../data/tables'
import { AURORA_PALETTES, heatBucket, moodWordFor, roomMinutesLeft, simMsForMinutesLeft } from '../rules'
import { clearAllStorage } from '../storage'
import type { AuroraKey } from '../types'

/** Queue head starts playing only after the undo window has passed (real ms). */
const START_GRACE_MS = 3500
const emittedMinutes = new Set<string>()

export const createSessionSlice: StateCreator<NaviState, [], [], SessionSlice> = (set, get) => ({
  session: freshSession('boot', 1, 'boot'),

  startNight(o) {
    const prev = get().session
    const col = get().col
    const realNights = col.nights.filter(n => !n.seeded)
    const visit = o?.nextVisit ? Math.max(prev.visit + 1, realNights.length + 1) : realNights.length + 1
    const seed = o?.seed ?? params.seed ?? `night-${todayKey()}-${visit}`
    const nightId = uid(`n${todayKey()}`)
    const session = {
      ...freshSession(seed, visit, nightId),
      muted: prev.muted,
      noDuck: prev.noDuck,
      script: prev.script,
      speed: prev.speed,
      view: prev.view,
      audioOn: prev.audioOn,
      intro: params.intro0 ? ('none' as const) : ('full' as const),
    }
    const room = freshRoom()
    if (o?.nextVisit || visit > 1) {
      room.moodWord = 'back'
      room.wordOverrideUntil = Date.now() + 1500
    }
    // Subscription favourites waiting to be brought in (demo data), kept across nights.
    const imports = col.imports.length
      ? col.imports
      : IMPORT_DEMO.map(id => ({ songId: id, versions: SONG_BY_ID[id]?.versions ?? ['original'], status: 'candidate' as const }))
    set(s => ({
      session,
      room,
      deck: freshDeck(),
      orders: freshOrders(),
      metrics: freshMetrics(),
      ui: { ...freshUi(), coach: s.ui.coach, reduced: s.ui.reduced },
      col: { ...s.col, imports, nights: [...s.col.nights, freshNight(nightId)] },
    }))
    bus.emit({ type: 'night/started', nightId, visit })
  },

  tick(realDtMs) {
    const s = get()
    if (s.session.phase !== 'live') return
    const speed = s.session.speed
    const simMs = s.session.simMs + realDtMs * speed
    const nowReal = Date.now()
    const room = s.room
    let moodWord = room.moodWord
    let wordOverrideUntil = room.wordOverrideUntil
    if (wordOverrideUntil && nowReal >= wordOverrideUntil) {
      wordOverrideUntil = 0
      moodWord = moodWordFor({
        heat: room.heat,
        trend: room.trend,
        started: room.sung.length > 0 || room.now != null,
        recentEnergies: room.sung.map(e => SONG_BY_ID[e.item.songId]?.energy ?? 0.5),
      })
    }
    const bubbles = room.bubbles.filter(b => b.at + b.ttl > nowReal)
    set({
      session: { ...s.session, simMs },
      room: bubbles.length !== room.bubbles.length || moodWord !== room.moodWord || wordOverrideUntil !== room.wordOverrideUntil ? { ...room, bubbles, moodWord, wordOverrideUntil } : room,
    })
    if (moodWord !== room.moodWord) bus.emit({ type: 'heat/changed', heat: room.heat, word: moodWord })

    // Songs move on their own outside script mode.
    if (!s.session.script) {
      const st = get()
      const now = st.room.now
      if (now && simMs - now.startedAt >= now.durationMs) st.finishNow()
      else if (!now && st.room.queue.length) {
        const head = st.room.queue[0]
        if (simMs - head.addedAt >= START_GRACE_MS * speed) st.startNext()
      }
    }
    checkMinutes(get().session.nightId, simMs)
  },

  setSpeed(speed) {
    set(s => ({ session: { ...s.session, speed } }))
  },

  jumpToMinutesLeft(m) {
    const target = simMsForMinutesLeft(m)
    set(s => {
      const delta = target - s.session.simMs
      const now = s.room.now ? { ...s.room.now, startedAt: s.room.now.startedAt + delta } : null
      return { session: { ...s.session, simMs: target }, room: { ...s.room, now, queue: s.room.queue.map(q => ({ ...q, addedAt: q.addedAt + delta })) } }
    })
    checkMinutes(get().session.nightId, target)
  },

  markIntroDone() {
    set(s => ({ session: { ...s.session, enteredAt: Date.now() } }))
    bus.emit({ type: 'intro/done' })
  },

  unlockAudio() {
    if (!get().session.audioOn) set(s => ({ session: { ...s.session, audioOn: true } }))
  },
  setMuted(muted) {
    set(s => ({ session: { ...s.session, muted } }))
  },
  setNoDuck(noDuck) {
    set(s => ({ session: { ...s.session, noDuck } }))
  },
  setScript(script) {
    set(s => ({ session: { ...s.session, script, noDuck: script ? true : s.session.noDuck } }))
  },
  setView(view) {
    set(s => ({ session: { ...s.session, view } }))
  },

  exitRoom() {
    const s = get()
    if (s.session.phase !== 'live') return
    s.closeOrders()
    set(st => ({
      session: { ...st.session, phase: 'wrap' },
      room: { ...st.room, prompt: null, invites: st.room.invites.filter(i => i.status !== 'open'), bubbles: [] },
      ui: { ...st.ui, sheet: null, overlay: 'wrap', tab: 'discover' },
      col: { ...st.col, nights: st.col.nights.map(n => (n.id === st.session.nightId ? { ...n, endedAt: Date.now() } : n)) },
    }))
  },

  closeNight({ linked }) {
    set(st => {
      const sung = st.room.sung
      const buckets: Record<string, number> = {}
      for (const e of sung) buckets[heatBucket(e.heatAfter)] = (buckets[heatBucket(e.heatAfter)] ?? 0) + 1
      // Heat buckets share names with aurora palettes.
      const top = (Object.entries(buckets).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'quiet') as AuroraKey
      const palette = [...AURORA_PALETTES[top]] as [string, string, string]
      return {
        session: { ...st.session, phase: 'closed', linked: linked || st.session.linked },
        ui: { ...st.ui, overlay: null, sheet: null },
        col: { ...st.col, nights: st.col.nights.map(n => (n.id === st.session.nightId ? { ...n, endedAt: n.endedAt ?? Date.now(), palette } : n)) },
      }
    })
  },

  resetAll() {
    clearAllStorage()
    emittedMinutes.clear()
    set(s => ({
      session: { ...freshSession('boot', 1, 'boot'), muted: s.session.muted },
      room: freshRoom(),
      deck: freshDeck(),
      col: freshCollection(),
      orders: freshOrders(),
      ui: freshUi(),
      metrics: freshMetrics(),
    }))
    get().startNight()
  },
})

function checkMinutes(nightId: string, simMs: number) {
  const left = roomMinutesLeft(simMs)
  for (const m of [15, 5, 0] as const) {
    const key = `${nightId}:${m}`
    if (left <= m && !emittedMinutes.has(key)) {
      emittedMinutes.add(key)
      bus.emit({ type: 'minutes/left', m })
    }
  }
}
