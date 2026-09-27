// Frame pacing of the big balls (SPEC K-11, QA ROBUST#2). The ball canvas is the most expensive
// thing on the home screen to rasterise, so it is only redrawn when the picture really moves:
// - a finger on the ball, a flick's inertia, a seek or a face effect ("busy") draws every frame
//   on tier 2;
// - the slow idle turn (15°/s, ≈0.25° per 60 Hz frame), the light drift and the twinkles are drawn
//   at 30 fps (the canvas itself is the cache between two draws);
// - lower tiers of the fx governor (fxState.quality) halve that again and drop the specular
//   extras (bloom, glass bands, most glints) and some resolution;
// - under reduced motion nothing turns: draw only when something changed.
import type { FxQuality } from '../../core/fxState'

export type Activity = {
  /** finger on the ball or a flick still faster than the idle turn */
  touch: boolean
  /** seek / camera tilt / pulses / flashes / card-drag preview / highlight fade */
  busy: boolean
  /** the scene changed (store sync, resize) and has not been drawn yet */
  dirty: boolean
}

export type Pace = {
  /** minimum ms between two draws for this activity (0 = every frame) */
  gap: number
  /** device pixel ratio cap of the canvas on this tier */
  dpr: number
  /** skip the specular extras (bloom, glass bands, most glints) */
  lite: boolean
}

type TierPace = { idle: number; busy: number; touch: number; dpr: number; lite: boolean }

/** Per governor tier. idle 33 ms = 30 fps, 66 ms = 15 fps. */
export const BALL_TIERS: Record<FxQuality, TierPace> = {
  2: { idle: 33, busy: 0, touch: 0, dpr: 1.5, lite: false },
  1: { idle: 33, busy: 33, touch: 0, dpr: 1.25, lite: true },
  0: { idle: 66, busy: 33, touch: 33, dpr: 1, lite: true },
}

/** Never redraw a ball that does not move more often than this under reduced motion. */
const REDUCED_IDLE = 1000

export function ballPace(tier: FxQuality, reduced: boolean, a: Activity): Pace {
  if (reduced) {
    // nothing turns: a static picture, redrawn when it changes (flashes, pulses, a drag)
    const p = BALL_TIERS[2]
    return { gap: a.touch || a.busy || a.dirty ? 0 : REDUCED_IDLE, dpr: p.dpr, lite: false }
  }
  const p = BALL_TIERS[tier] ?? BALL_TIERS[2]
  const gap = a.dirty ? 0 : a.touch ? p.touch : a.busy ? p.busy : p.idle
  return { gap, dpr: p.dpr, lite: p.lite }
}

/**
 * Idle redraws prefer odd 60 Hz vsync slots: the fx speck canvas paints its every-other-frame on
 * even ones (fx/signals.ts vsyncSlot, same rule — each ticker subscriber sees the same timestamp),
 * so the two biggest canvas paints rarely land in one frame. A due draw waits at most one frame.
 */
export function oddSlot(now: number): boolean {
  return (Math.round(now / (1000 / 60)) & 1) === 1
}

/**
 * Whether a frame `since` ms after the last draw should draw, for a minimum gap. Frames arrive
 * every ~16.7 ms (8.3 ms at 120 Hz) with jitter, so a gap is honoured with a small tolerance: a
 * 33 ms gap draws every 2nd frame at 60 Hz, a 66 ms gap every 4th.
 */
export function due(since: number, gap: number): boolean {
  return gap <= 0 || since >= gap - 5
}
