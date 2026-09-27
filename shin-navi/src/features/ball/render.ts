// Canvas2D mirror-ball painter (SPEC K-11, D-3). Pure drawing: the controller owns time,
// rotation and state; this file turns a Scene + a camera into pixels.
//
// Look (the lead's approved prototype, moved onto the D-2 geometry):
// * every tile is a flat mirror: its colour is a lookup of three moving coloured stage lights in
//   the direction the tile reflects the camera ray, with per-tile brightness and angle jitter;
// * a key light sweeps a white highlight across the tiles; bright tiles throw star glints;
// * lit faces: sketch = silver outline + faint area tint, neon = area colour with a pre-rendered
//   glow, mirror = dazzling silver, prism = hue cycling rainbow;
// * rim darkening, coloured back-light and halo are pre-rendered sprites (no per-frame gradients,
//   no shadowBlur, no ctx.filter).
//
// Raster cost (QA ROBUST#2): the big balls live in a canvas 1.5× their diameter, so every
// full-square sprite blit is expensive in software raster. The sphere sprites (base, rim + sheen
// merged into one "shade") are blitted only over the ball's own square, the glass band on lit
// faces is a pattern fill (no per-tile clip mask), and the static halo can be painted once into
// a separate canvas behind the ball (Frame.halo = false, see paintHalo).
import { BANDS, BAND_DLAT, LAT_MAX, TILE_COUNT } from './layout'
import type { BallView } from './hit'

export const K_SMOKE = 0
export const K_CHROME = 1
export const K_SKETCH = 2
export const K_NEON = 3
export const K_MIRROR = 4
export const K_PRISM = 5

export const MARK_BIT = { key: 1, stitch: 2, duet: 4, seal: 8, visa: 16, gold: 32, navi: 64, twin: 128 } as const
/** D-6: a sleeping face (60+ days since last sung) wears a small moon; nothing else changes */
export const MOON_BIT = 256

export type Scene = {
  kind: Uint8Array
  /** face colour per tile (area colour, or the reserver's colour on the room ball) */
  rgb: Uint8Array
  marks: Uint16Array
  keyShift: Int8Array
  /** 0..1 white flash */
  flash: Float32Array
  /** 0..1 extra glow in the face colour (pulses, drag pre-glow) */
  glow: Float32Array
  /** 0..1 outline (area highlight) */
  outline: Float32Array
  /** 0..1 darken (zoomed card view: everything outside the area) */
  mute: Float32Array
  outlineRgb: [number, number, number]
  links: { a: number; b: number; p: number }[]
  groups: number[][] | null
  pins: { color: string; slot: number; s: number }[]
  rings: { tile: number; p: number }[]
  beams: { tile: number; p: number; len: number }[]
  /** 0..1 all-tile white flash (short intro) */
  flashAll: number
  /** 0..1 how much the record chips' highlight dims everything else (links, groups, pins) */
  dim: number
}

export function createScene(): Scene {
  const n = TILE_COUNT
  return {
    kind: new Uint8Array(n),
    rgb: new Uint8Array(n * 3).fill(200),
    marks: new Uint16Array(n),
    keyShift: new Int8Array(n),
    flash: new Float32Array(n),
    glow: new Float32Array(n),
    outline: new Float32Array(n),
    mute: new Float32Array(n),
    outlineRgb: [125, 249, 255],
    links: [],
    groups: null,
    pins: [],
    rings: [],
    beams: [],
    flashAll: 0,
    dim: 0,
  }
}

export type Frame = {
  view: BallView
  /** seconds (drives the stage lights and the key-light sweep) */
  t: number
  /** canvas size in css px */
  w: number
  h: number
  dpr: number
  /** 0 mini (dock), 1 zoomed card view, 2 full */
  detail: 0 | 1 | 2
  /** 0..1 halo strength (grows with the collection) */
  glowLevel: number
  /** extra brightness 0..1 (first tap flash) */
  boost: number
  /** mood palette mixed into the stage lights */
  palette: [number, number, number][]
  paletteMix: number
  /** gold tint 0..1 */
  gold: number
  /** overall light level (1 = normal) */
  exposure?: number
  /** lower quality tiers: no bloom, no glass bands, fewer glints ("no specular") */
  lite?: boolean
  /** false: the halo is painted once into its own canvas behind the ball (paintHalo) */
  halo?: boolean
}

// ---------------------------------------------------------------- geometry

const RAD = Math.PI / 180
const N = TILE_COUNT
/** decorative cap rings (not faces): 6 tiles 72°→81° at each pole */
const CAP_TILES = 6
const NT = N + CAP_TILES * 2
const CAP_EDGE = 81

type Geo = {
  r: number
  gapPx: number
  /** corner unit vectors, 4 per tile × xyz */
  corners: Float32Array
  centers: Float32Array
  /** approx on-screen size of a tile facing the camera (css px) */
  size: Float32Array
  jit: Float32Array
  njx: Float32Array
  njy: Float32Array
  /** cap disc outlines (lat 81°) north and south, 16 points each */
  capN: Float32Array
  capS: Float32Array
}

function hash(i: number): number {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453
  return x - Math.floor(x)
}

function unit(out: Float32Array, o: number, latDeg: number, lonDeg: number) {
  const la = latDeg * RAD
  const lo = lonDeg * RAD
  out[o] = Math.cos(la) * Math.sin(lo)
  out[o + 1] = Math.sin(la)
  out[o + 2] = Math.cos(la) * Math.cos(lo)
}

function buildGeo(r: number, gapPx: number): Geo {
  const corners = new Float32Array(NT * 12)
  const centers = new Float32Array(NT * 3)
  const size = new Float32Array(NT)
  const jit = new Float32Array(NT)
  const njx = new Float32Array(NT)
  const njy = new Float32Array(NT)
  const g = gapPx / 2 / r / RAD // half gap, degrees of arc
  const put = (i: number, top: number, bot: number, lon0: number, lon1: number) => {
    const clat = (top + bot) / 2
    const glon = g / Math.max(0.2, Math.cos(clat * RAD))
    const la = [top - g, top - g, bot + g, bot + g]
    const lo = [lon0 + glon, lon1 - glon, lon1 - glon, lon0 + glon]
    for (let c = 0; c < 4; c++) unit(corners, i * 12 + c * 3, la[c], lo[c])
    unit(centers, i * 3, clat, (lon0 + lon1) / 2)
    size[i] = r * Math.min(Math.abs(top - bot), (lon1 - lon0) * Math.cos(clat * RAD)) * RAD
    jit[i] = 0.55 + hash(i) * 0.9
    njx[i] = (hash(i + 1000) - 0.5) * 0.26
    njy[i] = (hash(i + 2000) - 0.5) * 0.26
  }
  let i = 0
  BANDS.forEach((count, b) => {
    const top = LAT_MAX - BAND_DLAT * b
    const bot = top - BAND_DLAT
    const d = 360 / count
    for (let k = 0; k < count; k++) put(i++, top, bot, -180 + d * k, -180 + d * (k + 1))
  })
  const dc = 360 / CAP_TILES
  for (let k = 0; k < CAP_TILES; k++) put(i++, CAP_EDGE, LAT_MAX, -180 + dc * k + dc / 2, -180 + dc * (k + 1) + dc / 2)
  for (let k = 0; k < CAP_TILES; k++) put(i++, -LAT_MAX, -CAP_EDGE, -180 + dc * k, -180 + dc * (k + 1))
  const ring = (lat: number) => {
    const a = new Float32Array(16 * 3)
    for (let k = 0; k < 16; k++) unit(a, k * 3, lat, (k * 360) / 16)
    return a
  }
  return { r, gapPx, corners, centers, size, jit, njx, njy, capN: ring(CAP_EDGE + 0.6), capS: ring(-CAP_EDGE - 0.6) }
}

