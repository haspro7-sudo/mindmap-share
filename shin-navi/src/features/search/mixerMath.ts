// Pure mapping for the air mixer pad (SPEC L/M8 #4). x = hype (しっとり 0 → アガる 1),
// y = fresh (知ってる 0 → 新しい出会い 1). The pad is a 5×5 grid: crossing a cell plays one
// C-major-pentatonic note; the four corners are the four aurora palettes.
import type { AuroraKey } from '../../core/types'

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
