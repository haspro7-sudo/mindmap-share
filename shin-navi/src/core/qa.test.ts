// QA fix round 1 (core): reload/continue, persisted-shape validation, exit privacy, all-know log,
// script-mode first song, and the demo-path-safe past nights.
import { beforeEach, describe, expect, it } from 'vitest'
import { naviApi } from './store'
import { bus } from './events'
import { params } from './params'
import { KEYS, canContinue, loadPersisted, safeGet, safeSet, serializeNight } from './storage'
import { sanitizeCollection, sanitizeRoom } from './validate'
import { selRoomUnlinked } from './selectors'
import { advanceForTest } from './clock'
import { autoView, dualFit } from './layout'
import type { DeckCard } from './types'
import { SONG_BY_ID } from '../data/songs'
import { DEMO_PATH, DEMO_SONGS, SEED_NIGHT_SONGS } from '../data/tables'
import { songsForVoice } from '../engine/reading'
import '../i18n/vocab'
import '../i18n/reason'
import '../i18n/core'

class MemStorage {
  m = new Map<string, string>()
  getItem(k: string) {
    return this.m.has(k) ? this.m.get(k)! : null
  }
  setItem(k: string, v: string) {
    this.m.set(k, String(v))
  }
  removeItem(k: string) {
    this.m.delete(k)
  }
  clear() {
    this.m.clear()
  }
}
;(globalThis as unknown as { localStorage: MemStorage }).localStorage = new MemStorage()

const S = () => naviApi.getState()
const card = (id: string, songId: string): DeckCard => ({ id, kind: 'song', songId, reason: { source: 'yomu', text: { key: 'reason.opener' } }, trigger: { type: 'enter', at: 0 }, rule: 'test', dealtAt: 0 })

/** What installPersistence would have written by now. */
function persist() {
  safeSet(KEYS.night, { v: 1, data: serializeNight(S()) })
  safeSet(KEYS.collection, { v: 1, data: S().col })
}

function fresh() {
  bus.clear()
  localStorage.clear()
  params.seed = undefined
  params.script = false
  params.seedNights = undefined
  S().resetAll()
}

describe('reload continues the night (ROBUST#0 / DEMO#9)', () => {
  beforeEach(fresh)

  it('canContinue: same seed or no seed in the URL', () => {
    expect(canContinue('demo', 'demo')).toBe(true)
    expect(canContinue('night-1', undefined)).toBe(true)
    expect(canContinue('demo', 'other')).toBe(false)
  })

  it('?seed=demo reload keeps nightId, queue, orders and visit; three reloads add no nights', () => {
    params.seed = 'demo'
    S().startNight({ seed: 'demo' })
    S().reserve('ao-to-natsu', { by: 'me' })
    S().reserve('gurenge', { by: 'minato' })
    S().placeOrder('water')
    const nightId = S().session.nightId
    const visit = S().session.visit
    const nights = S().col.nights.length
    for (let i = 0; i < 3; i++) {
      persist()
      // a reload: the in-memory state is gone, only storage remains
      naviApi.setState(st => ({ room: { ...st.room, queue: [] }, orders: { list: [], closed: false } }))
      loadPersisted(naviApi)
      expect(S().session.nightId).toBe(nightId)
      expect(S().session.intro).toBe('short')
      expect(S().session.visit).toBe(visit)
      expect(S().room.queue.map(q => q.songId)).toEqual(['ao-to-natsu', 'gurenge'])
      expect(S().orders.list).toHaveLength(1)
      expect(S().col.nights).toHaveLength(nights)
    }
  })

  it('reloading the recap (wrap) keeps the recap', () => {
    params.seed = 'demo'
    S().startNight({ seed: 'demo' })
    S().exitRoom()
    const nightId = S().session.nightId
    persist()
    naviApi.setState(st => ({ ui: { ...st.ui, overlay: null } }))
    loadPersisted(naviApi)
    expect(S().session.nightId).toBe(nightId)
    expect(S().session.phase).toBe('wrap')
    expect(S().ui.overlay).toBe('wrap')
  })

  it('another seed starts a fresh night; the empty open night is dropped, visit stays 1', () => {
    S().startNight({ seed: 'a' })
    const before = S().session.nightId
    persist()
    params.seed = 'b'
    loadPersisted(naviApi)
    expect(S().session.nightId).not.toBe(before)
    expect(S().session.seed).toBe('b')
    expect(S().session.visit).toBe(1)
    expect(S().col.nights.some(n => n.id === before)).toBe(false)
    expect(S().col.nights.filter(n => !n.seeded)).toHaveLength(1)
  })

  it('visit counts closed real nights only', () => {
    expect(S().session.visit).toBe(1)
    S().startNight()
    S().startNight()
    expect(S().session.visit).toBe(1)
    S().exitRoom()
    S().closeNight({ linked: false })
    S().startNight({ nextVisit: true })
    expect(S().session.visit).toBe(2)
    S().seedPastNights(2)
    S().startNight()
    expect(S().session.visit).toBe(2)
  })

  it('an open night with something in it is closed, not orphaned', () => {
    S().faceEvent('ao-to-natsu', 'keep')
    const first = S().session.nightId
    S().startNight()
    const old = S().col.nights.find(n => n.id === first)
    expect(old?.endedAt).toBeTypeOf('number')
    expect(S().session.visit).toBe(2)
  })
})

