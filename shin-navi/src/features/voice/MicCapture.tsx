// The optional 3-second hum (SPEC L/M7 #1). lib/pitch.captureVoice listens for 3 seconds; the
// live pitch is drawn as a glowing trail on one small canvas driven by the app ticker (never
// React state per frame). Nothing is recorded: no MediaRecorder, and captureVoice stops the
// tracks when it is done. When the mic is missing or refused we hand over to the quiz silently.
import { useEffect, useRef, useState } from 'react'
import type { CaptureResult, PitchFrame } from '../../lib/pitch'
import { captureVoice, hzToMidi } from '../../lib/pitch'
import { ticker } from '../../core/ticker'
import { Icon } from '../../core/ui/Icon'
import { useLocale, type Locale } from '../../i18n'
import { noteName } from './buildReading'
import { V } from './strings'
import './voice.css'

export const HUM_SECONDS = 3
const LO = 40 // E2
const HI = 84 // C6
/** semitones shown at once (the window glides to follow the voice) */
const SPAN = 18

type Pt = { t: number; m: number | null; rms: number }
type Spark = { x: number; y: number; vx: number; vy: number; life: number; max: number; c: number }

type Live = { pts: Pt[]; startedAt: number; recent: number[]; lastRms: number }

function median(a: number[]): number {
  const s = [...a].sort((x, y) => x - y)
  return s[Math.floor(s.length / 2)]
}

/** Pre-rendered glow sprite (drawn once; drawImage per frame instead of gradients per frame). */
function glowSprite(rgb: string, size = 64): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = c.height = size
  const g = c.getContext('2d')!
  const r = size / 2
  const grad = g.createRadialGradient(r, r, 0, r, r, r)
  grad.addColorStop(0, 'rgba(255,255,255,1)')
  grad.addColorStop(0.18, `rgba(${rgb},0.95)`)
  grad.addColorStop(0.5, `rgba(${rgb},0.28)`)
  grad.addColorStop(1, `rgba(${rgb},0)`)
  g.fillStyle = grad
  g.fillRect(0, 0, size, size)
  return c
}

const SPARK_RGB = ['255,77,77', '77,139,255', '255,216,77', '199,125,255']

export type MicCaptureProps = {
  small?: boolean
  reduced?: boolean
  onDone: (c: CaptureResult) => void
  /** getUserMedia is missing or was refused */
  onUnavailable: () => void
  onQuiz: () => void
  onCancel: () => void
}

