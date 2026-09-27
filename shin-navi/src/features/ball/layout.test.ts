import { describe, expect, it } from 'vitest'
import { GENRES, SONGS } from '../../data/songs'
import { BANDS, TILE_COUNT, areaKeyOf, faceInSector, areaTiles, ballLayout, genreSectors, idealSpots, inSector, layoutBall, makeTiles, tileArea, MIN_SECTOR } from './layout'
import { TILT, frontRot, nearestAngle, project, tileAt, unproject, type BallView } from './hit'
import { convexHull, hexRgb, hueRgb } from './render'

describe('layoutBall (SPEC D-2)', () => {
  it('has 154 faces in 10 bands of round(20·cos(lat))', () => {
    const tiles = makeTiles()
    expect(tiles).toHaveLength(154)
    expect(TILE_COUNT).toBe(154)
    expect([...BANDS]).toEqual([9, 13, 16, 19, 20, 20, 19, 16, 13, 9])
    BANDS.forEach((n, b) => {
      const lat = 72 - 14.4 * (b + 0.5)
      expect(Math.round(20 * Math.cos((lat * Math.PI) / 180))).toBe(n)
      expect(tiles.filter(t => t.band === b)).toHaveLength(n)
    })
    expect(tiles.every((t, i) => t.i === i && Math.abs(t.lat) < 72 && t.lon >= -180 && t.lon < 180)).toBe(true)
  })

  it('places all 120 songs, each on its own tile, leaving 34 chrome tiles', () => {
    expect(SONGS).toHaveLength(120)
    const { tiles, bySong } = layoutBall(SONGS)
    expect(tiles).toHaveLength(154)
    const placed = tiles.filter(t => t.songId)
    expect(placed).toHaveLength(120)
    expect(new Set(placed.map(t => t.songId)).size).toBe(120)
    expect(Object.keys(bySong)).toHaveLength(120)
    for (const s of SONGS) expect(tiles[bySong[s.id]].songId).toBe(s.id)
    expect(tiles.filter(t => !t.songId)).toHaveLength(34)
  })

  it('puts at least 75% of songs inside their own genre sector', () => {
    const { tiles, bySong } = layoutBall(SONGS)
    const secs = genreSectors(SONGS)
    const sec = (g: string) => secs.find(x => x.genre === g)!
    // a face is in its sector when the face (its longitude span) lies in / touches the sector
    const inside = SONGS.filter(s => faceInSector(tiles[bySong[s.id]], sec(s.genre))).length
    expect(inside / SONGS.length).toBeGreaterThanOrEqual(0.75)
    // stricter reading (face centre inside the sector): the 12° sectors are narrower than a face
    const centred = SONGS.filter(s => inSector(tiles[bySong[s.id]].lon, sec(s.genre))).length
    expect(centred / SONGS.length).toBeGreaterThanOrEqual(0.6)
    // every big genre (≥ 8 songs) keeps at least half of its faces centred in its own sector
    for (const g of secs.filter(x => x.count >= 8)) {
      const ss = SONGS.filter(s => s.genre === g.genre)
      const c = ss.filter(s => inSector(tiles[bySong[s.id]].lon, g)).length
      expect(c / ss.length).toBeGreaterThanOrEqual(0.5)
    }
  })

  it('faceInSector: a face touching a sector counts, a face beside it does not', () => {
    const sec = { start: 40, width: 12 }
    expect(faceInSector({ lon: 46, dLon: 18 }, sec)).toBe(true)
    expect(faceInSector({ lon: 30, dLon: 18 }, sec)).toBe(false) // 21..39 ends before 40
    expect(faceInSector({ lon: 25, dLon: 18 }, sec)).toBe(false) // 16..34
    expect(faceInSector({ lon: 60, dLon: 18 }, sec)).toBe(true) // 51..69
    expect(faceInSector({ lon: 62, dLon: 18 }, sec)).toBe(false) // 53..71
    expect(faceInSector({ lon: 175, dLon: 18 }, { start: 178, width: 12 })).toBe(true) // wraps
  })

  it('is deterministic', () => {
    const a = layoutBall(SONGS)
    const b = layoutBall([...SONGS])
    expect(a.bySong).toEqual(b.bySong)
    expect(ballLayout().bySong).toEqual(a.bySong)
  })

  it('keeps fast songs north and slow songs south', () => {
    const { tiles, bySong } = layoutBall(SONGS)
    const mean = (tempo: string) => {
      const xs = SONGS.filter(s => s.tempo === tempo).map(s => tiles[bySong[s.id]].lat)
      return xs.reduce((a, b) => a + b, 0) / xs.length
    }
    expect(mean('fast')).toBeGreaterThan(mean('mid'))
    expect(mean('mid')).toBeGreaterThan(mean('slow'))
    const ideal = idealSpots(SONGS)
    const fastest = [...SONGS].sort((a, b) => b.bpm - a.bpm)[0]
    const slowest = [...SONGS].sort((a, b) => a.bpm - b.bpm)[0]
    expect(ideal[fastest.id].lat).toBe(72)
    expect(ideal[slowest.id].lat).toBe(-72)
  })

  it('sizes genre sectors by song count with a 12° minimum, in GENRES order', () => {
    const secs = genreSectors(SONGS)
    expect(secs.map(s => s.genre)).toEqual([...GENRES])
    expect(secs.reduce((a, s) => a + s.width, 0)).toBeCloseTo(360, 6)
    for (const s of secs) expect(s.width).toBeGreaterThanOrEqual(MIN_SECTOR - 1e-9)
    const jpop = secs.find(s => s.genre === 'J-POP')!
    const anime = secs.find(s => s.genre === 'アニメ')!
    expect(jpop.width).toBeGreaterThan(anime.width)
    expect(secs[0].start).toBe(-180)
  })

  it('handles small and empty inputs', () => {
    expect(Object.keys(layoutBall([]).bySong)).toHaveLength(0)
    const one = layoutBall([SONGS[0]])
    expect(Object.keys(one.bySong)).toEqual([SONGS[0].id])
  })

  it('maps areas to tiles, and chrome tiles to the nearest area', () => {
    const lay = ballLayout()
    const s = SONGS.find(x => x.id === 'lemon') ?? SONGS[0]
    const area = areaKeyOf(s)
    const ids = areaTiles(area)
    expect(ids).toContain(lay.bySong[s.id])
    const chrome = lay.tiles.find(t => !t.songId)!
    expect(tileArea(chrome.i)).toMatch(/^(fast|mid|slow):/)
    expect(tileArea(lay.bySong[s.id])).toBe(area)
  })
})

