// The one requestAnimationFrame loop for the whole app (SPEC K-7 / K-11).
// Every canvas and per-frame effect subscribes here instead of calling rAF itself:
// dt is clamped to 50ms, the loop sleeps while the tab is hidden, and the governor
// reads frameTimeAvg() to pick a quality tier. Never call React setState from a tick.

export type TickFn = (dtMs: number, now: number) => void

type Entry = { fn: TickFn; prio: number; seq: number }

const MAX_DT = 50
const WINDOW = 30

let entries: Entry[] = []
let seq = 0
let raf = 0
let last = 0
const samples = new Float64Array(WINDOW)
let sampleIdx = 0
let sampleCount = 0
let provider: (() => number) | null = null

const hasRaf = () => typeof requestAnimationFrame === 'function'
const isHidden = () => typeof document !== 'undefined' && document.hidden

function frame(now: number): void {
  raf = 0
  const raw = last ? now - last : 1000 / 60
  last = now
  // Record the real frame time (capped so one long pause does not poison the average).
  samples[sampleIdx] = Math.min(raw, 250)
  sampleIdx = (sampleIdx + 1) % WINDOW
  if (sampleCount < WINDOW) sampleCount++
  const dt = Math.min(MAX_DT, Math.max(0, raw))
  // Snapshot: subscribers may add/remove themselves while running.
  const list = entries
  for (let i = 0; i < list.length; i++) {
    try {
      list[i].fn(dt, now)
    } catch (err) {
      console.warn('[ticker]', err)
    }
  }
  schedule()
}

function schedule(): void {
  if (raf || !hasRaf() || entries.length === 0 || isHidden()) return
  raf = requestAnimationFrame(frame)
}

function stop(): void {
  if (raf && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(raf)
  raf = 0
  last = 0
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stop()
    else {
      last = 0 // do not report the hidden gap as one giant frame
      schedule()
    }
  })
}

export const ticker = {
  /**
   * Run fn every frame. Lower prio runs first (default 0): e.g. input/physics at -10,
   * canvases at 0, readers of what canvases wrote at 10. Returns an unsubscribe function.
   */
  add(fn: TickFn, prio = 0): () => void {
    const e: Entry = { fn, prio, seq: seq++ }
    entries = [...entries, e].sort((a, b) => a.prio - b.prio || a.seq - b.seq)
    schedule()
    return () => {
      entries = entries.filter(x => x !== e)
      if (entries.length === 0) stop()
    }
  },
  /** Average real frame time (ms) over the last 30 frames; 16.7 before any frame ran. */
  frameTimeAvg(): number {
    if (provider) return provider()
    if (sampleCount === 0) return 1000 / 60
    let sum = 0
    for (let i = 0; i < sampleCount; i++) sum += samples[i]
    return sum / sampleCount
  },
  /** Number of subscribers (debug / tests). */
  size(): number {
    return entries.length
  },
  /** Whether a frame is currently scheduled (debug / tests). */
  running(): boolean {
    return raf !== 0
  },
}

/** Tests: replace the frame-time source (pass null to restore the real measurement). */
export function setFrameTimeProvider(fn: (() => number) | null): void {
  provider = fn
}

/** Tests: forget recorded frame times. */
export function resetFrameTimes(): void {
  sampleIdx = 0
  sampleCount = 0
}
