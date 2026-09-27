// Ball structure (SPEC D-2). Pure functions: the same songs always give the same ball.
//
// 10 latitude bands between +72° and −72° (14.4° each) with round(20·cos(lat)) tiles per band:
// [9,13,16,19,20,20,19,16,13,9] = 154 faces. Songs sit by tempo (BPM rank: fastest at +72°,
// slowest at −72°) and genre (GENRES order, sector width ∝ song count, min 12°, year order inside
// the sector). A greedy pass drops each song on the free tile nearest its ideal spot
// (great-circle distance, ties → lower tile index). Tiles without a song are chrome decoration.
import { GENRES, SONGS, type Genre, type Song } from '../../data/songs'
import type { AreaKey, SongId, Tempo } from '../../core/types'

export type BallTile = { i: number; band: number; lat: number; lon: number; dLat: number; dLon: number; songId?: SongId }
export type BallLayout = { tiles: BallTile[]; bySong: Record<SongId, number> }
export type GenreSector = { genre: Genre; start: number; width: number; count: number }

export const BANDS = [9, 13, 16, 19, 20, 20, 19, 16, 13, 9] as const
export const LAT_MAX = 72
export const BAND_DLAT = (2 * LAT_MAX) / BANDS.length // 14.4°
export const TILE_COUNT = BANDS.reduce((a, b) => a + b, 0) // 154
export const MIN_SECTOR = 12

/** First tile index of each band. */
export const BAND_START: readonly number[] = BANDS.map((_, b) => BANDS.slice(0, b).reduce((a, n) => a + n, 0))

const RAD = Math.PI / 180

/** Wrap degrees into [-180, 180). */
export function wrapLon(d: number): number {
  const x = (((d + 180) % 360) + 360) % 360
  return x - 180
}

/** The 154 empty tiles, north band first, west → east inside a band. */
export function makeTiles(): BallTile[] {
  const tiles: BallTile[] = []
  BANDS.forEach((count, band) => {
    const lat = LAT_MAX - BAND_DLAT * (band + 0.5)
    const dLon = 360 / count
    for (let k = 0; k < count; k++) tiles.push({ i: tiles.length, band, lat, lon: -180 + dLon * (k + 0.5), dLat: BAND_DLAT, dLon })
  })
  return tiles
}

/** Genre sectors around the equator: GENRES order from −180°, width ∝ count, min 12°, total 360°. */
export function genreSectors(songs: readonly Song[]): GenreSector[] {
  const counts = GENRES.map(g => songs.filter(s => s.genre === g).length)
  const present = counts.map(c => c > 0)
  const fixed = new Set<number>()
  let widths = counts.map(() => 0)
  // Pin the small genres at the minimum, share what is left in proportion, repeat until stable.
  for (let guard = 0; guard < GENRES.length + 1; guard++) {
    const free = 360 - MIN_SECTOR * fixed.size
    const sumFree = counts.reduce((a, c, i) => (present[i] && !fixed.has(i) ? a + c : a), 0)
    let changed = false
    widths = counts.map((c, i) => {
      if (!present[i]) return 0
      if (fixed.has(i)) return MIN_SECTOR
      const w = sumFree > 0 ? (free * c) / sumFree : 0
      if (w < MIN_SECTOR) {
        fixed.add(i)
        changed = true
      }
      return w
    })
    if (!changed) break
  }
  widths = widths.map((w, i) => (fixed.has(i) ? MIN_SECTOR : w))
  const out: GenreSector[] = []
  let start = -180
  GENRES.forEach((genre, i) => {
    out.push({ genre, start, width: widths[i], count: counts[i] })
    start += widths[i]
  })
  return out
}

/** Unit-sphere angle between two lat/lon points (degrees in, radians out). */
export function greatCircle(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const p1 = lat1 * RAD
  const p2 = lat2 * RAD
  const dl = (lon2 - lon1) * RAD
  const c = Math.sin(p1) * Math.sin(p2) + Math.cos(p1) * Math.cos(p2) * Math.cos(dl)
  return Math.acos(Math.max(-1, Math.min(1, c)))
}

/** Whether a longitude falls inside a sector (sector may wrap past +180°). */
export function inSector(lon: number, sec: Pick<GenreSector, 'start' | 'width'>): boolean {
  const d = (((lon - sec.start) % 360) + 360) % 360
  return d < sec.width
}

/**
 * Whether a face lies in a sector: its longitude span [lon − dLon/2, lon + dLon/2) meets the
 * sector. Faces are 18°–40° wide while the smallest sectors are 12°, so "the centre is inside"
 * would be impossible for many faces of small genres; touching the sector is what the eye sees.
 */
export function faceInSector(t: Pick<BallTile, 'lon' | 'dLon'>, sec: Pick<GenreSector, 'start' | 'width'>): boolean {
  const a = (((t.lon - t.dLon / 2 - sec.start) % 360) + 360) % 360 // face start, relative to the sector start
  return a < sec.width || a + t.dLon > 360
}

export type IdealSpot = { lat: number; lon: number }

