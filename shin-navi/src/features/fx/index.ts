// M1 fx-sound — PHASE-0 STUB (owned by M1 from phase 1). Public API per SPEC L/M1.
// The stub keeps fxState in sync with the store, maps sounds onto the old lib/audio synth,
// paints a static aurora (tier-0 look) and a light speck field on the shared ticker.
import { createElement as h, useEffect, useRef } from 'react'
import type { NaviApi } from '../../core/store/types'
import { useNavi } from '../../core/store'
import { bus } from '../../core/events'
import { fxState } from '../../core/fxState'
import { ticker } from '../../core/ticker'
import { installSoundImpl, type SfxName, type SoundImpl } from '../../core/sound'
import { selHeat, selSpeckTarget } from '../../core/selectors'
import { auroraFor } from '../../core/rules'
import { introDelay } from '../../core/intro'
import * as audio from '../../lib/audio'
import '../../styles/stubs.css'

export function installFx(api: NaviApi): () => void {
  const sync = () => {
    const s = api.getState()
    const heat = selHeat(s)
    if (heat.aurora !== fxState.aurora) {
      fxState.auroraFrom = fxState.aurora
      fxState.aurora = heat.aurora
      fxState.auroraT = 0
    }
    fxState.heat = heat.heat
    fxState.speed = (0.5 + heat.heat) * (s.room.restUntil > s.session.simMs ? 0.5 : 1)
    fxState.specksTarget = selSpeckTarget(s)
    fxState.reduced = s.ui.reduced
    if (s.ui.reduced) fxState.quality = 0
  }
  sync()
  const unsub = api.subscribe(sync)
  const offFlash = bus.on('fx/flash', e => {
    fxState.flash = Math.max(fxState.flash, e.strength)
  })
  const offGold = bus.on('know/complete', e => {
    if (e.view.all) fxState.gold = 1
  })
  const offTick = ticker.add(dt => {
    if (fxState.flash > 0) fxState.flash = Math.max(0, fxState.flash - dt / 600)
    if (fxState.gold > 0) fxState.gold = Math.max(0, fxState.gold - dt / 800)
    if (fxState.auroraT < 1) fxState.auroraT = Math.min(1, fxState.auroraT + dt / 1800)
  }, -20)
  return () => {
    unsub()
    offFlash()
    offGold()
    offTick()
  }
}

const SFX_MAP: Partial<Record<SfxName, audio.Sfx>> = {
  lightOn: 'reserve',
  throw: 'swipeKeep',
  land: 'collect',
  keepFold: 'collect',
  pass: 'swipePass',
  knowTick: 'collect',
  knowChord: 'reserve',
  redeal: 'collect',
  orbPop: 'tap',
  clink: 'order',
  stamp: 'stamp',
  fanfare: 'levelUp',
  tap: 'tap',
  flip: 'tap',
  open: 'open',
  close: 'close',
}

export function installSound(api: NaviApi): () => void {
  const impl: SoundImpl = {
    play(n) {
      if (!api.getState().session.audioOn) return
      const m = SFX_MAP[n]
      if (m) audio.sfx(m)
    },
    playMelody() {
      return () => {}
    },
    unlock() {
      audio.unlockAudio()
    },
    setMuted(m) {
      audio.setMuted(m)
    },
    setDuck() {},
    haptic(p) {
      audio.haptic(p)
    },
  }
  installSoundImpl(impl)
  audio.setMuted(api.getState().session.muted)
  const unsub = api.subscribe((s, p) => {
    if (s.session.muted !== p.session.muted) audio.setMuted(s.session.muted)
  })
  return () => {
    unsub()
    installSoundImpl(null)
  }
}

/** Static aurora (tier-0 look): three soft blobs over the floor, palette from the mood word. */
export function BackgroundCanvas(p: { variant: 'phone' | 'room' }): JSX.Element {
  const word = useNavi(s => s.room.moodWord)
  const aurora = auroraFor(word)
  const d = introDelay('aurora')
  return h(
    'div',
    { className: `stub-aurora stub-aurora--${p.variant} is-${aurora}`, 'aria-hidden': true },
    h('div', { className: 'stub-aurora__glow', style: { animationDelay: `${d}s` } }),
    h('div', { className: 'stub-aurora__floor' }),
  )
}

type Speck = { a: number; r: number; s: number; z: number; tw: number; hue: number }

/** Specks orbiting like mirror-ball reflections (canvas, shared ticker, DPR ≤ 1.5). */
export function SpeckCanvas(): JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = ref.current
    const ctx = c?.getContext('2d')
    if (!c || !ctx) return
    const sprite = document.createElement('canvas')
    sprite.width = sprite.height = 32
    const sg = sprite.getContext('2d')!
    const grad = sg.createRadialGradient(16, 16, 0, 16, 16, 16)
    grad.addColorStop(0, 'rgba(255,255,255,1)')
    grad.addColorStop(0.2, 'rgba(255,246,216,.85)')
    grad.addColorStop(1, 'rgba(255,246,216,0)')
    sg.fillStyle = grad
    sg.fillRect(0, 0, 32, 32)
    const specks: Speck[] = Array.from({ length: 60 }, (_, i) => ({ a: (i * 2.39996) % (Math.PI * 2), r: 0.35 + ((i * 0.618) % 1) * 0.75, s: 0.5 + ((i * 0.37) % 1), z: 0.4 + ((i * 0.73) % 1) * 0.6, tw: i * 1.7, hue: i % 3 }))
    let w = 0
    let hgt = 0
    const resize = () => {
      const dpr = Math.min(1.5, window.devicePixelRatio || 1)
      w = c.clientWidth
      hgt = c.clientHeight
      c.width = Math.max(1, Math.round(w * dpr))
      c.height = Math.max(1, Math.round(hgt * dpr))
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(c)
    const start = performance.now() + introDelay('specks') * 1000
    const off = ticker.add((_dt, now) => {
      ctx.clearRect(0, 0, w, hgt)
      const since = (now - start) / 1000
      if (since < 0) return
      const n = Math.min(specks.length, fxState.quality === 0 ? 20 : fxState.specksTarget)
      const bright = 0.55 + fxState.flash * 0.9
      const cx = w / 2
      const cy = Math.min(hgt * 0.3, 250)
      const out = Math.min(1, since / 0.6)
      const spin = fxState.reduced ? 0 : (since * Math.PI * 2) / 12
      for (let i = 0; i < n; i++) {
        const sp = specks[i]
        const ang = sp.a + spin * sp.s * 0.6
        const rr = out * sp.r * Math.max(w, hgt) * 0.62
        const x = cx + Math.cos(ang) * rr
        const y = cy + Math.sin(ang) * rr * 0.62
        const tw = 0.55 + 0.45 * Math.sin(now / 700 + sp.tw)
        const size = 6 + sp.z * 10
        ctx.globalAlpha = Math.min(1, bright * tw * sp.z * 0.8)
        ctx.drawImage(sprite, x - size / 2, y - size / 2, size, size)
      }
      ctx.globalAlpha = 1
    })
    return () => {
      off()
      ro.disconnect()
    }
  }, [])
  return h('canvas', { ref, className: 'stub-specks', 'aria-hidden': true })
}

export function BurstLayer(): JSX.Element {
  return h('div', { className: 'stub-layer', 'aria-hidden': true, 'data-stub': 'BurstLayer' })
}
