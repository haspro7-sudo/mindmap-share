// M8 unit tests: normalisation, search in any script (SPEC L/M8 #1), filters, the mixer's
// mapping, and the i18n rule that feature JSX carries no Japanese literals (SPEC G-2).
import { describe, expect, it } from 'vitest'
import { normalize, kanaToRomaji, looseLatin, editDistance } from './normalize'
import { searchSongs, matchRange, fieldText, passesFilters, popularity } from './search'
import { SONG_BY_ID, SONGS, decadeOf } from '../../data/songs'
import { auroraAt, cellOf, noteForCell, zoneOf, CELLS, songStars, nearestStars, placeCallout, type Rect } from './mixerMath'

const top = (q: string, o?: Parameters<typeof searchSongs>[1]) => searchSongs(q, o)[0]?.song.id

describe('normalize', () => {
  it('NFKC, lower case, katakana → hiragana, strips spaces / symbols / long vowels', () => {
    expect(normalize('ザンコク')).toBe('ざんこく')
    expect(normalize('Ｌｅｍｏｎ')).toBe('lemon')
    expect(normalize('ﾏﾘｰｺﾞｰﾙﾄﾞ')).toBe('まりごるど')
    expect(normalize('マリーゴールド')).toBe('まりごるど')
    expect(normalize('Yoru ni Kakeru!')).toBe('yorunikakeru')
    expect(normalize('DAOKO×米津玄師')).toBe('daoko米津玄師')
    expect(normalize('残酷な天使のテーゼ')).toBe('残酷な天使のてぜ')
    expect(normalize('真夜中のドア〜stay with me')).toBe('真夜中のどあstaywithme')
    expect(normalize('Céline Dion')).toBe('celinedion')
    expect(normalize('잔혹한 천사의 테제')).toBe('잔혹한천사의테제')
    expect(normalize('')).toBe('')
  })

  it('reads kana as Hepburn romaji', () => {
    expect(kanaToRomaji('ざんこく')).toBe('zankoku')
    expect(kanaToRomaji('しんじだい')).toBe('shinjidai')
    expect(kanaToRomaji('きゃっと')).toBe('kyatto')
    expect(kanaToRomaji('まっち')).toBe('matchi')
    expect(kanaToRomaji('よるにかける')).toBe('yorunikakeru')
    expect(kanaToRomaji('ふぁん')).toBe('fan')
  })

  it('folds romaji spelling variants together', () => {
    expect(looseLatin('yuusha')).toBe(looseLatin('yusha'))
    expect(looseLatin('shinjidai')).toBe(looseLatin('sinzidai'))
    expect(looseLatin('tsunami')).toBe(looseLatin('tunami'))
    expect(looseLatin('kousui')).toBe(looseLatin('kosui'))
    expect(looseLatin('teeze')).toBe(looseLatin('teze'))
    expect(editDistance('gurenga', 'gurenge', 1)).toBe(1)
    expect(editDistance('abc', 'xyz', 1)).toBe(2)
  })
})

