// M9 unit tests: night naming in five languages and the symbol priority (SPEC L/M9 #4), the
// pure recap models, and module hygiene (no streak/scarcity wording, no literals in JSX, G-3).
import { describe, expect, it } from 'vitest'
import type { Night, SungEntry, QueueItem, WallPoint, MemberId, KnowTally, Member } from '../../core/types'
import { trIn, LOCALE_IDS } from '../../i18n'
import { baseColor, derivedFacts, factsFrom, nameOf, nightName, nightSymbol } from './nightName'
import { selCommon, takeHomeSongs } from './model'
import { RECORD_DICTS, NIGHT_COLORS, NIGHT_SYMBOLS } from './strings'
import './strings'

const pt = (t: number, heat: number, o: Partial<WallPoint> = {}): WallPoint => ({ t, heat, songId: 'marigold', by: 'me', claps: 20, markers: [], ...o })
const night = (points: WallPoint[], o: Partial<Night> = {}): Night => ({
  id: 'n1',
  startedAt: new Date(2026, 8, 25, 21).getTime(), // a Friday
  points,
  melody: [],
  facesGained: [],
  shared: [],
  claps: 0,
  stamped: false,
  palette: ['#FF3DA8', '#FFB547', '#FF6A3D'],
  ...o,
})
const HOT = [pt(3, 0.82), pt(8, 0.9), pt(13, 0.78)]

