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