export function MicCapture({ small, reduced, onDone, onUnavailable, onQuiz, onCancel }: MicCaptureProps) {
  const t = V.useT()
  const locale = useLocale()
  const wrap = useRef<HTMLDivElement>(null)
  const cv = useRef<HTMLCanvasElement>(null)
  const count = useRef<HTMLSpanElement>(null)
  const ring = useRef<HTMLSpanElement>(null)
  const live = useRef<Live>({ pts: [], startedAt: 0, recent: [], lastRms: 0 })
  const [attempt, setAttempt] = useState(0)
  const [quiet, setQuiet] = useState(false)
  const cb = useRef({ onDone, onUnavailable })
  cb.current = { onDone, onUnavailable }
  const loc = useRef<Locale>(locale)
  loc.current = locale

  // ---- listen (one capture per attempt)
  useEffect(() => {
    const ac = new AbortController()
    let alive = true
    live.current = { pts: [], startedAt: 0, recent: [], lastRms: 0 }
    wrap.current?.classList.remove('is-live', 'is-done')
    const onFrame = (f: PitchFrame) => {
      const L = live.current
      if (!L.startedAt) {
        L.startedAt = performance.now() - f.t * 1000
        wrap.current?.classList.add('is-live')
      }
      let m: number | null = null
      if (f.hz != null) {
        L.recent.push(hzToMidi(f.hz))
        if (L.recent.length > 3) L.recent.shift()
        m = median(L.recent)
      } else L.recent.length = 0
      L.pts.push({ t: f.t, m, rms: f.rms })
      L.lastRms = f.rms
    }
    captureVoice(HUM_SECONDS, onFrame, ac.signal)
      .then(res => {
        if (!alive) return
        wrap.current?.classList.add('is-done')
        if (!res) return cb.current.onUnavailable()
        if (!res.frames.some(f => f.hz != null)) return setQuiet(true)
        cb.current.onDone(res)
      })
      .catch(() => {
        if (alive) cb.current.onUnavailable()
      })
    return () => {
      alive = false
      ac.abort()
    }
  }, [attempt])

  // ---- draw (the one app ticker; paused automatically while the tab is hidden)
  useEffect(() => {
    const canvas = cv.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const head = glowSprite('255,255,255', 64)
    const sparksImg = SPARK_RGB.map(c => glowSprite(c, 32))
    let W = 0
    let H = 0
    let dpr = 1
    let grad: CanvasGradient | null = null
    const sparks: Spark[] = []
    let shownSec = -1
    // the pitch window follows the voice: a 2-octave view whose centre glides to the recent pitch
    let center = 57
    let seeded = false

    // size comes from a ResizeObserver, never from a per-frame layout read
    let cw = canvas.clientWidth
    let ch = canvas.clientHeight
    const ro =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(es => {
            const r = es[0]?.contentRect
            if (r) {
              cw = r.width
              ch = r.height
            }
          })
        : null
    ro?.observe(canvas)
    const layout = () => {
      if (!cw || !ch) return false
      dpr = Math.min(2, window.devicePixelRatio || 1)
      if (cw === W && ch === H && grad) return true
      W = cw
      H = ch
      canvas.width = Math.round(W * dpr)
      canvas.height = Math.round(H * dpr)
      grad = ctx.createLinearGradient(46, 0, W - 12, 0)
      grad.addColorStop(0, '#FF4D4D')
      grad.addColorStop(0.5, '#C77DFF')
      grad.addColorStop(1, '#4DE1FF')
      return true
    }
    const xOf = (tt: number) => 46 + (Math.min(HUM_SECONDS, tt) / HUM_SECONDS) * (W - 58)
    const top = 48
    const yOf = (m: number) => {
      const bottom = H - 22
      const k = (m - center) / SPAN + 0.5
      return Math.max(top - 10, Math.min(bottom + 8, bottom - k * (bottom - top)))
    }

    const draw = (dt: number) => {
      if (!layout()) return
      const L = live.current
      const now = performance.now()
      const tt = L.startedAt ? (now - L.startedAt) / 1000 : 0
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

      // follow the voice
      if (L.recent.length) {
        const target = Math.max(LO + SPAN / 2, Math.min(HI - SPAN / 2, median(L.recent)))
        if (!seeded) {
          center = target
          seeded = true
        } else center += (target - center) * Math.min(1, dt / 520)
      }

      // note guides (C and A of every octave in view), labelled in the reader's notation
      ctx.font = '600 10px ui-monospace, Menlo, monospace'
      ctx.textBaseline = 'middle'
      ctx.lineWidth = 1
      ctx.setLineDash([2, 5])
      for (let m = Math.ceil(center - SPAN / 2); m <= center + SPAN / 2; m++) {
        const pc = ((m % 12) + 12) % 12
        if (pc !== 9 && pc !== 0) continue
        const y = yOf(m)
        if (y < top - 4 || y > H - 16) continue
        const strong = pc === 9
        ctx.strokeStyle = strong ? 'rgba(167,155,201,0.2)' : 'rgba(167,155,201,0.09)'
        ctx.beginPath()
        ctx.moveTo(46, y)
        ctx.lineTo(W - 12, y)
        ctx.stroke()
        ctx.fillStyle = strong ? 'rgba(167,155,201,0.62)' : 'rgba(167,155,201,0.34)'
        ctx.fillText(noteName(m, loc.current), 8, y)
      }
      ctx.setLineDash([])

      // progress rail + sweep cursor
      const px = xOf(tt)
      ctx.fillStyle = 'rgba(255,255,255,0.08)'
      ctx.fillRect(46, H - 6, W - 58, 2)
      if (grad) {
        ctx.fillStyle = grad
        ctx.fillRect(46, H - 6, Math.max(0, px - 46), 2)
      }
      if (L.startedAt) {
        ctx.fillStyle = 'rgba(255,255,255,0.06)'
        ctx.fillRect(px - 1, 8, 2, H - 16)
      }

      // the trail: three strokes (wide haze, glow, bright core) with additive light
      const pts = L.pts
      // a smooth ribbon through the voiced frames (midpoint quadratic curves), broken at silences
      const path = () => {
        ctx.beginPath()
        let px0 = 0
        let py0 = 0
        let open = false
        for (let i = 0; i < pts.length; i++) {
          const p = pts[i]
          if (p.m == null) {
            if (open) ctx.lineTo(px0, py0)
            open = false
            continue
          }
          const x = xOf(p.t)
          const y = yOf(p.m)
          if (!open) {
            ctx.moveTo(x, y)
            open = true
          } else ctx.quadraticCurveTo(px0, py0, (px0 + x) / 2, (py0 + y) / 2)
          px0 = x
          py0 = y
        }
        if (open) ctx.lineTo(px0, py0)
      }
      if (pts.length > 1 && grad) {
        ctx.lineJoin = 'round'
        ctx.lineCap = 'round'
        ctx.globalCompositeOperation = 'lighter'
        path()
        ctx.strokeStyle = grad
        ctx.globalAlpha = 0.12
        ctx.lineWidth = 16
        ctx.stroke()
        ctx.globalAlpha = 0.34
        ctx.lineWidth = 7
        ctx.stroke()
        ctx.globalAlpha = 1
        ctx.lineWidth = 3
        ctx.stroke()
        ctx.globalCompositeOperation = 'source-over'
        ctx.strokeStyle = 'rgba(255,255,255,0.75)'
        ctx.lineWidth = 1
        ctx.stroke()
      }

      // the head: glow sized by loudness, with the note name floating beside it
      const last = pts.length ? pts[pts.length - 1] : null
      if (last && last.m != null && !wrap.current?.classList.contains('is-done')) {
        const x = xOf(last.t)
        const y = yOf(last.m)
        const s = 26 + Math.min(1, last.rms * 6) * 34
        ctx.globalCompositeOperation = 'lighter'
        ctx.drawImage(head, x - s / 2, y - s / 2, s, s)
        ctx.globalCompositeOperation = 'source-over'
        ctx.fillStyle = 'rgba(245,241,255,0.92)'
        ctx.font = '800 12px ui-monospace, Menlo, monospace'
        ctx.textBaseline = 'middle'
        const label = noteName(last.m, loc.current)
        const lx = Math.min(W - 60, x + 14)
        ctx.fillText(label, lx, y - 14)
        if (!reduced && sparks.length < 48) {
          sparks.push({ x, y, vx: -0.02 - Math.random() * 0.05, vy: (Math.random() - 0.5) * 0.06, life: 0, max: 520 + Math.random() * 380, c: (Math.random() * SPARK_RGB.length) | 0 })
        }
      }
      // sparks drift off the head and fade
      if (sparks.length) {
        ctx.globalCompositeOperation = 'lighter'
        for (let i = sparks.length - 1; i >= 0; i--) {
          const p = sparks[i]
          p.life += dt
          if (p.life >= p.max) {
            sparks.splice(i, 1)
            continue
          }
          p.x += p.vx * dt
          p.y += p.vy * dt
          const k = 1 - p.life / p.max
          ctx.globalAlpha = k * 0.9
          const s = 6 + 10 * k
          ctx.drawImage(sparksImg[p.c], p.x - s / 2, p.y - s / 2, s, s)
        }
        ctx.globalAlpha = 1
        ctx.globalCompositeOperation = 'source-over'
      }

      // DOM bits that change rarely: the 3-2-1 count and the loudness ring on the mic
      const sec = L.startedAt ? Math.max(0, Math.ceil(HUM_SECONDS - tt)) : HUM_SECONDS
      if (sec !== shownSec && count.current) {
        shownSec = sec
        count.current.textContent = String(Math.max(1, sec))
        if (L.startedAt && !reduced && typeof count.current.animate === 'function') {
          count.current.animate([{ transform: 'scale(1.35)', opacity: 0.35 }, { transform: 'scale(1)', opacity: 1 }], { duration: 320, easing: 'cubic-bezier(.2,.8,.2,1)' })
        }
      }
      if (ring.current) {
        const k = L.startedAt ? Math.min(1, L.lastRms * 7) : 0
        ring.current.style.transform = `scale(${(1 + k * 0.55).toFixed(3)})`
        ring.current.style.opacity = (0.25 + k * 0.75).toFixed(3)
      }
    }
    const off = ticker.add(draw)
    return () => {
      off()
      ro?.disconnect()
    }
  }, [reduced])

  return (
    <div className={`vmic${small ? ' is-small' : ''}`} ref={wrap} data-testid="voice-mic">
      <div className="vmic__stage">
        <canvas className="vmic__cv" ref={cv} />
        <div className="vmic__status">
          <span className="vmic__arming">{t('mic.arming')}</span>
          <span className="vmic__hum">{t('mic.hum')}</span>
        </div>
        <span className="vmic__count" ref={count}>
          {HUM_SECONDS}
        </span>
        {quiet ? (
          <div className="vmic__quiet">
            <b>{t('mic.quiet')}</b>
            <span>{t('mic.quietSub')}</span>
          </div>
        ) : null}
      </div>
      <div className="vmic__panel">
        <div className="vmic__mic">
          <span className="vmic__ring" ref={ring} />
          <span className="vmic__icon">
            <Icon name="sing" size={26} strokeWidth={1.8} />
          </span>
        </div>
        <p className="vmic__sub">{t('mic.humSub')}</p>
        <div className="vmic__btns">
          {quiet ? (
            <button
              type="button"
              className="vbtn vbtn--primary"
              data-testid="voice-mic-retry"
              onClick={() => {
                setQuiet(false)
                setAttempt(a => a + 1)
              }}
            >
              {t('mic.retry')}
            </button>
          ) : (
            <button type="button" className="vbtn vbtn--ghost" onClick={onCancel}>
              {t('mic.cancel')}
            </button>
          )}
          <button type="button" className="vbtn vbtn--ghost" data-testid="voice-mic-to-quiz" onClick={onQuiz}>
            {t('mic.toQuiz')}
          </button>
        </div>
      </div>
    </div>
  )
}