// ---------------------------------------------------------------- sprites (pre-rendered once)

function mkCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return c
}

let SPR: {
  halo: HTMLCanvasElement
  base: HTMLCanvasElement
  /** rim darkening + back-light crescents + edge, with the window sheen on top (one blit) */
  shade: HTMLCanvasElement
  star: HTMLCanvasElement
  beam: HTMLCanvasElement
  band: HTMLCanvasElement
} | null = null

/** Sprites are drawn for a unit ball of radius R_SPR inside a canvas of S_SPR. */
const S_SPR = 512
const R_SPR = 170

function sprites() {
  if (SPR) return SPR
  const c = S_SPR / 2
  // halo: soft lavender glow behind the ball
  const halo = mkCanvas(S_SPR, S_SPR)
  {
    const x = halo.getContext('2d')!
    const gr = x.createRadialGradient(c, c, R_SPR * 0.55, c, c, R_SPR * 1.5)
    gr.addColorStop(0, 'rgba(200,180,255,0.55)')
    gr.addColorStop(0.35, 'rgba(160,120,255,0.22)')
    gr.addColorStop(0.7, 'rgba(120,80,220,0.07)')
    gr.addColorStop(1, 'rgba(0,0,0,0)')
    x.fillStyle = gr
    x.fillRect(0, 0, S_SPR, S_SPR)
  }
  // base: the dark sphere seen through the grout between tiles
  const base = mkCanvas(S_SPR, S_SPR)
  {
    const x = base.getContext('2d')!
    const gr = x.createRadialGradient(c - R_SPR * 0.35, c - R_SPR * 0.4, R_SPR * 0.05, c, c, R_SPR)
    gr.addColorStop(0, '#2c2748')
    gr.addColorStop(0.7, '#110e24')
    gr.addColorStop(1, '#050414')
    x.fillStyle = gr
    x.beginPath()
    x.arc(c, c, R_SPR + 0.5, 0, Math.PI * 2)
    x.fill()
  }
  // rim: limb darkening + coloured back-light crescents + fine outer edge
  const rim = mkCanvas(S_SPR, S_SPR)
  {
    const x = rim.getContext('2d')!
    x.save()
    x.beginPath()
    x.arc(c, c, R_SPR, 0, Math.PI * 2)
    x.clip()
    const gr = x.createRadialGradient(c + R_SPR * 0.12, c + R_SPR * 0.1, R_SPR * 0.5, c, c, R_SPR)
    gr.addColorStop(0, 'rgba(6,4,22,0)')
    gr.addColorStop(0.6, 'rgba(6,4,22,0.14)')
    gr.addColorStop(0.88, 'rgba(6,4,22,0.42)')
    gr.addColorStop(1, 'rgba(4,2,16,0.8)')
    x.fillStyle = gr
    x.fillRect(0, 0, S_SPR, S_SPR)
    // back-light: magenta from the left, cyan from the right (faked blur = stacked strokes)
    const glowArc = (a0: number, a1: number, rgb: string) => {
      for (let k = 0; k < 7; k++) {
        x.strokeStyle = `rgba(${rgb},${0.09 + k * 0.035})`
        x.lineWidth = 16 - k * 2.1
        x.beginPath()
        x.arc(c, c, R_SPR - 1, a0 + k * 0.06, a1 - k * 0.06)
        x.stroke()
      }
    }
    glowArc(Math.PI * 0.62, Math.PI * 1.28, '255,70,180')
    glowArc(-Math.PI * 0.32, Math.PI * 0.3, '70,230,255')
    x.restore()
    x.strokeStyle = 'rgba(215,205,255,0.45)'
    x.lineWidth = 1.6
    x.beginPath()
    x.arc(c, c, R_SPR, 0, Math.PI * 2)
    x.stroke()
  }
  // sheen: soft window reflection, top left
  const sheen = mkCanvas(S_SPR, S_SPR)
  {
    const x = sheen.getContext('2d')!
    const hx = c - R_SPR * 0.4
    const hy = c - R_SPR * 0.45
    const gr = x.createRadialGradient(hx, hy, 0, hx, hy, R_SPR * 0.75)
    gr.addColorStop(0, 'rgba(255,255,255,0.32)')
    gr.addColorStop(0.4, 'rgba(255,255,255,0.1)')
    gr.addColorStop(1, 'rgba(255,255,255,0)')
    x.save()
    x.beginPath()
    x.arc(c, c, R_SPR, 0, Math.PI * 2)
    x.clip()
    x.fillStyle = gr
    x.fillRect(0, 0, S_SPR, S_SPR)
    x.restore()
  }
  // star glint: two long thin rays and a hot core
  const star = mkCanvas(64, 64)
  {
    const x = star.getContext('2d')!
    const ray = (vertical: boolean) => {
      const gr = vertical ? x.createLinearGradient(32, 0, 32, 64) : x.createLinearGradient(0, 32, 64, 32)
      gr.addColorStop(0, 'rgba(255,255,255,0)')
      gr.addColorStop(0.5, 'rgba(255,255,255,1)')
      gr.addColorStop(1, 'rgba(255,255,255,0)')
      x.fillStyle = gr
      x.beginPath()
      if (vertical) {
        x.moveTo(32, 0)
        x.lineTo(33.4, 32)
        x.lineTo(32, 64)
        x.lineTo(30.6, 32)
      } else {
        x.moveTo(0, 32)
        x.lineTo(32, 30.6)
        x.lineTo(64, 32)
        x.lineTo(32, 33.4)
      }
      x.closePath()
      x.fill()
    }
    ray(false)
    ray(true)
    const core = x.createRadialGradient(32, 32, 0, 32, 32, 12)
    core.addColorStop(0, 'rgba(255,255,255,1)')
    core.addColorStop(0.3, 'rgba(255,250,235,0.55)')
    core.addColorStop(1, 'rgba(255,255,255,0)')
    x.fillStyle = core
    x.fillRect(0, 0, 64, 64)
  }
  // beam: a light shaft fading out along +x
  const beam = mkCanvas(256, 32)
  {
    const x = beam.getContext('2d')!
    const gr = x.createLinearGradient(0, 0, 256, 0)
    gr.addColorStop(0, 'rgba(255,255,255,0.95)')
    gr.addColorStop(0.25, 'rgba(235,240,255,0.5)')
    gr.addColorStop(1, 'rgba(220,230,255,0)')
    x.fillStyle = gr
    x.beginPath()
    x.moveTo(0, 15)
    x.lineTo(256, 4)
    x.lineTo(256, 28)
    x.lineTo(0, 17)
    x.closePath()
    x.fill()
    x.globalCompositeOperation = 'destination-in'
    const v = x.createLinearGradient(0, 0, 0, 32)
    v.addColorStop(0, 'rgba(0,0,0,0)')
    v.addColorStop(0.5, 'rgba(0,0,0,1)')
    v.addColorStop(1, 'rgba(0,0,0,0)')
    x.fillStyle = v
    x.fillRect(0, 0, 256, 32)
  }
  // band: a diagonal glassy highlight for lit faces
  const band = mkCanvas(96, 48)
  {
    const x = band.getContext('2d')!
    const gr = x.createLinearGradient(0, 0, 96, 24)
    gr.addColorStop(0, 'rgba(255,255,255,0)')
    gr.addColorStop(0.36, 'rgba(255,255,255,0)')
    gr.addColorStop(0.47, 'rgba(255,255,255,0.75)')
    gr.addColorStop(0.53, 'rgba(255,255,255,0.35)')
    gr.addColorStop(0.62, 'rgba(255,255,255,0)')
    gr.addColorStop(1, 'rgba(255,255,255,0)')
    x.fillStyle = gr
    x.fillRect(0, 0, 96, 48)
  }
  // rim and sheen are always drawn together (rim, then sheen at 0.85): pre-composite them
  const shade = mkCanvas(S_SPR, S_SPR)
  {
    const x = shade.getContext('2d')!
    x.drawImage(rim, 0, 0)
    x.globalAlpha = 0.85
    x.drawImage(sheen, 0, 0)
  }
  SPR = { halo, base, shade, star, beam, band }
  return SPR
}

