// Air mixer (SPEC S3, L/M8 #4, 5-2): one 2-axis pad instead of a questionnaire.
// x: しっとり ⇄ アガる (hype), y: 知ってる ⇄ 新しい出会い (fresh); "誰と？" chips start from the
// room's companion. The pad is an instrument: 5×5 light pads that ring a pentatonic note and
// flash as the finger crosses them, a neon trail, and a constellation of the songs themselves
// (every reservable song is a star placed by Navi's read), so the nearest titles surface as you
// drag. While the finger moves, the wall's aurora follows live (fxState palette, brightness and
// flow speed). Letting go sets the mood (setBy 'mixer'), closes the sheet and the director
// redeals the hand in front of the user; the aurora then glides back to the room's real air.
// Nothing here re-renders per frame: the puck, labels, cells and fxState are driven directly
// (DOM transforms, two canvases: a static star field and an fx layer on the shared ticker).
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type RefObject } from 'react'
import type { AuroraKey, Companion } from '../../core/types'
import { useNavi, naviApi } from '../../core/store'
import { fxState } from '../../core/fxState'
import { ticker } from '../../core/ticker'
import { sound } from '../../core/sound'
import { AURORA_PALETTES, areaColor } from '../../core/rules'
import { selHeat } from '../../core/selectors'
import { GENRES, type Genre } from '../../data/songs'
import { songTitle, useLocale, type Locale } from '../../i18n'
import { S } from './strings'
import { CELLS, auroraAt, cellOf, clamp01, nearestStars, noteForCell, previewHeat, previewSpeed, songStars, zoneOf, type Star, type ZoneId } from './mixerMath'

const COMPANIONS: Companion[] = ['friends', 'family', 'work', 'date', 'solo']
const HOLD_AFTER_RELEASE_MS = 1100
const HAND_BACK_MS = 900
const CLOSE_TO_MOOD_MS = 240
const NEAR = 3

// ---------------------------------------------------------------- live aurora preview
// A tiny controller on the shared ticker (prio −30: before installFx's decays and before the
// canvases draw). It owns the whole crossfade (from, to, t) while the finger is down, so the
// store's own 250 ms sync never shows through.

const preview = {
  off: null as null | (() => void),
  key: 'quiet' as AuroraKey,
  from: 'quiet' as AuroraKey,
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
    fxState.auroraFrom = preview.t >= 0.5 ? preview.key : preview.from
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
  fxState.auroraFrom = preview.from
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
  preview.from = fxState.aurora
  preview.t = 1
  preview.heat = fxState.heat
  preview.heatTarget = fxState.heat
  preview.speed = fxState.speed
  preview.off = ticker.add(previewTick, -30)
}

