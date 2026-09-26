// Simulated time (SPEC K-7). Advances the store every 250ms of real time (× speed),
// and runs `after()` callbacks on a finer 50ms beat. Stops while the tab is hidden.
import type { NaviApi } from './store/types'

type Job = { at: number; fn: () => void; id: number }
let jobs: Job[] = []
let nextId = 1
let apiRef: NaviApi | null = null
let lastSync = 0

/** Current sim time, interpolated between store ticks. */
export function simNow(): number {
  if (!apiRef) return 0
  const s = apiRef.getState().session
  if (s.phase !== 'live') return s.simMs
  return s.simMs + (performance.now() - lastSync) * s.speed
}

/** Run fn after `simMs` of simulated time. Returns a cancel function. */
export function after(simMs: number, fn: () => void): () => void {
  const job: Job = { at: simNow() + Math.max(0, simMs), fn, id: nextId++ }
  jobs.push(job)
  jobs.sort((a, b) => a.at - b.at)
  return () => {
    jobs = jobs.filter(j => j.id !== job.id)
  }
}

export function clearJobs(): void {
  jobs = []
}

function runDue() {
  const t = simNow()
  while (jobs.length && jobs[0].at <= t) {
    const j = jobs.shift()!
    try {
      j.fn()
    } catch (e) {
      console.warn('[clock]', e)
    }
  }
}

export function installClock(api: NaviApi): () => void {
  apiRef = api
  lastSync = performance.now()
  let acc = 0
  let last = performance.now()
  const beat = setInterval(() => {
    if (typeof document !== 'undefined' && document.hidden) {
      last = performance.now()
      return
    }
    const now = performance.now()
    const dt = Math.min(1000, now - last)
    last = now
    acc += dt
    if (acc >= 250) {
      api.getState().tick(acc)
      lastSync = performance.now()
      acc = 0
    }
    runDue()
  }, 50)
  return () => {
    clearInterval(beat)
    if (apiRef === api) apiRef = null
  }
}

/** Test helper: advance sim time synchronously without timers. */
export function advanceForTest(api: NaviApi, realMs: number): void {
  apiRef = api
  api.getState().tick(realMs)
  lastSync = performance.now()
  runDue()
}