describe('searchSongs (SPEC L/M8 #1)', () => {
  it('잔혹한 / zankoku / 残酷天使 / ざんこく → zankoku first', () => {
    for (const q of ['잔혹한', 'zankoku', '残酷天使', 'ざんこく', 'ザンコク', 'Zankoku na', "cruel angel"]) expect(top(q), q).toBe('zankoku')
  })

  it('밤을 / yoru ni → yoru-ni-kakeru', () => {
    for (const q of ['밤을', 'yoru ni', 'Yoru Ni', 'よるにかける', 'Into the Night', '夜に']) expect(top(q), q).toBe('yoru-ni-kakeru')
  })

  it('Gurenge / 紅蓮 → gurenge', () => {
    for (const q of ['Gurenge', '紅蓮', 'ぐれんげ', '红莲', '홍련화', 'red lotus']) expect(top(q), q).toBe('gurenge')
  })

  it('米津 → only songs by 米津玄師', () => {
    const hits = searchSongs('米津')
    expect(hits.length).toBeGreaterThanOrEqual(3)
    for (const h of hits) expect(h.song.artist).toContain('米津玄師')
    expect(hits[0].matched).toBe('artist')
    // the artist is also found as people abroad write it
    for (const q of ['yonezu', 'Kenshi Yonezu', '요네즈']) {
      const hs = searchSongs(q)
      expect(hs.length, q).toBeGreaterThan(0)
      expect(hs[0].song.artist, q).toContain('米津玄師')
    }
  })

  it('reports which script matched', () => {
    expect(searchSongs('잔혹한')[0].matched).toBe('ko')
    expect(searchSongs('zankoku')[0].matched).toBe('romaji')
    expect(searchSongs('ざんこく')[0].matched).toBe('romaji')
    expect(searchSongs('残酷天使')[0].matched).toBe('zhHans')
    expect(searchSongs('紅蓮')[0].matched).toBe('title')
    expect(searchSongs('Red Lotus')[0].matched).toBe('en')
  })

  it('matches while the Hangul IME is still composing a syllable', () => {
    expect(top('잔혹하')).toBe('zankoku')
    expect(top('밤으')).toBe('yoru-ni-kakeru')
  })

  it('forgives romaji variants and a single typo', () => {
    expect(top('yusha')).toBe('yuusha')
    expect(top('tunami')).toBe('tsunami')
    expect(searchSongs('gurenga').slice(0, 3).map(h => h.song.id)).toContain('gurenge')
  })

  it('a single Latin letter only matches word starts', () => {
    for (const h of searchSongs('q', { limit: 200 })) {
      const words = [h.song.title, h.song.artist, ...Object.values(h.song.inboundTitle)].join(' ').toLowerCase()
      expect(words).toMatch(/(^|[^a-z])q/)
    }
  })

  it('empty query lists the filtered songs; filters always hold', () => {
    const all = searchSongs('', { limit: 500 })
    expect(all.length).toBe(SONGS.length)
    const area = searchSongs('', { filters: { tempo: 'slow', genre: 'J-POP' }, limit: 500 })
    expect(area.length).toBeGreaterThan(2)
    for (const h of area) expect(h.song.tempo === 'slow' && h.song.genre === 'J-POP').toBe(true)
    const dec = searchSongs('', { filters: { decade: '1990s' }, limit: 500 })
    for (const h of dec) expect(decadeOf(h.song)).toBe('1990s')
    const vibe = searchSongs('', { filters: { vibe: 'しっとり', lang: 'ja' }, limit: 500 })
    expect(vibe.length).toBeGreaterThan(0)
    for (const h of vibe) expect(h.song.tags.hypothesis.includes('しっとり') && h.song.lang === 'ja').toBe(true)
    // a query and filters combine
    expect(searchSongs('lemon', { filters: { genre: 'アニメ' } }).length).toBe(0)
    expect(passesFilters(SONG_BY_ID.lemon, { genre: 'J-POP', tempo: 'slow' })).toBe(true)
  })

  it('finds songs that cannot be reserved here (the sheet disables them with a note)', () => {
    expect(top('Magnetic')).toBe('magnetic')
    expect(SONG_BY_ID.magnetic.reservable).toBe(false)
    expect(top('小幸運')).toBe('xiao-xing-yun')
  })

  it('no match returns nothing (and is fast)', () => {
    const t0 = performance.now()
    for (let i = 0; i < 50; i++) searchSongs('zzqxv')
    expect(searchSongs('zzqxv')).toEqual([])
    expect((performance.now() - t0) / 50).toBeLessThan(8)
  })
})