function setPreview(h: number, f: number): void {
  const k = auroraAt(h, f)
  if (k !== preview.key) {
    preview.from = preview.t >= 0.5 ? preview.key : preview.from
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

// ---------------------------------------------------------------- sprites (pre-rendered once)

const SPRITE_COLOR: Record<AuroraKey, string> = { quiet: '#7b86ff', mellow: '#2ef2ff', warm: '#ff5fc0', hot: '#ffb547' }
const sprites = new Map<string, HTMLCanvasElement>()
function sprite(color: string): HTMLCanvasElement {
  let c = sprites.get(color)
  if (c) return c
  c = document.createElement('canvas')
  c.width = c.height = 64
  const g = c.getContext('2d')
  if (g) {
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32)
    gr.addColorStop(0, 'rgba(255,255,255,1)')
    gr.addColorStop(0.2, color)
    gr.addColorStop(0.55, color.startsWith('#') ? `${color}55` : color)
    gr.addColorStop(1, 'rgba(0,0,0,0)')
    g.fillStyle = gr
    g.fillRect(0, 0, 64, 64)
  }
  sprites.set(color, c)
  return c
}
const GENRE_COLOR: Record<Genre, string> = Object.fromEntries(GENRES.map(g => [g, hslToHex(areaColor(g))])) as Record<Genre, string>

/** "hsl(330 85% 62%)" → "#rrggbb" (so sprites can take an alpha suffix). */
function hslToHex(hsl: string): string {
  const m = /hsl\((\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)%\s+(\d+(?:\.\d+)?)%\)/.exec(hsl)
  if (!m) return '#ffffff'
  const h = Number(m[1]) / 360
  const s = Number(m[2]) / 100
  const l = Number(m[3]) / 100
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const ch = (t: number) => {
    let x = t
    if (x < 0) x += 1
    if (x > 1) x -= 1
    const v = x < 1 / 6 ? p + (q - p) * 6 * x : x < 1 / 2 ? q : x < 2 / 3 ? p + (q - p) * (2 / 3 - x) * 6 : p
    return Math.round(v * 255)
      .toString(16)
      .padStart(2, '0')
  }
  return `#${ch(h + 1 / 3)}${ch(h)}${ch(h - 1 / 3)}`
}

// ---------------------------------------------------------------- the star field (static canvas)

function useStarField(canvas: RefObject<HTMLCanvasElement>, pad: RefObject<HTMLDivElement>, stars: readonly Star[]) {
  useLayoutEffect(() => {
    const el = pad.current
    const cv = canvas.current
    if (!el || !cv) return
    const draw = () => {
      const w = el.clientWidth
      const h = el.clientHeight
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      cv.width = Math.max(1, Math.round(w * dpr))
      cv.height = Math.max(1, Math.round(h * dpr))
      const ctx = cv.getContext('2d')
      if (!ctx) return
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, w, h)
      ctx.globalCompositeOperation = 'lighter'
      for (const s of stars) {
        const x = s.hype * w
        const y = (1 - s.fresh) * h
        ctx.globalAlpha = 0.34
        const g = sprite(GENRE_COLOR[s.genre])
        ctx.drawImage(g, x - 7, y - 7, 14, 14)
      }
      ctx.globalCompositeOperation = 'source-over'
      ctx.globalAlpha = 0.85
      ctx.fillStyle = '#f4f1ff'
      for (const s of stars) {
        ctx.beginPath()
        ctx.arc(s.hype * w, (1 - s.fresh) * h, 1.25, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.globalAlpha = 1
    }
    draw()
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(draw) : null
    ro?.observe(el)
    return () => ro?.disconnect()
  }, [stars])
}

// ---------------------------------------------------------------- trail, sparks, near stars (fx canvas)

type Dot = { x: number; y: number; t: number; k: AuroraKey }
type Spark = { x: number; y: number; vx: number; vy: number; t: number; life: number; k: AuroraKey; size: number }
type Fx = {
  setDragging(on: boolean): void
  trail(x: number, y: number, k: AuroraKey): void
  burst(x: number, y: number, k: AuroraKey): void
  near(puck: { x: number; y: number } | null, stars: { x: number; y: number; color: string }[]): void
}

const TRAIL_MS = 760

function usePadFx(canvas: RefObject<HTMLCanvasElement>, pad: RefObject<HTMLDivElement>): Fx {
  const st = useRef({
    trail: [] as Dot[],
    sparks: [] as Spark[],
    puck: null as { x: number; y: number } | null,
    near: [] as { x: number; y: number; color: string }[],
    off: null as null | (() => void),
    dragging: false,
    w: 0,
    h: 0,
    dpr: 1,
  })

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
    // constellation lines: the puck reaches for the nearest songs
    if (s.dragging && s.puck && s.near.length) {
      ctx.lineWidth = 1.2
      for (let i = 0; i < s.near.length; i++) {
        const n = s.near[i]
        ctx.globalAlpha = 0.55 - i * 0.12
        ctx.strokeStyle = n.color
        ctx.beginPath()
        ctx.moveTo(s.puck.x, s.puck.y)
        ctx.lineTo(n.x, n.y)
        ctx.stroke()
        ctx.globalAlpha = 0.9 - i * 0.15
        ctx.drawImage(sprite(n.color), n.x - 12, n.y - 12, 24, 24)
      }
    }
    // the neon ribbon behind the finger
    s.trail = s.trail.filter(p => now - p.t < TRAIL_MS)
    const tr = s.trail
    if (tr.length > 1) {
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      for (let i = 1; i < tr.length; i++) {
        const a = 1 - (now - tr[i].t) / TRAIL_MS
        ctx.globalAlpha = a * 0.9
        ctx.strokeStyle = SPRITE_COLOR[tr[i].k]
        ctx.lineWidth = 2 + 9 * a
        ctx.beginPath()
        ctx.moveTo(tr[i - 1].x, tr[i - 1].y)
        ctx.lineTo(tr[i].x, tr[i].y)
        ctx.stroke()
      }
      for (let i = 1; i < tr.length; i++) {
        const a = 1 - (now - tr[i].t) / TRAIL_MS
        ctx.globalAlpha = a * 0.8
        ctx.strokeStyle = '#ffffff'
        ctx.lineWidth = 1 + 2 * a
        ctx.beginPath()
        ctx.moveTo(tr[i - 1].x, tr[i - 1].y)
        ctx.lineTo(tr[i].x, tr[i].y)
        ctx.stroke()
      }
    }
    s.sparks = s.sparks.filter(p => now - p.t < p.life)
    for (const p of s.sparks) {
      const age = (now - p.t) / 1000
      const k = 1 - (now - p.t) / p.life
      const x = p.x + p.vx * age
      const y = p.y + p.vy * age + 60 * age * age
      const d = p.size * (0.4 + 0.6 * k)
      ctx.globalAlpha = k
      ctx.drawImage(sprite(SPRITE_COLOR[p.k]), x - d / 2, y - d / 2, d, d)
    }
    ctx.globalAlpha = 1
    ctx.globalCompositeOperation = 'source-over'
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
    setDragging(on) {
      st.current.dragging = on
      if (on) wake()
    },
    trail(x, y, k) {
      const s = st.current
      s.trail.push({ x, y, t: performance.now(), k })
      if (s.trail.length > 40) s.trail.shift()
      wake()
    },
    burst(x, y, k) {
      const s = st.current
      const now = performance.now()
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2 + Math.random() * 0.6
        const v = 60 + Math.random() * 90
        s.sparks.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, t: now, life: 480 + Math.random() * 300, k, size: 12 + Math.random() * 12 })
      }
      if (s.sparks.length > 90) s.sparks.splice(0, s.sparks.length - 90)
      wake()
    },
    near(puck, stars) {
      st.current.puck = puck
      st.current.near = stars
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
  const locale = useLocale()
  const reduced = useNavi(s => s.ui.reduced)
  const start = useRef(naviApi.getState().room.mood).current
  const [companion, setCompanion] = useState<Companion>(start.companion)
  const [zone, setZone] = useState<ZoneId>(() => zoneOf(start.hype, start.fresh))
  const [dragging, setDragging] = useState(false)
  const padRef = useRef<HTMLDivElement>(null)
  const puckRef = useRef<HTMLSpanElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const starsRef = useRef<HTMLCanvasElement>(null)
  const cellRefs = useRef<(HTMLElement | null)[]>([])
  const ringRefs = useRef<(HTMLSpanElement | null)[]>([])
  const rowRefs = useRef<(HTMLElement | null)[]>([])
  const calloutRef = useRef<HTMLSpanElement>(null)
  const pos = useRef({ h: start.hype, f: start.fresh })
  const lastCell = useRef(-1)
  const ringFirst = useRef(false)
  const lastKey = useRef<AuroraKey | null>(null)
  const lastNear = useRef('')
  const zoneRef = useRef(zone)
  const drag = useRef<number | null>(null)
  const committed = useRef(false)
  const touched = useRef(false)
  const companionRef = useRef(companion)
  companionRef.current = companion
  const localeRef = useRef<Locale>(locale)
  localeRef.current = locale
  const stars = songStars()
  const fx = usePadFx(canvasRef, padRef)
  useStarField(starsRef, padRef, stars)

  /**
   * Surface the songs nearest to the puck: a ring on each of the three stars and a callout of
   * their titles riding beside the puck (DOM writes only when the set changes).
   */
  const showNear = (h: number, f: number, W: number, H: number, force = false) => {
    const px = h * W
    const py = (1 - f) * H
    const near = nearestStars(stars, h, f, NEAR, W / Math.max(1, H))
    fx.near(
      { x: px, y: py },
      near.map(s => ({ x: s.hype * W, y: (1 - s.fresh) * H, color: GENRE_COLOR[s.genre] })),
    )
    const co = calloutRef.current
    if (co) {
      // beside the puck, on the side with room, kept inside the pad vertically
      const dy = Math.max(38 - py, Math.min(H - 38 - py, 0))
      co.style.transform = `translate3d(${px.toFixed(1)}px, ${(py + dy).toFixed(1)}px, 0)`
      co.dataset.side = h > 0.55 ? 'l' : 'r'
    }
    const sig = near.map(s => s.id).join('|')
    if (sig === lastNear.current && !force) return
    lastNear.current = sig
    near.forEach((s, i) => {
      const ring = ringRefs.current[i]
      if (ring) {
        ring.style.transform = `translate3d(${(s.hype * W).toFixed(1)}px, ${((1 - s.fresh) * H).toFixed(1)}px, 0)`
        ring.style.setProperty('--c', GENRE_COLOR[s.genre])
        ring.dataset.star = s.id
      }
      const row = rowRefs.current[i]
      if (row) {
        row.style.setProperty('--c', GENRE_COLOR[s.genre])
        row.dataset.star = s.id
        const text = row.querySelector('span')
        if (text) text.textContent = songTitle(s.id, localeRef.current).main
        if (!reduced && typeof row.animate === 'function') row.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: 'ease-out' })
      }
    })
  }

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
    showNear(h, f, W, H, !live)
    const [cx, cy] = cellOf(h, f)
    const id = cx * CELLS + cy
    const changed = id !== lastCell.current
    if (changed) {
      cellRefs.current[lastCell.current]?.parentElement?.classList.remove('is-here')
      cellRefs.current[id]?.parentElement?.classList.add('is-here')
      lastCell.current = id
    }
    if (!live) return
    setPreview(h, f)
    if (!reduced) fx.trail(x, y, k)
    if (changed || ringFirst.current) ring(cx, cy, k)
    ringFirst.current = false
  }

  /** A cell crossing: one pentatonic note, the pad lights, a ripple and sparks. */
  const ring = (cx: number, cy: number, k: AuroraKey) => {
    sound.play('penlight', { note: noteForCell(cx, cy) })
    sound.haptic(4)
    fxState.flash = Math.max(fxState.flash, 0.2)
    const cell = cellRefs.current[cx * CELLS + cy]
    if (cell && typeof cell.animate === 'function') {
      cell.animate(
        [
          { opacity: 1, transform: 'scale(0.9)' },
          { opacity: 0.85, transform: 'scale(1)', offset: 0.25 },
          { opacity: 0, transform: 'scale(1)' },
        ],
        { duration: reduced ? 400 : 900, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' },
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
    ringFirst.current = true
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

  // titles follow a language switch
  useEffect(() => {
    const pad = padRef.current
    if (pad) showNear(pos.current.h, pos.current.f, pad.clientWidth, pad.clientHeight, true)
  }, [locale])

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
        <i className="mx-pad__drift" aria-hidden="true" />
        <div className="mx-pad__grid" aria-hidden="true">
          {Array.from({ length: CELLS * CELLS }, (_, i) => {
            const cx = Math.floor(i / CELLS)
            const cy = i % CELLS
            const k = auroraAt((cx + 0.5) / CELLS, (cy + 0.5) / CELLS)
            return (
              <span key={i} className="mx-cell" style={{ left: `${(cx * 100) / CELLS}%`, top: `${((CELLS - 1 - cy) * 100) / CELLS}%`, '--c': SPRITE_COLOR[k] } as CSSProperties}>
                <i ref={el => (cellRefs.current[i] = el)} className="mx-cell__lit" />
              </span>
            )
          })}
        </div>
        <canvas ref={starsRef} className="mx-pad__stars" aria-hidden="true" />
        <canvas ref={canvasRef} className="mx-pad__fx" aria-hidden="true" />
        <div className="mx-nears" aria-hidden="true">
          {Array.from({ length: NEAR }, (_, i) => (
            <span key={i} ref={el => (ringRefs.current[i] = el)} className="mx-ring" data-rank={i} />
          ))}
          <span ref={calloutRef} className="mx-callout" data-testid="mixer-near">
            <span className="mx-callout__list">
              {Array.from({ length: NEAR }, (_, i) => (
                <b key={i} ref={el => (rowRefs.current[i] = el)} className="mx-callout__row" data-rank={i}>
                  <i />
                  <span />
                </b>
              ))}
            </span>
          </span>
        </div>
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
