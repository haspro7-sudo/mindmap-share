// Store/bus → fxState (SPEC K-7, K-11, L/M1). The canvases never subscribe to React: this keeps
// the mutable fxState in step with the store, runs the quality governor on the shared ticker,
// decays the flash (600 ms) and the gold (800 ms), drives the 1.8 s palette crossfade, and turns
// a few moments into one-shot cues for the canvases (the room lights coming on, a face throwing
// a speck, a touch ripple).
//
// Right after a reservation the wall also previews where the air is heading ("ナビの見立て",
// selForecast → fxPreview, QA OWNER#7 / DEMO#13) until the next song ends and the real palette
// takes over.
//
// fxState has other writers too (the mood mixer previews the air live, KnowDots and the finale
// flash it), so the store is copied over only when the store's own value changes — a clock tick
// must never snap a live preview back.
import type { NaviApi, NaviState } from '../../core/store/types'
import { isMine } from '../../core/store'
import type { AuroraKey } from '../../core/types'
import { bus, type BurstPreset, type TargetId } from '../../core/events'
import { fxState } from '../../core/fxState'
import { ticker } from '../../core/ticker'
import { selForecast, selHeat, selSpeckTarget } from '../../core/selectors'
import { areaColor, auroraFor } from '../../core/rules'
import { resolveTarget, rectCenter } from '../../core/targets'
import { params } from '../../core/params'
import { introElapsedMs } from '../../core/intro'
import { SONG_BY_ID } from '../../data/songs'
import * as audio from '../../lib/audio'
import { createGovernor, type Tier } from './governor'
import { AFTERGLOW_MS, CROSSFADE_MS, FLASH_MS, GOLD_MS, PALETTE_RGB, PREVIEW_IN_MS, PREVIEW_MIX, PREVIEW_OUT_MS, smooth } from './aurora'
import { fxClock, fxPreview, fxRuntime, fxSignals } from './signals'
import { fxDebug } from './debug'

/** Aurora flow speed (SPEC E-4): 0.5 + heat, halved for one song after "water / a breather". */
export function flowSpeed(s: Pick<NaviState, 'room' | 'session'>): number {
  const base = 0.5 + s.room.heat
  return s.room.restUntil > s.session.simMs ? base * 0.5 : base
}

/** Start a crossfade from whatever the wall shows now towards `key` (no-op when already there). */
export function retargetAurora(key: AuroraKey): void {
  if (key === fxState.aurora) return
  fxState.auroraFrom = fxState.aurora
  fxState.aurora = key
  fxState.auroraT = 0
}

/**
 * Copy what the canvases need from the store into fxState (no React involved). With `prev`,
 * only values that changed in the store are written; without it (boot) everything is written
 * and the palette snaps instead of fading.
 */
export function syncFxState(s: NaviState, prev?: NaviState): void {
  const h = selHeat(s)
  const p = prev ? selHeat(prev) : null
  if (!p) {
    fxState.aurora = fxState.auroraFrom = h.aurora
    fxState.auroraT = 1
  } else if (h.aurora !== p.aurora) retargetAurora(h.aurora)
  if (!p || h.heat !== p.heat) fxState.heat = h.heat
  const sp = flowSpeed(s)
  if (!prev || sp !== flowSpeed(prev)) fxState.speed = sp
  fxState.specksTarget = selSpeckTarget(s)
  fxState.reduced = s.ui.reduced
  if (s.ui.reduced) fxState.quality = 0
}

let forcedTier: Tier | null = null

/**
 * What the governor judges: the mean of the last 30 frame times without the slowest 10 %. A few
 * hitches from outside the effects (a GC, a React commit, another tab) no longer keep a 60 Hz
 * wall from ever being probed back up, while effects that make every 4th frame late still read
 * as slow (≈19.5 ms) and step the tier down.
 */
