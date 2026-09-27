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
 * Runtime facts the canvases read every frame (written by installFx from the store).
 * `covered`: a full-screen overlay (standby, wrap-up, entry) hides the phone wall; after its
 * 300 ms fade the phone canvases stop painting until it closes.
 * `floor`: the home tab shows the hero's floor. On the other tabs the phone wall keeps its light
 * but the horizon seam and its reflection fade out (they would cut across lists).
 */
export const fxRuntime = { covered: false, coverAt: 0, floor: true }

/** Whether the phone wall is hidden under an overlay right now. */
export function phoneCovered(now: number): boolean {
  return fxRuntime.covered && now - fxRuntime.coverAt > 400
}
