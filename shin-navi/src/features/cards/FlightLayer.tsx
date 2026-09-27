// Flights (SPEC I-4 #2/#3, D-14). Listens to bus 'fx/flight' and throws a light token from the
// source rect to its target: reserve = quadratic bezier into the lane slot in 280 ms, shrinking
// to a 40 px chip; keep = fold into a face (rotateY, rounded card -> square tile, 180 ms) then
// fly to the face on the ball (240 ms). Tokens are plain DOM nodes animated with WAAPI
// transform/opacity keyframes, so they stay smooth on the compositor even while React commits.
// The GhostHand coach lives in this layer too (it spans from the card up to the lane).
import { useEffect, useRef } from 'react'
import type { NaviEvent, TargetId } from '../../core/events'
import { bus } from '../../core/events'
import { naviApi } from '../../core/store'
import { resolveTarget } from '../../core/targets'
import { useLayoutFrame } from '../../core/layout'
import { SONG_BY_ID, GENRES } from '../../data/songs'
import { palette } from '../../lib/art'
import { songTitle } from '../../i18n'
import { easeOutCubic, qbez } from './gestures'
import { GhostHand } from './GhostHand'
import { deckCtl } from './DeckView'

type FlightEvent = Extract<NaviEvent, { type: 'fx/flight' }>
type Box = { x: number; y: number; w: number; h: number }

export const RESERVE_MS = 280
export const FOLD_MS = 180
export const KEEP_FLY_MS = 240

const STEPS = 18

function areaColor(songId?: string): string {
  const g = songId ? SONG_BY_ID[songId]?.genre : undefined
  const i = g ? Math.max(0, GENRES.indexOf(g)) : 0
  return `hsl(${(330 + 30 * i) % 360} 85% 62%)`
}

function el(tag: string, cls: string, parent: HTMLElement, style?: Partial<CSSStyleDeclaration>): HTMLElement {
  const e = document.createElement(tag)
  e.className = cls
  if (style) Object.assign(e.style, style)
  parent.appendChild(e)
  return e
}

function canAnimate(e: HTMLElement): boolean {
  return typeof e.animate === 'function'
}

function landed(to: TargetId, songId?: string) {
  bus.emit({ type: 'fx/landed', to, songId })
}

function tf(cx: number, cy: number, w: number, h: number, s: number, extra = ''): string {
  return `translate3d(${(cx - w / 2).toFixed(1)}px, ${(cy - h / 2).toFixed(1)}px, 0) scale(${s.toFixed(4)})${extra}`
}