export function trimmedFrameMs(samples: ArrayLike<number>, count: number, trim = 0.1): number {
  const n = Math.min(count, samples.length)
  if (n === 0) return 1000 / 60
  const xs: number[] = []
  for (let i = 0; i < n; i++) xs.push(samples[i])
  xs.sort((a, b) => a - b)
  const keep = Math.max(1, n - Math.floor(n * trim))
  let sum = 0
  for (let i = 0; i < keep; i++) sum += xs[i]
  return sum / keep
}

/**
 * The forecast lean: armed by a reservation, disarmed when a song ends (the real word and palette
 * are recomputed then) or a night starts. While armed it follows selForecast: a bucket other than
 * the wall's own palette leans the wall PREVIEW_MIX of the way toward it.
 */
export function previewTarget(s: NaviState, armed: boolean): AuroraKey | null {
  if (!armed || s.session.phase !== 'live') return null
  const f = selForecast(s)
  if (!f) return null
  return f.bucket !== fxState.aurora ? f.bucket : null
}

/** Advance the lean by `ms` (wall clock): progress in over PREVIEW_IN_MS, out over PREVIEW_OUT_MS. */
export function stepPreview(ms: number, reduced: boolean): void {
  const pv = fxPreview
  const want = pv.target > 0 ? 1 : 0
  const from0 = pv.p <= 0.001
  let p = pv.p
  if (reduced) p = want
  else if (p < want) p = Math.min(want, p + ms / PREVIEW_IN_MS)
  else if (p > want) p = Math.max(want, p - ms / PREVIEW_OUT_MS)
  pv.p = p
  pv.k = PREVIEW_MIX * smooth(p)
  if (pv.key) {
    const to = PALETTE_RGB[pv.key]
    // a forecast that changes mid-lean slides over instead of jumping (τ ≈ 0.4 s)
    const a = from0 || reduced ? 1 : 1 - Math.exp(-ms / 400)
    for (let i = 0; i < 3; i++) for (let c = 0; c < 3; c++) pv.rgb[i][c] += (to[i][c] - pv.rgb[i][c]) * a
  }
  if (p <= 0 && pv.target <= 0) pv.key = null
}