/** Where each song would like to sit before collisions are resolved. */
export function idealSpots(songs: readonly Song[]): Record<SongId, IdealSpot> {
  const n = songs.length
  const index = new Map(songs.map((s, i) => [s.id, i]))
  const byBpm = [...songs].sort((a, b) => b.bpm - a.bpm || index.get(a.id)! - index.get(b.id)!)
  const lat: Record<SongId, number> = {}
  byBpm.forEach((s, rank) => {
    lat[s.id] = n <= 1 ? 0 : LAT_MAX - (2 * LAT_MAX * rank) / (n - 1)
  })
  const out: Record<SongId, IdealSpot> = {}
  for (const sec of genreSectors(songs)) {
    const inGenre = songs.filter(s => s.genre === sec.genre).sort((a, b) => a.year - b.year || b.bpm - a.bpm || index.get(a.id)! - index.get(b.id)!)
    inGenre.forEach((s, j) => {
      out[s.id] = { lat: lat[s.id], lon: wrapLon(sec.start + (sec.width * (j + 0.5)) / inGenre.length) }
    })
  }
  return out
}

/** SPEC D-2 layoutBall: deterministic greedy placement of every song on its own tile. */
export function layoutBall(songs: readonly Song[]): BallLayout {
  const tiles = makeTiles()
  const bySong: Record<SongId, number> = {}
  const ideal = idealSpots(songs)
  const index = new Map(songs.map((s, i) => [s.id, i]))
  const order = [...songs].sort((a, b) => GENRES.indexOf(a.genre) - GENRES.indexOf(b.genre) || b.bpm - a.bpm || index.get(a.id)! - index.get(b.id)!)
  for (const s of order) {
    if (bySong[s.id] != null) continue // duplicate ids keep their first tile
    const spot = ideal[s.id]
    let best = -1
    let bestD = Infinity
    for (const t of tiles) {
      if (t.songId) continue
      const d = greatCircle(spot.lat, spot.lon, t.lat, t.lon)
      if (d < bestD - 1e-12) {
        bestD = d
        best = t.i
      }
    }
    if (best < 0) break // more songs than tiles: the rest stay off the ball
    tiles[best].songId = s.id
    bySong[s.id] = best
  }
  return { tiles, bySong }
}

// ---------------------------------------------------------------- the app's ball (SONGS)

let cached: BallLayout | null = null
/** The layout of the full song seed, computed once. */
export function ballLayout(): BallLayout {
  if (!cached) cached = layoutBall(SONGS)
  return cached
}

let sectorCache: GenreSector[] | null = null
export function ballSectors(): GenreSector[] {
  if (!sectorCache) sectorCache = genreSectors(SONGS)
  return sectorCache
}

const SONG_INDEX = new Map(SONGS.map(s => [s.id, s]))

export const areaKeyOf = (s: Pick<Song, 'tempo' | 'genre'>): AreaKey => `${s.tempo}:${s.genre}`

export function parseArea(a: AreaKey): { tempo: Tempo; genre: Genre } {
  const i = a.indexOf(':')
  return { tempo: a.slice(0, i) as Tempo, genre: a.slice(i + 1) as Genre }
}

const areaCache = new WeakMap<BallLayout, Map<AreaKey, number[]>>()
/** Tile indices whose song belongs to the area (tempo × genre); cached per layout. */
export function areaTiles(area: AreaKey, layout: BallLayout = ballLayout()): number[] {
  let m = areaCache.get(layout)
  if (!m) areaCache.set(layout, (m = new Map()))
  let hit = m.get(area)
  if (!hit) m.set(area, (hit = computeAreaTiles(area, layout)))
  return hit
}

function computeAreaTiles(area: AreaKey, layout: BallLayout): number[] {
  const out: number[] = []
  for (const t of layout.tiles) {
    const s = t.songId ? SONG_INDEX.get(t.songId) : undefined
    if (s && areaKeyOf(s) === area) out.push(t.i)
  }
  return out
}

/** Songs of an area, best known first (for "representative songs"). */
export function areaSongs(area: AreaKey, songs: readonly Song[] = SONGS): Song[] {
  const { tempo, genre } = parseArea(area)
  const avg = (s: Song) => (s.knownRate[20] + s.knownRate[30] + s.knownRate[40]) / 3
  return songs.filter(s => s.tempo === tempo && s.genre === genre).sort((a, b) => avg(b) - avg(a) || (a.id < b.id ? -1 : 1))
}

/**
 * The area a tile stands for. Song tiles use their song; chrome tiles borrow the area of the
 * nearest song tile so tapping anywhere on the ball can guide to a region.
 */
export function tileArea(i: number, layout: BallLayout = ballLayout()): AreaKey | null {
  const t = layout.tiles[i]
  if (!t) return null
  if (t.songId) {
    const s = SONG_INDEX.get(t.songId)
    return s ? areaKeyOf(s) : null
  }
  let best: BallTile | null = null
  let bestD = Infinity
  for (const u of layout.tiles) {
    if (!u.songId) continue
    const d = greatCircle(t.lat, t.lon, u.lat, u.lon)
    if (d < bestD - 1e-12) {
      bestD = d
      best = u
    }
  }
  const s = best?.songId ? SONG_INDEX.get(best.songId) : undefined
  return s ? areaKeyOf(s) : null
}

/** Mean position of a set of tiles (for aiming the camera at an area). */
export function tilesCentroid(ids: readonly number[], layout: BallLayout = ballLayout()): { lat: number; lon: number } {
  if (!ids.length) return { lat: 0, lon: 0 }
  let x = 0
  let y = 0
  let z = 0
  for (const i of ids) {
    const t = layout.tiles[i]
    const la = t.lat * RAD
    const lo = t.lon * RAD
    x += Math.cos(la) * Math.sin(lo)
    y += Math.sin(la)
    z += Math.cos(la) * Math.cos(lo)
  }
  const len = Math.hypot(x, y, z) || 1
  return { lat: Math.asin(y / len) / RAD, lon: Math.atan2(x, z) / RAD }
}