describe('persisted shapes (ROBUST#1)', () => {
  beforeEach(fresh)

  it('a night snapshot without orders / with room.queue=null falls back per field', () => {
    S().reserve('ao-to-natsu', { by: 'me' })
    persist()
    const raw = safeGet<{ v: 1; data: Record<string, unknown> }>(KEYS.night)!
    delete raw.data.orders
    ;(raw.data.room as Record<string, unknown>).queue = null
    ;(raw.data.deck as Record<string, unknown>).cards = 'x'
    safeSet(KEYS.night, raw)
    expect(() => loadPersisted(naviApi)).not.toThrow()
    expect(S().orders.list).toEqual([])
    expect(S().room.queue).toEqual([])
    expect(Array.isArray(S().deck.cards)).toBe(true)
    expect(S().session.phase).toBe('live')
  })

  it('a drifted collection keeps what is valid', () => {
    const col = sanitizeCollection({ faces: { lemon: { state: 'neon', marks: 'x' }, nope: { state: 'neon' }, koi: { state: 'weird' } }, nights: 'x', pins: 5, links: [{ a: 'lemon', b: 'koi' }, { a: 1 }] })
    expect(Object.keys(col.faces)).toEqual(['lemon'])
    expect(col.faces.lemon.marks).toEqual([])
    expect(col.nights).toEqual([])
    expect(col.pins).toEqual([])
    expect(col.links).toHaveLength(1)
    expect(Array.isArray(col.saved) && Array.isArray(col.imports) && Array.isArray(col.voices)).toBe(true)
  })

  it('loading a broken collection never throws and starts a live night', () => {
    safeSet(KEYS.collection, { v: 1, data: { faces: [], nights: 'x', pins: 5 } })
    safeSet(KEYS.night, { v: 1, data: { session: 7, room: 'x' } })
    expect(() => loadPersisted(naviApi)).not.toThrow()
    expect(S().session.phase).toBe('live')
    expect(S().col.nights.some(n => n.id === S().session.nightId)).toBe(true)
  })

  it('a room with members missing gets the fresh roster', () => {
    const r = sanitizeRoom({ members: { me: { present: true } }, queue: [{ id: 'q1', songId: 'lemon', by: 'saki' }, { id: 'q2', songId: 'nope', by: 'me' }], now: { item: null } })
    expect(Object.keys(r.members).sort()).toEqual(['jun', 'me', 'minato', 'saki'])
    expect(r.queue.map(q => q.songId)).toEqual(['lemon'])
    expect(r.now).toBeNull()
  })
})

describe('退室 unlinks the room screen (POLICY#0 / DEMO#11 / ROBUST#3)', () => {
  beforeEach(fresh)

  it('my NOW is finished and counted, my queued songs leave, I leave the room, orders close', () => {
    S().reserve('ao-to-natsu', { by: 'me' })
    S().startNext()
    S().reserve('gurenge', { by: 'minato' })
    S().reserve('marigold', { by: 'me' })
    S().reserve('lemon', { by: 'saki', with: 'me' })
    S().placeOrder('water')
    S().exitRoom()
    const s = S()
    expect(s.session.phase).toBe('wrap')
    expect(selRoomUnlinked(s)).toBe(true)
    expect(s.room.now).toBeNull()
    expect(s.room.sung.map(e => e.item.songId)).toEqual(['ao-to-natsu'])
    expect(s.col.faces['ao-to-natsu'].state).toBe('mirror')
    expect(s.room.queue.map(q => q.songId)).toEqual(['gurenge'])
    expect(s.room.members.me.present).toBe(false)
    expect(s.orders.closed).toBe(true)
    expect(s.orders.list.every(o => o.status === 'closed' || o.status === 'delivered')).toBe(true)
  })

  it('a roommate singing keeps singing; nothing of mine is left anywhere live', () => {
    S().reserve('gurenge', { by: 'minato' })
    S().startNext()
    S().reserve('ao-to-natsu', { by: 'me' })
    S().exitRoom()
    expect(S().room.now?.item.by).toBe('minato')
    expect(S().room.queue).toHaveLength(0)
  })
})

