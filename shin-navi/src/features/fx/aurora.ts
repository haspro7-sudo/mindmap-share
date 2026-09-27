// The aurora on the wall (SPEC A-1, B-2, E-4, I-4 #7, K-11 L0): the room's air shown as colour
// and flow instead of a number. Drawn at 0.5× (tier 2) / 0.4× (tier 1) internal resolution from
// three pre-rendered sprites (blob, curtain, dot) that are moved and scaled with sines, tinted
// by the current palette, cross-faded over 1.8 s, flushed gold for 0.8 s when everyone knows,
// and mirrored faintly on the floor below the horizon.
import type { AuroraKey } from '../../core/types'
import { AURORA_PALETTES } from '../../core/rules'
import { INTRO_TIMELINE, INTRO_SCALE } from '../../core/intro'
import { curtainSprite, hexToRgb, mixRgb, rampSprite, softDot, Tint, type RGB } from './sprites'
import type { TierSpec } from './governor'

export type Palette3 = [RGB, RGB, RGB]
export const PALETTE_RGB: Record<AuroraKey, Palette3> = {
  quiet: AURORA_PALETTES.quiet.map(hexToRgb) as Palette3,
  mellow: AURORA_PALETTES.mellow.map(hexToRgb) as Palette3,
  warm: AURORA_PALETTES.warm.map(hexToRgb) as Palette3,
  hot: AURORA_PALETTES.hot.map(hexToRgb) as Palette3,
}
export const GOLD_RGB: Palette3 = [hexToRgb('#FFD36B'), hexToRgb('#FFB547'), hexToRgb('#FFF0B8')]

export const CROSSFADE_MS = 1800
export const GOLD_MS = 800
export const FLASH_MS = 600

export const smooth = (t: number): number => {
  const x = Math.max(0, Math.min(1, t))
  return x * x * (3 - 2 * x)
}
export const easeOut = (t: number): number => 1 - Math.pow(1 - Math.max(0, Math.min(1, t)), 3)

/** Palette shown now: from→to by the crossfade progress, then flushed towards gold. */
export function blendPalette(from: Palette3, to: Palette3, t: number, gold = 0): Palette3 {
  const k = smooth(t)
  const g = Math.min(1, gold * 1.7) // hold gold for the first part of the 0.8 s, then melt back
  return [0, 1, 2].map(i => mixRgb(mixRgb(from[i], to[i], k), GOLD_RGB[i], smooth(g))) as Palette3
}

/**
 * Follows fxState's palette target. When the air changes again mid-fade, the colours on screen
 * become the new starting point, so the wall never jumps.
 */
export class PaletteTracker {
  private target: AuroraKey
  private from: Palette3
  shown: Palette3
  constructor(start: AuroraKey) {
    this.target = start
    this.from = PALETTE_RGB[start]
    this.shown = PALETTE_RGB[start]
  }
  update(fx: { aurora: AuroraKey; auroraT: number; gold: number }, preview?: { k: number; rgb: Palette3; afterglow?: number } | null): Palette3 {
    if (fx.aurora !== this.target) {
      this.from = this.shownNoGold ?? this.shown
      this.target = fx.aurora
    }
    let base = blendPalette(this.from, PALETTE_RGB[this.target], fx.auroraT, 0)
    // the forecast lean (fxPreview) sits between the real palette and the gold flush
    if (preview && preview.k > 0.001) base = leanPalette(base, preview.rgb, preview.k)
    // after an all-know the wall keeps a little lamplight while the word celebrates
    const ag = preview?.afterglow ?? 0
    if (ag > 0.001) base = leanPalette(base, GOLD_RGB, AFTERGLOW_MIX * smooth(ag))
    this.shownNoGold = base
    this.shown = fx.gold > 0 ? blendPalette(base, base, 1, fx.gold) : base
    return this.shown
  }
  private shownNoGold: Palette3 | null = null
  get key(): AuroraKey {
    return this.target
  }
}