describe('nightName (SPEC D-7)', () => {
  it('names the spec example in all five languages', () => {
    const ref = nightName(night(HOT), { weekday: 5, facts: { duet: true } })
    expect(trIn(ref, 'ja')).toBe('金曜の琥珀ハモリ座')
    expect(trIn(ref, 'en')).toBe("Friday's Amber Harmony")
    expect(trIn(ref, 'zhHant')).toBe('星期五的琥珀和聲座')
    expect(trIn(ref, 'zhHans')).toBe('星期五的琥珀和声座')
    expect(trIn(ref, 'ko')).toBe('금요일의 호박색 하모니자리')
  })

  it('is a TextRef that re-resolves on a language switch (not a baked string)', () => {
    const ref = nightName(night(HOT), { weekday: 5 })
    expect(ref.key).toMatch(/^record\.nn\.5\.hot\.spark$/)
    expect(trIn(ref, 'ja')).not.toBe(trIn(ref, 'ko'))
  })

  it('symbol priority: duet → finale → everyone → crossing → air-read → spark', () => {
    const n = night(HOT)
    expect(nightSymbol(n, { duet: true, finale: true, allKnow: true, crossing: true, airRead: true })).toBe('harmony')
    expect(nightSymbol(n, { finale: true, allKnow: true, crossing: true, airRead: true })).toBe('finale')
    expect(nightSymbol(n, { allKnow: true, crossing: true, airRead: true })).toBe('allKnow')
    expect(nightSymbol(n, { crossing: true, airRead: true })).toBe('crossing')
    expect(nightSymbol(n, { airRead: true })).toBe('airRead')
    expect(nightSymbol(n, {})).toBe('spark')
    const ja = (f: Parameters<typeof nightSymbol>[1]) => trIn(nightName(n, { weekday: 5, facts: f }), 'ja')
    expect(ja({ finale: true, crossing: true })).toBe('金曜の琥珀締め座')
    expect(ja({ allKnow: true })).toBe('金曜の琥珀全員座')
    expect(ja({ crossing: true })).toBe('金曜の琥珀越境座')
    expect(ja({ airRead: true })).toBe('金曜の琥珀読み座')
    expect(ja({})).toBe('金曜の琥珀口火座')
  })

  it('base colour is the most frequent heat bucket (quiet 瑠璃 / mellow 菫 / warm 珊瑚 / hot 琥珀)', () => {
    expect(baseColor(night([]))).toBe('quiet')
    expect(baseColor(night([pt(1, 0.2), pt(2, 0.3), pt(3, 0.9)]))).toBe('quiet')
    expect(baseColor(night([pt(1, 0.4), pt(2, 0.5), pt(3, 0.9)]))).toBe('mellow')
    expect(baseColor(night([pt(1, 0.6), pt(2, 0.7), pt(3, 0.2)]))).toBe('warm')
    // a tie goes to the bucket the night reached first
    expect(baseColor(night([pt(1, 0.6), pt(2, 0.9), pt(3, 0.7), pt(4, 0.95)]))).toBe('warm')
    const w = (points: WallPoint[]) => trIn(nightName(night(points), { weekday: 1 }), 'ja')
    expect(w([pt(1, 0.2)])).toBe('月曜の瑠璃口火座')
    expect(w([pt(1, 0.45)])).toBe('月曜の菫口火座')
    expect(w([pt(1, 0.6)])).toBe('月曜の珊瑚口火座')
    expect(trIn(nightName(night([pt(1, 0.6)]), { weekday: 1 }), 'en')).toBe("Monday's Coral Spark")
  })

  it('weekday wraps safely (0 = Sunday)', () => {
    const n = night(HOT)
    expect(trIn(nightName(n, { weekday: 0 }), 'ja')).toBe('日曜の琥珀口火座')
    expect(trIn(nightName(n, { weekday: 7 }), 'ja')).toBe('日曜の琥珀口火座')
    expect(trIn(nightName(n, { weekday: -1 }), 'ja')).toBe('土曜の琥珀口火座')
    expect(trIn(nightName(n, { weekday: 6 }), 'ko')).toBe('토요일의 호박색 불씨자리')
  })

  it('derives "everyone knew" and "air-read" from the night itself', () => {
    expect(derivedFacts(night(HOT, { shared: ['marigold'] })).allKnow).toBe(true)
    expect(derivedFacts(night([pt(1, 0.5, { markers: ['allKnow'] })])).allKnow).toBe(true)
    expect(derivedFacts(night([pt(1, 0.5, { markers: ['shift'] }), pt(2, 0.58)])).airRead).toBe(true)
    expect(derivedFacts(night([pt(1, 0.5, { markers: ['shift'] }), pt(2, 0.52)])).airRead).toBe(false)
    expect(trIn(nightName(night(HOT, { shared: ['lemon'] }), { weekday: 5 }), 'ja')).toBe('金曜の琥珀全員座')
  })

  it('facts from tonight: my duet, the finale, a crossing song, air-read pin', () => {
    const q = (o: Partial<QueueItem>): QueueItem => ({ id: 'q', songId: 'marigold', by: 'me', keyShift: 0, version: 'original', tags: [], addedAt: 0, ...o })
    const e = (item: QueueItem): SungEntry => ({ item, endedAt: 0, heatBefore: 0.3, heatAfter: 0.5, knowShare: 1, claps: 10 })
    expect(factsFrom([e(q({ with: 'saki' }))], [], 'n1').duet).toBe(true)
    expect(factsFrom([e(q({ by: 'saki', tags: ['duet'] }))], [], 'n1').duet).toBe(false) // not mine
    expect(factsFrom([e(q({ tags: ['finale'] }))], [], 'n1').finale).toBe(true)
    expect(factsFrom([e(q({ tags: ['visa'] }))], [], 'n1').crossing).toBe(true)
    expect(factsFrom([], [{ id: 'airRead', nightId: 'n1' }], 'n1').airRead).toBe(true)
    expect(factsFrom([], [{ id: 'airRead', nightId: 'other' }], 'n1').airRead).toBe(false)
  })

  it('nameOf keeps a stored name and computes one otherwise', () => {
    const stored = { key: 'record.nn.2.warm.finale' }
    expect(nameOf(night(HOT, { name: stored }))).toBe(stored)
    expect(nameOf(night(HOT)).key).toBe('record.nn.5.hot.spark')
  })

  it('every weekday × colour × symbol exists in all five languages', () => {
    for (const l of LOCALE_IDS)
      for (let w = 0; w < 7; w++) for (const c of NIGHT_COLORS) for (const s of NIGHT_SYMBOLS) expect(RECORD_DICTS[l][`nn.${w}.${c}.${s}`], `${l} ${w}.${c}.${s}`).toBeTruthy()
  })
})

// ---------------------------------------------------------------- recap models

