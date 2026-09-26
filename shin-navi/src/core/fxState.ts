// Mutable per-frame effect state (SPEC K-7). NOT React state: canvases read it every frame,
// store subscriptions (installFx) and gesture code write it. Never trigger renders from here.
import type { AuroraKey, SongId } from './types'

export type FxQuality = 0 | 1 | 2
export type DragDir = 'up' | 'right' | 'left' | null

export type FxState = {
  /** room heat 0..1 (mirrors room.heat) */
  heat: number
  /** aurora palette being faded to, and the one being faded from */
  aurora: AuroraKey
  auroraFrom: AuroraKey
  /** crossfade progress 0..1 from auroraFrom to aurora (1 = settled) */
  auroraT: number
  /** aurora flow speed multiplier (0.5 + heat; halved during "お水・ひと休み") */
  speed: number
  /** target number of light specks (12 + min(48, mirror + prism)) */
  specksTarget: number
  /** 0..1 flash that decays to 0 (first tap, all-know, …) */
  flash: number
  /** 0..1 gold tint that decays (all-know chord) */
  gold: number
  /** quality tier chosen by the governor */
  quality: FxQuality
  /** prefers-reduced-motion */
  reduced: boolean
  /** where specks are emitted from (face projections), in viewport px */
  emitters: { x: number; y: number }[]
  /** last touch in viewport px, t = performance.now() */
  touch: { x: number; y: number; t: number } | null
  /** card drag preview: written by cards (M3), read by ball (M2) and lane (M6) */
  drag: { dir: DragDir; songId?: SongId; progress: number }
}

export function freshFxState(): FxState {
  return {
    heat: 0.2,
    aurora: 'quiet',
    auroraFrom: 'quiet',
    auroraT: 1,
    speed: 0.7,
    specksTarget: 12,
    flash: 0,
    gold: 0,
    quality: 2,
    reduced: false,
    emitters: [],
    touch: null,
    drag: { dir: null, progress: 0 },
  }
}

export const fxState: FxState = freshFxState()

/** Tests: restore defaults in place (keeps the same object identity). */
export function resetFxState(): void {
  Object.assign(fxState, freshFxState())
}
