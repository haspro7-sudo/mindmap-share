import { beforeEach, describe, expect, it } from 'vitest'
import { naviApi } from './store'
import { bus } from './events'
import { nextFaceState, faceNote, isPentatonic, knowView, orderIdem, moodWordFor, gapAreas, roomMinutesLeft, heatAfter } from './rules'
import { performCardAction, performUndo } from './actions'
import { selKnowView, selQueueView, selMyTurnIn, selFaceStats, selSpeckTarget } from './selectors'
import { serializeNight, KEYS, safeGet, safeSet, loadPersisted } from './storage'
import type { DeckCard, KnowTally } from './types'
import { SONGS, SONG_BY_ID } from '../data/songs'
import { advanceForTest } from './clock'
import '../i18n/vocab'
import '../i18n/reason'
import '../i18n/core'

// Minimal in-memory localStorage for node.
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

const card = (id: string, songId: string, kind: DeckCard['kind'] = 'song'): DeckCard => ({
  id,
  kind,
  songId,
  reason: { source: 'yomu', text: { key: 'reason.opener' } },
  trigger: { type: 'enter', at: 0 },
  rule: 'test',
  dealtAt: 0,
})

function fresh() {
  bus.clear()
  naviApi.getState().resetAll()
  const s = naviApi.getState()
  s.dealCards([card('c1', 'marigold'), card('c2', 'lemon'), card('c3', 'gurenge')], 'replace')
}

describe('rules', () => {
  it('faces only move up', () => {
    expect(nextFaceState(undefined, 'keep')).toBe('sketch')
    expect(nextFaceState('sketch', 'reserve')).toBe('neon')
    expect(nextFaceState('mirror', 'keep')).toBe('mirror')
    expect(nextFaceState('neon', 'sungAllKnow')).toBe('prism')
    expect(nextFaceState('prism', 'sung')).toBe('prism')
  })

  it('face notes are C pentatonic', () => {
    for (const s of SONGS) expect(isPentatonic(faceNote(s))).toBe(true)
  })

  it('knowView treats "none" and no answer the same', () => {
    const t: KnowTally = { songId: 'x', askedAt: 0, by: 'me', answers: { minato: { a: 'know', at: 2 }, saki: { a: 'none', at: 1 } } }
    const v = knowView(t, ['me', 'minato', 'saki'])
    expect(v.dots).toEqual(['know', 'empty', 'empty'])
    expect(v.all).toBe(false)
    const all = knowView({ ...t, answers: { me: { a: 'know', at: 1 }, minato: { a: 'know', at: 2 }, saki: { a: 'chorus', at: 3 } } }, ['me', 'minato', 'saki'])
    expect(all.knows).toBe(2.5)
    expect(all.all).toBe(false)
  })

  it('orderIdem is stable', () => {
    expect(orderIdem('beer', 12345, 3)).toBe(orderIdem('beer', 12345, 3))
  })

  it('mood words follow heat and flow', () => {
    expect(moodWordFor({ heat: 0.2, trend: 0, started: false, recentEnergies: [] })).toBe('blank')
    expect(moodWordFor({ heat: 0.7, trend: 1, started: true, recentEnergies: [0.9] })).toBe('rising')
    expect(moodWordFor({ heat: 0.7, trend: 1, started: true, recentEnergies: [0.3, 0.4] })).toBe('mellow')
    expect(moodWordFor({ heat: 0.9, trend: 0, started: true, recentEnergies: [0.9] })).toBe('peak')
  })

  it('gap areas need 3 songs and no lit face', () => {
    const gaps = gapAreas({}, SONGS)
    expect(gaps.length).toBeGreaterThan(3)
    expect(gaps).toContain('mid:J-POP')
  })

  it('room minutes and heat are bounded', () => {
    expect(roomMinutesLeft(0)).toBe(90)
    expect(roomMinutesLeft(10_000_000)).toBe(0)
    expect(heatAfter(0.9, { energy: 1, knowShare: 1, claps: 99 })).toBeLessThanOrEqual(1)
  })
})

