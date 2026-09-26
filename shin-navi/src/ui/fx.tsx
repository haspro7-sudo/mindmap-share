// Ambient light specks and one-shot bursts, drawn on canvases so they stay cheap.
import { useEffect, useRef } from 'react'

type Speck = { x: number; y: number; r: number; a: number; vx: number; vy: number; hue: string; tw: number }

const DPR = () => Math.min(2, window.devicePixelRatio || 1)

// Soft glow dots are pre-rendered once per colour and reused with drawImage.
const spriteCache = new Map<string, HTMLCanvasElement>()
export function glowSprite(color: string, px = 64): HTMLCanvasElement {
  const key = color + '|' + px
  const hit = spriteCache.get(key)
  if (hit) return hit
  const c = document.createElement('canvas')
  c.width = c.height = px
  const g = c.getContext('2d')!
  const grad = g.createRadialGradient(px / 2, px / 2, 0, px / 2, px / 2, px / 2)
  grad.addColorStop(0, color)
  grad.addColorStop(0.25, color)
  grad.addColorStop(1, 'rgba(0,0,0,0)')
  g.fillStyle = grad
  g.fillRect(0, 0, px, px)
  spriteCache.set(key, c)
  return c
}

/**
 * Slowly orbiting light specks, like a mirror ball throwing light on the walls.
 * `level` (0..1) controls how many specks and how bright.
 */
export function LightField({ colors, level = 0.5, className }: { colors: string[]; level?: number; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const levelRef = useRef(level)
  const colorsRef = useRef(colors)
  levelRef.current = level
  colorsRef.current = colors
  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    let w = 0
    let h = 0
    const specks: Speck[] = []
    const resize = () => {
      const dpr = DPR()
      w = canvas.clientWidth
      h = canvas.clientHeight
      canvas.width = Math.max(1, Math.floor(w * dpr))
      canvas.height = Math.max(1, Math.floor(h * dpr))
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(canvas)
    const spawn = (): Speck => ({
      x: Math.random() * w,
      y: Math.random() * h,
      r: 0.8 + Math.random() * 2.6,
      a: 0,
      vx: (Math.random() - 0.5) * 0.25,
      vy: (Math.random() - 0.5) * 0.25,
      hue: colorsRef.current[Math.floor(Math.random() * colorsRef.current.length)] ?? '#fff',
      tw: Math.random() * Math.PI * 2,
    })
    let raf = 0
    let last = performance.now()
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    const loop = (now: number) => {
      const dt = Math.min(50, now - last) / 16.67
      last = now
      const want = Math.round(24 + levelRef.current * 90)
      while (specks.length < want) specks.push(spawn())
      if (specks.length > want) specks.length = want
      ctx.clearRect(0, 0, w, h)
      ctx.globalCompositeOperation = 'lighter'
      const cx = w / 2
      const cy = h * 0.35
      for (const s of specks) {
        // gentle orbit around the upper centre + drift
        const dx = s.x - cx
        const dy = s.y - cy
        s.x += (s.vx - dy * 0.0009) * dt * (reduce ? 0 : 1)
        s.y += (s.vy + dx * 0.0009) * dt * (reduce ? 0 : 1)
        s.tw += 0.05 * dt
        s.a = Math.min(1, s.a + 0.02 * dt)
        if (s.x < -20 || s.x > w + 20 || s.y < -20 || s.y > h + 20) Object.assign(s, spawn())
        const alpha = s.a * (0.35 + 0.65 * Math.abs(Math.sin(s.tw))) * (0.5 + levelRef.current * 0.5)
        const size = s.r * 10
        ctx.globalAlpha = alpha
        ctx.drawImage(glowSprite(s.hue), s.x - size / 2, s.y - size / 2, size, size)
      }
      ctx.globalAlpha = 1
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    const onVis = () => {
      if (document.hidden) cancelAnimationFrame(raf)
      else {
        last = performance.now()
        raf = requestAnimationFrame(loop)
      }
    }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [])
  return <canvas ref={ref} className={className} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }} aria-hidden="true" />
}