describe('match highlighting', () => {
  it('finds the matched run in source characters', () => {
    expect(matchRange('잔혹한 천사의 테제', '잔혹한')).toEqual([0, 3])
    expect(matchRange('Zankoku na Tenshi no Teeze', 'tenshi')).toEqual([11, 17])
    expect(matchRange('Zankoku na Tenshi no Teeze', 'ざんこく')).toEqual([0, 7])
    expect(matchRange('マリーゴールド', 'まり')).toEqual([0, 2])
    expect(matchRange('紅蓮華', '紅蓮')).toEqual([0, 2])
    expect(matchRange('Lemon', 'xyz')).toBeNull()
  })

  it('names the alias that matched an artist', () => {
    expect(fieldText(SONG_BY_ID.lemon, 'artist', 'yonezu')).toBe('Yonezu Kenshi')
    expect(fieldText(SONG_BY_ID.lemon, 'artist', '米津')).toBe('米津玄師')
  })
})

describe('mixer mapping', () => {
  it('maps the pad to cells, zones, notes and aurora palettes', () => {
    expect(CELLS).toBe(5)
    expect(cellOf(0, 0)).toEqual([0, 0])
    expect(cellOf(1, 1)).toEqual([4, 4])
    expect(cellOf(0.5, 0.5)).toEqual([2, 2])
    expect(zoneOf(0.1, 0.1)).toBe('mellowKnown')
    expect(zoneOf(0.9, 0.9)).toBe('hypeFresh')
    expect(zoneOf(0.5, 0.5)).toBe('midMid')
    expect(auroraAt(0.1, 0.1)).toBe('quiet')
    expect(auroraAt(0.1, 0.9)).toBe('mellow')
    expect(auroraAt(0.9, 0.9)).toBe('warm')
    expect(auroraAt(0.9, 0.1)).toBe('hot')
    // every note is in C major pentatonic (C D E G A)
    for (let x = 0; x < 5; x++)
      for (let y = 0; y < 5; y++) {
        const m = noteForCell(x, y)
        expect([0, 2, 4, 7, 9]).toContain(m % 12)
      }
    expect(noteForCell(4, 4)).toBeGreaterThan(noteForCell(0, 0))
  })
})

describe('i18n: no Japanese literals in M8 JSX (SPEC G-2)', () => {
  const files = import.meta.glob('./*.tsx', { eager: true, query: '?raw', import: 'default' }) as Record<string, string>
  it('has component files', () => expect(Object.keys(files).length).toBeGreaterThanOrEqual(4))
  for (const [path, src] of Object.entries(files)) {
    it(`${path} has no full-width text outside comments`, () => {
      const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
      const bad = code.match(/[　-ヿ㐀-鿿＀-￯가-힯]+/g)
      expect(bad, `${path}: ${bad?.join(' ')}`).toBeNull()
    })
  }
})

describe('mixer constellation', () => {
  it('places every reservable song once, spread over the whole pad', () => {
    const stars = songStars()
    const reservable = SONGS.filter(s => s.reservable)
    expect(stars.length).toBe(reservable.length)
    expect(new Set(stars.map(s => s.id)).size).toBe(stars.length)
    for (const s of stars) {
      expect(s.hype).toBeGreaterThanOrEqual(0)
      expect(s.hype).toBeLessThanOrEqual(1)
      expect(s.fresh).toBeGreaterThanOrEqual(0)
      expect(s.fresh).toBeLessThanOrEqual(1)
    }
    // every quadrant of the pad has songs (ranks, not raw values)
    const q = [0, 0, 0, 0]
    for (const s of stars) q[(s.hype < 0.5 ? 0 : 1) + (s.fresh < 0.5 ? 0 : 2)]++
    for (const n of q) expect(n).toBeGreaterThan(10)
    // deterministic
    expect(songStars()).toBe(stars)
  })

  it('follows the axes: calm songs to the left, well-known songs at the bottom', () => {
    const stars = songStars()
    const by = new Map(stars.map(s => [s.id, s]))
    const calm = [...SONGS].filter(s => s.reservable).sort((a, b) => a.energy - b.energy)[0]
    const loud = [...SONGS].filter(s => s.reservable).sort((a, b) => b.energy - a.energy)[0]
    expect(by.get(calm.id)!.hype).toBeLessThan(by.get(loud.id)!.hype)
    const known = [...SONGS].filter(s => s.reservable).sort((a, b) => popularity(b) - popularity(a))[0]
    expect(by.get(known.id)!.fresh).toBeLessThan(0.1)
  })

  it('finds the nearest songs to the puck', () => {
    const stars = songStars()
    const near = nearestStars(stars, 0.95, 0.05, 3)
    expect(near).toHaveLength(3)
    for (const s of near) expect(s.hype > 0.6 && s.fresh < 0.4).toBe(true)
    const far = nearestStars(stars, 0.05, 0.95, 3)
    for (const s of far) expect(s.hype < 0.4 && s.fresh > 0.6).toBe(true)
  })
})

