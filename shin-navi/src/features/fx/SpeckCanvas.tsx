// L1 (SPEC K-11, B-2 0.4 s, D-4): light specks, dust and light streaks, DPR ≤ 1.5, on the shared
// ticker. At 0.4 s the first specks are thrown from the ball's faces (fxState.emitters, written
// by the ball) and reach the walls in 600 ms; afterwards the count follows selSpeckTarget (via
// fxState.specksTarget) within the tier cap. Mirror faces throw streaks; a face that levels up
// throws a speck; the first tap turns the room lights on. Never re-renders after mount.
import { memo, useEffect, useRef } from 'react'
import { fxState } from '../../core/fxState'
import { ticker } from '../../core/ticker'
import { naviApi } from '../../core/store'
import { introElapsedMs, introWait, INTRO_TIMELINE, INTRO_SCALE } from '../../core/intro'
import { params } from '../../core/params'
import { PaletteTracker } from './aurora'
import { TIERS, type Tier } from './governor'
import { SpeckField, syncCount } from './specks'
import { cssToRgb, lighten } from './sprites'
import { fxPreview, fxSignals, phoneCovered, vsyncSlot } from './signals'
import { fxDebug } from './debug'
import { measureGeometry } from './BackgroundCanvas'
import './fx.css'

function SpeckInner(): JSX.Element {
  if (params.test) fxDebug.renders.specks++
  const ref = useRef<HTMLCanvasElement>(null)
  const probeH = useRef<HTMLDivElement>(null)
  const probeB = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const cv = ref.current
    const host = cv?.parentElement
    const ctx = cv?.getContext('2d')
    if (!cv || !host || !ctx) return
    const variant = cv.closest('[data-shell=room]') ? 'room' : 'phone'
    const field = new SpeckField()
    const pal = new PaletteTracker(fxState.aurora)
    let dpr = 1
    let rect = cv.getBoundingClientRect()
    let scale = 1

    let sizedTier = -1
    let ballR = 98
    const size = () => {
      const g = measureGeometry(host, variant, probeH.current, probeB.current)
      field.setBox({ w: g.w, h: g.h, cx: g.bx, cy: g.by, hy: g.hy, spot: Math.max(1, Math.min(1.6, Math.min(g.w, g.h) / 600)) })
      ballR = g.br
      // DPR ≤ 1.5 (K-11), lower on the lower tiers
      const q = fxState.reduced ? 0 : fxState.quality
      sizedTier = q
      dpr = Math.min(q === 2 ? 1.5 : 1, window.devicePixelRatio || 1)
      // on the phone everything below the floor is under the cards: paint only down to there
      const drawH = variant === 'phone' ? Math.min(g.h, Math.round(g.hy + 210)) : g.h
      cv.style.height = `${drawH}px`
      const cw = Math.max(1, Math.round(g.w * dpr))
      const ch = Math.max(1, Math.round(drawH * dpr))
      if (cv.width !== cw || cv.height !== ch) {
        cv.width = cw
        cv.height = ch
      }
      rect = cv.getBoundingClientRect()
      scale = rect.width > 0 ? g.w / rect.width : 1
      dirty = true
    }
    let dirty = true
    size()
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(size) : null
    ro?.observe(host)

    /** viewport → local (handles the scaled dual phone frame) */
    const local = (x: number, y: number) => ({ x: (x - rect.left) * scale, y: (y - rect.top) * scale })
    const inside = (p: { x: number; y: number }) => p.x >= -20 && p.y >= -20 && p.x <= field.box.w + 20 && p.y <= field.box.h + 20
    const ballPoint = () => ({ x: field.box.cx + (Math.random() - 0.5) * 40, y: field.box.cy + (Math.random() - 0.5) * 40 })
    /** launch point for the i-th new speck: a face of the ball as the ball projects it now */
    const emitter = (i: number) => {
      const em = fxState.emitters
      if (em.length) {
        const e = em[(i * 3 + ((Math.random() * em.length) | 0)) % em.length]
        const p = local(e.x, e.y)
        if (inside(p)) return p
      }
      return ballPoint()
    }
    const streakOrigin = () => {
      const em = fxState.emitters
      if (!em.length) return null
      const e = em[(Math.random() * Math.min(em.length, 8)) | 0]
      const p = local(e.x, e.y)
      return inside(p) ? p : null
    }

    // entrance: the first specks leave the ball at 0.4 s (B-2); later mounts skip the throw
    const mode = naviApi.getState().session.intro
    const startAt = performance.now() + introWait('specks') * 1000
    let started = false
    const throwNow = mode !== 'none' && introElapsedMs() < INTRO_TIMELINE.specks * INTRO_SCALE[mode] + 400

    const offSig = fxSignals.on(s => {
      if (s.type === 'lightsOn') {
        if (!fxState.reduced) field.lightsOn(pal.shown, ballR)
        dirty = true
      } else if (s.type === 'spawn') {
        const p = local(s.x, s.y)
        if (!inside(p)) return
        const c = lighten(cssToRgb(s.color), 0.35)
        if (!fxState.reduced) field.spawnAt(p.x, p.y, s.keep)
        if (s.streak && fxState.quality > 0) field.streak(p.x, p.y, c)
        field.ring(p.x, p.y, { color: c, r1: 46, a: 0.5, dur: 520 })
        dirty = true
      } else if (s.type === 'touch') {
        const p = local(s.x, s.y)
        if (!inside(p) || fxState.reduced) return
        field.touch(p.x, p.y, pal.shown[1])
        dirty = true
      }
    })

    let rectClock = 0
    let visClock = 0
    let visible = true
    let redrawClock = 0
    let lastTarget = -1
    let growSince = 0
    let acc = 0
    let since = 0
    const off = ticker.add((dt, now) => {
      visClock += dt
      if (visClock > 500) {
        visClock = 0
        visible = cv.offsetParent !== null
      }
      if (!visible || (variant === 'phone' && phoneCovered(performance.now()))) return
      rectClock += dt
      if (rectClock > 1000) {
        rectClock = 0
        rect = cv.getBoundingClientRect()
        const w = field.box.w
        scale = rect.width > 0 ? w / rect.width : 1
        if (variant === 'room') size()
      }
      const reduced = fxState.reduced
      const tier = (reduced ? 0 : fxState.quality) as Tier
      if (tier !== sizedTier) size()
      // tier 1 paints at 30 fps on even vsync slots (the mirror ball redraws on odd ones, see
      // vsyncSlot), never more than two frames apart; tier 0 at 20 fps. The specks drift slowly
      // and time still adds up.
      acc += dt
      since++
      if (!dirty && tier === 1 && since < 2 && (vsyncSlot(now) & 1) !== 0) return
      if (!dirty && tier === 0 && since < 3) return
      since = 0
      const step = acc
      acc = 0
      const spec = TIERS[tier]
      const target = Math.min(spec.specks, fxState.specksTarget)
      if (!started && (performance.now() >= startAt || !throwNow)) {
        started = true
        syncCount(field.specks, target, throwNow ? emitter : () => null, throwNow ? 600 : 0)
        if (throwNow && !reduced) field.throwPulse(ballR, pal.shown[1])
        lastTarget = target
      } else if (started) {
        // the count follows the target every frame. A growth waits a moment for the specks the
        // levelled-up faces are throwing (adopted), then fills the rest from the ball.
        if (target !== lastTarget) {
          if (target > lastTarget) growSince = performance.now()
          lastTarget = target
          dirty = true
        }
        syncCount(field.specks, target, emitter, 900, performance.now() - growSince > 1400)
      }
      field.initMotes(reduced ? 0 : spec.dust)
      const palette = pal.update(fxState, fxPreview)
      const mirrors = Math.max(0, fxState.specksTarget - 12)
      field.step(step, reduced, reduced ? 0 : mirrors, streakOrigin, lighten(palette[1], 0.6), spec.streaks)
      const busy = field.rings.length > 0 || field.streaks.length > 0 || field.glows.length > 0
      if (reduced && !dirty && !busy) {
        // reduced motion: specks stand still; repaint only when something changed
        redrawClock += step
        if (redrawClock < 500) return
        redrawClock = 0
      }
      dirty = false
      const c0 = params.test ? performance.now() : 0
      field.draw(ctx, {
        dpr,
        k: started ? 1 : 0,
        flash: fxState.flash,
        gold: fxState.gold,
        palette,
        reduced,
        spread: 1 + 0.06 * fxState.flash,
      })
      if (params.test) {
        fxDebug.frames.specks++
        fxDebug.cost.specks += performance.now() - c0
        fxDebug.specks = field.count()
        fxDebug.streaks = field.streaks.length
      }
    }, 1)

    return () => {
      off()
      offSig()
      ro?.disconnect()
    }
  }, [])

  return (
    <>
      <canvas ref={ref} className="fx-specks" aria-hidden="true" />
      <div ref={probeH} className="fx-probe fx-probe--horizon" />
      <div ref={probeB} className="fx-probe fx-probe--ball" />
    </>
  )
}

const SpeckMemo = memo(SpeckInner)

/** Light specks, dust and streaks thrown by the mirror ball onto the walls. */
export function SpeckCanvas(): JSX.Element {
  return <SpeckMemo />
}
