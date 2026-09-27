// Light specks (SPEC A-1, B-2, D-4, K-11 L1): the mirror ball's reflections crawling over the
// walls, plus dust in the light, the long light streaks thrown by mirror faces, and the ripple a
// touch leaves. Specks ride a rigid "rotation" like real mirror-ball spots: they cross the wall
// in 12 s, flare as they pass the ball's centre line, and shrink towards the sides where the
// wall turns away. Everything is drawn from pre-rendered sprites with additive blending.
import { beamSprite, coneSprite, glintSprite, lighten, rgbCss, speckDot, softDot, Tint, type RGB } from './sprites'
import type { Palette3 } from './aurora'

export const LAP_MS = 12000
/** half-width of the visible arc (radians): spots wrap off-screen at ±100° */
export const ARC = 1.75
export const OMEGA = (2 * ARC) / LAP_MS // rad per ms

export type Speck = {
  lon: number
  lat: number
  z: number // 0..1 depth/brightness class
  tw: number
  twf: number
  hue: 0 | 1 | 2 | 3
  /** 0..1 presence (fades in on birth, out when dying) */
  alive: number
  dying: boolean
  /** transient specks (a face levelled up but the count did not grow) fade after a while */
  ttl: number
  /** launch: fly from (fx, fy) to the orbit position over launchMs */
  fx: number
  fy: number
  age: number
  launchMs: number
  kx: number
  ky: number
  glint: number
}

export type Streak = { x: number; y: number; ang: number; spin: number; len: number; w: number; age: number; dur: number; color: RGB }
export type Ring = { x: number; y: number; age: number; dur: number; r0: number; r1: number; w: number; color: RGB; a: number }
export type Mote = { x: number; y: number; vx: number; vy: number; tw: number; s: number; a: number }

export type FieldBox = { w: number; h: number; cx: number; cy: number; hy: number }

const wrapLon = (l: number) => {
  const span = ARC * 2
  let x = (l + ARC) % span
  if (x < 0) x += span
  return x - ARC
}
const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/** Where a speck sits on the wall (CSS px) and how visible/large it is there. */
export function project(s: Pick<Speck, 'lon' | 'lat'>, b: FieldBox, spread = 1): { x: number; y: number; vis: number; scale: number } {
  const sn = Math.sin(s.lon)
  const cs = Math.cos(s.lon)
  const spanX = b.w * 0.6 * spread
  const bow = 0.72 + 0.28 * cs
  const up = Math.max(80, b.cy - 12)
  const down = Math.max(80, b.h - b.cy)
  const sl = Math.sin(s.lat)
  const y = b.cy - sl * (sl >= 0 ? up : down) * bow * spread
  const vis = 1 - smoothstep(0.8, 0.985, Math.abs(sn))
  return { x: b.cx + sn * spanX, y, vis, scale: 0.6 + 0.4 * cs }
}

let seq = 0
/** Deterministic, evenly spread placement for the n-th speck (golden-ratio strata). */
export function placement(i: number): { lon: number; lat: number; z: number; hue: 0 | 1 | 2 | 3 } {
  const u = (i * 0.6180339887) % 1
  const v = (i * 0.7548776662 + 0.31) % 1
  // mostly the upper wall and ceiling (the floor is under the cards), a few on the floor
  const lat = Math.asin(-0.34 + 1.29 * v)
  const hue = (i % 9 < 5 ? 0 : 1 + (i % 3)) as 0 | 1 | 2 | 3
  return { lon: -ARC + u * ARC * 2, lat, z: (i * 0.4142135) % 1, hue }
}

export function makeSpeck(i: number, from: { x: number; y: number } | null, launchMs: number): Speck {
  const p = placement(i)
  return {
    lon: p.lon,
    lat: p.lat,
    z: p.z,
    tw: Math.random() * Math.PI * 2,
    twf: 0.0012 + Math.random() * 0.0022,
    hue: p.hue,
    alive: 0,
    dying: false,
    ttl: Infinity,
    fx: from?.x ?? NaN,
    fy: from?.y ?? NaN,
    age: 0,
    launchMs: from ? launchMs : 0,
    kx: 0,
    ky: 0,
    glint: 0,
  }
}

/**
 * Keep `list` at `target` living specks: adopt transient ones first, then add new specks from
 * the emitters; surplus specks fade out. Returns the number of living (non-dying) specks.
 */
