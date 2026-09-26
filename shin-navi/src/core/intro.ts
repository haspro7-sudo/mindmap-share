// The first three seconds (SPEC B-2). Every module reads its entrance time from here so the
// whole sequence stays choreographed from one table. Times are ms from the intro start.
import { naviApi, useNavi } from './store'
import type { IntroMode } from './store/types'

export const INTRO_TIMELINE = {
  wire: 0,
  ballDrop: 0,
  horizon: 300,
  aurora: 300,
  specks: 400,
  orbMinato: 900,
  orbSaki: 1150,
  junRing: 1400,
  cardRise: 1400,
  moodWord: 1600,
  knowDots: 1900,
  lane: 2400,
  ghostHand: 2400,
  peeks: 2600,
  langPulse: 2800,
  done: 3000,
} as const satisfies Record<string, number>

export type IntroKey = keyof typeof INTRO_TIMELINE

/** short = same-night reload (0.8 s), none = ?intro=0 / tests. */
export const INTRO_SCALE: Record<IntroMode, number> = { full: 1, short: 0.27, none: 0 }

function mode(): IntroMode {
  try {
    return naviApi.getState().session.intro
  } catch {
    return 'full'
  }
}

function reduced(): boolean {
  try {
    return naviApi.getState().ui.reduced
  } catch {
    return false
  }
}

/**
 * Delay in SECONDS for a timeline key, scaled by the intro mode (short ×0.27, none 0).
 * Under prefers-reduced-motion everything fades in together (SPEC B-5), so the delay is 0.
 */
export function introDelay(k: IntroKey, m: IntroMode = mode()): number {
  if (reduced()) return 0
  return (INTRO_TIMELINE[k] * INTRO_SCALE[m]) / 1000
}

// ---- elapsed-time helpers: components that mount after the intro must not replay it.

const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())
let startedAt = nowMs()

/** Called by the App when an intro (re)starts: first mount, next visit. */
export function restartIntro(): void {
  startedAt = nowMs()
}

/** ms since the current intro started. */
export function introElapsedMs(): number {
  return nowMs() - startedAt
}

/** Seconds still to wait until `k` fires (0 once it has passed). Use this for late mounts. */
export function introWait(k: IntroKey, m: IntroMode = mode()): number {
  return Math.max(0, introDelay(k, m) - introElapsedMs() / 1000)
}

/** True while the moment `k` is still ahead (i.e. an entrance animation should play). */
export function introPending(k: IntroKey, m: IntroMode = mode()): boolean {
  if (m === 'none') return false
  return introElapsedMs() < INTRO_TIMELINE[k] * INTRO_SCALE[m] + 50
}

/** Whether the whole intro sequence has finished. */
export function introFinished(m: IntroMode = mode()): boolean {
  return introElapsedMs() >= INTRO_TIMELINE.done * INTRO_SCALE[m]
}

export function useIntroMode(): IntroMode {
  return useNavi(s => s.session.intro)
}
