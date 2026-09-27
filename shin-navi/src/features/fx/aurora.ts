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
  update(fx: { aurora: AuroraKey; auroraT: number; gold: number }): Palette3 {
    if (fx.aurora !== this.target) {
      this.from = this.shownNoGold ?? this.shown
      this.target = fx.aurora
    }
    const base = blendPalette(this.from, PALETTE_RGB[this.target], fx.auroraT, 0)
    this.shownNoGold = base
    this.shown = fx.gold > 0 ? blendPalette(base, base, 1, fx.gold) : base
    return this.shown
  }
  private shownNoGold: Palette3 | null = null
  get key(): AuroraKey {
    return this.target
  }
}

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
  heat: number
  colors: Palette3
  spec: TierSpec
  variant: 'phone' | 'room'
}

type Blob = { x: number; y: number; rx: number; ry: number; sx: number; sy: number; fx: number; fy: number; ph: number; a: number; c: 0 | 1 | 2 }

// y is relative to the horizon (negative = above), rx relative to the width
const BLOBS: Blob[] = [
  { x: 0.24, y: -92, rx: 0.62, ry: 150, sx: 0.13, sy: 20, fx: 0.13, fy: 0.21, ph: 0, a: 0.95, c: 0 },
  { x: 0.76, y: -128, rx: 0.56, ry: 175, sx: 0.12, sy: 26, fx: 0.11, fy: 0.17, ph: 2.1, a: 0.85, c: 1 },
  { x: 0.5, y: -36, rx: 0.78, ry: 105, sx: 0.2, sy: 12, fx: 0.07, fy: 0.29, ph: 4.2, a: 0.8, c: 2 },
]

export class AuroraPainter {
  private blob = softDot(256)
  private curtain = curtainSprite(128, 320)
  private ramp = rampSprite(64)
  private blobTint: Tint[]
  private curtainTint: Tint[]

  constructor() {
    this.blobTint = [0, 1, 2].map(() => new Tint(this.blob, 0.5, 0.3))
    this.curtainTint = [0, 1, 2].map(() => new Tint(this.curtain, 1))
  }