describe('performCardAction', () => {
  beforeEach(fresh)

  it('reserve updates queue, face, melody, pin and first-reserve time at once', () => {
    const events: string[] = []
    bus.onAny(e => events.push(e.type))
    performCardAction(naviApi, 'c1', 'reserve', { navi: true })
    const s = naviApi.getState()
    expect(s.room.queue).toHaveLength(1)
    expect(s.room.queue[0].songId).toBe('marigold')
    expect(s.room.queue[0].tags).toContain('navi')
    expect(s.col.faces.marigold.state).toBe('neon')
    expect(s.col.faces.marigold.marks).toContain('navi')
    const tonight = s.col.nights.find(n => n.id === s.session.nightId)!
    expect(tonight.melody).toHaveLength(1)
    expect(s.col.pins.map(p => p.id)).toContain('spark')
    expect(s.metrics.firstReserveMs).toBeGreaterThanOrEqual(0)
    expect(s.deck.cards.map(c => c.id)).toEqual(['c2', 'c3'])
    expect(events).toEqual(expect.arrayContaining(['queue/added', 'face/changed', 'pin/earned', 'fx/flight', 'card/acted']))
  })

  it('undo restores queue, face, note, pin and the card', () => {
    performCardAction(naviApi, 'c1', 'reserve')
    expect(performUndo(naviApi)).toBe(true)
    const s = naviApi.getState()
    expect(s.room.queue).toHaveLength(0)
    expect(s.col.faces.marigold).toBeUndefined()
    expect(s.col.nights.find(n => n.id === s.session.nightId)!.melody).toHaveLength(0)
    expect(s.col.pins).toHaveLength(0)
    expect(s.metrics.firstReserveMs).toBeUndefined()
    expect(s.deck.cards[0].id).toBe('c1')
  })

  it('keep makes a sketch face; pass leaves faces alone; both undo', () => {
    performCardAction(naviApi, 'c1', 'keep')
    expect(naviApi.getState().col.faces.marigold.state).toBe('sketch')
    performUndo(naviApi)
    expect(naviApi.getState().col.faces.marigold).toBeUndefined()
    performCardAction(naviApi, 'c1', 'pass')
    expect(Object.keys(naviApi.getState().col.faces)).toHaveLength(0)
    expect(naviApi.getState().deck.passStreak).toBe(1)
    performUndo(naviApi)
    expect(naviApi.getState().deck.cards[0].id).toBe('c1')
    expect(naviApi.getState().deck.passStreak).toBe(0)
  })

  it('keep is ignored for kinds that are not keepable', () => {
    naviApi.getState().dealCards([{ ...card('g1', 'marigold', 'gap'), area: 'mid:J-POP' }], 'top')
    performCardAction(naviApi, 'g1', 'keep')
    expect(naviApi.getState().deck.cards[0].id).toBe('g1')
  })

  it('a sung song climbs to mirror, and to prism when everyone knew it', () => {
    const s = naviApi.getState()
    s.askRoom('marigold')
    for (const m of ['me', 'minato', 'saki'] as const) naviApi.getState().answerKnow('marigold', m, 'know')
    expect(selKnowView('marigold')(naviApi.getState())!.all).toBe(true)
    performCardAction(naviApi, 'c1', 'reserve')
    naviApi.getState().startNext()
    expect(selMyTurnIn(naviApi.getState())).toBe(0)
    naviApi.getState().finishNow()
    const st = naviApi.getState()
    expect(st.col.faces.marigold.state).toBe('prism')
    expect(st.col.pins.map(p => p.id)).toContain('allKnow')
    expect(selFaceStats(st).prism).toBe(1)
    expect(selSpeckTarget(st)).toBe(13)
    expect(st.room.sung).toHaveLength(1)
  })

  it('roommates singing never enter my collection', () => {
    naviApi.getState().reserve('lemon', { by: 'minato' })
    naviApi.getState().startNext()
    naviApi.getState().finishNow()
    expect(naviApi.getState().col.faces.lemon).toBeUndefined()
  })

  it('the queue view counts songs until my turn', () => {
    naviApi.getState().reserve('lemon', { by: 'minato' })
    naviApi.getState().reserve('idol', { by: 'saki' })
    performCardAction(naviApi, 'c1', 'reserve')
    naviApi.getState().startNext()
    expect(selQueueView(naviApi.getState()).map(r => r.pos)).toEqual([0, 1, 2])
    expect(selMyTurnIn(naviApi.getState())).toBe(2)
  })

  it('songs auto-advance after the undo grace outside script mode', () => {
    performCardAction(naviApi, 'c1', 'reserve')
    advanceForTest(naviApi, 1000)
    expect(naviApi.getState().room.now).toBeNull()
    advanceForTest(naviApi, 3000)
    expect(naviApi.getState().room.now?.item.songId).toBe('marigold')
    advanceForTest(naviApi, 41_000)
    expect(naviApi.getState().room.now).toBeNull()
    expect(naviApi.getState().col.faces.marigold.state).toBe('mirror')
  })

  it('orders are idempotent and close on exit', () => {
    const s = naviApi.getState()
    const a = s.placeOrder('highball')
    expect(a.ok).toBe(true)
    const b = naviApi.getState().placeOrder('highball')
    expect(b.dup).toBe(true)
    expect(naviApi.getState().orders.list).toHaveLength(1)
    naviApi.getState().placeOrder('highball', { again: true })
    expect(naviApi.getState().orders.list).toHaveLength(2)
    naviApi.getState().exitRoom()
    const c = naviApi.getState().placeOrder('cola')
    expect(c.ok).toBe(false)
    expect(naviApi.getState().metrics.mo.afterExitBlocked).toBe(1)
    expect(naviApi.getState().col.pins).toHaveLength(0)
  })

  it('shift insert waits for agreement and moves to the end on a hold-out', () => {
    naviApi.getState().reserve('lemon', { by: 'minato' })
    naviApi.getState().dealCards([card('s1', 'gurenge', 'shift')], 'top')
    performCardAction(naviApi, 's1', 'insert')
    expect(naviApi.getState().room.queue[0].songId).toBe('gurenge')
    naviApi.getState().agreePrompt('minato', true)
    naviApi.getState().agreePrompt('saki', false)
    const q = naviApi.getState().room.queue
    expect(q[q.length - 1].songId).toBe('gurenge')
    expect(naviApi.getState().room.prompt).toBeNull()
  })
})

