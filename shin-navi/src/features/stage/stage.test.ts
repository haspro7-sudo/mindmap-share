// M6 stage: pure helpers, strings and the "no Japanese literals in JSX" rule for this module.
import { describe, expect, it } from 'vitest'
import { isPentatonic } from '../../core/rules'
import { naviApi } from '../../core/store'
import { selForecast } from '../../core/selectors'
import { presentOf } from './parts'
import { SONG_BY_ID } from '../../data/songs'
import type { Member } from '../../core/types'
import { LOCALE_IDS, namespaceStrings } from '../../i18n'
import {
  FLOOR_SLOTS,
  SILVER,
  VOICE_COLOR,
  demoScore,
  expectedKnow,
  forecastHeat,
  forecastKey,
  forecastMood,
  forecastQueue,
  glassSlots,
  heatRange,
  heatSeries,
  lightColor,
  penlightNote,
  qrMatrix,
  scoreVerdict,
  shiftRoles,
  smoothPath,
  soonestEta,
  splitAround,
  threadEnd,
  trendOf,
} from './model'
import './strings'

const member = (id: Member['id'], likes: Member['likes'] = {}): Member => ({
  id,
  color: '#fff',
  locale: 'ja',
  generation: 20,
  likes,
  voiceType: null,
  present: true,
  arriving: false,
  joinedAt: 0,
})
const ROOM = [member('me'), member('minato', { ロック: 0.9, 'J-POP': 0.7, アニメ: 0.6 }), member('saki', { 'J-POP': 0.9 })]

describe('demo score (E-4)', () => {
  it('stays within 78..96 and is fixed per seed and item', () => {
    const seen = new Set<number>()
    for (let i = 0; i < 400; i++) {
      const s = demoScore('test', `q-${i}`)
      expect(s).toBeGreaterThanOrEqual(78)
      expect(s).toBeLessThanOrEqual(96)
      expect(Number.isInteger(s)).toBe(true)
      seen.add(s)
    }
    expect(seen.size).toBeGreaterThan(10)
    expect(demoScore('night-a', 'q-1')).toBe(demoScore('night-a', 'q-1'))
  })

  it('compares only with my own earlier scores tonight (no ranking)', () => {
    expect(scoreVerdict(88, [])).toEqual({ kind: 'first', best: 88, gap: 0 })
    expect(scoreVerdict(90, [85, 88])).toEqual({ kind: 'best', best: 90, gap: 0 })
    expect(scoreVerdict(88, [85, 88])).toEqual({ kind: 'same', best: 88, gap: 0 })
    expect(scoreVerdict(81, [85, 88])).toEqual({ kind: 'gap', best: 88, gap: 7 })
  })
})

describe('lane helpers', () => {
  it('places a drink glass after the song it should arrive after', () => {
    const o = (eta: number, status: 'sending' | 'accepted' | 'preparing' | 'delivered' | 'closed' = 'accepted') => ({ etaAfterSongs: eta, status })
    // NOW + 3 queued: arrives after 2 songs → after row 2
    expect([...glassSlots(4, [o(2)])]).toEqual([[2, 1]])
    // a longer wait than the lane shows parks at the end
    expect([...glassSlots(1, [o(2)])]).toEqual([[1, 1]])
    // two orders on the same spot are counted together; delivered / closed ones vanish
    expect([...glassSlots(4, [o(1), o(1, 'preparing'), o(1, 'delivered'), o(3, 'closed')])]).toEqual([[1, 2]])
    expect(glassSlots(0, [o(2)]).get(0)).toBe(1)
  })

  it('splits a translated sentence around the number', () => {
    expect(splitAround('あなたの番まであと\u0001曲', '\u0001')).toEqual(['あなたの番まであと', '曲'])
    expect(splitAround('\u0001 songs until your turn', '\u0001')).toEqual(['', ' songs until your turn'])
    expect(splitAround('no marker', '\u0001')).toEqual(['no marker', ''])
  })

  it('member lights: my voice colour only on the private phone', () => {
    const me = { ...member('me'), voiceType: 'emotional' as const }
    expect(lightColor(me, true)).toBe(VOICE_COLOR.emotional)
    expect(lightColor(me, false)).toBe(SILVER)
    expect(lightColor(member('me'), true)).toBe(SILVER)
    expect(lightColor({ ...member('saki'), color: '#FF6FB1' }, false)).toBe('#FF6FB1')
  })

  it('floor order follows F-3 and threads end on the ball rim', () => {
    expect(FLOOR_SLOTS.map(s => s.id)).toEqual(['minato', 'me', 'saki', 'jun'])
    expect(FLOOR_SLOTS.find(s => s.id === 'me')!.front).toBe(true)
    const e = threadEnd({ x: 50, y: 20 }, { x: 195, y: -90, r: 98 }, 1)
    expect(Math.hypot(e.x - 195, e.y + 90)).toBeCloseTo(98, 5)
  })
})

