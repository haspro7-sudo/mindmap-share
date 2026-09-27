// Pre-rendered sprites (SPEC K-11): every gradient is painted once here, never per frame or per
// particle. Canvases then only drawImage these with transforms, alpha and additive blending.
// Colour changes (palette crossfades, gold) re-tint a slot's own small canvas, and only on the
// frames where the colour actually changed.

export type RGB = [number, number, number]

export function hexToRgb(hex: string): RGB {
  let h = hex.trim().replace('#', '')
  if (h.length === 3) h = h.split('').map(c => c + c).join('')
  const n = parseInt(h.slice(0, 6), 16)
  if (!Number.isFinite(n)) return [255, 255, 255]
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

export const rgbCss = (c: RGB, a = 1): string => (a >= 1 ? `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})` : `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`)

export const mixRgb = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]

/** Lighten towards white (for speck tints). */
export const lighten = (c: RGB, t: number): RGB => mixRgb(c, [255, 255, 255], t)

function mk(w: number, h = w): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return c
}

const cache = new Map<string, HTMLCanvasElement>()
function once(key: string, make: () => HTMLCanvasElement): HTMLCanvasElement {
  let c = cache.get(key)
  if (!c) cache.set(key, (c = make()))
  return c
}

/** White radial falloff with a smooth (gaussian-like) profile. Alpha carries the shape. */
export function softDot(px = 256): HTMLCanvasElement {
  return once(`dot|${px}`, () => {
    const c = mk(px)
    const g = c.getContext('2d')!
    const r = px / 2
    const grad = g.createRadialGradient(r, r, 0, r, r, r)
    for (let i = 0; i <= 8; i++) {
      const x = i / 8
      grad.addColorStop(x, `rgba(255,255,255,${Math.exp(-x * x * 4.2) * (1 - x) ** 0.5})`)
    }
    g.fillStyle = grad
    g.fillRect(0, 0, px, px)
    return c
  })
}

/** A light spot: a crisp bright disc inside a soft halo (a mirror-ball reflection on a wall). */
export function speckDot(px = 48): HTMLCanvasElement {
  return once(`speck|${px}`, () => {
    const c = mk(px)
    const g = c.getContext('2d')!
    const r = px / 2
    const grad = g.createRadialGradient(r, r, 0, r, r, r)
    grad.addColorStop(0, 'rgba(255,255,255,1)')
    grad.addColorStop(0.14, 'rgba(255,255,255,1)')
    grad.addColorStop(0.2, 'rgba(255,255,255,0.55)')
    grad.addColorStop(0.42, 'rgba(255,255,255,0.18)')
    grad.addColorStop(0.7, 'rgba(255,255,255,0.05)')
    grad.addColorStop(1, 'rgba(255,255,255,0)')
    g.fillStyle = grad
    g.fillRect(0, 0, px, px)
    return c
  })
}

/** Four-point glint for the brightest specks. */
export function glintSprite(px = 64): HTMLCanvasElement {
  return once(`glint|${px}`, () => {
    const c = mk(px)
    const g = c.getContext('2d')!
    const r = px / 2
    const arm = (horizontal: boolean) => {
      const lg = horizontal ? g.createLinearGradient(0, r, px, r) : g.createLinearGradient(r, 0, r, px)
      lg.addColorStop(0, 'rgba(255,255,255,0)')
      lg.addColorStop(0.5, 'rgba(255,255,255,0.9)')
      lg.addColorStop(1, 'rgba(255,255,255,0)')
      g.fillStyle = lg
      if (horizontal) g.fillRect(0, r - 0.9, px, 1.8)
      else g.fillRect(r - 0.9, 0, 1.8, px)
    }
    arm(true)
    arm(false)
    const core = g.createRadialGradient(r, r, 0, r, r, r * 0.35)
    core.addColorStop(0, 'rgba(255,255,255,1)')
    core.addColorStop(1, 'rgba(255,255,255,0)')
    g.fillStyle = core
    g.fillRect(0, 0, px, px)
    return c
  })
}

/**
 * Aurora curtain: fine vertical rays (fixed pseudo-noise), brightest at the foot (the horizon),
 * dissolving upwards and soft at the sides.
 */
export function curtainSprite(w = 128, h = 320): HTMLCanvasElement {
  return once(`curtain|${w}x${h}`, () => {
    const c = mk(w, h)
    const g = c.getContext('2d')!
    // smoothed value noise → striations
    const knots = Array.from({ length: 24 }, (_, i) => {
      const v = Math.sin(i * 12.9898 + 78.233) * 43758.5453
      return v - Math.floor(v)
    })
    const noise = (u: number) => {
      const x = u * (knots.length - 1)
      const i = Math.floor(x)
      const f = x - i
      const a = knots[i]
      const b = knots[Math.min(knots.length - 1, i + 1)]
      return a + (b - a) * (f * f * (3 - 2 * f))
    }
    for (let x = 0; x < w; x++) {
      const u = x / (w - 1)
      const d = (u - 0.5) * 2
      const env = Math.exp(-d * d * 2.6)
      const rays = 0.35 + 0.65 * Math.pow(noise(u), 1.6) + 0.15 * Math.sin(u * 71)
      g.fillStyle = `rgba(255,255,255,${Math.max(0, Math.min(1, env * rays))})`
      g.fillRect(x, 0, 1, h)
    }
    g.globalCompositeOperation = 'destination-in'
    const vt = g.createLinearGradient(0, 0, 0, h)
    vt.addColorStop(0, 'rgba(255,255,255,0)')
    vt.addColorStop(0.3, 'rgba(255,255,255,0.22)')
    vt.addColorStop(0.65, 'rgba(255,255,255,0.62)')
    vt.addColorStop(0.9, 'rgba(255,255,255,1)')
    vt.addColorStop(0.97, 'rgba(255,255,255,0.8)')
    vt.addColorStop(1, 'rgba(255,255,255,0)')
    g.fillStyle = vt
    g.fillRect(0, 0, w, h)
    return c
  })
}