/** Reserve: a bright token along a quadratic bezier into the lane slot, then a landing pop. */
function flyReserve(layer: HTMLElement, from: Box, to: Box, e: FlightEvent) {
  const songId = e.songId
  const pal = songId ? palette(songId, SONG_BY_ID[songId]?.energy ?? 0.5) : null
  const w = Math.max(40, from.w)
  const h = Math.max(24, from.h)
  const c0 = { x: from.x + from.w / 2, y: from.y + from.h / 2 }
  const c1 = { x: to.x + to.w / 2, y: to.y + to.h / 2 }
  const ctrl = { x: c0.x + (c1.x - c0.x) * 0.12, y: c1.y + (c0.y - c1.y) * 0.22 }
  const s1 = 40 / w
  const tok = el('div', 'ftok ftok--reserve', layer, { width: `${w}px`, height: `${h}px`, borderRadius: `${Math.min(24, h / 2)}px` })
  tok.style.setProperty('--a', pal?.a ?? e.color)
  tok.style.setProperty('--b', pal?.b ?? e.color)
  const bg = el('div', 'ftok__bg', tok)
  if (pal) bg.style.background = pal.bg
  if (songId) {
    const t = el('div', 'ftok__title', tok)
    t.textContent = songTitle(songId).main
  }
  el('div', 'ftok__chip', tok)

  const frames: Keyframe[] = []
  for (let i = 0; i <= STEPS; i++) {
    const t = i / STEPS
    const te = 1 - Math.pow(1 - t, 1.8)
    const x = qbez(c0.x, ctrl.x, c1.x, te)
    const y = qbez(c0.y, ctrl.y, c1.y, te)
    const s = 1 + (s1 - 1) * easeOutCubic(Math.min(1, t / 0.72))
    const rot = Math.sin(Math.PI * t) * -7
    frames.push({ transform: tf(x, y, w, h, s, ` rotate(${rot.toFixed(2)}deg)`), offset: t })
  }
  const trail: HTMLElement[] = []
  for (let k = 0; k < 5; k++) {
    const d = el('div', 'ftrail', layer)
    d.style.setProperty('--a', pal?.a ?? e.color)
    trail.push(d)
  }
  if (!canAnimate(tok)) {
    tok.remove()
    trail.forEach(d => d.remove())
    window.setTimeout(() => {
      landed(e.to, songId)
      bus.emit({ type: 'fx/burst', at: e.to, preset: 'spark12' })
    }, RESERVE_MS)
    return
  }
  const chip = tok.querySelector('.ftok__chip') as HTMLElement
  const faceLayers = [bg, tok.querySelector('.ftok__title') as HTMLElement | null].filter(Boolean) as HTMLElement[]
  faceLayers.forEach(f => f.animate([{ opacity: 1 }, { opacity: 1, offset: 0.35 }, { opacity: 0 }], { duration: RESERVE_MS, fill: 'forwards' }))
  chip.animate([{ opacity: 0 }, { opacity: 0, offset: 0.3 }, { opacity: 1 }], { duration: RESERVE_MS, fill: 'forwards' })
  trail.forEach((d, k) => {
    const pts: Keyframe[] = []
    for (let i = 0; i <= STEPS; i++) {
      const t = i / STEPS
      const te = 1 - Math.pow(1 - t, 1.8)
      const x = qbez(c0.x, ctrl.x, c1.x, te)
      const y = qbez(c0.y, ctrl.y, c1.y, te)
      const s = 1 - k * 0.14
      pts.push({ transform: `translate3d(${(x - 6).toFixed(1)}px, ${(y - 6).toFixed(1)}px, 0) scale(${s.toFixed(3)})`, opacity: t < 0.08 ? 0 : 0.9 - k * 0.15, offset: t })
    }
    const a = d.animate(pts, { duration: RESERVE_MS, delay: 26 * (k + 1), easing: 'linear', fill: 'both' })
    a.onfinish = () => d.remove()
  })
  const anim = tok.animate(frames, { duration: RESERVE_MS, easing: 'linear', fill: 'forwards' })
  anim.onfinish = () => {
    landed(e.to, songId)
    bus.emit({ type: 'fx/burst', at: e.to, preset: 'spark12' })
    const pop = tok.animate(
      [
        { transform: tf(c1.x, c1.y, w, h, s1), opacity: 1 },
        { transform: tf(c1.x, c1.y, w, h, s1 * 1.5), opacity: 0 },
      ],
      { duration: 160, easing: 'ease-out', fill: 'forwards' },
    )
    pop.onfinish = () => tok.remove()
  }
}