describe('mixer callout placement (ROBUST#14)', () => {
  // the 360×740 pad as measured in EN: 320×224, three rows of titles (3 × 20 + 2 × 2), the four
  // axis labels with the 3 px margin MoodMixer adds
  const W = 320
  const H = 224
  const bw = 156
  const bh = 64
  const axes: Rect[] = [
    { x: 5, y: 99, w: 79, h: 26 },
    { x: 249, y: 99, w: 66, h: 26 },
    { x: 109, y: 5, w: 101, h: 26 },
    { x: 120, y: 193, w: 80, h: 26 },
  ]
  const ov = (a: Rect, b: Rect) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y))
  const box = (h: number, f: number, prev = -1) => {
    const p = placeCallout(h * W, (1 - f) * H, W, H, bw, bh, axes, prev, 26)
    return { ...p, r: { x: p.x, y: p.y, w: bw, h: bh } }
  }

  it('at the default centre it covers no axis label and stays inside the pad', () => {
    const { r } = box(0.5, 0.5)
    expect(axes.map(a => ov(r, a))).toEqual([0, 0, 0, 0])
    expect(r.x).toBeGreaterThanOrEqual(8)
    expect(r.x + r.w).toBeLessThanOrEqual(W - 8)
  })

  it('never leaves the pad and never covers the puck, anywhere on it', () => {
    for (let h = 0; h <= 1.0001; h += 0.1)
      for (let f = 0; f <= 1.0001; f += 0.1) {
        const { r } = box(h, f)
        expect(r.x >= 8 && r.y >= 8 && r.x + r.w <= W - 8 && r.y + r.h <= H - 8, `${h},${f}`).toBe(true)
        const puck = { x: h * W - 21, y: (1 - f) * H - 21, w: 42, h: 42 }
        // only the cramped corners may touch the ball's rim a little
        expect(ov(r, puck), `${h.toFixed(1)},${f.toFixed(1)}`).toBeLessThan(42 * 10)
      }
  })

  it('stays clear of the labels away from the corners', () => {
    let clear = 0
    let total = 0
    for (let h = 0.2; h <= 0.8001; h += 0.1)
      for (let f = 0.2; f <= 0.8001; f += 0.1) {
        total++
        const { r } = box(h, f)
        if (axes.every(a => ov(r, a) === 0)) clear++
      }
    expect(clear / total).toBeGreaterThan(0.9)
  })

  it('goes to the left of the puck near the right edge', () => {
    const p = box(0.92, 0.5)
    expect(p.side).toBe('l')
    expect(p.r.x + p.r.w).toBeLessThanOrEqual(0.92 * W)
  })

  it('does not flicker from spot to spot during a slow drag', () => {
    for (const f of [0.3, 0.5, 0.7]) {
      let prev = -1
      let changes = 0
      for (let h = 0.15; h <= 0.85; h += 0.01) {
        const p = box(h, f, prev)
        if (prev >= 0 && p.slot !== prev) changes++
        prev = p.slot
      }
      expect(changes, `f=${f}`).toBeLessThanOrEqual(4)
    }
  })
})
