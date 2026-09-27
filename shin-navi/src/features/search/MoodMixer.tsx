// Air mixer (SPEC S3, L/M8 #4, 5-2): one 2-axis pad instead of a questionnaire.
// x: しっとり ⇄ アガる (hype), y: 知ってる ⇄ 新しい出会い (fresh); "誰と？" chips start from the
// room's companion. While the finger moves, the wall's aurora follows live (fxState palette,
// brightness and flow speed) and every crossing into one of the 5×5 cells rings a pentatonic
// note, flashes the cell and throws sparks. Letting go sets the mood (setBy 'mixer'), closes the
// sheet and the director redeals the hand in front of the user; the aurora then glides back to
// the room's real air. Nothing here re-renders per frame: the puck, cells, trail and fxState are
// driven directly (DOM transforms, one canvas on the shared ticker).
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type RefObject } from 'react'
import type { AuroraKey, Companion } from '../../core/types'
import { useNavi, naviApi } from '../../core/store'
import { fxState } from '../../core/fxState'
import { ticker } from '../../core/ticker'
import { sound } from '../../core/sound'
import { AURORA_PALETTES } from '../../core/rules'
import { selHeat } from '../../core/selectors'
import { S } from './strings'
import { CELLS, auroraAt, cellOf, clamp01, noteForCell, previewHeat, previewSpeed, zoneOf, type ZoneId } from './mixerMath'

const COMPANIONS: Companion[] = ['friends', 'family', 'work', 'date', 'solo']
const HOLD_AFTER_RELEASE_MS = 1100
const HAND_BACK_MS = 900
const CLOSE_TO_MOOD_MS = 240

// ---------------------------------------------------------------- live aurora preview
// A tiny controller on the shared ticker (prio −30: before installFx's decays and before the
// canvases draw), so the store's own 250 ms sync never shows through while the finger is down.

const preview = {
  off: null as null | (() => void),
  key: 'quiet' as AuroraKey,
  t: 1,
  heat: 0.2,
  heatTarget: 0.2,
  speed: 0.7,
  holdUntil: 0,
  backAt: 0,
  backFrom: 0.2,
}

const smooth = (x: number) => x * x * (3 - 2 * x)

function stopPreview(): void {
  preview.off?.()
  preview.off = null
  preview.holdUntil = 0
  preview.backAt = 0
}

function previewTick(dt: number, now: number): void {
  if (preview.holdUntil && now >= preview.holdUntil && !preview.backAt) {
    // hand the wall back to the room: installFx cross-fades from what is on screen now
    preview.backAt = now
    preview.backFrom = preview.heat
    fxState.auroraFrom = preview.key
    fxState.aurora = selHeat(naviApi.getState()).aurora
    fxState.auroraT = 0
  }
  if (preview.backAt) {
    const k = Math.min(1, (now - preview.backAt) / HAND_BACK_MS)
    fxState.heat = preview.backFrom + (naviApi.getState().room.heat - preview.backFrom) * smooth(k)
    if (k >= 1) stopPreview()
    return
  }
  preview.t = Math.min(1, preview.t + dt / 420)
  preview.heat += (preview.heatTarget - preview.heat) * Math.min(1, dt / 160)
  fxState.aurora = preview.key
  fxState.auroraT = preview.t
  fxState.heat = preview.heat
  fxState.speed = preview.speed
}

function startPreview(): void {
  preview.holdUntil = 0
  preview.backAt = 0
  if (preview.off) return
  preview.key = fxState.aurora
  preview.t = 1
  preview.heat = fxState.heat
  preview.heatTarget = fxState.heat
  preview.speed = fxState.speed
  preview.off = ticker.add(previewTick, -30)
}

function setPreview(h: number, f: number): void {
  const k = auroraAt(h, f)
  if (k !== preview.key) {
    preview.key = k
    preview.t = 0
  }
  preview.heatTarget = previewHeat(h)
  preview.speed = previewSpeed(h, f)
}