export function syncCount(list: Speck[], target: number, emit: (i: number) => { x: number; y: number } | null, launchMs: number): number {
  let living = 0
  for (const s of list) if (!s.dying && s.ttl === Infinity) living++
  if (living < target) {
    for (const s of list) {
      if (living >= target) break
      if (!s.dying && s.ttl !== Infinity) {
        s.ttl = Infinity
        living++
      }
    }
    while (living < target) {
      list.push(makeSpeck(seq++, emit(living), launchMs))
      living++
    }
  } else if (living > target) {
    for (let i = list.length - 1; i >= 0 && living > target; i--) {
      const s = list[i]
      if (!s.dying && s.ttl === Infinity) {
        s.dying = true
        living--
      }
    }
  }
  return living
}

export type DrawFrame = {
  dpr: number
  /** entrance 0..1 for the whole layer */
  k: number
  flash: number
  gold: number
  palette: Palette3
  reduced: boolean
  /** extra spread while the lights come on (1 = none) */
  spread: number
}

const WARM: RGB = [255, 246, 216]
const GOLD: RGB = [255, 211, 107]

export class SpeckField {
  specks: Speck[] = []
  streaks: Streak[] = []
  rings: Ring[] = []
  motes: Mote[] = []
  box: FieldBox = { w: 390, h: 844, cx: 195, cy: 250, hy: 340 }
  private dot = speckDot(48)
  private glint = glintSprite(64)
  private beam = beamSprite(256, 32)
  private soft = softDot(64)
  private tints: Tint[] = [0, 1, 2, 3].map(() => new Tint(speckDot(48)))
  private beamTint = new Tint(coneSprite(256, 64))
  private streakClock = 0

  setBox(b: FieldBox): void {
    this.box = b
  }

  count(): number {
    let n = 0
    for (const s of this.specks) if (!s.dying && s.ttl === Infinity) n++
    return n
  }

  /** A face levelled up: one speck slides out from it (kept if the count grows, else fades). */
  spawnAt(x: number, y: number, keep: boolean): void {
    const s = makeSpeck(seq++, { x, y }, 900)
    s.ttl = keep ? Infinity : 2600
    s.glint = 1
    // pick a spot on the wall on the same side as the face, so it visibly slides outwards
    const side = x < this.box.cx ? -1 : 1
    s.lon = side * (0.35 + Math.random() * 0.9)
    this.specks.push(s)
  }

  streak(x: number, y: number, color: RGB, ang?: number, len?: number): void {
    const b = this.box
    const a = ang ?? Math.atan2(y - b.cy, x - b.cx) + (Math.random() - 0.5) * 0.9
    this.streaks.push({ x, y, ang: a, spin: (Math.random() < 0.5 ? -1 : 1) * (0.05 + Math.random() * 0.12), len: len ?? Math.hypot(b.w, b.h) * (0.55 + Math.random() * 0.35), w: 10 + Math.random() * 10, age: 0, dur: 1100, color })
  }

  ring(x: number, y: number, o: Partial<Ring> = {}): void {
    this.rings.push({ x, y, age: 0, dur: o.dur ?? 650, r0: o.r0 ?? 6, r1: o.r1 ?? 72, w: o.w ?? 2.2, color: o.color ?? WARM, a: o.a ?? 0.5 })
  }

  /** A touch: nearby specks are nudged outwards and glint; a faint ring spreads. */
  touch(x: number, y: number, color: RGB): void {
    this.ring(x, y, { color: lighten(color, 0.5), a: 0.42 })
    const b = this.box
    for (const s of this.specks) {
      const p = project(s, b)
      const dx = p.x + s.kx - x
      const dy = p.y + s.ky - y
      const d = Math.hypot(dx, dy)
      if (d < 130 && d > 0.1) {
        const f = (1 - d / 130) * 22
        s.kx += (dx / d) * f
        s.ky += (dy / d) * f
        s.glint = Math.max(s.glint, 1 - d / 130)
      }
    }
  }

  /** The room lights come on: a bloom from the ball, eight rays, every speck glints. */
  lightsOn(palette: Palette3): void {
    const b = this.box
    this.ring(b.cx, b.cy, { r0: 40, r1: Math.hypot(b.w, b.h) * 0.75, w: 26, dur: 900, a: 0.28, color: lighten(palette[1], 0.55) })
    this.ring(b.cx, b.cy, { r0: 30, r1: Math.hypot(b.w, b.h) * 0.45, w: 6, dur: 700, a: 0.5, color: WARM })
    const base = Math.random() * Math.PI
    for (let i = 0; i < 8; i++) {
      const c = i % 2 ? WARM : lighten(palette[i % 3], 0.35)
      this.streak(b.cx, b.cy, c, base + (i * Math.PI) / 4, Math.hypot(b.w, b.h) * 0.8)
    }
    for (const s of this.specks) s.glint = 1
  }