/** Sprite square that holds the sphere (base / shade): the ball plus its 16 px back-light. */
const SPR_BALL0 = S_SPR / 2 - R_SPR - 10
const SPR_BALLW = (R_SPR + 10) * 2

/**
 * The halo behind a ball, painted once (it only changes with the canvas size and the collection's
 * glow). Used by the controller for a static canvas under the animated one.
 */
export function paintHalo(ctx: CanvasRenderingContext2D, w: number, h: number, dpr: number, r: number, alpha: number): void {
  const S = sprites()
  const k = r / R_SPR
  const ss = S_SPR * k
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height)
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.globalAlpha = Math.max(0, Math.min(1, alpha))
  ctx.drawImage(S.halo, w / 2 - ss / 2, h / 2 - ss / 2, ss, ss)
  ctx.globalAlpha = 1
}

/** Glow of the halo for a collection level (0..1): what draw() uses when it paints the halo itself. */
export const haloAlpha = (glowLevel: number, mini: boolean): number => Math.min(1, (mini ? 0.35 : 0.5) + glowLevel * 0.5)

const bandPatterns = new WeakMap<CanvasRenderingContext2D, CanvasPattern | null>()
let bandMatrix: DOMMatrix | null = null

const glowCache = new Map<string, HTMLCanvasElement>()
/** Radial glow in one colour, 64px, pre-rendered once per colour. */
export function glowSprite(r: number, g: number, b: number): HTMLCanvasElement {
  const key = `${r},${g},${b}`
  let c = glowCache.get(key)
  if (!c) {
    c = mkCanvas(64, 64)
    const x = c.getContext('2d')!
    const gr = x.createRadialGradient(32, 32, 0, 32, 32, 32)
    gr.addColorStop(0, `rgba(${Math.min(255, r + 60)},${Math.min(255, g + 60)},${Math.min(255, b + 60)},1)`)
    gr.addColorStop(0.28, `rgba(${r},${g},${b},0.55)`)
    gr.addColorStop(0.6, `rgba(${r},${g},${b},0.16)`)
    gr.addColorStop(1, `rgba(${r},${g},${b},0)`)
    x.fillStyle = gr
    x.fillRect(0, 0, 64, 64)
    glowCache.set(key, c)
  }
  return c
}

// ---------------------------------------------------------------- colour helpers

const colorCache = new Map<number, string>()
function rgbStr(r: number, g: number, b: number): string {
  const R = r < 0 ? 0 : r > 255 ? 63 : r >> 2
  const G = g < 0 ? 0 : g > 255 ? 63 : g >> 2
  const B = b < 0 ? 0 : b > 255 ? 63 : b >> 2
  const k = (R << 12) | (G << 6) | B
  let s = colorCache.get(k)
  if (!s) {
    s = `rgb(${R * 4 + (R >> 4)},${G * 4 + (G >> 4)},${B * 4 + (B >> 4)})`
    colorCache.set(k, s)
  }
  return s
}

/** hue (deg) → rgb at full saturation, lightness l (0..1). */
export function hueRgb(h: number, l: number, out: number[]): void {
  const hh = (((h % 360) + 360) % 360) / 60
  const c = (1 - Math.abs(2 * l - 1)) * 1
  const x = c * (1 - Math.abs((hh % 2) - 1))
  const m = l - c / 2
  let r = 0
  let g = 0
  let b = 0
  if (hh < 1) {
    r = c
    g = x
  } else if (hh < 2) {
    r = x
    g = c
  } else if (hh < 3) {
    g = c
    b = x
  } else if (hh < 4) {
    g = x
    b = c
  } else if (hh < 5) {
    r = x
    b = c
  } else {
    r = c
    b = x
  }
  out[0] = (r + m) * 255
  out[1] = (g + m) * 255
  out[2] = (b + m) * 255
}

export function hexRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (m) {
    const n = parseInt(m[1], 16)
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
  }
  const hsl = /hsl\(\s*([\d.]+)[ ,]+([\d.]+)%[ ,]+([\d.]+)%/i.exec(hex)
  if (hsl) {
    const h = Number(hsl[1])
    const s = Number(hsl[2]) / 100
    const l = Number(hsl[3]) / 100
    const a = s * Math.min(l, 1 - l)
    const f = (k0: number) => {
      const k = (k0 + h / 30) % 12
      return Math.round((l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))) * 255)
    }
    return [f(0), f(8), f(4)]
  }
  return [220, 220, 235]
}

// ---------------------------------------------------------------- stage lights

// Three coloured stage lights (pink, cyan, warm) drifting slowly around the room.
const LIGHT_DIR = [
  [-0.6, 0.6, 0.5],
  [0.7, 0.2, 0.6],
  [0.0, 0.8, 0.6],
  [0.25, -0.75, 0.6],
]
const LIGHT_RGB = [
  [255, 60, 170],
  [60, 230, 255],
  [228, 196, 136],
  [150, 90, 255],
]
const LIGHT_SPEED = [0.23, -0.17, 0.11, 0.07]
const NL = 4

// ---------------------------------------------------------------- painter

const PIN_SLOTS = 10
const PIN_LAT = 78.5

export class BallPainter {
  private geo: Geo
  /** projected tile centres of the last frame (css px of the canvas) and depth */
  readonly px = new Float32Array(NT)
  readonly py = new Float32Array(NT)
  readonly pz = new Float32Array(NT)
  /** screen size of each tile in the last frame */
  readonly ps = new Float32Array(NT)
  /** bright front tiles of the last frame (for glints / emitters): indices sorted by brightness */
  readonly bright: number[] = []
  private lx = new Float32Array(NL)
  private ly = new Float32Array(NL)
  private lz = new Float32Array(NL)
  private lr = new Float32Array(NL)
  private lg = new Float32Array(NL)
  private lb = new Float32Array(NL)
  private tmp = [0, 0, 0]
  // per-frame scratch lists (indices)
  private sGlow: number[] = []
  private sGlint: number[] = []
  private sGlintA: number[] = []
  private sMarks: number[] = []
  private sOutline: number[] = []
  private sBloom: number[] = []
  private bevel: number[] = []
  private pinOrder: { p: Scene['pins'][number]; x: number; y: number; z: number }[] = []
  private sBloomC: number[] = []
  private lum = new Float32Array(NT)
  /** per-tile light factor of the last frame (1 - mute): glows, glints and marks follow it */
  private vis = new Float32Array(NT)
  /** ms spent in the last draw */
  lastMs = 0

  constructor(r: number, gapPx = 0.8) {
    this.geo = buildGeo(r, gapPx)
  }

  get r(): number {
    return this.geo.r
  }