function releasePreview(holdMs: number): void {
  if (!preview.off) return
  preview.holdUntil = performance.now() + holdMs
}

// ---------------------------------------------------------------- sparks and trail (one canvas)

const SPRITE_COLOR: Record<AuroraKey, string> = { quiet: '#7b86ff', mellow: '#2ef2ff', warm: '#ff5fc0', hot: '#ffb547' }
const sprites = new Map<AuroraKey, HTMLCanvasElement>()
function sprite(k: AuroraKey): HTMLCanvasElement {
  let c = sprites.get(k)
  if (c) return c
  c = document.createElement('canvas')
  c.width = c.height = 64
  const g = c.getContext('2d')
  if (g) {
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32)
    gr.addColorStop(0, 'rgba(255,255,255,1)')
    gr.addColorStop(0.22, SPRITE_COLOR[k])
    gr.addColorStop(1, 'rgba(0,0,0,0)')
    g.fillStyle = gr
    g.fillRect(0, 0, 64, 64)
  }
  sprites.set(k, c)
  return c
}

type Dot = { x: number; y: number; t: number; k: AuroraKey }
type Spark = { x: number; y: number; vx: number; vy: number; t: number; life: number; k: AuroraKey; size: number }

function usePadCanvas(canvas: RefObject<HTMLCanvasElement>, pad: RefObject<HTMLDivElement>) {
  const st = useRef({ trail: [] as Dot[], sparks: [] as Spark[], off: null as null | (() => void), dragging: false, w: 0, h: 0, dpr: 1 })

  useLayoutEffect(() => {
    const el = pad.current
    const cv = canvas.current
    if (!el || !cv) return
    const size = () => {
      const s = st.current
      s.w = el.clientWidth
      s.h = el.clientHeight
      s.dpr = Math.min(1.5, window.devicePixelRatio || 1)
      cv.width = Math.max(1, Math.round(s.w * s.dpr))
      cv.height = Math.max(1, Math.round(s.h * s.dpr))
    }
    size()
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(size) : null
    ro?.observe(el)
    return () => {
      ro?.disconnect()
      st.current.off?.()
      st.current.off = null
    }
  }, [])

  const draw = () => {
    const s = st.current
    const cv = canvas.current
    const ctx = cv?.getContext('2d')
    if (!cv || !ctx) return
    const now = performance.now()
    ctx.setTransform(s.dpr, 0, 0, s.dpr, 0, 0)
    ctx.clearRect(0, 0, s.w, s.h)
    ctx.globalCompositeOperation = 'lighter'
    s.trail = s.trail.filter(p => now - p.t < 460)
    for (const p of s.trail) {
      const a = 1 - (now - p.t) / 460
      const d = 8 + 30 * a
      ctx.globalAlpha = a * 0.5
      ctx.drawImage(sprite(p.k), p.x - d / 2, p.y - d / 2, d, d)
    }
    s.sparks = s.sparks.filter(p => now - p.t < p.life)
    for (const p of s.sparks) {
      const age = (now - p.t) / 1000
      const k = 1 - (now - p.t) / p.life
      const x = p.x + p.vx * age
      const y = p.y + p.vy * age - 40 * age * age
      const d = p.size * (0.4 + 0.6 * k)
      ctx.globalAlpha = k
      ctx.drawImage(sprite(p.k), x - d / 2, y - d / 2, d, d)
    }
    ctx.globalAlpha = 1
    if (!s.dragging && !s.trail.length && !s.sparks.length) {
      ctx.clearRect(0, 0, s.w, s.h)
      s.off?.()
      s.off = null
    }
  }

  const wake = () => {
    const s = st.current
    if (!s.off) s.off = ticker.add(draw, 5)
  }

  return {
    setDragging(on: boolean) {
      st.current.dragging = on
      if (on) wake()
    },
    trail(x: number, y: number, k: AuroraKey) {
      const s = st.current
      s.trail.push({ x, y, t: performance.now(), k })
      if (s.trail.length > 26) s.trail.shift()
      wake()
    },
    burst(x: number, y: number, k: AuroraKey) {
      const s = st.current
      const now = performance.now()
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2 + Math.random() * 0.6
        const v = 50 + Math.random() * 70
        s.sparks.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, t: now, life: 520 + Math.random() * 260, k, size: 10 + Math.random() * 10 })
      }
      if (s.sparks.length > 80) s.sparks.splice(0, s.sparks.length - 80)
      wake()
    },
  }
}