  initMotes(n: number): void {
    const b = this.box
    while (this.motes.length < n) {
      this.motes.push({ x: Math.random() * b.w, y: Math.random() * Math.max(60, b.hy + 60), vx: (Math.random() - 0.5) * 0.008, vy: -0.004 - Math.random() * 0.008, tw: Math.random() * 6.28, s: 1.4 + Math.random() * 2.4, a: 0.1 + Math.random() * 0.24 })
    }
    if (this.motes.length > n) this.motes.length = n
  }

  /** Advance the simulation (dt in ms). Returns whether anything is still moving. */
  step(dt: number, frozen: boolean, streakRate: number, emit: () => { x: number; y: number } | null, streakColor: RGB, maxStreaks: number): void {
    const b = this.box
    const kDecay = Math.exp(-dt / 260)
    for (let i = this.specks.length - 1; i >= 0; i--) {
      const s = this.specks[i]
      s.age += dt
      if (!frozen) {
        s.lon = wrapLon(s.lon + OMEGA * dt * (0.96 + 0.08 * s.z))
        s.tw += s.twf * dt
      }
      s.kx *= kDecay
      s.ky *= kDecay
      s.glint = Math.max(0, s.glint - dt / 700)
      if (s.ttl !== Infinity) {
        s.ttl -= dt
        if (s.ttl <= 0) s.dying = true
      }
      if (s.dying) {
        s.alive -= dt / 800
        if (s.alive <= 0) this.specks.splice(i, 1)
      } else s.alive = Math.min(1, s.alive + dt / (s.launchMs > 0 ? 250 : 500))
    }
    for (let i = this.streaks.length - 1; i >= 0; i--) {
      const st = this.streaks[i]
      st.age += dt
      if (!frozen) st.ang += st.spin * (dt / 1000)
      if (st.age >= st.dur) this.streaks.splice(i, 1)
    }
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i]
      r.age += dt
      if (r.age >= r.dur) this.rings.splice(i, 1)
    }
    if (!frozen) {
      for (const m of this.motes) {
        m.x += m.vx * dt
        m.y += m.vy * dt
        m.tw += dt * 0.0011
        if (m.y < -8) {
          m.y = Math.max(60, b.hy + 40)
          m.x = Math.random() * b.w
        }
        if (m.x < -8) m.x = b.w + 6
        else if (m.x > b.w + 8) m.x = -6
      }
      // mirror faces throw light streaks now and then (SPEC D-3: each face every 4 s, ≤ 6 at once)
      if (streakRate > 0 && maxStreaks > 0) {
        this.streakClock += dt * streakRate
        while (this.streakClock >= 4000) {
          this.streakClock -= 4000
          if (this.streaks.length < maxStreaks) {
            const o = emit()
            if (o) this.streak(o.x, o.y, streakColor)
          }
        }
      }
    }
  }

  draw(ctx: CanvasRenderingContext2D, f: DrawFrame): void {
    const b = this.box
    const { dpr } = f
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.globalCompositeOperation = 'source-over'
    ctx.globalAlpha = 1
    ctx.clearRect(0, 0, b.w, b.h)
    if (f.k <= 0 && !this.rings.length && !this.streaks.length) return
    ctx.globalCompositeOperation = 'lighter'
    const bright = 1 + f.flash // ×2 when the lights come on, back over 600 ms
    const tints = [lighten(f.palette[0], 0.2), lighten(f.palette[0], 0.55), lighten(f.palette[1], 0.5), lighten(f.palette[2], 0.5)].map((c, i) => this.tints[i].set(f.gold > 0 ? mixGold(i === 0 ? WARM : c, f.gold) : i === 0 ? WARM : c))

    // dust in the light: brighter near the ball
    if (this.motes.length) {
      const reach = Math.max(b.w, b.hy) * 0.85
      for (const m of this.motes) {
        const d = Math.hypot(m.x - b.cx, m.y - b.cy)
        const lit = Math.max(0, 1 - d / reach)
        const a = m.a * lit * (0.55 + 0.45 * Math.sin(m.tw)) * f.k * bright
        if (a < 0.01) continue
        ctx.globalAlpha = Math.min(1, a)
        ctx.drawImage(this.soft, m.x - m.s, m.y - m.s, m.s * 2, m.s * 2)
      }
    }

    // streaks: long shafts from the ball's faces, sweeping a little as the ball turns
    for (const st of this.streaks) {
      const t = st.age / st.dur
      const grow = Math.min(1, t / 0.22)
      const a = (t < 0.22 ? grow : 1 - smoothstep(0.35, 1, t)) * 0.34 * Math.max(f.k, 0.6) * (0.8 + 0.4 * f.flash)
      if (a <= 0.005) continue
      const c = Math.cos(st.ang)
      const s = Math.sin(st.ang)
      ctx.setTransform(dpr * c, dpr * s, -dpr * s, dpr * c, st.x * dpr, st.y * dpr)
      // a coloured cone widening into the haze, with a thin white core
      const L = st.len * (0.35 + 0.65 * grow)
      const spread = st.w * 4.2
      ctx.globalAlpha = Math.min(1, a * 1.3)
      ctx.drawImage(this.beamTint.set(st.color), 0, -spread / 2, L, spread)
      ctx.globalAlpha = Math.min(1, a * 0.9)
      ctx.drawImage(this.beam, 0, -st.w * 0.12, st.len * 0.7 * grow, st.w * 0.24)
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    // specks
    const spread = f.spread
    for (const s of this.specks) {
      if (s.alive <= 0) continue
      const p = project(s, b, spread)
      let x = p.x + s.kx
      let y = p.y + s.ky
      if (s.launchMs > 0 && s.age < s.launchMs && Number.isFinite(s.fx)) {
        const u = easeOutQuart(s.age / s.launchMs)
        x = s.fx + (x - s.fx) * u
        y = s.fy + (y - s.fy) * u
      }
      const flight = s.launchMs > 0 && s.age < s.launchMs ? 1 : p.vis
      const tw = f.reduced ? 0.85 : 0.72 + 0.28 * Math.sin(s.tw)
      // flare when crossing the ball's centre line (a facet looking straight at you)
      const facing = f.reduced ? 0 : Math.max(0, 1 - Math.abs(Math.sin(s.lon)) / 0.12)
      const g = Math.max(s.glint, facing * facing)
      const a = s.alive * flight * f.k * (0.6 + 0.4 * s.z) * tw
      if (a < 0.01 && g < 0.05) continue
      const d = (16 + 20 * s.z) * p.scale * (1 + 0.35 * f.flash + 0.25 * g)
      ctx.globalAlpha = Math.min(1, a * bright)
      ctx.drawImage(tints[s.hue], x - d / 2, y - d / 2, d, d)
      if (bright > 1.02) {
        // "twice as bright" cannot be done with alpha alone: add a second pass
        ctx.globalAlpha = Math.min(1, a * (bright - 1))
        ctx.drawImage(this.dot, x - d / 2, y - d / 2, d, d)
      }
      if (g > 0.08) {
        const gd = d * (1.6 + 1.2 * g)
        ctx.globalAlpha = Math.min(1, g * s.alive * f.k * 0.85)
        ctx.drawImage(this.glint, x - gd / 2, y - gd / 2, gd, gd)
      }
    }

    // rings: touches and the lights-on bloom
    for (const r of this.rings) {
      const t = r.age / r.dur
      const e = easeOutQuart(t)
      const rad = r.r0 + (r.r1 - r.r0) * e
      ctx.globalAlpha = Math.max(0, r.a * (1 - t) * (1 - t))
      ctx.strokeStyle = rgbCss(r.color)
      ctx.lineWidth = Math.max(0.6, r.w * (1 - 0.7 * t))
      ctx.beginPath()
      ctx.arc(r.x, r.y, rad, 0, Math.PI * 2)
      ctx.stroke()
    }
    ctx.globalAlpha = 1
    ctx.globalCompositeOperation = 'source-over'
  }
}

const easeOutQuart = (t: number) => 1 - Math.pow(1 - Math.max(0, Math.min(1, t)), 4)
const mixGold = (c: RGB, g: number): RGB => {
  const k = Math.min(1, g * 1.7)
  return [c[0] + (GOLD[0] - c[0]) * k, c[1] + (GOLD[1] - c[1]) * k, c[2] + (GOLD[2] - c[2]) * k]
}