describe('Night.allKnow (DEMO#4, handshake 3)', () => {
  beforeEach(fresh)

  it('records the first all-know moment with the room size then, once', () => {
    S().askRoom('ao-to-natsu')
    for (const m of ['me', 'minato', 'saki'] as const) S().answerKnow('ao-to-natsu', m, 'know')
    const tonight = () => S().col.nights.find(n => n.id === S().session.nightId)!
    expect(tonight().allKnow).toEqual([{ songId: 'ao-to-natsu', size: 3, at: expect.any(Number) }])
    // Jun joins: 3/4 now, but the moment stays
    S().memberJoin('jun')
    S().answerKnow('ao-to-natsu', 'jun', 'none')
    expect(tonight().allKnow).toHaveLength(1)
    expect(tonight().allKnow![0].size).toBe(3)
  })
})

describe('script mode: the first song is sung (handshake 6)', () => {
  beforeEach(fresh)

  it('starts the night’s first song after the grace, and nothing after it', () => {
    S().setScript(true)
    S().dealCards([card('c1', 'ao-to-natsu')], 'replace')
    S().reserve('ao-to-natsu', { by: 'me' })
    S().reserve('gurenge', { by: 'minato' })
    advanceForTest(naviApi, 1000)
    expect(S().room.now).toBeNull()
    advanceForTest(naviApi, 3000)
    expect(S().room.now?.item.songId).toBe('ao-to-natsu')
    // script mode never finishes it by itself
    advanceForTest(naviApi, 60_000)
    expect(S().room.now?.item.songId).toBe('ao-to-natsu')
    S().finishNow()
    advanceForTest(naviApi, 10_000)
    expect(S().room.now).toBeNull()
    expect(S().room.queue[0].songId).toBe('gurenge')
  })
})

describe('past nights never pre-light the demo path (DEMO#3)', () => {
  beforeEach(fresh)

  it('the curated seed list and DEMO_PATH do not intersect', () => {
    const hit = SEED_NIGHT_SONGS.filter(id => DEMO_PATH.has(id))
    expect(hit).toEqual([])
    expect(new Set(SEED_NIGHT_SONGS).size).toBe(SEED_NIGHT_SONGS.length)
    for (const id of SEED_NIGHT_SONGS) expect(SONG_BY_ID[id]?.reservable).toBe(true)
    for (const id of DEMO_PATH) expect(SONG_BY_ID[id]).toBeDefined()
  })

  it('the voice demo picks and the co-occurrence rows of the demo songs stay dark', () => {
    const seeds = new Set<string>(SEED_NIGHT_SONGS)
    for (const t of ['clear', 'power', 'groove', 'emotional'] as const) for (const s of songsForVoice(t, null, 3)) expect(seeds.has(s.id)).toBe(false)
    for (const id of DEMO_SONGS) for (const c of SONG_BY_ID[id].coOccurrence) expect(seeds.has(c)).toBe(false)
  })

  it('seedPastNights lights ~30 faces, none on the demo path and none merely kept', () => {
    S().seedPastNights(2)
    const faces = Object.values(S().col.faces)
    expect(faces.length).toBe(30)
    for (const f of faces) {
      expect(DEMO_PATH.has(f.songId)).toBe(false)
      expect(f.state).not.toBe('sketch')
    }
    expect(S().col.nights.filter(n => n.seeded)).toHaveLength(2)
    // idempotent
    S().seedPastNights(2)
    expect(S().col.nights.filter(n => n.seeded)).toHaveLength(2)
  })

  it('any number of past nights stays in the past', () => {
    S().seedPastNights(5)
    const seeded = S().col.nights.filter(n => n.seeded)
    expect(seeded).toHaveLength(5)
    for (const n of seeded) expect(n.endedAt!).toBeLessThan(Date.now())
  })
})

describe('layout choices', () => {
  it('a landscape phone stays phone; room needs ≥700×600 landscape (ROBUST#17)', () => {
    expect(autoView(844, 390)).toBe('phone')
    expect(autoView(390, 844)).toBe('phone')
    expect(autoView(1280, 800)).toBe('room')
    expect(autoView(1024, 768)).toBe('room')
    expect(autoView(800, 1280)).toBe('phone')
  })

  it('dual scales uniformly below 1366×768 (ROBUST#7)', () => {
    expect(dualFit(1366, 768)).toBe(1)
    expect(dualFit(1920, 1080)).toBe(1)
    expect(dualFit(1024, 768)).toBeCloseTo(1024 / 1366, 3)
    expect(dualFit(1280, 720)).toBeCloseTo(720 / 768, 3)
  })
})
