// One-shot bursts (SPEC I-4 #2, D-14, K-6 BurstPreset): sparks with streak tails, rainbow rings,
// gold pins, ink splashes. Pure particle data + a painter that only uses pre-rendered sprites,
// strokes and additive blending.
import type { BurstPreset } from '../../core/events'
import { glintSprite, glowSprite, inkSprite } from './sprites'

export type Part = {
  kind: 'spark' | 'glitter' | 'ink'
  x: number
  y: number
  vx: number
  vy: number
  drag: number
  grav: number
  age: number
  life: number
  size: number
  color: string
  tail: number
  spin: number
}
export type BRing = { x: number; y: number; age: number; life: number; r0: number; r1: number; w: number; colors: string[]; a: number }
export type BFlash = { x: number; y: number; age: number; life: number; size: number; color: string }

export const RAINBOW = ['#FF3DA8', '#FF6A3D', '#FFB547', '#C6FF3D', '#2EF2FF', '#5B6CFF', '#8A6BFF']
const GOLDS = ['#FFD36B', '#FFE9A8', '#FFB547', '#FFFFFF']

/** Number of flying particles a preset throws (spark12 is exactly 12, SPEC I-4 #2). */
export const PRESET_PARTICLES: Record<BurstPreset, number> = { spark12: 12, prism: 21, pin: 10, stamp: 16, area: 10 }

export type BurstOpts = { colors?: string[]; reduced?: boolean; lite?: boolean }

export class BurstSystem {
  parts: Part[] = []
  rings: BRing[] = []
  flashes: BFlash[] = []

  get busy(): boolean {
    return this.parts.length + this.rings.length + this.flashes.length > 0
  }