// ---- Bursts: a single full-screen canvas that any component can trigger.
type Particle = { x: number; y: number; vx: number; vy: number; life: number; max: number; size: number; color: string; shape: 0 | 1 | 2; rot: number; vr: number }

let emit: ((x: number, y: number, opts?: BurstOptions) => void) | null = null

export type BurstOptions = { colors?: string[]; count?: number; spread?: number; power?: number; gravity?: number; shapes?: 'spark' | 'confetti' | 'star' }

/** Fire a burst at viewport coordinates. No-op until <BurstLayer/> is mounted. */
export function burst(x: number, y: number, opts?: BurstOptions): void {
  emit?.(x, y, opts)
}

/** Burst from the centre of an element. */
export function burstFrom(el: Element | null | undefined, opts?: BurstOptions): void {
  if (!el) return
  const r = el.getBoundingClientRect()
  burst(r.left + r.width / 2, r.top + r.height / 2, opts)
}

export function BurstLayer() {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const parts: Particle[] = []
    let raf = 0
    let running = false
    const resize = () => {
      const dpr = DPR()
      canvas.width = Math.floor(window.innerWidth * dpr)
      canvas.height = Math.floor(window.innerHeight * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    window.addEventListener('resize', resize)
    const step = () => {
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight)
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i]
        p.life++
        p.vy += 0.12 * (p.shape === 1 ? 0.6 : 1)
        p.vx *= 0.985
        p.vy *= 0.985
        p.x += p.vx
        p.y += p.vy
        p.rot += p.vr
        const t = p.life / p.max
        if (t >= 1) {
          parts.splice(i, 1)
          continue
        }
        ctx.globalAlpha = 1 - t * t
        ctx.fillStyle = p.color
        ctx.save()
        ctx.translate(p.x, p.y)
        ctx.rotate(p.rot)
        if (p.shape === 1) ctx.fillRect(-p.size, -p.size * 0.4, p.size * 2, p.size * 0.8)
        else if (p.shape === 2) star(ctx, p.size)
        else {
          ctx.globalCompositeOperation = 'lighter'
          ctx.beginPath()
          ctx.arc(0, 0, p.size, 0, Math.PI * 2)
          ctx.fill()
          ctx.globalCompositeOperation = 'source-over'
        }
        ctx.restore()
      }
      ctx.globalAlpha = 1
      if (parts.length) raf = requestAnimationFrame(step)
      else running = false
    }
    emit = (x, y, opts = {}) => {
      const colors = opts.colors ?? ['#ff2e88', '#7df9ff', '#ffe066', '#c77dff', '#ffffff']
      const count = opts.count ?? 36
      const power = opts.power ?? 7
      const spread = opts.spread ?? Math.PI * 2
      const shape: Particle['shape'] = opts.shapes === 'confetti' ? 1 : opts.shapes === 'star' ? 2 : 0
      for (let i = 0; i < count; i++) {
        const ang = -Math.PI / 2 + (Math.random() - 0.5) * spread
        const v = power * (0.35 + Math.random() * 0.8)
        parts.push({
          x,
          y,
          vx: Math.cos(ang) * v,
          vy: Math.sin(ang) * v,
          life: 0,
          max: 40 + Math.random() * 40,
          size: shape === 0 ? 1.5 + Math.random() * 3 : 3 + Math.random() * 4,
          color: colors[i % colors.length],
          shape,
          rot: Math.random() * Math.PI,
          vr: (Math.random() - 0.5) * 0.3,
        })
      }
      if (!running) {
        running = true
        raf = requestAnimationFrame(step)
      }
    }
    return () => {
      emit = null
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
    }
  }, [])
  return <canvas ref={ref} style={{ position: 'fixed', inset: 0, width: '100vw', height: '100vh', pointerEvents: 'none', zIndex: 900 }} aria-hidden="true" />
}

function star(ctx: CanvasRenderingContext2D, r: number) {
  ctx.beginPath()
  for (let i = 0; i < 10; i++) {
    const rr = i % 2 ? r * 0.45 : r
    const a = (i * Math.PI) / 5 - Math.PI / 2
    ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr)
  }
  ctx.closePath()
  ctx.fill()
}