  resize(r: number, gapPx = this.geo.gapPx): void {
    if (Math.abs(r - this.geo.r) > 0.01 || gapPx !== this.geo.gapPx) this.geo = buildGeo(r, gapPx)
  }

  private setupLights(f: Frame) {
    const mix = f.paletteMix
    for (let k = 0; k < NL; k++) {
      const a = f.t * LIGHT_SPEED[k]
      const ca = Math.cos(a)
      const sa = Math.sin(a)
      const d = LIGHT_DIR[k]
      this.lx[k] = d[0] * ca - d[2] * sa
      this.ly[k] = d[1]
      this.lz[k] = d[0] * sa + d[2] * ca
      const p = f.palette[k] ?? LIGHT_RGB[k]
      const boost = (1 + f.boost * 0.6) * (k === 3 ? 0.75 : 1) * (f.exposure ?? 1)
      let r = LIGHT_RGB[k][0] * (1 - mix) + p[0] * mix
      let g = LIGHT_RGB[k][1] * (1 - mix) + p[1] * mix
      let b = LIGHT_RGB[k][2] * (1 - mix) + p[2] * mix
      if (f.gold > 0) {
        r = r * (1 - f.gold) + 255 * f.gold
        g = g * (1 - f.gold) + 200 * f.gold
        b = b * (1 - f.gold) + 90 * f.gold
      }
      this.lr[k] = r * boost
      this.lg[k] = g * boost
      this.lb[k] = b * boost
    }
  }

