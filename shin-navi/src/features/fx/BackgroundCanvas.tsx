// L0 (SPEC K-11): the aurora on the wall and the floor horizon. A canvas at 0.5×/0.4× internal
// resolution driven by the shared ticker and fxState; at tier 0 or under reduced motion it gives
// way to static CSS gradients (one layer per palette, cross-faded with opacity only).
// The crisp 1 px horizon is a DOM line that draws itself from the centre (scaleX 0 → 1, 600 ms
// at 0.3 s). No store subscription and no React state: after mount this never re-renders.
import { memo, useEffect, useRef } from 'react'
import { fxState } from '../../core/fxState'
import { ticker } from '../../core/ticker'
import { naviApi } from '../../core/store'
import { introElapsedMs, introPending, introWait } from '../../core/intro'
import { phoneMetrics } from '../../core/layout'
import { params } from '../../core/params'
import { AuroraPainter, PaletteTracker, auroraIntro, type IntroMode } from './aurora'
import { TIERS } from './governor'
import { fxDebug } from './debug'
import { fxClock, fxRuntime, phoneCovered } from './signals'
import { rgbCss } from './sprites'
import './fx.css'

type Variant = 'phone' | 'room'

export type Geometry = { w: number; h: number; hy: number; bx: number; by: number; br: number }

/** Ball, horizon and box of a background layer, in its own (unscaled) CSS px. */
export function measureGeometry(root: HTMLElement, variant: Variant, probeH: HTMLElement | null, probeB: HTMLElement | null): Geometry {
  const w = root.clientWidth || 390
  const h = root.clientHeight || 844
  if (variant === 'phone') {
    const m = phoneMetrics({ w, h })
    const hy = probeH && probeH.offsetTop > 0 ? probeH.offsetTop : Math.round(h * 0.4)
    const by = probeB && probeB.offsetTop > 0 ? probeB.offsetTop : Math.round(hy - (m.horizon - m.ballCy))
    return { w, h, hy, bx: w / 2, by, br: m.ball / 2 }
  }
  // room: the static ball wrapper placed by the shell (the drop animation lives inside it)
  const shell = root.closest('[data-shell=room]')
  const ballEl = shell?.querySelector('.rs-ball') as HTMLElement | null
  if (ballEl) {
    const R = root.getBoundingClientRect()
    const B = ballEl.getBoundingClientRect()
    const k = R.width > 0 ? w / R.width : 1
    const br = (B.width * k) / 2
    if (br > 10) {
      const bx = (B.left - R.left) * k + br
      const by = (B.top - R.top) * k + br
      return { w, h, bx, by, br, hy: Math.min(h - 24, by + br * 1.04) }
    }
  }
  const br = Math.min(w, h) * 0.24
  return { w, h, bx: w / 2, by: h * 0.46, br, hy: Math.min(h - 24, h * 0.46 + br * 1.04) }
}

