import type { AuroraKey } from '../../core/types'
import type { RGB } from './sprites'

// One-shot cues from installFx (store/bus side) to the canvases (drawing side). Both the phone
// and the room canvases may be mounted at once (dual), so this is a tiny fan-out, not a queue.
export type FxSignal =
  | { type: 'lightsOn' }
  /** a face levelled up: throw one speck (and a streak for mirror/prism) from this viewport point */
  | { type: 'spawn'; x: number; y: number; color: string; keep: boolean; streak: boolean }
  | { type: 'touch'; x: number; y: number }

type Fn = (s: FxSignal) => void
const fns = new Set<Fn>()

export const fxSignals = {
  on(fn: Fn): () => void {
    fns.add(fn)
    return () => fns.delete(fn)
  },
  emit(s: FxSignal): void {
    for (const fn of [...fns]) {
      try {
        fn(s)
      } catch (err) {
        console.warn('[fx]', s.type, err)
      }
    }
  },
}

/** Frame counter advanced once per ticker frame (by installFx): the canvases that paint at a
 *  reduced rate take turns, so no single frame carries every paint. */
export const fxClock = { frame: 0 }

/**
 * The 60 Hz vsync slot of a frame timestamp. Paints that run every other frame take turns by its
 * parity across modules: the specks prefer even slots, the mirror ball's idle redraws prefer odd
 * ones (ball/pace.ts uses the same rule), so the two biggest canvas paints rarely share a frame.
 * Every ticker subscriber gets the same timestamp in a frame, so they always agree.
 */
export const vsyncSlot = (now: number): number => Math.round(now / (1000 / 60))

/**
 * Runtime facts the canvases read every frame (written by installFx from the store).
 * `covered`: a full-screen overlay (standby, wrap-up, entry) hides the phone wall; after its
 * 300 ms fade the phone canvases stop painting until it closes.
 * `floor`: the home tab shows the hero's floor. On the other tabs the phone wall keeps its light
 * but the horizon seam and its reflection fade out (they would cut across lists).
 */
export const fxRuntime = { covered: false, coverAt: 0, floor: true }

/**
 * "ナビの見立て" on the wall (QA OWNER#7 / DEMO#13). Right after a reservation the aurora leans
 * PREVIEW_MIX of the way toward the palette the room is heading for (selForecast), so every
 * reservation visibly moves the top half within a second; when the next song ends the real
 * palette takes over (the air really changed) and the lean melts away. Written by installFx once
 * per frame, read by every canvas that paints with the palette.
 * `key`: forecast palette (null = none); `k`: current mix 0..PREVIEW_MIX (eased from the linear
 * progress `p`); `target`: PREVIEW_MIX while a lean is wanted, else 0; `rgb`: the colours the
 * preview leans to right now (eased, so a changing forecast never jumps); `afterglow`: 1 → 0 over
 * AFTERGLOW_MS after everyone knew a song — the wall keeps a little of the 0.8 s gold flush while
 * the hero word says "みんな知ってた！".
 */
export const fxPreview: { key: AuroraKey | null; k: number; target: number; p: number; afterglow: number; rgb: [RGB, RGB, RGB] } = {
  key: null,
  k: 0,
  target: 0,
  p: 0,
  afterglow: 0,
  rgb: [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ],
}

/** Whether the phone wall is hidden under an overlay right now. */
export function phoneCovered(now: number): boolean {
  return fxRuntime.covered && now - fxRuntime.coverAt > 400
}