/** Keep: fold the card into a face tile (rotateY), then fly the tile to its face on the ball. */
function flyKeep(layer: HTMLElement, from: Box, e: FlightEvent, local: (r: DOMRectReadOnly) => Box) {
  const songId = e.songId
  const pal = songId ? palette(songId, SONG_BY_ID[songId]?.energy ?? 0.5) : null
  const w = Math.max(40, from.w)
  const h = Math.max(40, from.h)
  const c0 = { x: from.x + from.w / 2, y: from.y + from.h / 2 }
  const tile = Math.min(w, h) * 0.62
  const sFold = 64 / tile
  const tok = el('div', 'ftok ftok--keep', layer, { width: `${w}px`, height: `${h}px` })
  const front = el('div', 'ftok__front', tok)
  if (pal) front.style.background = pal.bg
  if (songId) {
    const t = el('div', 'ftok__title', front)
    t.textContent = songTitle(songId).main
  }
  const back = el('div', 'ftok__back', tok)
  const face = el('div', 'ftok__face', back, { width: `${tile}px`, height: `${tile}px` })
  face.style.setProperty('--area', areaColor(songId))
  if (!canAnimate(tok)) {
    tok.remove()
    window.setTimeout(() => landed(e.to, songId), FOLD_MS + KEEP_FLY_MS)
    return
  }
  // fold while drifting a quarter of the way toward the ball (a flick can leave the card off-screen)
  const L0 = layer.getBoundingClientRect()
  const guess = resolveTarget(e.to)
  const g = guess ? local(guess) : { x: L0.width / 2, y: 120, w: 0, h: 0 }
  const fx = c0.x + (g.x + g.w / 2 - c0.x) * 0.28
  const fy = c0.y + (g.y + g.h / 2 - c0.y) * 0.18
  const lift = fy - c0.y
  const fold = tok.animate(
    [
      { transform: `${tf(c0.x, c0.y, w, h, 1)} perspective(900px) rotateY(0deg)` },
      { transform: `${tf((c0.x + fx) / 2, c0.y + lift * 0.5, w, h, 0.62)} perspective(900px) rotateY(110deg)`, offset: 0.55 },
      { transform: `${tf(fx, c0.y + lift, w, h, sFold)} perspective(900px) rotateY(180deg)` },
    ],
    { duration: FOLD_MS, easing: 'cubic-bezier(.4,0,.2,1)', fill: 'forwards' },
  )
  fold.onfinish = () => {
    const r = resolveTarget(e.to)
    const L = layer.getBoundingClientRect()
    const to = r ? local(r) : { x: L.width / 2 - 10, y: 120, w: 20, h: 20 }
    const c1 = { x: to.x + to.w / 2, y: to.y + to.h / 2 }
    const start = { x: fx, y: c0.y + lift }
    const ctrl = { x: (start.x + c1.x) / 2 + (c1.x >= start.x ? 70 : -70), y: Math.min(start.y, c1.y) - 70 }
    const sEnd = Math.max(0.03, Math.min(to.w, to.h, 22) / tile)
    const frames: Keyframe[] = []
    for (let i = 0; i <= STEPS; i++) {
      const t = i / STEPS
      const te = t * t * (3 - 2 * t)
      const x = qbez(start.x, ctrl.x, c1.x, te)
      const y = qbez(start.y, ctrl.y, c1.y, te)
      const s = sFold + (sEnd - sFold) * te
      frames.push({ transform: `${tf(x, y, w, h, s)} perspective(900px) rotateY(180deg) rotateZ(${(t * 90).toFixed(1)}deg)`, offset: t })
    }
    const fly = tok.animate(frames, { duration: KEEP_FLY_MS, easing: 'linear', fill: 'forwards' })
    fly.onfinish = () => {
      landed(e.to, songId)
      const flash = el('div', 'fflash', layer)
      flash.style.setProperty('--area', areaColor(songId))
      const f = flash.animate(
        [
          { transform: `translate3d(${c1.x - 20}px, ${c1.y - 20}px, 0) scale(0.2)`, opacity: 1 },
          { transform: `translate3d(${c1.x - 20}px, ${c1.y - 20}px, 0) scale(1.6)`, opacity: 0 },
        ],
        { duration: 320, easing: 'ease-out', fill: 'forwards' },
      )
      f.onfinish = () => flash.remove()
      tok.remove()
    }
  }
}