describe('ball camera + hit testing', () => {
  const views: BallView[] = [0, 0.7, 2.2, -3, 11].map(rot => ({ cx: 150, cy: 140, r: 98, rot, tilt: TILT }))

  it('finds the tile under the projected centre of every front tile', () => {
    const lay = ballLayout()
    let checked = 0
    for (const v of views) {
      for (const t of lay.tiles) {
        const p = project(t.lat, t.lon, v)
        if (p.z < 0.15) continue
        expect(tileAt(p.x, p.y, v)).toBe(t.i)
        checked++
      }
    }
    expect(checked).toBeGreaterThan(200)
  })

  it('round-trips unproject(project(p))', () => {
    const v = views[1]
    const p = project(20, 40, v)
    const q = unproject(p.x, p.y, v)!
    expect(q.lat).toBeCloseTo(20, 6)
    expect(q.lon).toBeCloseTo(40, 6)
    expect(unproject(v.cx + v.r * 1.1, v.cy, v)).toBeNull()
  })

  it('returns null on the polar caps and outside the disc', () => {
    const v = views[0]
    const top = project(85, 0, v)
    expect(tileAt(top.x, top.y, v)).toBeNull()
    expect(tileAt(v.cx + v.r + 2, v.cy, v)).toBeNull()
  })

  it('frontRot brings a longitude to the front centre', () => {
    const v = { ...views[0], rot: frontRot(123) }
    const p = project(0, 123, v)
    expect(p.x).toBeCloseTo(v.cx, 6)
    expect(p.z).toBeGreaterThan(0.95)
    expect(nearestAngle(0.1, 0.1 + Math.PI * 4 + 0.2)).toBeCloseTo(0.3, 9)
    expect(nearestAngle(3, -3)).toBeCloseTo(-3 + Math.PI * 2, 9)
  })
})

describe('render helpers', () => {
  it('parses hex and hsl() colours (area colours are hsl tokens)', () => {
    expect(hexRgb('#FF8A3D')).toEqual([255, 138, 61])
    expect(hexRgb('hsl(330 85% 62%)')).toEqual([240, 76, 158])
    expect(hexRgb('nonsense')).toEqual([220, 220, 235])
  })
  it('hueRgb cycles through the rainbow', () => {
    const o = [0, 0, 0]
    hueRgb(0, 0.5, o)
    expect(o.map(Math.round)).toEqual([255, 0, 0])
    hueRgb(120, 0.5, o)
    expect(o.map(Math.round)).toEqual([0, 255, 0])
    hueRgb(600, 0.5, o) // wraps to 240
    expect(o.map(Math.round)).toEqual([0, 0, 255])
  })
  it('convexHull keeps the outline of a linked group', () => {
    const h = convexHull([
      [0, 0],
      [10, 0],
      [5, 5],
      [10, 10],
      [0, 10],
    ])
    expect(h).toHaveLength(4)
    expect(h).not.toContainEqual([5, 5])
  })
})