describe('persistence', () => {
  beforeEach(fresh)

  it('round-trips a night', () => {
    performCardAction(naviApi, 'c1', 'reserve')
    const snap = serializeNight(naviApi.getState())
    safeSet(KEYS.night, { v: 1, data: snap })
    safeSet(KEYS.collection, { v: 1, data: naviApi.getState().col })
    const back = safeGet<{ v: 1; data: typeof snap }>(KEYS.night)!
    expect(back.data.room.queue[0].songId).toBe('marigold')
    const nightId = naviApi.getState().session.nightId
    naviApi.setState(st => ({ room: { ...st.room, queue: [] } }))
    loadPersisted(naviApi)
    expect(naviApi.getState().session.nightId).toBe(nightId)
    expect(naviApi.getState().session.intro).toBe('short')
    expect(naviApi.getState().room.queue[0].songId).toBe('marigold')
  })

  it('never throws when storage throws', () => {
    const bad = {
      getItem() {
        throw new Error('blocked')
      },
      setItem() {
        throw new Error('blocked')
      },
      removeItem() {
        throw new Error('blocked')
      },
    }
    const prev = (globalThis as unknown as { localStorage: unknown }).localStorage
    ;(globalThis as unknown as { localStorage: unknown }).localStorage = bad
    try {
      expect(() => loadPersisted(naviApi)).not.toThrow()
      expect(safeSet('x', 1)).toBe(false)
      expect(safeGet('x')).toBeNull()
    } finally {
      ;(globalThis as unknown as { localStorage: unknown }).localStorage = prev
    }
  })
})

describe('data', () => {
  it('reservable flags and trending set match the spec', () => {
    expect(SONG_BY_ID.magnetic.reservable).toBe(false)
    expect(SONG_BY_ID['xiao-xing-yun'].reservable).toBe(false)
    expect(SONGS.filter(s => s.trending).map(s => s.id).sort()).toEqual(['bansanka', 'bbbb', 'idol', 'lilac', 'otonoke', 'que-sera'])
    expect(SONG_BY_ID.zankoku.coSource).toBe('curated')
  })
})