  /** Draw one frame. ctx must be un-transformed; the painter applies dpr. */
  draw(ctx: CanvasRenderingContext2D, s: Scene, f: Frame): void {
    const t0 = performance.now()
    const S = sprites()
    const g = this.geo
    const { cx, cy, rot, tilt } = f.view
    const r = g.r
    const dpr = f.dpr
    const full = f.detail === 2
    const mini = f.detail === 0
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.globalCompositeOperation = 'source-over'
    ctx.globalAlpha = 1
    this.setupLights(f)

    // sprite placement: sprites are drawn for radius R_SPR inside S_SPR
    const k = r / R_SPR
    const sx = cx - (S_SPR / 2) * k
    const sy = cy - (S_SPR / 2) * k
    const ss = S_SPR * k

    if (f.halo !== false && (!mini || f.glowLevel > 0)) {
      ctx.globalAlpha = haloAlpha(f.glowLevel, mini)
      ctx.drawImage(S.halo, sx, sy, ss, ss)
      ctx.globalAlpha = 1
    }
    // the sphere sprites only cover the ball: blit just that square of them
    const bk = ss / S_SPR
    const bx0 = sx + SPR_BALL0 * bk
    const by0 = sy + SPR_BALL0 * bk
    const bw = SPR_BALLW * bk
    const sphere = this.sphereSprites(bw, dpr)
    this.blitSphere(ctx, sphere?.base ?? null, S.base, bx0, by0, bw, dpr)
    let band: CanvasPattern | null | undefined = null
    if (!mini && !f.lite) {
      band = bandPatterns.get(ctx)
      if (band === undefined) {
        band = typeof DOMMatrix !== 'undefined' ? ctx.createPattern(S.band, 'no-repeat') : null
        bandPatterns.set(ctx, band)
      }
      if (band && !bandMatrix) bandMatrix = new DOMMatrix()
    }

    const cR = Math.cos(rot)
    const sR = Math.sin(rot)
    const ct = Math.cos(tilt)
    const st = Math.sin(tilt)
    // key light (lambert) and the sweeping highlight direction H
    let kx = Math.sin(f.t * 0.9) * 0.55 - 0.3
    let ky = 0.55
    let kz = 0.78
    let kl = Math.hypot(kx, ky, kz)
    kx /= kl
    ky /= kl
    kz /= kl
    let hx = Math.sin(f.t * 0.37) * 0.7
    let hy = 0.35 + Math.cos(f.t * 0.23) * 0.25
    let hz = 0.8
    kl = Math.hypot(hx, hy, hz)
    hx /= kl
    hy /= kl
    hz /= kl

    const { corners, centers, size, jit, njx, njy } = g
    const W = f.w
    const H = f.h
    const margin = r * 0.3
    const lx = this.lx
    const ly = this.ly
    const lz = this.lz
    const glows = this.sGlow
    const glints = this.sGlint
    const glintA = this.sGlintA
    const marks = this.sMarks
    const outl = this.sOutline
    const bloom = this.sBloom
    const bloomC = this.sBloomC
    bloom.length = 0
    bloomC.length = 0
    const bevel = this.bevel
    bevel.length = 0
    glows.length = 0
    glints.length = 0
    glintA.length = 0
    marks.length = 0
    outl.length = 0
    this.bright.length = 0
    const tmp = this.tmp
    const flashAll = s.flashAll
    const cull = mini ? 0.03 : 0.14
    const shoulder = f.detail === 1 ? 50 : 85
    const bevelOn = !mini && !f.lite

    for (let i = 0; i < NT; i++) {
      const c3 = i * 3
      const x0 = centers[c3]
      const y0 = centers[c3 + 1]
      const z0 = centers[c3 + 2]
      const x1 = x0 * cR + z0 * sR
      const z1 = z0 * cR - x0 * sR
      const y2 = y0 * ct - z1 * st
      const z2 = y0 * st + z1 * ct
      const X = cx + x1 * r
      const Y = cy - y2 * r
      this.px[i] = X
      this.py[i] = Y
      this.pz[i] = z2
      this.lum[i] = 0
      this.vis[i] = i < N ? 1 - s.mute[i] : 1
      // tiles in the outer ~1.5 % of the radius are slivers under the rim darkening: ~13 % of the
      // visible tiles for ~3 % of the disc, so they are not worth a path fill each
      if (z2 < cull) continue
      if (X < -margin || X > W + margin || Y < -margin || Y > H + margin) continue
      this.ps[i] = size[i] * Math.sqrt(z2)

      // normal with the tile's own small tilt (real mirrors are glued slightly off-angle)
      let nx = x1 + njx[i]
      let ny = y2 + njy[i]
      let nz = z2
      const nl = 1 / Math.hypot(nx, ny, nz)
      nx *= nl
      ny *= nl
      nz *= nl
      // reflected view ray
      const rx = 2 * nz * nx
      const ry = 2 * nz * ny
      const rz = 2 * nz * nz - 1
      let er = 18
      let eg = 14
      let eb = 36
      for (let q = 0; q < NL; q++) {
        const d = rx * lx[q] + ry * ly[q] + rz * lz[q]
        if (d > 0) {
          const d2 = d * d
          const kk = d2 * d2 * d2 * 1.1 + d * 0.15
          er += this.lr[q] * kk
          eg += this.lg[q] * kk
          eb += this.lb[q] * kk
        }
      }
      const lam = Math.max(0, nx * kx + ny * ky + nz * kz)
      const sd = rx * hx + ry * hy + rz * hz
      let spec = 0
      if (sd > 0.6) {
        const s2 = sd * sd
        const s4 = s2 * s2
        const s8 = s4 * s4
        spec = s8 * s8 * s4 * s2 // ^22
      }
      // a zoomed card shows a few big tiles: the key light's sweep would turn one into a flat
      // white square there, so it only tints them
      if (f.detail === 1) spec *= 0.4
      const j = jit[i]
      const face = i < N ? s.kind[i] : K_SMOKE
      let R: number
      let G: number
      let B: number
      let stroke: string | null = null
      if (face === K_SMOKE) {
        const kk = (0.3 + lam * 0.2) * j + spec * 0.55
        R = 48 + er * kk + spec * 120
        G = 46 + eg * kk + spec * 120
        B = 66 + eb * kk + spec * 120
      } else if (face === K_CHROME) {
        const kk = (0.52 + lam * 0.3) * j + spec * 0.6
        R = 92 + er * kk + spec * 200
        G = 94 + eg * kk + spec * 200
        B = 110 + eb * kk + spec * 200
      } else {
        const ar = s.rgb[c3]
        const ag = s.rgb[c3 + 1]
        const ab = s.rgb[c3 + 2]
        if (face === K_SKETCH) {
          const kk = (0.3 + lam * 0.2) * j + spec * 0.5
          R = (48 + er * kk) * 0.72 + ar * 0.3 + spec * 90
          G = (46 + eg * kk) * 0.72 + ag * 0.3 + spec * 90
          B = (66 + eb * kk) * 0.72 + ab * 0.3 + spec * 90
          stroke = 'rgba(236,240,255,0.9)'
        } else if (face === K_NEON) {
          // lit from inside: the area colour stays saturated, reflections only add a little white
          const kk = 0.9 + lam * 0.2
          const w = spec * 70 + (er + eg + eb) * 0.012
          R = ar * kk + w
          G = ag * kk + w
          B = ab * kk + w
          glows.push(i)
        } else if (face === K_MIRROR) {
          // polished silver: bright, but keeps the colour of what it reflects (soft tone-map)
          const kk = (0.8 + lam * 0.3) * (0.8 + j * 0.3)
          R = 255 * (1 - Math.exp(-(84 + er * kk + spec * 320 + ar * 0.16) / 175))
          G = 255 * (1 - Math.exp(-(84 + eg * kk + spec * 320 + ag * 0.16) / 175))
          B = 255 * (1 - Math.exp(-(98 + eb * kk + spec * 320 + ab * 0.16) / 175))
          if (sd > 0.35) glows.push(i)
        } else {
          hueRgb(i * 29 + f.t * 110, 0.58 + lam * 0.12 + spec * 0.25, tmp)
          R = tmp[0]
          G = tmp[1]
          B = tmp[2]
          glows.push(i)
        }
      }
      if (face <= K_SKETCH) {
        // soft shoulder: bright reflections keep their colour instead of clipping to paper white
        // (on the big tiles of a zoomed card the shoulder tops out at silver)
        if (R > 170) R = 170 + shoulder * (1 - Math.exp(-(R - 170) / shoulder))
        if (G > 170) G = 170 + shoulder * (1 - Math.exp(-(G - 170) / shoulder))
        if (B > 170) B = 170 + shoulder * (1 - Math.exp(-(B - 170) / shoulder))
      }
      if (i < N && s.mute[i] > 0) {
        const m = 1 - s.mute[i]
        R *= m
        G *= m
        B *= m
      }
      const fl = i < N ? Math.max(s.flash[i], flashAll) : flashAll
      if (fl > 0) {
        R += (255 - R) * fl
        G += (255 - G) * fl
        B += (255 - B) * fl
      }
      const lum = (R * 0.3 + G * 0.55 + B * 0.15) / 255
      this.lum[i] = lum
      const vis = this.vis[i]
      // glints: the brightest mirrors at the moment
      if (!mini && vis > 0.5 && (spec > 0.5 || (face >= K_MIRROR && spec > 0.18) || (face === K_CHROME && lum > 0.82)) && glints.length < (f.lite ? 6 : 14)) {
        glints.push(i)
        glintA.push(Math.min(1, spec * (face >= K_MIRROR ? 1.4 : 1) + (face === K_CHROME ? lum - 0.6 : 0)))
      }
      if (i < N && vis > 0.5 && (face === K_MIRROR || face === K_PRISM || lum > 0.7)) this.bright.push(i)
      // bright reflections bloom a little (what a camera sees on a real mirror ball)
      if (!mini && !f.lite && face <= K_SKETCH && lum > 0.6 && bloom.length < 16) {
        bloom.push(i)
        bloomC.push(((Math.min(255, R) >> 6) << 16) | ((Math.min(255, G) >> 6) << 8) | (Math.min(255, B) >> 6))
      }

      const fade = z2 < 0.42 ? z2 * 2.4 : 1
      ctx.globalAlpha = fade
      ctx.fillStyle = rgbStr(R, G, B)
      const o = i * 12
      let x0b = 1e9
      let x1b = -1e9
      let y0b = 1e9
      let y1b = -1e9
      ctx.beginPath()
      for (let c = 0; c < 4; c++) {
        const p = o + c * 3
        const ax = corners[p]
        const ay = corners[p + 1]
        const az = corners[p + 2]
        const bx = ax * cR + az * sR
        const bz = az * cR - ax * sR
        const by = ay * ct - bz * st
        const qx = cx + bx * r
        const qy = cy - by * r
        if (c < 2 && bevelOn && z2 > 0.3) bevel.push(qx, qy)
        if (qx < x0b) x0b = qx
        if (qx > x1b) x1b = qx
        if (qy < y0b) y0b = qy
        if (qy > y1b) y1b = qy
        if (c === 0) ctx.moveTo(qx, qy)
        else ctx.lineTo(qx, qy)
      }
      ctx.closePath()
      ctx.fill()
      // lit faces are glass: a light band slides across them as the ball turns. The band is a
      // no-repeat pattern placed per tile and filled into the tile's own path (no clip mask).
      if (band && bandMatrix && face >= K_NEON && z2 > 0.12 && vis > 0.05) {
        const w = x1b - x0b
        const h = y1b - y0b
        const ph = (X - cx) / r + j * 0.35
        // pattern space → the tile's box (in the same css px user space as the path)
        const m = bandMatrix
        m.a = (w * 2.4) / 96
        m.b = 0
        m.c = 0
        m.d = (h * 1.2) / 48
        m.e = x0b - w * (1.1 + ph * 0.9)
        m.f = y0b - h * 0.1
        band.setTransform(m)
        ctx.globalAlpha = fade * (face === K_NEON ? 0.5 : 0.7) * vis
        ctx.fillStyle = band
        ctx.fill()
        ctx.globalAlpha = fade
      }
      if (stroke && !mini && vis > 0.02) {
        ctx.globalAlpha = fade * vis
        ctx.strokeStyle = stroke
        ctx.lineWidth = f.detail === 1 ? 1.6 : 1
        ctx.stroke()
      }
      if (i < N) {
        if (s.marks[i] && !mini && z2 > 0.25) marks.push(i)
        if (s.outline[i] > 0.01) outl.push(i)
        if (s.glow[i] > 0.01 && face !== K_NEON && face !== K_PRISM && !(face === K_MIRROR && sd > 0.35)) glows.push(i)
      }
    }
    ctx.globalAlpha = 1
    // bevelled mirror edges catch the light: every top edge in one stroke
    if (bevel.length) {
      ctx.beginPath()
      for (let k = 0; k < bevel.length; k += 4) {
        ctx.moveTo(bevel[k], bevel[k + 1])
        ctx.lineTo(bevel[k + 2], bevel[k + 3])
      }
      ctx.strokeStyle = 'rgba(255,255,255,0.2)'
      ctx.lineWidth = f.detail === 1 ? 1.2 : 0.7
      ctx.stroke()
    }

    // ---- caps: dark metal discs at the poles (north carries the hanger and the pins)
    this.drawCap(ctx, g.capS, f, false)
    this.drawCap(ctx, g.capN, f, true)

    // ---- marks (D-3 刻印)
    if (marks.length) this.drawMarks(ctx, s, f, marks)

    // ---- area outlines
    if (outl.length) {
      const [or, og, ob] = s.outlineRgb
      ctx.lineJoin = 'round'
      for (const i of outl) {
        const z = this.pz[i]
        if (z < 0.03) continue
        ctx.globalAlpha = Math.min(1, s.outline[i]) * Math.min(1, z * 2.4)
        ctx.strokeStyle = `rgb(${or},${og},${ob})`
        ctx.lineWidth = f.detail === 1 ? 2.2 : 1.4
        this.tilePath(ctx, i, cR, sR, ct, st, cx, cy, r)
        ctx.stroke()
      }
      ctx.globalAlpha = 1
    }

    // ---- rim darkening + back-light + sheen (one pre-composited sprite, ball square only)
    this.blitSphere(ctx, sphere?.shade ?? null, S.shade, bx0, by0, bw, dpr)

    // ---- additive light
    ctx.globalCompositeOperation = 'lighter'
    // record: connected link groups painted as one faint shape (D-5)
    if (s.groups && full && s.dim < 0.999) this.drawGroups(ctx, s.groups, 1 - s.dim)
    for (let n = 0; n < bloom.length; n++) {
      const i = bloom[n]
      const c = bloomC[n]
      const sz = this.ps[i] * 1.9
      ctx.globalAlpha = Math.min(0.55, (this.lum[i] - 0.6) * 1.8) * Math.min(1, this.pz[i] * 2) * this.vis[i]
      ctx.drawImage(glowSprite(((c >> 16) & 3) * 85, ((c >> 8) & 3) * 85, (c & 3) * 85), this.px[i] - sz / 2, this.py[i] - sz / 2, sz, sz)
    }
    for (const i of glows) {
      const z = this.pz[i]
      const face = s.kind[i]
      const c3 = i * 3
      let a = face === K_NEON ? 0.95 : face === K_PRISM ? 0.65 : face === K_MIRROR ? 0.42 : 0
      a = Math.max(a * this.vis[i], s.glow[i] * 0.9)
      a *= Math.min(1, z * 1.6)
      if (a <= 0.01) continue
      let spr: HTMLCanvasElement
      if (face === K_PRISM) {
        hueRgb(i * 29 + f.t * 110, 0.62, tmp)
        spr = glowSprite((tmp[0] >> 6) * 85, (tmp[1] >> 6) * 85, (tmp[2] >> 6) * 85)
      } else if (face === K_MIRROR && s.glow[i] < 0.05) spr = glowSprite(235, 240, 255)
      else spr = glowSprite(s.rgb[c3], s.rgb[c3 + 1], s.rgb[c3 + 2])
      const sz = this.ps[i] * (mini ? 2.6 : face === K_NEON ? 3.9 : 3.0) * (1 + s.glow[i] * 0.4)
      ctx.globalAlpha = Math.min(1, a)
      ctx.drawImage(spr, this.px[i] - sz / 2, this.py[i] - sz / 2, sz, sz)
    }
    // white flashes bloom
    for (let i = 0; i < N; i++) {
      const fl = s.flash[i]
      if (fl < 0.02 || this.pz[i] < 0.05) continue
      const sz = this.ps[i] * (2.2 + fl * 2.6)
      ctx.globalAlpha = Math.min(1, fl)
      ctx.drawImage(glowSprite(255, 255, 255), this.px[i] - sz / 2, this.py[i] - sz / 2, sz, sz)
    }
    // glints
    if (!mini) {
      const gs = Math.max(12, r * 0.3)
      for (let n = 0; n < glints.length; n++) {
        const i = glints[n]
        const a = glintA[n]
        if (a < 0.05) continue
        const tw = 0.75 + 0.25 * Math.sin(f.t * 9 + i * 1.7)
        const sz = gs * (0.45 + a * 0.75) * tw
        ctx.globalAlpha = Math.min(1, a) * Math.min(1, this.pz[i] * 2)
        ctx.drawImage(S.star, this.px[i] - sz / 2, this.py[i] - sz / 2, sz, sz)
      }
    }
    // beams thrown by mirror faces (D-3)
    if (s.beams.length && full) {
      for (const bm of s.beams) {
        const i = bm.tile
        const z = this.pz[i]
        if (z < 0.2) continue
        let dx = this.px[i] - cx
        let dy = this.py[i] - cy
        const dl = Math.hypot(dx, dy)
        if (dl < r * 0.08) {
          dx = 0.6
          dy = -0.8
        } else {
          dx /= dl
          dy /= dl
        }
        const env = Math.sin(Math.PI * Math.min(1, bm.p))
        const len = r * bm.len * (0.6 + 0.4 * bm.p)
        ctx.globalAlpha = env * 0.75 * Math.min(1, z * 1.5)
        ctx.setTransform(dpr * dx, dpr * dy, -dpr * dy, dpr * dx, dpr * this.px[i], dpr * this.py[i])
        ctx.drawImage(S.beam, 0, -r * 0.05, len, r * 0.1)
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      }
    }
    // links (D-5): light lines that turn with the ball and vanish on the back
    // (under a record chip's highlight they stay as a faint 20 % trace)
    if (s.links.length && !mini) this.drawLinks(ctx, s, f, cR, sR, ct, st)
    // prism rings (D-14)
    if (s.rings.length) {
      for (const rg of s.rings) {
        const i = rg.tile
        if (this.pz[i] < 0.05) continue
        const rad = this.ps[i] * (0.6 + rg.p * 3.4)
        const a = (1 - rg.p) * Math.min(1, this.pz[i] * 2)
        ctx.lineWidth = 3
        for (let q = 0; q < 6; q++) {
          hueRgb(q * 60 + f.t * 200, 0.62, tmp)
          ctx.globalAlpha = a
          ctx.strokeStyle = rgbStr(tmp[0], tmp[1], tmp[2])
          ctx.beginPath()
          ctx.arc(this.px[i], this.py[i], rad, (q * Math.PI) / 3, ((q + 1) * Math.PI) / 3 + 0.05)
          ctx.stroke()
        }
      }
    }
    ctx.globalCompositeOperation = 'source-over'
    ctx.globalAlpha = 1

    // pins stuck at the hanging ring (D-10)
    if (s.pins.length && !mini) this.drawPins(ctx, s, f, cR, sR, ct, st)

    this.bright.sort((a, b) => this.lum[b] * this.pz[b] - this.lum[a] * this.pz[a])
    this.lastMs = performance.now() - t0
  }