  fire(preset: BurstPreset, x: number, y: number, o: BurstOpts = {}): void {
    const rnd = Math.random
    const reduced = !!o.reduced
    const add = (n: number, make: (i: number) => Omit<Part, 'age'>) => {
      if (reduced) return
      const k = o.lite ? Math.ceil(n / 2) : n
      for (let i = 0; i < k; i++) this.parts.push({ ...make(i), age: 0 })
    }
    const colors = o.colors?.length ? o.colors : GOLDS
    switch (preset) {
      case 'spark12': {
        // the slot swallows the card: twelve sparks, a thin ring and a pop of light
        const n = 12
        const a0 = rnd() * Math.PI
        add(n, i => {
          const a = a0 + (i / n) * Math.PI * 2 + (rnd() - 0.5) * 0.35
          const v = 240 + rnd() * 220
          return { kind: 'spark', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v * 0.8 - 40, drag: 4.2, grav: 380, life: 480 + rnd() * 260, size: 1.6 + rnd() * 1.3, color: i % 3 === 2 ? '#FFFFFF' : colors[i % colors.length], tail: 0.05, spin: 0 }
        })
        this.rings.push({ x, y, age: 0, life: 360, r0: 6, r1: 46, w: 2.4, colors: [colors[0]], a: 0.85 })
        this.flashes.push({ x, y, age: 0, life: 260, size: 74, color: colors[0] })
        break
      }
      case 'prism': {
        // a face turned prism: a rainbow ring, rainbow sparks, glitter drifting down
        add(21, i => {
          const a = (i / 21) * Math.PI * 2 + (rnd() - 0.5) * 0.2
          const v = 200 + rnd() * 240
          return { kind: 'spark', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, drag: 3.2, grav: 140, life: 700 + rnd() * 320, size: 1.8 + rnd() * 1.4, color: RAINBOW[i % RAINBOW.length], tail: 0.06, spin: 0 }
        })
        add(9, () => {
          const a = rnd() * Math.PI * 2
          const v = 40 + rnd() * 90
          return { kind: 'glitter', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 60, drag: 1.6, grav: 90, life: 900 + rnd() * 500, size: 7 + rnd() * 7, color: RAINBOW[(rnd() * RAINBOW.length) | 0], tail: 0, spin: rnd() * 6 }
        })
        this.rings.push({ x, y, age: 0, life: 700, r0: 10, r1: 78, w: 5, colors: RAINBOW, a: 0.9 })
        this.rings.push({ x, y, age: 0, life: 520, r0: 4, r1: 44, w: 1.6, colors: ['#FFFFFF'], a: 0.8 })
        this.flashes.push({ x, y, age: 0, life: 380, size: 110, color: '#FFFFFF' })
        break
      }
      case 'pin': {
        add(10, i => {
          const a = (i / 10) * Math.PI * 2 + rnd() * 0.3
          const v = 120 + rnd() * 120
          return { kind: 'spark', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, drag: 5, grav: 120, life: 420 + rnd() * 200, size: 1.4 + rnd(), color: GOLDS[i % GOLDS.length], tail: 0.05, spin: 0 }
        })
        add(4, () => ({ kind: 'glitter', x: x + (rnd() - 0.5) * 30, y: y + (rnd() - 0.5) * 30, vx: 0, vy: -20, drag: 2, grav: 0, life: 600 + rnd() * 300, size: 10 + rnd() * 8, color: '#FFE9A8', tail: 0, spin: rnd() * 6 }))
        this.rings.push({ x, y, age: 0, life: 420, r0: 4, r1: 32, w: 2.2, colors: ['#FFD36B'], a: 0.9 })
        this.flashes.push({ x, y, age: 0, life: 260, size: 56, color: '#FFD36B' })
        break
      }
      case 'stamp': {
        // ink splashes out and settles: short, heavy droplets
        const ink = o.colors?.length ? o.colors : ['#8A6BFF', '#FF3DA8', '#2EF2FF']
        add(16, i => {
          const a = (i / 16) * Math.PI * 2 + (rnd() - 0.5) * 0.4
          const v = 150 + rnd() * 160
          return { kind: 'ink', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, drag: 7, grav: 0, life: 820 + rnd() * 300, size: 2 + rnd() * 3, color: ink[i % ink.length], tail: 0, spin: 0 }
        })
        // the thump: a heavy ring in tonight's colours and a lamplight flash under the stamp
        this.rings.push({ x, y, age: 0, life: 620, r0: 16, r1: 70, w: 5, colors: ink, a: 0.75 })
        this.rings.push({ x, y, age: 0, life: 420, r0: 10, r1: 44, w: 2, colors: ['#FFF0B8'], a: 0.8 })
        this.flashes.push({ x, y, age: 0, life: 340, size: 110, color: '#FFE9A8' })
        break
      }
      case 'area': {
        const c = colors[0]
        add(10, i => {
          const a = (i / 10) * Math.PI * 2 + rnd() * 0.3
          const v = 60 + rnd() * 80
          return { kind: 'glitter', x: x + Math.cos(a) * 14, y: y + Math.sin(a) * 14, vx: Math.cos(a) * v, vy: Math.sin(a) * v, drag: 2.5, grav: 0, life: 650 + rnd() * 300, size: 6 + rnd() * 6, color: c, tail: 0, spin: rnd() * 6 }
        })
        this.rings.push({ x, y, age: 0, life: 620, r0: 12, r1: 92, w: 3, colors: [c], a: 0.8 })
        this.flashes.push({ x, y, age: 0, life: 320, size: 80, color: c })
        break
      }
    }
  }