/** Import: a silver disc turns into the song's colour on its way to the ball. */
function flyDisc(layer: HTMLElement, from: Box, to: Box, e: FlightEvent, ms: number, cls: string) {
  const songId = e.songId
  const pal = songId ? palette(songId, SONG_BY_ID[songId]?.energy ?? 0.5) : null
  const size = cls === 'fpin' ? 16 : Math.max(28, Math.min(64, Math.min(from.w, from.h)))
  const c0 = { x: from.x + from.w / 2, y: from.y + from.h / 2 }
  const c1 = { x: to.x + to.w / 2, y: to.y + to.h / 2 }
  const ctrl = { x: (c0.x + c1.x) / 2 + 50, y: Math.min(c0.y, c1.y) - 90 }
  const tok = el('div', cls, layer, { width: `${size}px`, height: `${size}px` })
  tok.style.setProperty('--a', pal?.a ?? e.color)
  const color = el('div', `${cls}__color`, tok)
  if (!canAnimate(tok)) {
    tok.remove()
    window.setTimeout(() => landed(e.to, songId), ms)
    return
  }
  const frames: Keyframe[] = []
  for (let i = 0; i <= STEPS; i++) {
    const t = i / STEPS
    const te = t * t * (3 - 2 * t)
    const x = qbez(c0.x, ctrl.x, c1.x, te)
    const y = qbez(c0.y, ctrl.y, c1.y, te)
    const s = 1 - 0.55 * te
    frames.push({ transform: `translate3d(${(x - size / 2).toFixed(1)}px, ${(y - size / 2).toFixed(1)}px, 0) scale(${s.toFixed(3)}) rotate(${(t * 300).toFixed(0)}deg)`, offset: t })
  }
  color.animate([{ opacity: 0 }, { opacity: 1, offset: 0.5 }, { opacity: 1 }], { duration: ms, fill: 'forwards' })
  const a = tok.animate(frames, { duration: ms, easing: 'linear', fill: 'forwards' })
  a.onfinish = () => {
    landed(e.to, songId)
    tok.remove()
  }
}

/** prefers-reduced-motion: no flight, a soft glow blooms at the destination instead. */
function fadeAt(layer: HTMLElement, to: Box, e: FlightEvent) {
  const c1 = { x: to.x + to.w / 2, y: to.y + to.h / 2 }
  const g = el('div', 'fflash', layer)
  g.style.setProperty('--area', e.color)
  g.style.transform = `translate3d(${c1.x - 20}px, ${c1.y - 20}px, 0)`
  if (canAnimate(g)) {
    const a = g.animate([{ opacity: 0 }, { opacity: 1, offset: 0.4 }, { opacity: 0 }], { duration: 300, fill: 'forwards' })
    a.onfinish = () => g.remove()
  } else g.remove()
  window.setTimeout(() => {
    landed(e.to, e.songId)
    if (e.kind === 'reserve') bus.emit({ type: 'fx/burst', at: e.to, preset: 'spark12' })
  }, 200)
}

export function FlightLayer(): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const frame = useLayoutFrame()
  const scaleRef = useRef(frame.scale)
  scaleRef.current = frame.scale

  useEffect(() => {
    // flights launched ahead of the store action (deckCtl.preflight) are not thrown twice
    const early = new Map<string, number>()
    const keyOf = (kind: string, songId?: string) => `${kind}|${songId ?? ''}`
    const launch = (e: FlightEvent) => {
      const layer = ref.current
      if (!layer || e.kind === 'pass') return
      try {
        const L = layer.getBoundingClientRect()
        const sc = scaleRef.current || 1
        const local = (r: { left: number; top: number; width: number; height: number }): Box => ({ x: (r.left - L.left) / sc, y: (r.top - L.top) / sc, w: r.width / sc, h: r.height / sc })
        const from = local(e.from)
        const target = resolveTarget(e.to)
        const to: Box = target ? local(target) : { x: L.width / sc / 2 - 20, y: 44, w: 40, h: 40 }
        if (naviApi.getState().ui.reduced) return fadeAt(layer, to, e)
        if (e.kind === 'reserve') flyReserve(layer, from, to, e)
        else if (e.kind === 'keep') flyKeep(layer, from, e, local)
        else if (e.kind === 'import') flyDisc(layer, from, to, e, 420, 'fdisc')
        else if (e.kind === 'pin') flyDisc(layer, from, to, e, 480, 'fpin')
      } catch (err) {
        console.warn('[flight]', err)
        landed(e.to, e.songId)
      }
    }
    deckCtl.preflight = p => {
      early.set(keyOf(p.kind, p.songId), performance.now())
      launch({ type: 'fx/flight', ...p })
    }
    const off = bus.on('fx/flight', e => {
      const k = keyOf(e.kind, e.songId)
      const at = early.get(k)
      if (at != null && performance.now() - at < 1500) {
        early.delete(k)
        return
      }
      launch(e)
    })
    return () => {
      off()
      deckCtl.preflight = null
    }
  }, [])

  return (
    <div ref={ref} className="flights" aria-hidden="true">
      <GhostHand layerRef={ref} scale={frame.scale} />
    </div>
  )
}
