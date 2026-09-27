// Pure mapping for the air mixer pad (SPEC L/M8 #4). x = hype (しっとり 0 → アガる 1),
// y = fresh (知ってる 0 → 新しい出会い 1). The pad is a 5×5 grid: crossing a cell plays one
// C-major-pentatonic note; the four corners are the four aurora palettes.
import type { AuroraKey } from '../../core/types'
import { SONGS, type Song } from '../../data/songs'
import { popularity } from './search'

export const CELLS = 5
const PENTA = [0, 2, 4, 7, 9]
const C5 = 72

export const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v)

/** Cell [column, row] for a pad value; row 0 = 知ってる (bottom), column 0 = しっとり (left). */
export function cellOf(hype: number, fresh: number): [number, number] {
  return [Math.min(CELLS - 1, Math.floor(clamp01(hype) * CELLS)), Math.min(CELLS - 1, Math.floor(clamp01(fresh) * CELLS))]
}

/** A note for a cell: climbs the pentatonic scale to the right and upwards (C5 … G6). */
export function noteForCell(cx: number, cy: number): number {
  const step = Math.max(0, cx) + Math.max(0, cy)
  return C5 + 12 * Math.floor(step / 5) + PENTA[step % 5]
}

export type ZoneId =
  | 'mellowKnown'
  | 'midKnown'
  | 'hypeKnown'
  | 'mellowMid'
  | 'midMid'
  | 'hypeMid'
  | 'mellowFresh'
  | 'midFresh'
  | 'hypeFresh'

/** One of nine named moods (3 × 3) for the live phrase above the pad. */
export function zoneOf(hype: number, fresh: number): ZoneId {
  const c = hype < 0.34 ? 'mellow' : hype < 0.67 ? 'mid' : 'hype'
  const r = fresh < 0.34 ? 'Known' : fresh < 0.67 ? 'Mid' : 'Fresh'
  return `${c}${r}` as ZoneId
}

/** The aurora palette the pad previews: the four corners are the four palettes. */
export function auroraAt(hype: number, fresh: number): AuroraKey {
  if (hype < 0.5) return fresh < 0.5 ? 'quiet' : 'mellow'
  return fresh < 0.5 ? 'hot' : 'warm'
}

/** Aurora brightness/size while previewing (fxState.heat is 0..1). */
export const previewHeat = (hype: number): number => 0.12 + 0.83 * clamp01(hype)

/** Aurora flow speed while previewing (fxState.speed; the room uses 0.5 + heat). */
export const previewSpeed = (hype: number, fresh: number): number => 0.35 + 1.45 * clamp01(hype) + 0.3 * clamp01(fresh)

// ---------------------------------------------------------------- the song constellation
// Every reservable song is a star on the pad: x = how much it lifts the room (energy), y = how
// new it is likely to be (1 − how widely it is known). Both are ranks, not raw values, so the
// catalogue (mostly well-known, upbeat songs) spreads over the whole pad instead of piling into
// one corner. This is Navi's read (a hypothesis), shown as such.

export type Star = { id: string; hype: number; fresh: number; genre: Song['genre'] }

/** 0..1, deterministic, small: keeps equal ranks from lining up on a grid. */
function jitter(id: string, salt: number): number {
  let h = 2166136261 ^ salt
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619)
  return ((h >>> 0) % 1000) / 1000 - 0.5
}

let STARS: Star[] | null = null

export function songStars(songs: readonly Song[] = SONGS): Star[] {
  if (songs === SONGS && STARS) return STARS
  const list = songs.filter(s => s.reservable)
  const n = list.length
  const byEnergy = [...list].sort((a, b) => a.energy - b.energy || a.id.localeCompare(b.id))
  const byFresh = [...list].sort((a, b) => popularity(b) - popularity(a) || a.id.localeCompare(b.id))
  const rx = new Map(byEnergy.map((s, i) => [s.id, i]))
  const ry = new Map(byFresh.map((s, i) => [s.id, i]))
  const pad = 0.05
  const out = list.map(s => ({
    id: s.id,
    genre: s.genre,
    hype: clamp01(pad + (1 - 2 * pad) * (((rx.get(s.id) ?? 0) + 0.5 + 0.8 * jitter(s.id, 1)) / n)),
    fresh: clamp01(pad + (1 - 2 * pad) * (((ry.get(s.id) ?? 0) + 0.5 + 0.8 * jitter(s.id, 2)) / n)),
  }))
  if (songs === SONGS) STARS = out
  return out
}