/** A palette leaning `k` (0..1) of the way toward another one (the forecast preview). */
export function leanPalette(base: Palette3, to: Palette3, k: number): Palette3 {
  const x = Math.max(0, Math.min(1, k))
  return [mixRgb(base[0], to[0], x), mixRgb(base[1], to[1], x), mixRgb(base[2], to[2], x)]
}

/** How far the wall leans toward the forecast palette (QA OWNER#7: 30–50 %). */
export const PREVIEW_MIX = 0.45
/** All-know: after the 0.8 s gold flush the wall keeps this much gold, melting over ~3 s. */
export const AFTERGLOW_MIX = 0.24
export const AFTERGLOW_MS = 3000
/** The lean arrives within ~1.2 s of a reservation and melts over the 1.8 s crossfade. */
export const PREVIEW_IN_MS = 1200
export const PREVIEW_OUT_MS = CROSSFADE_MS

export type IntroMode = 'full' | 'short' | 'none'

/**
 * Entrance progress 0..1 of a layer that starts at `startMs` of the timeline and takes `durMs`
 * (SPEC B-2: aurora 0.3 → 1.5 s). Short intros compress the start and fade in over 300 ms.
 */
export function introProgress(elapsedMs: number, mode: IntroMode, reduced: boolean, startMs: number, durMs: number): number {
  if (mode === 'none') return 1
  if (reduced) return Math.max(0, Math.min(1, elapsedMs / 300))
  const s = startMs * INTRO_SCALE[mode]
  const d = mode === 'full' ? durMs : 300
  return Math.max(0, Math.min(1, (elapsedMs - s) / d))
}

export const auroraIntro = (elapsedMs: number, mode: IntroMode, reduced: boolean): number =>
  introProgress(elapsedMs, mode, reduced, INTRO_TIMELINE.aurora, 1200)

export type AuroraFrame = {
  w: number
  h: number
  /** horizon y and the ball (centre + radius), in CSS px of the canvas box */
  hy: number
  bx: number
  by: number
  br: number
  /** flow time (already integrated with the speed) */
  t: number
  /** entrance progress 0..1 */
  k: number
  /** brightness multiplier (1 + 0.4 · flash) */
  bright: number
  /** 0..1 gold flush (everyone knows): the wall glows like lamplight */
  gold?: number
  /** 0..1 how much of the floor (horizon seam, reflection) shows — 0 away from the hero */
  floor?: number
  heat: number
  colors: Palette3
  spec: TierSpec
  variant: 'phone' | 'room'
}