  /**
   * The base and shade sprites pre-scaled to this ball's exact device-pixel size (made once per
   * size): a 1:1 blit is a plain blend, a scaled one resamples every pixel — in software raster
   * that was ~40 % of a hero frame.
   */
  private sphereSprites(bw: number, dpr: number): { base: HTMLCanvasElement; shade: HTMLCanvasElement; px: number } | null {
    const px = Math.round(bw * dpr)
    if (px < 8 || px > 1024) return null
    const c = this.sphere
    if (c && c.px === px) return c
    const S = sprites()
    const mk = (src: HTMLCanvasElement) => {
      const cv = mkCanvas(px, px)
      const x = cv.getContext('2d')
      if (!x) return cv
      x.imageSmoothingQuality = 'high'
      x.drawImage(src, SPR_BALL0, SPR_BALL0, SPR_BALLW, SPR_BALLW, 0, 0, px, px)
      return cv
    }
    this.sphere = { base: mk(S.base), shade: mk(S.shade), px }
    return this.sphere
  }
  private sphere: { base: HTMLCanvasElement; shade: HTMLCanvasElement; px: number } | null = null

  /** 1:1 on the device pixel grid when the pre-scaled sprite exists, else a scaled blit. */
  private blitSphere(ctx: CanvasRenderingContext2D, pre: HTMLCanvasElement | null, src: HTMLCanvasElement, x: number, y: number, w: number, dpr: number) {
    if (!pre) {
      ctx.drawImage(src, SPR_BALL0, SPR_BALL0, SPR_BALLW, SPR_BALLW, x, y, w, w)
      return
    }
    // centre the pre-scaled square on the ball, snapped to whole device pixels
    const cx = (x + w / 2) * dpr
    const cy = (y + w / 2) * dpr
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.drawImage(pre, Math.round(cx - pre.width / 2), Math.round(cy - pre.height / 2))
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  }