  draw(ctx: CanvasRenderingContext2D, f: AuroraFrame, res: number): void {
    const { w, h, hy, t, heat, spec } = f
    ctx.setTransform(res, 0, 0, res, 0, 0)
    ctx.globalCompositeOperation = 'source-over'
    ctx.globalAlpha = 1
    ctx.clearRect(0, 0, w, h)
    if (f.k <= 0) return
    const A = easeOut(f.k) * f.bright * (1.05 + 0.3 * heat)
    const rise = (1 - easeOut(f.k)) * 80
    const room = f.variant === 'room'
    const blobs = this.blobTint.map((tn, i) => tn.set(f.colors[i]))
    const curtains = this.curtainTint.map((tn, i) => tn.set(f.colors[i]))
    ctx.globalCompositeOperation = 'lighter'

    type Placed = { img: HTMLCanvasElement; x: number; y: number; w: number; h: number; a: number; shear: number }
    const placed: Placed[] = []
    const vScale = room ? Math.max(1, (hy - 40) / 300) : 1

    // 1. colour masses floating above the floor
    for (let i = 0; i < Math.min(spec.blobs, BLOBS.length); i++) {
      const b = BLOBS[i]
      const cx = w * b.x + Math.sin(t * b.fx + b.ph) * w * b.sx
      const cy = hy + b.y * vScale + Math.sin(t * b.fy + b.ph * 1.3) * b.sy + rise
      const rx = w * b.rx * (1 + 0.08 * Math.sin(t * 0.17 + b.ph)) * (room ? 0.75 : 1)
      const ry = b.ry * vScale * (0.85 + 0.35 * heat) * (1 + 0.1 * Math.sin(t * 0.23 + b.ph))
      const a = A * b.a * (0.78 + 0.22 * Math.sin(t * 0.31 + b.ph))
      placed.push({ img: blobs[b.c], x: cx - rx, y: cy - ry, w: rx * 2, h: ry * 2, a, shear: 0 })
    }

    // 2. curtains rising from the horizon, swaying
    const n = spec.curtains
    for (let j = 0; j < n; j++) {
      const u = (j + 0.5) / n
      const x = w * (0.06 + 0.88 * u) + Math.sin(t * 0.19 + j * 1.7) * w * 0.07
      const hh = (170 + 80 * Math.sin(t * 0.27 + j * 2.1)) * (0.8 + 0.5 * heat) * vScale
      const ww = (room ? 130 : 58) + (room ? 40 : 26) * Math.sin(t * 0.33 + j)
      const pulse = 0.5 + 0.5 * Math.sin(t * 0.41 + j * 1.3)
      const a = A * (0.42 + 0.6 * pulse * pulse)
      const shear = 0.18 * Math.sin(t * 0.23 + j * 0.9)
      placed.push({ img: curtains[j % 3], x: x - ww / 2, y: hy - hh + rise, w: ww, h: hh, a, shear })
    }

    // x' = x + shear·(y − bottom) sways a curtain around its foot
    const Q = 0.42
    const drawOne = (p: Placed) => {
      ctx.globalAlpha = Math.min(1, p.a)
      if (p.shear) ctx.setTransform(res, 0, p.shear * res, res, -p.shear * (p.y + p.h) * res, 0)
      ctx.drawImage(p.img, p.x, p.y, p.w, p.h)
      if (p.shear) ctx.setTransform(res, 0, 0, res, 0, 0)
    }

    for (const p of placed) drawOne(p)

    // 3. the ball's own halo on the wall
    const halo = f.br * 2.3
    ctx.globalAlpha = Math.min(1, A * 0.55)
    ctx.drawImage(blobs[1], f.bx - halo, f.by - halo, halo * 2, halo * 2)
    ctx.globalAlpha = Math.min(1, A * 0.3)
    ctx.drawImage(blobs[0], f.bx - halo * 1.5, f.by - halo * 0.9, halo * 3, halo * 1.8)

    // 4. the floor: the wall mirrored and squashed below the horizon (one self-copy of the
    //    band above the floor, like a glossy floor) + a bright band along the horizon
    const cvs = ctx.canvas as HTMLCanvasElement | undefined
    if (hy < h && cvs && typeof cvs.width === 'number') {
      const band = Math.min(hy, 220)
      const sy = Math.max(0, Math.floor((hy - band) * res))
      const sh = Math.max(1, Math.floor(hy * res) - sy)
      if (sh > 1 && sy + sh <= cvs.height) {
        ctx.setTransform(1, 0, 0, -Q, 0, hy * res * (1 + Q))
        ctx.globalAlpha = 0.34
        ctx.drawImage(cvs, 0, sy, cvs.width, sh, 0, sy, cvs.width, sh)
        ctx.setTransform(res, 0, 0, res, 0, 0)
        // the reflection dissolves with depth instead of ending in an edge
        ctx.globalCompositeOperation = 'destination-out'
        ctx.globalAlpha = 1
        const depth = band * Q
        ctx.drawImage(this.ramp, 0, hy + 2, w, depth)
        ctx.fillStyle = '#000'
        ctx.fillRect(0, hy + depth, w, h - hy - depth)
        ctx.globalCompositeOperation = 'lighter'
      }
      const fall = Math.min(260, h - hy)
      ctx.globalAlpha = Math.min(1, A * 0.45)
      ctx.drawImage(blobs[2], -w * 0.2, hy, w * 1.4, fall * 0.55)
    }
    ctx.globalAlpha = Math.min(1, A * 0.9)
    ctx.drawImage(blobs[2], -w * 0.15, hy - 30, w * 1.3, 60)
    ctx.globalAlpha = Math.min(1, A * 0.55)
    ctx.drawImage(this.blob, w * 0.1, hy - 7, w * 0.8, 14)
    ctx.globalAlpha = 1
    ctx.globalCompositeOperation = 'source-over'
  }
}