/** Mean relative luminance 0..1 of a palette (bright palettes are drawn a little softer). */
export function paletteLum(p: Palette3): number {
  let l = 0
  for (const c of p) l += (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255
  return l / 3
}

type Blob = { x: number; y: number; rx: number; ry: number; ax: number; fx: number; ay: number; fy: number; ph: number; a: number; c: 0 | 1 | 2 }

// y is relative to the horizon (negative = above), rx relative to the width. Frequencies are per
// unit of flow time (seconds × 0.5 + heat): at a quiet 0.7 the masses drift ~10 px/s.
const BLOBS: Blob[] = [
  { x: 0.22, y: -96, rx: 0.6, ry: 150, ax: 0.16, fx: 0.23, ay: 18, fy: 0.37, ph: 0, a: 0.9, c: 0 },
  { x: 0.78, y: -134, rx: 0.56, ry: 172, ax: 0.15, fx: 0.19, ay: 22, fy: 0.31, ph: 2.1, a: 0.85, c: 1 },
  { x: 0.5, y: -40, rx: 0.8, ry: 110, ax: 0.2, fx: 0.13, ay: 12, fy: 0.43, ph: 4.2, a: 0.8, c: 2 },
]

/** One sprite placement of the wall, kept so the floor can mirror it. */
type Placed = { img: HTMLCanvasElement; x: number; y: number; w: number; h: number; a: number; shear: number; op: GlobalCompositeOperation }

/**
 * The wall. Three layers, all pre-rendered sprites:
 * 1. three radial colour masses (dark palettes glow additively, bright ones mix with screen so
 *    they never burn to white), drifting and breathing on sines, plus the ball's own halo;
 * 2. aurora curtains standing on the horizon (lighter): a crest of light travels along the band,
 *    each curtain sways around its foot, and a second, differently tinted copy slides over it so
 *    the rays shimmer;
 * 3. the glossy floor: every placement above is drawn again mirrored and squashed below the
 *    horizon (never a copy of the canvas onto itself — that forces a flush and costs ~4 ms),
 *    dissolving with depth, and a bright seam along the horizon.
 */
export class AuroraPainter {
  private blob = softDot(256)
  private curtain = curtainSprite(128, 320)
  private ramp = rampSprite(64)
  private blobTint: Tint[]
  private curtainTint: Tint[]
  private placed: Placed[] = []

  constructor() {
    this.blobTint = [0, 1, 2].map(() => new Tint(this.blob, 0.5, 0.2))
    this.curtainTint = [0, 1, 2].map(() => new Tint(this.curtain, 1))
  }

  draw(ctx: CanvasRenderingContext2D, f: AuroraFrame, res: number): void {
    const { w, h, hy, t, heat, spec } = f
    ctx.setTransform(res, 0, 0, res, 0, 0)
    ctx.globalCompositeOperation = 'source-over'
    ctx.globalAlpha = 1
    ctx.clearRect(0, 0, w, h)
    if (f.k <= 0) return
    const e = easeOut(f.k)
    const lum = paletteLum(f.colors)
    const gold = Math.min(1, (f.gold ?? 0) * 1.7)
    const A = e * f.bright * (1.12 - 0.45 * lum) * (1 + 0.35 * gold)
    // Both blend passes are weighted by the palette's luminance, so a crossfade never jumps.
    // The gold flush is additive on purpose: lamplight, a little white-hot in the middle.
    const wAdd = Math.max(gold * 0.85, Math.min(1, Math.max(0, (0.5 - lum) / 0.22)))
    const rise = (1 - e) * 80
    const room = f.variant === 'room'
    const blobs = this.blobTint.map((tn, i) => tn.set(f.colors[i]))
    const curtains = this.curtainTint.map((tn, i) => tn.set(f.colors[i]))
    const vScale = room ? Math.max(1, (hy - 40) / 300) : 1
    const placed = this.placed
    placed.length = 0

    const put = (p: Placed) => {
      if (p.a <= 0.004) return
      placed.push(p)
      ctx.globalCompositeOperation = p.op
      ctx.globalAlpha = Math.min(1, p.a)
      // x' = x + shear·(y − foot) sways a curtain around its foot
      if (p.shear) ctx.setTransform(res, 0, p.shear * res, res, -p.shear * (p.y + p.h) * res, 0)
      ctx.drawImage(p.img, p.x, p.y, p.w, p.h)
      if (p.shear) ctx.setTransform(res, 0, 0, res, 0, 0)
    }
    const mass = (img: HTMLCanvasElement, x: number, y: number, mw: number, mh: number, a: number) => {
      if (wAdd > 0.01) put({ img, x, y, w: mw, h: mh, a: a * wAdd, shear: 0, op: 'lighter' })
      if (wAdd < 0.99) put({ img, x, y, w: mw, h: mh, a: a * (1 - wAdd), shear: 0, op: 'screen' })
    }

    // 1. colour masses floating above the floor, and the ball's halo on the wall
    for (let i = 0; i < Math.min(spec.blobs, BLOBS.length); i++) {
      const b = BLOBS[i]
      const cx = w * b.x + Math.sin(t * b.fx + b.ph) * w * b.ax + Math.sin(t * b.fx * 2.3 + b.ph * 1.7) * w * 0.04
      const cy = hy + b.y * vScale + Math.sin(t * b.fy + b.ph * 1.3) * b.ay + rise
      const rx = w * b.rx * (1 + 0.12 * Math.sin(t * 0.29 + b.ph)) * (room ? 0.75 : 1)
      const ry = b.ry * vScale * (0.85 + 0.3 * heat) * (1 + 0.12 * Math.sin(t * 0.34 + b.ph))
      mass(blobs[b.c], cx - rx, cy - ry, rx * 2, ry * 2, A * b.a * (0.75 + 0.25 * Math.sin(t * 0.47 + b.ph)))
    }
    const halo = f.br * 2.3 * (1 + 0.05 * Math.sin(t * 0.8))
    mass(blobs[1], f.bx - halo, f.by - halo, halo * 2, halo * 2, A * 0.5)
    mass(blobs[0], f.bx - halo * 1.5, f.by - halo * 0.9, halo * 3, halo * 1.8, A * 0.3)

    // 2. curtains rising from the horizon: a crest of light travels along them
    const n = spec.curtains
    for (let j = 0; j < n; j++) {
      const u = (j + 0.5) / n
      const ph = t * 1.15 - u * 5.5
      const crest = 0.5 + 0.5 * Math.sin(ph)
      const x = w * (0.05 + 0.9 * u) + Math.sin(t * 0.31 + j * 1.7) * w * 0.06 + Math.sin(ph * 0.5 + j) * 6
      const hh = (165 + 70 * Math.sin(t * 0.37 + j * 2.1)) * (0.8 + 0.45 * heat) * (0.78 + 0.3 * crest) * vScale
      const ww = (room ? 130 : 60) + (room ? 40 : 24) * Math.sin(t * 0.4 + j)
      const a = A * (0.28 + 0.72 * crest * crest) * (0.95 + 0.3 * wAdd)
      const shear = 0.2 * Math.sin(t * 0.45 + j * 0.9)
      const top = hy - hh + rise
      put({ img: curtains[j % 3], x: x - ww / 2, y: top, w: ww, h: hh, a, shear, op: 'lighter' })
      // the shimmer: a narrower copy in the next colour sliding across the rays
      const sx = Math.sin(t * 1.9 + j * 2.3) * ww * 0.16
      put({ img: curtains[(j + 1) % 3], x: x - ww * 0.4 + sx, y: top + hh * 0.12, w: ww * 0.8, h: hh * 0.88, a: a * 0.45, shear: shear * 1.3, op: 'lighter' })
    }

    // 3. the floor: the wall mirrored and squashed below the horizon, fading with depth
    const Q = 0.42
    const fl = f.floor ?? 1
    if (hy < h && fl > 0.01) {
      const top = hy - 230 // only what stands close to the floor shows in it
      for (const p of placed) {
        if (p.y + p.h < top) continue
        ctx.globalCompositeOperation = p.op
        ctx.globalAlpha = Math.min(1, p.a * 0.34 * fl)
        // y' = hy + (hy − y)·Q, with the curtain's sway around its foot
        ctx.setTransform(res, 0, p.shear * res, -Q * res, -p.shear * (p.y + p.h) * res, hy * (1 + Q) * res)
        ctx.drawImage(p.img, p.x, p.y, p.w, p.h)
      }
      ctx.setTransform(res, 0, 0, res, 0, 0)
      // the reflection dissolves with depth instead of ending in an edge
      ctx.globalCompositeOperation = 'destination-out'
      ctx.globalAlpha = 1
      const depth = 230 * Q
      ctx.drawImage(this.ramp, 0, hy + 2, w, depth)
      ctx.fillStyle = '#000'
      ctx.fillRect(0, hy + depth, w, h - hy - depth)
      ctx.globalCompositeOperation = 'lighter'
      const fall = Math.min(260, h - hy)
      ctx.globalAlpha = Math.min(1, A * 0.4 * fl)
      ctx.drawImage(blobs[2], -w * 0.2, hy, w * 1.4, fall * 0.55)
    }
    ctx.globalCompositeOperation = 'lighter'
    ctx.globalAlpha = Math.min(1, A * (0.3 + 0.55 * fl))
    ctx.drawImage(blobs[2], -w * 0.15, hy - 30, w * 1.3, 60)
    ctx.globalAlpha = Math.min(1, A * 0.42 * fl)
    ctx.drawImage(this.blob, w * 0.12, hy - 6, w * 0.76, 12)
    ctx.globalAlpha = 1
    ctx.globalCompositeOperation = 'source-over'
  }
}