  tilePath(ctx: CanvasRenderingContext2D, i: number, cR: number, sR: number, ct: number, st: number, cx: number, cy: number, r: number): void {
    const corners = this.geo.corners
    const o = i * 12
    ctx.beginPath()
    for (let c = 0; c < 4; c++) {
      const p = o + c * 3
      const ax = corners[p]
      const ay = corners[p + 1]
      const az = corners[p + 2]
      const bx = ax * cR + az * sR
      const bz = az * cR - ax * sR
      const by = ay * ct - bz * st
      if (c === 0) ctx.moveTo(cx + bx * r, cy - by * r)
      else ctx.lineTo(cx + bx * r, cy - by * r)
    }
    ctx.closePath()
  }

  /** projected corner c (0..3) of tile i under the last frame's camera */
  private corner(i: number, c: number, cR: number, sR: number, ct: number, st: number, cx: number, cy: number, r: number, out: number[]) {
    const p = i * 12 + c * 3
    const corners = this.geo.corners
    const ax = corners[p]
    const ay = corners[p + 1]
    const az = corners[p + 2]
    const bx = ax * cR + az * sR
    const bz = az * cR - ax * sR
    const by = ay * ct - bz * st
    out[0] = cx + bx * r
    out[1] = cy - by * r
  }

  private drawCap(ctx: CanvasRenderingContext2D, ring: Float32Array, f: Frame, north: boolean) {
    const { cx, cy, rot, tilt } = f.view
    const r = this.geo.r
    const cR = Math.cos(rot)
    const sR = Math.sin(rot)
    const ct = Math.cos(tilt)
    const st = Math.sin(tilt)
    // pole depth
    const pz = north ? st : -st
    if (pz < -0.2) return
    ctx.beginPath()
    for (let k = 0; k < 16; k++) {
      const ax = ring[k * 3]
      const ay = ring[k * 3 + 1]
      const az = ring[k * 3 + 2]
      const bx = ax * cR + az * sR
      const bz = az * cR - ax * sR
      const by = ay * ct - bz * st
      if (k === 0) ctx.moveTo(cx + bx * r, cy - by * r)
      else ctx.lineTo(cx + bx * r, cy - by * r)
    }
    ctx.closePath()
    ctx.fillStyle = north ? '#1b1733' : '#120f25'
    ctx.fill()
    if (!north || f.detail === 0) return
    // hanger: a small chrome ring at the pole
    const px = cx
    const py = cy - ct * r
    const rr = Math.max(1.6, r * 0.065)
    ctx.strokeStyle = 'rgba(230,228,245,0.85)'
    ctx.lineWidth = Math.max(1, r * 0.018)
    ctx.beginPath()
    ctx.ellipse(px, py, rr, rr * Math.max(0.25, st), 0, 0, Math.PI * 2)
    ctx.stroke()
    ctx.fillStyle = 'rgba(255,255,255,0.55)'
    ctx.beginPath()
    ctx.arc(px - rr * 0.45, py - rr * 0.12, Math.max(0.6, rr * 0.22), 0, Math.PI * 2)
    ctx.fill()
  }