/** The n stars closest to (hype, fresh), measured on a pad of the given width/height ratio. */
export function nearestStars(stars: readonly Star[], hype: number, fresh: number, n = 3, aspect = 1.3): Star[] {
  const d = (s: Star) => (s.hype - hype) ** 2 * aspect * aspect + (s.fresh - fresh) ** 2
  return [...stars].sort((a, b) => d(a) - d(b)).slice(0, n)
}

// ---------------------------------------------------------------- where the "nearest songs" callout sits

export type Rect = { x: number; y: number; w: number; h: number }
export type CalloutSide = 'r' | 'l' | 'c'
export type CalloutSpot = { x: number; y: number; side: CalloutSide; slot: number }

const overlap = (a: Rect, b: Rect): number => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y))

/**
 * Put the callout (bw × bh) beside the puck at (px, py) inside a W × H pad: on the side away from
 * the nearest edge, never over the axis labels or the puck, always inside the pad (ROBUST#14).
 * Pure: candidates around the puck, clamped into the pad, scored by what they cover. `prev` (the
 * slot used last time) is kept unless another slot is clearly better, so the list does not flicker
 * from side to side while the puck is dragged.
 */
export function placeCallout(px: number, py: number, W: number, H: number, bw: number, bh: number, avoid: Rect[], prev = -1, puckR = 28, margin = 8): CalloutSpot {
  const off = puckR + 6
  const away: CalloutSide = px > W / 2 ? 'l' : 'r'
  const xs: { x: number; side: CalloutSide }[] = [
    { x: px + off, side: 'r' },
    { x: px - off - bw, side: 'l' },
    { x: px - bw / 2, side: 'c' },
  ]
  // beside the puck (centred, just below its row, just above it), clear of it vertically, or
  // snapped to the free band next to a label
  const ys = [py - bh / 2, py + 12, py - 12 - bh, py + off + 2, py - off - 2 - bh]
  for (const a of avoid) ys.push(a.y + a.h + 1, a.y - bh - 1)
  const maxX = Math.max(margin, W - margin - bw)
  const maxY = Math.max(margin, H - margin - bh)
  const puck: Rect = { x: px - puckR, y: py - puckR, w: puckR * 2, h: puckR * 2 }
  const spots: CalloutSpot[] = []
  const scores: number[] = []
  let best = 0
  xs.forEach((cx, i) =>
    ys.forEach((cy, j) => {
      const x = Math.min(maxX, Math.max(margin, cx.x))
      const y = Math.min(maxY, Math.max(margin, cy))
      const box = { x, y, w: bw, h: bh }
      // labels and the puck must stay readable; sliding along the edge is cheap; beside the puck
      // on the side away from the nearest edge reads best
      let s = 20 * overlap(box, puck) + 4 * Math.abs(x - cx.x) + 2 * Math.abs(y - cy) + (cx.side === 'c' ? 60 : cx.side === away ? 0 : 30) + (j === 0 ? 0 : 15) + Math.abs(y + bh / 2 - py) * 0.5
      for (const a of avoid) s += 20 * overlap(box, a)
      const k = spots.length
      spots.push({ x, y, side: cx.side, slot: k })
      scores.push(s)
      if (s < scores[best]) best = k
      void i
    }),
  )
  // keep the previous slot unless another one is clearly better (no flicker while dragging)
  const pick = prev >= 0 && prev < spots.length && scores[prev] <= scores[best] + 200 ? prev : best
  return spots[pick]
}