type S = Parameters<typeof takeHomeSongs>[0]
const mem = (id: MemberId, present = true) => ({ id, color: '#fff', locale: 'ja', generation: 20, likes: {}, voiceType: null, present, arriving: false, joinedAt: 0 }) as Member
const state = (o: { sung?: QueueItem[]; queue?: QueueItem[]; gained?: string[]; saved?: string[]; knowing?: Record<string, KnowTally>; shared?: string[]; jun?: boolean }): S =>
  ({
    session: { nightId: 'n1' },
    room: {
      sung: (o.sung ?? []).map(item => ({ item, endedAt: 0, heatBefore: 0, heatAfter: 0, knowShare: 0, claps: 0 })),
      now: null,
      queue: o.queue ?? [],
      knowing: o.knowing ?? {},
      members: { me: mem('me'), minato: mem('minato'), saki: mem('saki'), jun: mem('jun', !!o.jun) },
    },
    col: { nights: [night([], { facesGained: o.gained ?? [], shared: o.shared ?? [] })], saved: (o.saved ?? []).map(songId => ({ songId, version: 'original', at: 0, from: 'import' })) },
  }) as unknown as S

describe('recap models', () => {
  const q = (songId: string, o: Partial<QueueItem> = {}): QueueItem => ({ id: songId, songId, by: 'me', keyShift: 0, version: 'original', tags: [], addedAt: 0, ...o })
  it('take-home: my sung/queued songs with their version, tonight’s faces, never roommates’ songs, never overwrites', () => {
    const s = state({ sung: [q('marigold', { version: 'artistMv' }), q('lemon', { by: 'saki' })], queue: [q('gurenge')], gained: ['idol', 'marigold'], saved: ['idol'] })
    const got = takeHomeSongs(s)
    expect(got).toEqual([
      { songId: 'marigold', version: 'artistMv' },
      { songId: 'gurenge', version: 'original' },
    ])
  })

  it('common songs: every present member knew (anonymous tally), then shared songs', () => {
    const tally = (songId: string, ans: Partial<Record<MemberId, 'know' | 'chorus' | 'none'>>, at = 0): KnowTally => ({
      songId,
      askedAt: at,
      by: 'me',
      answers: Object.fromEntries(Object.entries(ans).map(([k, a]) => [k, { a, at }])) as KnowTally['answers'],
    })
    const knowing = {
      marigold: tally('marigold', { me: 'know', minato: 'know', saki: 'know' }, 1),
      lemon: tally('lemon', { me: 'know', minato: 'chorus', saki: 'know' }, 2),
      zankoku: tally('zankoku', { me: 'know', minato: 'know', saki: 'know' }, 3),
    }
    expect(selCommon(state({ knowing, shared: ['idol'] }))).toEqual({ ids: ['marigold', 'zankoku', 'idol'], size: 3 })
    // Jun joined and has not answered: nobody is "all" any more, and nothing says who is missing
    expect(selCommon(state({ knowing, jun: true })).ids).toEqual([])
  })
})

// ---------------------------------------------------------------- hygiene

describe('record module hygiene', () => {
  it('never says streak, scarcity or "does not know" (D-15, E-12, T14)', () => {
    for (const l of LOCALE_IDS) for (const s of Object.values(RECORD_DICTS[l])) expect(s).not.toMatch(/連続|残り|期間限定|今だけ|知らない|連續|连续|streak|연속/i)
  })

  it('has every key in all five languages with the same variables', () => {
    const vars = (s: string) =>
      [...s.matchAll(/\{(\w+)\}/g)]
        .map(m => m[1])
        .sort()
        .join(',')
    const ja = RECORD_DICTS.ja
    for (const l of LOCALE_IDS)
      for (const k of Object.keys(ja)) {
        expect(RECORD_DICTS[l][k], `${l}.${k}`).toBeTypeOf('string')
        expect(vars(RECORD_DICTS[l][k]), `${l}.${k}`).toBe(vars(ja[k]))
      }
  })

  const files = import.meta.glob('./*.tsx', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
  it('has component files to check', () => expect(Object.keys(files).length).toBeGreaterThanOrEqual(10))
  for (const [name, src] of Object.entries(files)) {
    it(`no Japanese literals in ${name} (G-3)`, () => {
      expect(src).not.toMatch(/[　-ヿ㐀-鿿＀-￯]/)
    })
  }
})