function BackgroundInner({ variant }: { variant: Variant }): JSX.Element {
  if (params.test) fxDebug.renders.bg++
  const root = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const horizon = useRef<HTMLDivElement>(null)
  const probeB = useRef<HTMLDivElement>(null)

  // entrance of the horizon line, decided once at mount (never replays on re-render)
  const intro = useRef<{ mode: IntroMode; reduced: boolean; delay: number; pending: boolean } | null>(null)
  if (!intro.current) {
    const s = naviApi.getState()
    intro.current = { mode: s.session.intro, reduced: s.ui.reduced, delay: introWait('horizon'), pending: s.session.intro !== 'none' && introPending('horizon') }
  }
  const ia = intro.current
  const horizonAnim = !ia.pending ? 'none' : ia.reduced ? `fx-fade-in 300ms ease-out ${ia.delay}s both` : `fx-horizon-in ${ia.mode === 'full' ? 600 : 300}ms cubic-bezier(0.2, 0.8, 0.2, 1) ${ia.delay}s both`

  useEffect(() => {
    const el = root.current
    const cv = canvas.current
    const ctx = cv?.getContext('2d', { alpha: true })
    if (!el || !cv || !ctx) return
    const painter = new AuroraPainter()
    const pal = new PaletteTracker(fxState.aurora)
    let geo: Geometry = measureGeometry(el, variant, horizon.current, probeB.current)
    let res = 0
    let tier = -1
    let flowT = Math.random() * 40
    let speed = fxState.speed
    let acc = 0
    let visible = true
    let visClock = 0
    let geoClock = 0
    let lastPalette = ''
    let lastGold = ''
    let lastTier = ''

    const size = () => {
      geo = measureGeometry(el, variant, horizon.current, probeB.current)
      if (variant === 'room' && horizon.current) horizon.current.style.top = `${Math.round(geo.hy)}px`
      const spec = TIERS[(fxState.quality ?? 2) as 0 | 1 | 2]
      res = spec.auroraRes
      if (res > 0) {
        // on the phone the wall ends a little under the floor (the cards cover the rest)
        const drawH = variant === 'phone' ? Math.min(geo.h, Math.round(geo.hy + 290)) : geo.h
        cv.style.height = `${drawH}px`
        const cw = Math.max(1, Math.round(geo.w * res))
        const ch = Math.max(1, Math.round(drawH * res))
        if (cv.width !== cw || cv.height !== ch) {
          cv.width = cw
          cv.height = ch
        }
      }
    }
    size()
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(size) : null
    ro?.observe(el)

    let lastHz = ''
    let lastFlash = ''
    let floor = 1
    let lastFloor = ''
    const off = ticker.add(dt => {
      // cheap visibility check (display:none tab, closed shell) twice a second
      visClock += dt
      if (visClock > 500) {
        visClock = 0
        visible = el.offsetParent !== null || getComputedStyle(el).position === 'fixed'
      }
      if (!visible || (variant === 'phone' && phoneCovered(performance.now()))) return
      geoClock += dt
      if (variant === 'room' && geoClock > 1000) {
        geoClock = 0
        size()
      }
      const reduced = fxState.reduced
      // the floor belongs to the hero: away from the home tab it fades (300 ms)
      const floorOn = variant === 'room' || fxRuntime.floor
      floor = Math.max(0, Math.min(1, floor + (floorOn ? 1 : -1) * (dt / 300)))
      const fk = floorOn ? '1' : '0'
      if (fk !== lastFloor) el.dataset.floor = lastFloor = fk
      const q = reduced ? 0 : fxState.quality
      if (q !== tier) {
        tier = q
        size()
      }
      // palette/gold as data attributes for the static (tier 0) look — written only on change
      const key = fxState.aurora
      if (key !== lastPalette) el.dataset.palette = lastPalette = key
      const g = fxState.gold > 0.25 ? '1' : '0'
      if (g !== lastGold) el.dataset.gold = lastGold = g
      const mode = q === 0 ? 'static' : 'canvas'
      if (mode !== lastTier) {
        el.dataset.mode = lastTier = mode
        if (mode === 'static') ctx.clearRect(0, 0, cv.width, cv.height)
      }
      const colors = pal.update(fxState)
      // the horizon glow picks up the palette's lightest colour
      const c2 = colors[2]
      const hz = rgbCss([Math.min(255, c2[0] + 90), Math.min(255, c2[1] + 90), Math.min(255, c2[2] + 90)])
      if (hz !== lastHz && horizon.current) horizon.current.style.setProperty('--fx-hz', (lastHz = hz))
      if (params.test) {
        fxDebug.bgMode = mode
        fxDebug.palette = key
      }
      if (mode === 'static') {
        // brighten the static layers during the flash without repainting anything
        const fl = fxState.flash.toFixed(2)
        if (fl !== lastFlash) el.style.setProperty('--fx-flash', (lastFlash = fl))
        return
      }
      // the aurora is slow and soft: 30 fps on tier 2, 15 fps on tier 1 (time still adds up).
      // On tier 1 it takes a frame the specks leave free, so no frame carries both paints.
      acc += dt
      if (fxClock.frame % (tier === 1 ? 4 : 2) !== (tier === 1 ? 1 : 0)) return
      const step = acc
      acc = 0
      speed += (fxState.speed - speed) * Math.min(1, step / 700)
      flowT += (step / 1000) * speed
      const s = naviApi.getState()
      const k = auroraIntro(introElapsedMs(), s.session.intro, reduced)
      const c0 = params.test ? performance.now() : 0
      painter.draw(
        ctx,
        {
          ...geo,
          t: flowT,
          k,
          bright: 1 + 0.4 * fxState.flash,
          gold: fxState.gold,
          floor,
          heat: fxState.heat,
          colors,
          spec: TIERS[tier as 0 | 1 | 2],
          variant,
        },
        res,
      )
      if (params.test) {
        fxDebug.frames.bg++
        fxDebug.cost.bg += performance.now() - c0
      }
    }, 0)

    return () => {
      off()
      ro?.disconnect()
    }
  }, [variant])

  return (
    <div ref={root} className={`fx-bg fx-bg--${variant}`} data-mode="canvas" data-palette="quiet" data-gold="0" data-floor="1" aria-hidden="true">
      <div className="fx-bg__static">
        <i className="fx-static fx-static--quiet" />
        <i className="fx-static fx-static--mellow" />
        <i className="fx-static fx-static--warm" />
        <i className="fx-static fx-static--hot" />
        <i className="fx-static fx-static--gold" />
      </div>
      <canvas ref={canvas} className="fx-bg__canvas" />
      <div ref={horizon} className="fx-horizon" style={{ animation: horizonAnim }}>
        <i className="fx-horizon__glow" />
        <i className="fx-horizon__line" />
      </div>
      {variant === 'phone' ? <div ref={probeB} className="fx-probe fx-probe--ball" /> : null}
    </div>
  )
}

const BackgroundMemo = memo(BackgroundInner)

/** The wall behind everything: aurora + floor horizon (phone hero or room screen). */
export function BackgroundCanvas(p: { variant: 'phone' | 'room' }): JSX.Element {
  return <BackgroundMemo variant={p.variant} />
}