  private drawPins(ctx: CanvasRenderingContext2D, s: Scene, f: Frame, cR: number, sR: number, ct: number, st: number) {
    const { cx, cy } = f.view
    const r = this.geo.r
    const la = PIN_LAT * RAD
    const cl = Math.cos(la)
    const sl = Math.sin(la)
    const base = Math.max(1.6, r * 0.034)
    // back pins first
    const order = this.pinOrder
    order.length = s.pins.length
    s.pins.forEach((p, k) => {
      const lo = (p.slot / PIN_SLOTS) * Math.PI * 2
      const x0 = cl * Math.sin(lo)
      const z0 = cl * Math.cos(lo)
      const x1 = x0 * cR + z0 * sR
      const z1 = z0 * cR - x0 * sR
      const y2 = sl * ct - z1 * st
      const z2 = sl * st + z1 * ct
      const o = order[k] ?? (order[k] = { p, x: 0, y: 0, z: 0 })
      o.p = p
      o.x = cx + x1 * r
      o.y = cy - y2 * r
      o.z = z2
    })
    order.sort((a, b) => a.z - b.z)
    for (const o of order) {
      const vis = Math.max(0.35, Math.min(1, 0.6 + o.z * 3))
      const rad = base * (0.6 + 0.4 * vis) * o.p.s
      if (rad < 0.3) continue
      ctx.globalAlpha = vis
      ctx.fillStyle = 'rgba(8,6,20,0.8)'
      ctx.beginPath()
      ctx.arc(o.x, o.y + rad * 0.35, rad * 1.05, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = o.p.color
      ctx.beginPath()
      ctx.arc(o.x, o.y, rad, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = 'rgba(255,255,255,0.85)'
      ctx.beginPath()
      ctx.arc(o.x - rad * 0.35, o.y - rad * 0.38, rad * 0.32, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.globalAlpha = 1
  }

  private drawMarks(ctx: CanvasRenderingContext2D, s: Scene, f: Frame, list: number[]) {
    const { cx, cy, rot, tilt } = f.view
    const r = this.geo.r
    const cR = Math.cos(rot)
    const sR = Math.sin(rot)
    const ct = Math.cos(tilt)
    const st = Math.sin(tilt)
    const a = [0, 0]
    const b = [0, 0]
    const c = [0, 0]
    const d = [0, 0]
    const zoom = f.detail === 1
    for (const i of list) {
      const m = s.marks[i]
      const z = this.pz[i]
      const size = this.ps[i]
      if (size < 7 || this.vis[i] < 0.05) continue
      ctx.globalAlpha = Math.min(1, (z - 0.25) * 3) * this.vis[i]
      this.corner(i, 0, cR, sR, ct, st, cx, cy, r, a) // top-left
      this.corner(i, 1, cR, sR, ct, st, cx, cy, r, b) // top-right
      this.corner(i, 2, cR, sR, ct, st, cx, cy, r, c) // bottom-right
      this.corner(i, 3, cR, sR, ct, st, cx, cy, r, d) // bottom-left
      const X = this.px[i]
      const Y = this.py[i]
      const toward = (p: number[], k: number): [number, number] => [p[0] + (X - p[0]) * k, p[1] + (Y - p[1]) * k]
      const dot = Math.max(1.1, size * 0.09)
      if (m & MARK_BIT.duet) {
        // the face splits into two colours
        ctx.fillStyle = 'rgba(255,111,177,0.62)'
        ctx.beginPath()
        ctx.moveTo(b[0], b[1])
        ctx.lineTo(c[0], c[1])
        ctx.lineTo(d[0], d[1])
        ctx.closePath()
        ctx.fill()
      }
      if (m & MARK_BIT.gold) {
        ctx.strokeStyle = '#FFD36B'
        ctx.lineWidth = zoom ? 2.4 : 1.5
        ctx.beginPath()
        ctx.moveTo(a[0], a[1])
        ctx.lineTo(b[0], b[1])
        ctx.lineTo(c[0], c[1])
        ctx.lineTo(d[0], d[1])
        ctx.closePath()
        ctx.stroke()
      }
      if (m & MARK_BIT.stitch) {
        const p = toward(d, 0.22)
        const q = toward(c, 0.22)
        ctx.strokeStyle = 'rgba(255,255,255,0.9)'
        ctx.lineWidth = 0.9
        ctx.setLineDash([1.6, 1.4])
        ctx.beginPath()
        ctx.moveTo(p[0], p[1])
        ctx.lineTo(q[0], q[1])
        ctx.stroke()
        ctx.setLineDash([])
      }
      if (m & MARK_BIT.navi) {
        const p = toward(b, 0.28)
        ctx.fillStyle = '#FFD36B'
        ctx.beginPath()
        ctx.arc(p[0], p[1], dot * 1.1, 0, Math.PI * 2)
        ctx.fill()
      }
      if (m & MARK_BIT.seal) {
        const p = toward(c, 0.3)
        ctx.fillStyle = '#C8203F'
        ctx.beginPath()
        ctx.arc(p[0], p[1], dot * 1.35, 0, Math.PI * 2)
        ctx.fill()
        ctx.fillStyle = 'rgba(255,190,200,0.8)'
        ctx.beginPath()
        ctx.arc(p[0] - dot * 0.3, p[1] - dot * 0.3, dot * 0.45, 0, Math.PI * 2)
        ctx.fill()
      }
      if (m & MARK_BIT.visa) {
        const p = toward(d, 0.3)
        const w = dot * 3
        ctx.strokeStyle = '#7DF9FF'
        ctx.lineWidth = 0.9
        ctx.strokeRect(p[0] - w / 2, p[1] - w * 0.35, w, w * 0.7)
      }
      if (m & MARK_BIT.twin) {
        ctx.fillStyle = 'rgba(255,255,255,0.95)'
        ctx.beginPath()
        ctx.arc(X - dot * 1.3, Y + size * 0.18, dot * 0.8, 0, Math.PI * 2)
        ctx.arc(X + dot * 1.3, Y + size * 0.18, dot * 0.8, 0, Math.PI * 2)
        ctx.fill()
      }
      if (m & MOON_BIT) {
        // a small crescent: a thick arc with round ends
        const p = toward(b, 0.5)
        const mr = Math.max(1.8, size * 0.14)
        ctx.strokeStyle = '#FFF1B8'
        ctx.lineCap = 'round'
        ctx.lineWidth = mr * 0.62
        ctx.beginPath()
        ctx.arc(p[0], p[1] + size * 0.12, mr * 0.72, Math.PI * 0.55, Math.PI * 1.75)
        ctx.stroke()
        ctx.lineCap = 'butt'
      }
      if (m & MARK_BIT.key && size >= 11) {
        const p = toward(a, 0.3)
        const ks = s.keyShift[i]
        ctx.fillStyle = '#FFFFFF'
        ctx.font = `800 ${Math.max(6, Math.round(size * 0.3))}px system-ui, sans-serif`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(`${ks < 0 ? '♭' : '♯'}${Math.abs(ks) || ''}`, p[0], p[1])
      }
    }
    ctx.globalAlpha = 1
  }

  private drawLinks(ctx: CanvasRenderingContext2D, s: Scene, f: Frame, cR: number, sR: number, ct: number, st: number) {
    const { cx, cy } = f.view
    const la = 1 - s.dim * 0.8
    const r = this.geo.r * 1.004
    const C = this.geo.centers
    const SEG = 14
    for (const L of s.links) {
      const a = L.a * 3
      const b = L.b * 3
      const ax = C[a]
      const ay = C[a + 1]
      const az = C[a + 2]
      const bx = C[b]
      const by = C[b + 1]
      const bz = C[b + 2]
      const dot = Math.max(-1, Math.min(1, ax * bx + ay * by + az * bz))
      const om = Math.acos(dot)
      const so = Math.sin(om) || 1
      const segs = Math.max(2, Math.round(SEG * Math.min(1, L.p)))
      let px = 0
      let py = 0
      let pz = 0
      for (let k = 0; k <= segs; k++) {
        const u = (k / SEG) * (om > 1e-4 ? 1 : 0)
        const w1 = om > 1e-4 ? Math.sin((1 - u) * om) / so : 1
        const w2 = om > 1e-4 ? Math.sin(u * om) / so : 0
        const x0 = ax * w1 + bx * w2
        const y0 = ay * w1 + by * w2
        const z0 = az * w1 + bz * w2
        const x1 = x0 * cR + z0 * sR
        const z1 = z0 * cR - x0 * sR
        const y2 = y0 * ct - z1 * st
        const z2 = y0 * st + z1 * ct
        const X = cx + x1 * r
        const Y = cy - y2 * r
        if (k > 0) {
          const zz = Math.min(pz, z2)
          if (zz > 0.08) {
            const al = Math.min(1, (zz - 0.08) * 3) * la
            ctx.globalAlpha = al * 0.3
            ctx.strokeStyle = 'rgb(125,249,255)'
            ctx.lineWidth = f.detail === 1 ? 5 : 2.8
            ctx.beginPath()
            ctx.moveTo(px, py)
            ctx.lineTo(X, Y)
            ctx.stroke()
            ctx.globalAlpha = al
            ctx.strokeStyle = 'rgb(225,252,255)'
            ctx.lineWidth = f.detail === 1 ? 1.6 : 1
            ctx.stroke()
          }
        }
        px = X
        py = Y
        pz = z2
      }
      // endpoint nodes
      if (L.p > 0.05) {
        const node = Math.max(5, this.ps[L.a] * 0.7)
        for (const i of L.p >= 1 ? [L.a, L.b] : [L.a]) {
          const z = this.pz[i]
          if (z < 0.1) continue
          ctx.globalAlpha = Math.min(1, z * 2) * 0.9 * la
          ctx.drawImage(glowSprite(160, 250, 255), this.px[i] - node / 2, this.py[i] - node / 2, node, node)
        }
      }
    }
    ctx.globalAlpha = 1
  }

  private drawGroups(ctx: CanvasRenderingContext2D, groups: number[][], alpha: number) {
    for (const gr of groups) {
      const pts: [number, number][] = []
      let ok = true
      for (const i of gr) {
        if (this.pz[i] < 0.1) {
          ok = false
          break
        }
        pts.push([this.px[i], this.py[i]])
      }
      if (!ok || pts.length < 3) continue
      const hull = convexHull(pts)
      ctx.globalAlpha = 0.07 * alpha
      ctx.fillStyle = 'rgb(160,235,255)'
      ctx.beginPath()
      hull.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y)))
      ctx.closePath()
      ctx.fill()
    }
    ctx.globalAlpha = 1
  }
}

export function convexHull(p: [number, number][]): [number, number][] {
  const pts = [...p].sort((a, b) => a[0] - b[0] || a[1] - b[1])
  if (pts.length < 3) return pts
  const cross = (o: [number, number], a: [number, number], b: [number, number]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const lower: [number, number][] = []
  for (const q of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop()
    lower.push(q)
  }
  const upper: [number, number][] = []
  for (let i = pts.length - 1; i >= 0; i--) {
    const q = pts[i]
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop()
    upper.push(q)
  }
  upper.pop()
  lower.pop()
  return lower.concat(upper)
}