// ---------------------------------------------------------------- the sheet

const ZONE_CENTER: Record<ZoneId, [number, number]> = {
  mellowKnown: [0.17, 0.17],
  midKnown: [0.5, 0.17],
  hypeKnown: [0.83, 0.17],
  mellowMid: [0.17, 0.5],
  midMid: [0.5, 0.5],
  hypeMid: [0.83, 0.5],
  mellowFresh: [0.17, 0.83],
  midFresh: [0.5, 0.83],
  hypeFresh: [0.83, 0.83],
}

const paletteVars = (k: AuroraKey): CSSProperties => {
  const p = AURORA_PALETTES[k]
  return { '--p1': p[0], '--p2': p[1], '--p3': p[2] } as CSSProperties
}

const round2 = (v: number) => Math.round(v * 100) / 100

export function MoodMixer(): JSX.Element {
  const t = S.useT()
  const reduced = useNavi(s => s.ui.reduced)
  const start = useRef(naviApi.getState().room.mood).current
  const [companion, setCompanion] = useState<Companion>(start.companion)
  const [zone, setZone] = useState<ZoneId>(() => zoneOf(start.hype, start.fresh))
  const [dragging, setDragging] = useState(false)
  const padRef = useRef<HTMLDivElement>(null)
  const puckRef = useRef<HTMLSpanElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const cellRefs = useRef<(HTMLElement | null)[]>([])
  const pos = useRef({ h: start.hype, f: start.fresh })
  const lastCell = useRef(-1)
  const lastKey = useRef<AuroraKey | null>(null)
  const zoneRef = useRef(zone)
  const drag = useRef<number | null>(null)
  const committed = useRef(false)
  const touched = useRef(false)
  const companionRef = useRef(companion)
  companionRef.current = companion
  const fx = usePadCanvas(canvasRef, padRef)

  /** Put the puck at (h, f); ring the cell when it changes. */
  const place = (h: number, f: number, live: boolean) => {
    const pad = padRef.current
    const puck = puckRef.current
    if (!pad || !puck) return
    const W = pad.clientWidth
    const H = pad.clientHeight
    pos.current = { h, f }
    const x = h * W
    const y = (1 - f) * H
    puck.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`
    const k = auroraAt(h, f)
    if (k !== lastKey.current) {
      lastKey.current = k
      const p = AURORA_PALETTES[k]
      puck.style.setProperty('--p1', p[0])
      puck.style.setProperty('--p2', p[1])
      puck.style.setProperty('--p3', p[2])
    }
    const z = zoneOf(h, f)
    if (z !== zoneRef.current) {
      zoneRef.current = z
      setZone(z)
    }
    if (!live) return
    setPreview(h, f)
    if (!reduced) fx.trail(x, y, k)
    const [cx, cy] = cellOf(h, f)
    const id = cx * CELLS + cy
    if (id !== lastCell.current) {
      lastCell.current = id
      ring(cx, cy, k)
    }
  }

  /** A cell crossing: one pentatonic note, a flash, a ripple and sparks. */
  const ring = (cx: number, cy: number, k: AuroraKey) => {
    sound.play('penlight', { note: noteForCell(cx, cy) })
    sound.haptic(4)
    fxState.flash = Math.max(fxState.flash, 0.2)
    const cell = cellRefs.current[cx * CELLS + cy]
    if (cell && typeof cell.animate === 'function') {
      cell.animate(
        [
          { opacity: 0.95, transform: 'scale(0.86)' },
          { opacity: 0, transform: 'scale(1)' },
        ],
        { duration: 720, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' },
      )
    }
    const pad = padRef.current
    if (!pad || reduced) return
    const W = pad.clientWidth
    const H = pad.clientHeight
    const x = ((cx + 0.5) / CELLS) * W
    const y = (1 - (cy + 0.5) / CELLS) * H
    fx.burst(pos.current.h * W, (1 - pos.current.f) * H, k)
    const r = document.createElement('i')
    r.className = 'mx-ripple'
    r.style.setProperty('--c', SPRITE_COLOR[k])
    pad.appendChild(r)
    if (typeof r.animate !== 'function') return r.remove()
    const a = r.animate(
      [
        { transform: `translate3d(${x - 30}px, ${y - 30}px, 0) scale(0.25)`, opacity: 0.9 },
        { transform: `translate3d(${x - 30}px, ${y - 30}px, 0) scale(1.9)`, opacity: 0 },
      ],
      { duration: 640, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)', fill: 'forwards' },
    )
    a.onfinish = () => r.remove()
  }

  const fromPointer = (clientX: number, clientY: number) => {
    const pad = padRef.current
    if (!pad) return
    const r = pad.getBoundingClientRect()
    place(clamp01((clientX - r.left) / r.width), clamp01(1 - (clientY - r.top) / r.height), true)
  }

  const begin = () => {
    touched.current = true
    startPreview()
    fx.setDragging(true)
    setDragging(true)
  }

  const commit = () => {
    if (committed.current) return
    committed.current = true
    fx.setDragging(false)
    setDragging(false)
    const { h, f } = pos.current
    releasePreview(HOLD_AFTER_RELEASE_MS)
    fxState.flash = Math.max(fxState.flash, 0.6)
    sound.play('orbPop')
    const mood = { hype: round2(h), fresh: round2(f), companion: companionRef.current, setBy: 'mixer' as const }
    naviApi.getState().closeSheet()
    // let the sheet start sinking so the redeal happens in view
    window.setTimeout(() => naviApi.getState().setMood(mood), CLOSE_TO_MOOD_MS)
  }

  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    if (drag.current != null || committed.current) return
    e.preventDefault()
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      /* synthetic events */
    }
    drag.current = e.pointerId
    begin()
    fromPointer(e.clientX, e.clientY)
  }
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    if (drag.current !== e.pointerId) return
    fromPointer(e.clientX, e.clientY)
  }
  const onUp = (e: PointerEvent<HTMLDivElement>) => {
    if (drag.current !== e.pointerId) return
    fromPointer(e.clientX, e.clientY)
    drag.current = null
    commit()
  }
  const onCancel = (e: PointerEvent<HTMLDivElement>) => {
    if (drag.current !== e.pointerId) return
    drag.current = null
    fx.setDragging(false)
    setDragging(false)
    releasePreview(0)
  }

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = 1 / CELLS
    const { h, f } = pos.current
    let nh = h
    let nf = f
    if (e.key === 'ArrowLeft') nh = h - step
    else if (e.key === 'ArrowRight') nh = h + step
    else if (e.key === 'ArrowUp') nf = f + step
    else if (e.key === 'ArrowDown') nf = f - step
    else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      if (touched.current) commit()
      return
    } else return
    e.preventDefault()
    if (!touched.current) begin()
    fx.setDragging(false)
    place(clamp01(nh), clamp01(nf), true)
  }

  // initial puck position, and again when the pad resizes
  useLayoutEffect(() => {
    const pad = padRef.current
    place(pos.current.h, pos.current.f, false)
    if (!pad || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => place(pos.current.h, pos.current.f, false))
    ro.observe(pad)
    return () => ro.disconnect()
  }, [])

  // leaving without letting go on the pad: give the wall back, keep a changed companion
  useEffect(
    () => () => {
      if (!committed.current) {
        releasePreview(0)
        if (companionRef.current !== start.companion) naviApi.getState().setMood({ companion: companionRef.current })
      }
    },
    [],
  )

  const pickCompanion = (c: Companion) => {
    sound.play('tap')
    setCompanion(c)
    const puck = puckRef.current
    if (puck && typeof puck.animate === 'function' && !reduced) {
      const inner = puck.querySelector('.mx-puck__ball') as HTMLElement | null
      inner?.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.25)' }, { transform: 'scale(1)' }], { duration: 360, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' })
    }
  }

  const [zh, zf] = ZONE_CENTER[zone]
  const zoneKey = auroraAt(zh, zf)

  return (
    <div className={`mx${dragging ? ' is-drag' : ''}`}>
      <header className="mx__head">
        <h2 className="mx__title">{t('mixer.title')}</h2>
        <p className="mx__lead">{t('mixer.lead')}</p>
      </header>

      <div className="mx-who" role="radiogroup" aria-label={t('mixer.who')}>
        <span className="mx-who__label">{t('mixer.who')}</span>
        <div className="mx-who__chips">
          {COMPANIONS.map(c => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={companion === c}
              className={`mx-who__chip${companion === c ? ' is-on' : ''}`}
              data-testid="mixer-companion"
              data-companion={c}
              onClick={() => pickCompanion(c)}
            >
              {t(`who.${c}`)}
            </button>
          ))}
        </div>
      </div>

      <div className="mx-phrase" style={paletteVars(zoneKey)} aria-live="polite">
        <AnimatePresence initial={false} mode="popLayout">
          <motion.span
            key={zone}
            className="mx-phrase__text"
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: 10, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, y: -10, scale: 0.98 }}
            transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
          >
            {t(`zone.${zone}`)}
          </motion.span>
        </AnimatePresence>
      </div>

      <div
        ref={padRef}
        className="mx-pad"
        data-testid="mixer-pad"
        data-anchor="mixer"
        data-zone={zone}
        role="application"
        tabIndex={0}
        aria-label={t('mixer.pad')}
        aria-description={t('mixer.padHelp')}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onCancel}
        onLostPointerCapture={onCancel}
        onKeyDown={onKey}
      >
        <i className="mx-pad__field" aria-hidden="true" />
        <div className="mx-pad__grid" aria-hidden="true">
          {Array.from({ length: CELLS * CELLS }, (_, i) => {
            const cx = Math.floor(i / CELLS)
            const cy = i % CELLS
            const k = auroraAt((cx + 0.5) / CELLS, (cy + 0.5) / CELLS)
            return (
              <i
                key={i}
                ref={el => (cellRefs.current[i] = el)}
                className="mx-cell"
                style={{ left: `${(cx * 100) / CELLS}%`, top: `${((CELLS - 1 - cy) * 100) / CELLS}%`, '--c': SPRITE_COLOR[k] } as CSSProperties}
              />
            )
          })}
        </div>
        <canvas ref={canvasRef} className="mx-pad__fx" aria-hidden="true" />
        <span className="mx-axis mx-axis--l">{t('axis.mellow')}</span>
        <span className="mx-axis mx-axis--r">{t('axis.hype')}</span>
        <span className="mx-axis mx-axis--t">{t('axis.fresh')}</span>
        <span className="mx-axis mx-axis--b">{t('axis.known')}</span>
        <span className="mx-ghost" style={{ left: `${start.hype * 100}%`, top: `${(1 - start.fresh) * 100}%` }} aria-hidden="true">
          <i />
          <small>{t('mixer.now')}</small>
        </span>
        <span ref={puckRef} className="mx-puck" data-testid="mixer-puck" aria-hidden="true">
          <i className="mx-puck__halo" />
          <i className="mx-puck__ball" />
        </span>
      </div>

      <p className="mx-foot">
        <span className="mx-foot__release">{t('mixer.release')}</span>
        <small>{t('mixer.note')}</small>
      </p>
    </div>
  )
}