describe('flow & forecast (Navi’s read, a hypothesis)', () => {
  it('heat series starts at the opening heat and keeps the last samples', () => {
    expect(heatSeries([])).toEqual([0.2])
    const sung = Array.from({ length: 10 }, (_, i) => ({ heatAfter: i / 10 }))
    const s = heatSeries(sung, 0.2, 6)
    expect(s).toHaveLength(6)
    expect(s[s.length - 1]).toBeCloseTo(0.9)
  })

  it('a high-energy song reads hotter than a mellow one', () => {
    const hot = SONG_BY_ID['gurenge']
    const calm = SONG_BY_ID['hanamizuki'] ?? SONG_BY_ID['dry-flower']
    expect(hot && calm).toBeTruthy()
    expect(hot.energy).toBeGreaterThan(calm.energy)
    expect(forecastHeat(0.4, hot.id, ROOM)).toBeGreaterThan(forecastHeat(0.4, calm.id, ROOM))
    const q = forecastQueue(0.3, [hot.id, calm.id], ROOM)
    expect(q).toHaveLength(2)
    for (const v of q) {
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(1)
    }
    const k = expectedKnow(hot.id, ROOM)
    expect(k).toBeGreaterThan(0)
    expect(k).toBeLessThanOrEqual(0.97)
    expect(trendOf(0.4, 0.5)).toBe('up')
    expect(trendOf(0.5, 0.4)).toBe('down')
    expect(trendOf(0.5, 0.51)).toBe('flat')
  })

  it('smooth paths and display ranges are well formed', () => {
    const d = smoothPath([
      { x: 0, y: 10 },
      { x: 10, y: 4 },
      { x: 20, y: 8 },
    ])
    expect(d.startsWith('M0 10')).toBe(true)
    expect(d.match(/C/g)).toHaveLength(2)
    expect(smoothPath([])).toBe('')
    const [lo, hi] = heatRange([0.3, 0.32])
    expect(hi - lo).toBeGreaterThanOrEqual(0.3 - 1e-9)
    expect(lo).toBeGreaterThanOrEqual(0)
    expect(hi).toBeLessThanOrEqual(1)
  })

  it('shift roles: the candidate closer to the recent songs rides the flow', () => {
    const calm = SONG_BY_ID['dry-flower']
    const hot = SONG_BY_ID['gurenge']
    const r = shiftRoles([hot.id, calm.id], [0.3, 0.35], hot.id)
    expect(r.ride).toBe(calm.id)
    expect(r.change).toBe(hot.id)
    expect(r.pick).toBe(hot.id)
    expect(shiftRoles([calm.id, hot.id], [0.9, 0.95]).ride).toBe(hot.id)
    expect(shiftRoles([calm.id, hot.id], [], 'not-an-option').pick).toBe(calm.id)
    expect(shiftRoles([], [0.5])).toEqual({})
  })
})

describe('penlight & QR', () => {
  it('every penlight note is C-major pentatonic, climbing', () => {
    for (let i = 0; i < 40; i++) expect(isPentatonic(penlightNote(i))).toBe(true)
    expect(penlightNote(1)).toBeGreaterThan(penlightNote(0))
  })

  it('stylised QR has three finder squares and a quiet centre', () => {
    const m = qrMatrix('room-12')
    expect(m).toHaveLength(25)
    expect(m[0][0] && m[0][6] && m[6][0] && m[0][24] && m[24][0]).toBe(true)
    expect(m[12][12]).toBe(false)
  })
})

