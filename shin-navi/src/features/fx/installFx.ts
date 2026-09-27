// Store/bus → fxState (SPEC K-7, K-11, L/M1). The canvases never subscribe to React: this keeps
// the mutable fxState in step with the store, runs the quality governor on the shared ticker,
// decays the flash (600 ms) and the gold (800 ms), drives the 1.8 s palette crossfade, and turns
// a few moments into one-shot cues for the canvases (the room lights coming on, a face throwing
// a speck, a touch ripple).
import type { NaviApi, NaviState } from '../../core/store/types'
import { bus } from '../../core/events'
import { fxState } from '../../core/fxState'
import { ticker } from '../../core/ticker'
import { selHeat, selSpeckTarget } from '../../core/selectors'
import { areaColor } from '../../core/rules'
import { resolveTarget, rectCenter } from '../../core/targets'
import { params } from '../../core/params'
import { introElapsedMs } from '../../core/intro'
import { SONG_BY_ID } from '../../data/songs'
import * as audio from '../../lib/audio'
import { createGovernor, type Tier } from './governor'
import { CROSSFADE_MS, FLASH_MS, GOLD_MS } from './aurora'
import { fxClock, fxSignals } from './signals'
import { fxDebug } from './debug'

/** Aurora flow speed (SPEC E-4): 0.5 + heat, halved for one song after "water / a breather". */
export function flowSpeed(s: Pick<NaviState, 'room' | 'session'>): number {
  const base = 0.5 + s.room.heat
  return s.room.restUntil > s.session.simMs ? base * 0.5 : base
}

/** Copy what the canvases need from the store into fxState (no React involved). */
export function syncFxState(s: NaviState): void {
  const h = selHeat(s)
  if (h.aurora !== fxState.aurora) {
    fxState.auroraFrom = fxState.aurora
    fxState.aurora = h.aurora
    fxState.auroraT = 0
  }
  fxState.heat = h.heat
  fxState.speed = flowSpeed(s)
  fxState.specksTarget = selSpeckTarget(s)
  fxState.reduced = s.ui.reduced
  if (s.ui.reduced) fxState.quality = 0
}

let forcedTier: Tier | null = null

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

  syncFxState(api.getState())
  offs.push(
    api.subscribe((s, p) => {
      syncFxState(s)
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
  offs.push(
    ticker.add((dt, now) => {
      fxClock.frame++
      if (fxState.flash > 0) fxState.flash = Math.max(0, fxState.flash - dt / FLASH_MS)
      if (fxState.gold > 0) fxState.gold = Math.max(0, fxState.gold - dt / GOLD_MS)
      if (fxState.auroraT < 1) fxState.auroraT = Math.min(1, fxState.auroraT + dt / CROSSFADE_MS)
      govClock += dt
      if (govClock >= 250) {
        govClock = 0
        const t = gov.update(now, ticker.frameTimeAvg(), fxState.reduced)
        fxState.quality = forcedTier ?? t
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
  offs.push(
    bus.on('fx/flash', e => {
      fxState.flash = Math.max(fxState.flash, Math.min(1, e.strength))
    }),
    bus.on('know/complete', e => {
      if (e.view.all) fxState.gold = 1
    }),
    bus.on('fx/flight', e => {
      if (e.songId) flying.set(e.songId, performance.now())
    }),
    bus.on('face/changed', e => {
      if (e.from === e.to) return
      pendingSpawn.set(e.songId, e.to)
      later(0, () => {
        const f = flying.get(e.songId)
        if (f != null && performance.now() - f < 1500) {
          // wait for the landing (and the lane → face thread), with a cap
          later(900, () => {
            const to = pendingSpawn.get(e.songId)
            if (to) {
              pendingSpawn.delete(e.songId)
              spawnFrom(e.songId, to)
            }
          })
          return
        }
        later(120, () => {
          const to = pendingSpawn.get(e.songId)
          if (to) {
            pendingSpawn.delete(e.songId)
            spawnFrom(e.songId, to)
          }
        })
      })
    }),
    bus.on('fx/landed', e => {
      if (!e.songId) return
      const id = e.songId
      flying.delete(id)
      if (!pendingSpawn.has(id)) return
      later(e.to.startsWith('lane:') ? 320 : 60, () => {
        const to = pendingSpawn.get(id)
        if (to) {
          pendingSpawn.delete(id)
          spawnFrom(id, to)
        }
      })
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
      /** ms since the entrance started (intro timeline clock) */
      introMs: () => introElapsedMs(),
      /** the ticker's 30-frame average the governor reads */
      frameAvg: () => ticker.frameTimeAvg(),
      /** pin the tier (null = governor decides) */
      forceTier: (t: Tier | null) => {
        forcedTier = t
        if (t != null) fxState.quality = t
      },
      sound: () => ({ muted: audio.isMuted(), ducked: audio.isDucked(), ctx: audio.contextState() }),
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