  step(dt: number): void {
    const s = dt / 1000
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i]
      p.age += dt
      if (p.age >= p.life) {
        this.parts.splice(i, 1)
        continue
      }
      const d = Math.exp(-p.drag * s)
      p.vx *= d
      p.vy = p.vy * d + p.grav * s
      p.x += p.vx * s
      p.y += p.vy * s
      p.spin += s * 3
    }
    for (let i = this.rings.length - 1; i >= 0; i--) if ((this.rings[i].age += dt) >= this.rings[i].life) this.rings.splice(i, 1)
    for (let i = this.flashes.length - 1; i >= 0; i--) if ((this.flashes[i].age += dt) >= this.flashes[i].life) this.flashes.splice(i, 1)
  }

  draw(ctx: CanvasRenderingContext2D, dpr: number, w: number, h: number): void {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.globalCompositeOperation = 'source-over'
    ctx.globalAlpha = 1
    ctx.clearRect(0, 0, w, h)
    const glint = glintSprite(64)
    ctx.globalCompositeOperation = 'lighter'
    for (const f of this.flashes) {
      const t = f.age / f.life
      const sz = f.size * (0.6 + 0.6 * easeOut(t))
      ctx.globalAlpha = (1 - t) * (1 - t) * 0.9
      ctx.drawImage(glowSprite(f.color, 64), f.x - sz / 2, f.y - sz / 2, sz, sz)
    }
    for (const r of this.rings) {
      const t = r.age / r.life
      const rad = r.r0 + (r.r1 - r.r0) * easeOut(t)
      ctx.lineWidth = Math.max(0.5, r.w * (1 - 0.75 * t))
      ctx.globalAlpha = r.a * (1 - t)
      if (r.colors.length === 1) {
        ctx.strokeStyle = r.colors[0]
        ctx.beginPath()
        ctx.arc(r.x, r.y, rad, 0, Math.PI * 2)
        ctx.stroke()
      } else {
        // a rainbow ring: one arc per hue, turning as it grows
        const n = r.colors.length * 2
        const rot = t * 1.6
        for (let i = 0; i < n; i++) {
          ctx.strokeStyle = r.colors[i % r.colors.length]
          ctx.beginPath()
          ctx.arc(r.x, r.y, rad, rot + (i / n) * Math.PI * 2, rot + ((i + 1) / n) * Math.PI * 2 + 0.02)
          ctx.stroke()
        }
      }
    }
    ctx.lineCap = 'round'
    for (const p of this.parts) {
      const t = p.age / p.life
      const fade = 1 - t * t
      if (p.kind === 'spark') {
        // streak tail along the velocity, bright head
        const tx = p.x - p.vx * p.tail
        const ty = p.y - p.vy * p.tail
        ctx.globalAlpha = fade * 0.9
        ctx.strokeStyle = p.color
        ctx.lineWidth = p.size * (1 - 0.5 * t)
        ctx.beginPath()
        ctx.moveTo(tx, ty)
        ctx.lineTo(p.x, p.y)
        ctx.stroke()
        const hd = p.size * 5
        ctx.globalAlpha = fade
        ctx.drawImage(glowSprite(p.color, 32), p.x - hd / 2, p.y - hd / 2, hd, hd)
      } else if (p.kind === 'glitter') {
        const tw = 0.6 + 0.4 * Math.sin(p.spin * 3)
        const sz = p.size * (0.7 + 0.3 * tw)
        ctx.globalAlpha = fade * tw
        ctx.drawImage(glint, p.x - sz, p.y - sz, sz * 2, sz * 2)
        ctx.globalAlpha = fade * 0.8
        ctx.drawImage(glowSprite(p.color, 32), p.x - sz / 2, p.y - sz / 2, sz, sz)
      }
    }
    // ink is paint, not light: drops land with source-over so they read on any background
    ctx.globalCompositeOperation = 'source-over'
    for (const p of this.parts) {
      if (p.kind !== 'ink') continue
      const t = p.age / p.life
      const fade = t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3
      const sz = p.size * (1.6 + 0.6 * Math.min(1, t * 3))
      ctx.globalAlpha = fade * 0.9
      ctx.drawImage(inkSprite(p.color, 32), p.x - sz, p.y - sz, sz * 2, sz * 2)
    }
    ctx.globalAlpha = 1
    ctx.globalCompositeOperation = 'source-over'
  }
}

const easeOut = (t: number) => 1 - Math.pow(1 - Math.max(0, Math.min(1, t)), 3)