export function installFx(api: NaviApi): () => void {
  const gov = createGovernor()
  const offs: (() => void)[] = []
  const timers = new Set<ReturnType<typeof setTimeout>>()
  const later = (ms: number, fn: () => void) => {
    const id = setTimeout(() => {
      timers.delete(id)
      fn()
    }, ms)
    timers.add(id)
  }

  const cover = (s: NaviState) => {
    fxRuntime.floor = s.ui.tab === 'discover'
    const on = s.ui.overlay != null
    if (on !== fxRuntime.covered) {
      fxRuntime.covered = on
      fxRuntime.coverAt = typeof performance !== 'undefined' ? performance.now() : 0
    }
  }
  // ---- the forecast lean
  let armed = false
  const lean = (s: NaviState) => {
    const key = previewTarget(s, armed)
    if (key) {
      // a new read: the wall takes a small breath as it starts leaning (the lane's landing
      // flash covers my own reservations; this one also answers a friend's)
      if (key !== fxPreview.key || fxPreview.target <= 0) fxState.flash = Math.max(fxState.flash, 0.22)
      fxPreview.key = key
      fxPreview.target = PREVIEW_MIX
    } else fxPreview.target = 0
  }
  fxPreview.key = null
  fxPreview.target = 0
  fxPreview.k = 0
  fxPreview.p = 0
  fxPreview.afterglow = 0

  syncFxState(api.getState())
  cover(api.getState())
  offs.push(
    api.subscribe((s, p) => {
      syncFxState(s, p)
      cover(s)
      if (armed && (s.room !== p.room || s.session.phase !== p.session.phase)) lean(s)
      // the first tap: the room lights come on (App sets fxState.flash = 1 and plays lightOn)
      if (s.session.audioOn && !p.session.audioOn) {
        fxState.flash = Math.max(fxState.flash, 1)
        fxDebug.lightsOn++
        fxSignals.emit({ type: 'lightsOn' })
      }
    }),
  )

  // ---- per frame: decays, crossfade, governor
  let govClock = 0
  let last = 0
  const frameMs = new Float64Array(30)
  let frameIdx = 0
  let frameCount = 0
  offs.push(
    ticker.add((dt, now) => {
      fxClock.frame++
      // timed moments run on the wall clock (the ticker clamps dt at 50 ms): a 600 ms flash lasts
      // 600 ms even when frames are slow
      const real = last ? Math.min(250, Math.max(0, now - last)) : dt
      if (last) {
        frameMs[frameIdx] = real
        frameIdx = (frameIdx + 1) % frameMs.length
        frameCount = Math.min(frameMs.length, frameCount + 1)
      }
      last = now
      if (fxState.flash > 0) fxState.flash = Math.max(0, fxState.flash - real / FLASH_MS)
      if (fxState.gold > 0) fxState.gold = Math.max(0, fxState.gold - real / GOLD_MS)
      if (fxState.auroraT < 1) fxState.auroraT = Math.min(1, fxState.auroraT + real / CROSSFADE_MS)
      if (fxPreview.target > 0 || fxPreview.k > 0) stepPreview(real, fxState.reduced)
      if (fxPreview.afterglow > 0) fxPreview.afterglow = Math.max(0, fxPreview.afterglow - real / AFTERGLOW_MS)
      govClock += dt
      if (govClock >= 250) {
        govClock = 0
        // the trimmed mean of what this loop measured (the ticker's own average until 10 frames
        // have run — and in unit tests, where no frame runs and setFrameTimeProvider drives it)
        const avg = frameCount >= 10 ? trimmedFrameMs(frameMs, frameCount) : ticker.frameTimeAvg()
        const t = gov.update(now, avg, fxState.reduced)
        fxState.quality = fxState.reduced ? 0 : (forcedTier ?? t)
      }
    }, -20),
  )

  // ---- bus
  const flying = new Map<string, number>()
  const spawnFrom = (songId: string, to: string) => {
    const song = SONG_BY_ID[songId]
    const r = resolveTarget(`face:${songId}`) ?? resolveTarget('hero:ball') ?? resolveTarget('room:ball')
    if (!r) return
    const c = rectCenter(r)
    const shine = to === 'mirror' || to === 'prism'
    fxSignals.emit({ type: 'spawn', x: c.x, y: c.y, color: song ? areaColor(song.genre) : '#FFF6D8', keep: shine, streak: shine })
  }
  const pendingSpawn = new Map<string, string>()
  const flushSpawn = (id: string) => {
    const to = pendingSpawn.get(id)
    if (!to) return
    pendingSpawn.delete(id)
    spawnFrom(id, to)
  }
  offs.push(
    bus.on('fx/flash', e => {
      fxState.flash = Math.max(fxState.flash, Math.min(1, e.strength))
    }),
    bus.on('queue/added', () => {
      // a reservation: show where the air is heading (the state already holds the new item)
      armed = true
      lean(api.getState())
    }),
    bus.on('song/ended', () => {
      armed = false
      fxPreview.target = 0
    }),
    bus.on('song/started', e => {
      // my turn (handshake 7): the wall flushes lamplight under stage's ON STAGE moment and keeps
      // a warm afterglow while it steps back
      if (!isMine(e.item) || api.getState().session.phase !== 'live') return
      fxState.gold = Math.max(fxState.gold, 1)
      fxState.flash = Math.max(fxState.flash, 0.45)
      fxPreview.afterglow = 1
    }),
    bus.on('night/started', () => {
      armed = false
      fxPreview.target = 0
      fxPreview.k = 0
      fxPreview.key = null
      fxPreview.p = 0
      fxPreview.afterglow = 0
    }),
    bus.on('know/complete', e => {
      // everyone knows: the wall turns gold for 0.8 s (SPEC C-8 ②, I-4 #4)
      if (e.view.all) {
        fxState.gold = 1
        fxState.flash = Math.max(fxState.flash, 0.5)
        fxPreview.afterglow = 1
      }
    }),
    bus.on('heat/changed', e => {
      // the store copy follows on its own; this also covers a cue that arrives before the state
      retargetAurora(auroraFor(e.word))
      fxState.heat = e.heat
    }),
    bus.on('card/acted', e => {
      if (e.action === 'rest') fxState.speed = flowSpeed(api.getState())
    }),
    bus.on('fx/flight', e => {
      if (e.songId) flying.set(e.songId, performance.now())
    }),
    bus.on('face/changed', e => {
      if (e.from === e.to) return
      if (e.to === 'prism') later(160, () => (fxState.flash = Math.max(fxState.flash, 0.55)))
      pendingSpawn.set(e.songId, e.to)
      later(0, () => {
        const f = flying.get(e.songId)
        // a flight is on its way: wait for the landing (and the lane → face thread), with a cap
        if (f != null && performance.now() - f < 1500) later(900, () => flushSpawn(e.songId))
        else later(120, () => flushSpawn(e.songId))
      })
    }),
    bus.on('fx/landed', e => {
      // the room answers every throw that lands in the lane: the wall brightens for a moment
      if (e.to.startsWith('lane:')) fxState.flash = Math.max(fxState.flash, 0.3)
      if (!e.songId) return
      const id = e.songId
      flying.delete(id)
      if (!pendingSpawn.has(id)) return
      later(e.to.startsWith('lane:') ? 320 : 60, () => flushSpawn(id))
    }),
  )

  // ---- touches leave a ripple in the light
  let lastTouch = 0
  const onDown = (e: PointerEvent) => {
    const t = performance.now()
    fxState.touch = { x: e.clientX, y: e.clientY, t }
    if (t - lastTouch < 70) return
    lastTouch = t
    fxSignals.emit({ type: 'touch', x: e.clientX, y: e.clientY })
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('pointerdown', onDown, { capture: true, passive: true })
    offs.push(() => window.removeEventListener('pointerdown', onDown, { capture: true }))
  }

  // ---- ?test=1: window.__fx
  if (params.test && typeof window !== 'undefined') {
    const w = window as unknown as { __fx?: unknown }
    w.__fx = {
      debug: fxDebug,
      state: () => ({ ...fxState, emitters: fxState.emitters.length }),
      tier: () => fxState.quality,
      /** the governor's recent decisions */
      govLog: () => gov.log.map(e => ({ ...e })),
      /** ms since the entrance started (intro timeline clock) */
      introMs: () => introElapsedMs(),
      /** the forecast lean on the wall (QA OWNER#7) */
      preview: () => ({ key: fxPreview.key, k: fxPreview.k, target: fxPreview.target, afterglow: fxPreview.afterglow, armed }),
      /** the ticker's 30-frame average, and the trimmed mean the governor reads */
      frameAvg: () => ticker.frameTimeAvg(),
      frameTrimmed: () => trimmedFrameMs(frameMs, frameCount),
      /** pin the tier (null = governor decides) */
      forceTier: (t: Tier | null) => {
        forcedTier = t
        if (t != null) fxState.quality = t
      },
      sound: () => ({ muted: audio.isMuted(), ducked: audio.isDucked(), ctx: audio.contextState() }),
      /** fire a burst preset at a target id or a viewport point */
      burst: (preset: BurstPreset, at: TargetId | { x: number; y: number }) => bus.emit({ type: 'fx/burst', preset, at }),
    }
    offs.push(() => {
      delete w.__fx
    })
  }

  return () => {
    offs.forEach(f => f())
    timers.forEach(id => clearTimeout(id))
    timers.clear()
    forcedTier = null
  }
}