describe('QA round 1 helpers', () => {
  it('the empty lane shows one glass with the soonest real ETA (ROBUST#15)', () => {
    expect(soonestEta([])).toBe(1)
    expect(soonestEta([{ status: 'accepted', etaAfterSongs: 1 }])).toBe(1)
    expect(soonestEta([{ status: 'accepted', etaAfterSongs: 3 }, { status: 'preparing', etaAfterSongs: 2 }, { status: 'delivered', etaAfterSongs: 0 }])).toBe(2)
    expect(soonestEta([{ status: 'sending', etaAfterSongs: 0 }])).toBe(1)
  })

  it('forecast words follow the word ahead and the direction (OWNER#7)', () => {
    expect(forecastKey('peak', true)).toBe('fc.hot')
    expect(forecastKey('rising', true)).toBe('fc.hot')
    expect(forecastKey('warming', true)).toBe('fc.warmUp')
    expect(forecastKey('warming', false)).toBe('fc.warmDown')
    expect(forecastKey('mellow', true)).toBe('fc.mellowDown')
    expect(forecastKey('loosening', true)).toBe('fc.mellowUp')
    expect(forecastKey('loosening', false)).toBe('fc.quiet')
  })

  it('forecastMood reads the air ahead with the store’s own word rules', () => {
    const present = [member('me'), member('minato'), member('saki')]
    const hot = Object.values(SONG_BY_ID).filter(s => s.energy >= 0.85).map(s => s.id)
    const slow = Object.values(SONG_BY_ID).filter(s => s.energy <= 0.3).map(s => s.id)
    expect(forecastMood(0.2, [], [], present)).toBeNull()
    const up = forecastMood(0.2, [], hot.slice(0, 3), present)!
    expect(up.rising).toBe(true)
    expect(['warm', 'hot']).toContain(up.bucket)
    const down = forecastMood(0.8, [0.9, 0.9], slow.slice(0, 2), present)!
    expect(down.word).toBe('mellow')
    expect(down.bucket).toBe('mellow')
    expect(down.rising).toBe(false)
  })

  it('the hero word and the wall (core selForecast, read by fx) forecast the same colour', () => {
    const api = naviApi
    const ids = Object.values(SONG_BY_ID).filter(s => s.reservable).map(s => s.id)
    let checked = 0
    for (let k = 0; k < 40; k++) {
      api.getState().resetAll()
      const heat = (k % 10) / 10
      const st = api.getState()
      api.setState({ room: { ...st.room, heat } })
      const pick = (i: number) => ids[(k * 7 + i * 13) % ids.length]
      api.getState().reserve(pick(0), { by: 'me' })
      if (k % 2) api.getState().reserve(pick(1), { by: 'saki' })
      if (k % 3) api.getState().reserve(pick(2), { by: 'minato' })
      const s = api.getState()
      const r = s.room
      const upcoming = [...(r.now ? [r.now.item.songId] : []), ...r.queue.slice(0, 2).map(q => q.songId)]
      const word = forecastMood(r.heat, r.sung.map(e => SONG_BY_ID[e.item.songId]?.energy ?? 0.5), upcoming, presentOf(r.members))
      const wall = selForecast(s)
      expect(wall?.bucket, `heat ${heat} ${upcoming.join(',')}`).toBe(word?.bucket)
      expect(wall?.rising).toBe(word?.rising)
      checked++
    }
    expect(checked).toBe(40)
  })
})

describe('stage strings', () => {
  it('every "{n}" string has a singular sibling in all five locales, with the same vars', () => {
    const d = namespaceStrings('stage')! as unknown as Record<string, Record<string, string>>
    const vars = (x: string) => [...x.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort().join(',')
    const counted = Object.keys(d.ja).filter(k => !k.endsWith('.one') && /\{n\}/.test(d.ja[k]))
    expect(counted.length).toBeGreaterThan(5)
    for (const k of counted)
      for (const l of LOCALE_IDS) {
        expect(typeof d[l][`${k}.one`], `${l}.${k}.one`).toBe('string')
        expect(vars(d[l][`${k}.one`]), `${l}.${k}.one vars`).toBe(vars(d.ja[k]))
      }
    expect(d.en['myTurnIn.one']).toBe('{n} song until your turn')
    expect(d.en['glassIn.one']).toBe('Arrives in about {n} song')
  })

  const ns = namespaceStrings('stage')!
  it('exist in all five locales with the same keys', () => {
    const keys = Object.keys(ns.ja)
    expect(keys.length).toBeGreaterThan(50)
    for (const l of LOCALE_IDS) {
      const d = (ns as unknown as Record<string, Record<string, string>>)[l]
      for (const k of keys) expect(typeof d[k], `${l}.${k}`).toBe('string')
    }
  })

  it('never say "does not know", streaks or scarcity (E-12, D-15)', () => {
    const all = LOCALE_IDS.flatMap(l => Object.values((ns as unknown as Record<string, Record<string, string>>)[l]))
    for (const s of all) {
      expect(s).not.toMatch(/知らない|連続|残り|期間限定|今だけ/)
    }
  })
})

describe('no Japanese literals in this module’s JSX (G-3)', () => {
  const files = import.meta.glob('./*.tsx', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
  it('has tsx files to check', () => expect(Object.keys(files).length).toBeGreaterThan(8))
  for (const [name, src] of Object.entries(files)) {
    it(name, () => {
      // full-width / CJK characters anywhere in a component file (strings live in strings.ts)
      expect(src).not.toMatch(/[　-ヿ㐀-鿿＀-￯]/)
    })
  }
})