/** A light shaft: starts bright at x=0 and fades along +x; soft across. */
export function beamSprite(w = 256, h = 32): HTMLCanvasElement {
  return once(`beam|${w}x${h}`, () => {
    const c = mk(w, h)
    const g = c.getContext('2d')!
    const vt = g.createLinearGradient(0, 0, 0, h)
    for (let i = 0; i <= 8; i++) {
      const y = i / 8
      const d = (y - 0.5) * 2
      vt.addColorStop(y, `rgba(255,255,255,${Math.exp(-d * d * 5)})`)
    }
    g.fillStyle = vt
    g.fillRect(0, 0, w, h)
    g.globalCompositeOperation = 'destination-in'
    const hz = g.createLinearGradient(0, 0, w, 0)
    hz.addColorStop(0, 'rgba(255,255,255,0.2)')
    hz.addColorStop(0.04, 'rgba(255,255,255,1)')
    hz.addColorStop(0.35, 'rgba(255,255,255,0.55)')
    hz.addColorStop(1, 'rgba(255,255,255,0)')
    g.fillStyle = hz
    g.fillRect(0, 0, w, h)
    return c
  })
}

/** A light cone: a narrow bright foot at x=0 widening and fading along +x (a ray in haze). */
export function coneSprite(w = 256, h = 64): HTMLCanvasElement {
  return once(`cone|${w}x${h}`, () => {
    const c = mk(w, h)
    const g = c.getContext('2d')!
    const img = g.createImageData(w, h)
    for (let x = 0; x < w; x++) {
      const u = x / (w - 1)
      const along = Math.min(1, u / 0.03) * Math.pow(1 - u, 1.25)
      const spread = (0.06 + 0.94 * u) * (h / 2)
      for (let y = 0; y < h; y++) {
        const d = (y - (h - 1) / 2) / spread
        const a = along * Math.exp(-d * d * 2.2)
        const i = (y * w + x) * 4
        img.data[i] = img.data[i + 1] = img.data[i + 2] = 255
        img.data[i + 3] = Math.round(Math.max(0, Math.min(1, a)) * 255)
      }
    }
    g.putImageData(img, 0, 0)
    return c
  })
}

/** Vertical ramp: transparent at the top, opaque at the bottom (used to fade reflections). */
export function rampSprite(h = 64): HTMLCanvasElement {
  return once(`ramp|${h}`, () => {
    const c = mk(4, h)
    const g = c.getContext('2d')!
    const vt = g.createLinearGradient(0, 0, 0, h)
    vt.addColorStop(0, 'rgba(255,255,255,0)')
    vt.addColorStop(0.55, 'rgba(255,255,255,0.55)')
    vt.addColorStop(1, 'rgba(255,255,255,1)')
    g.fillStyle = vt
    g.fillRect(0, 0, 4, h)
    return c
  })
}

/** Colour sprite cached by colour (static colours: bursts, member hues). */
export function glowSprite(color: string, px = 64): HTMLCanvasElement {
  return once(`glow|${color}|${px}`, () => {
    const c = mk(px)
    const g = c.getContext('2d')!
    g.drawImage(speckDot(px), 0, 0)
    g.globalCompositeOperation = 'source-in'
    g.fillStyle = color
    g.fillRect(0, 0, px, px)
    // keep a white-hot centre
    g.globalCompositeOperation = 'lighter'
    g.globalAlpha = 0.85
    g.drawImage(speckDot(px), px * 0.3, px * 0.3, px * 0.4, px * 0.4)
    return c
  })
}

/**
 * A slot that holds a tinted copy of a white sprite and re-tints only when its colour moves.
 * Used for the aurora blobs/curtains and the palette-tinted specks.
 */
export class Tint {
  readonly canvas: HTMLCanvasElement
  private g: CanvasRenderingContext2D
  private last: RGB = [-1, -1, -1]
  constructor(
    private base: HTMLCanvasElement,
    scale = 1,
    /** 0..1: how much white light burns in the middle (light looks luminous, not painted) */
    private core = 0,
  ) {
    this.canvas = mk(Math.max(1, Math.round(base.width * scale)), Math.max(1, Math.round(base.height * scale)))
    this.g = this.canvas.getContext('2d')!
  }
  set(c: RGB): HTMLCanvasElement {
    const l = this.last
    if (Math.abs(l[0] - c[0]) < 1.5 && Math.abs(l[1] - c[1]) < 1.5 && Math.abs(l[2] - c[2]) < 1.5) return this.canvas
    this.last = [c[0], c[1], c[2]]
    const { g, canvas } = this
    const W = canvas.width
    const H = canvas.height
    g.globalCompositeOperation = 'copy'
    g.globalAlpha = 1
    g.drawImage(this.base, 0, 0, W, H)
    g.globalCompositeOperation = 'source-in'
    g.fillStyle = rgbCss(c)
    g.fillRect(0, 0, W, H)
    if (this.core > 0) {
      // a whiter, smaller copy on top: the hot middle of the light
      g.globalCompositeOperation = 'lighter'
      g.globalAlpha = this.core
      g.drawImage(this.base, W * 0.2, H * 0.2, W * 0.6, H * 0.6)
      g.globalAlpha = 1
    }
    g.globalCompositeOperation = 'source-over'
    return canvas
  }
}
