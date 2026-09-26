// A still, coloured orb for a voice reading: power (red), care (blue) and brightness (yellow)
// mixed by their values. No animation — the reveal belongs to M7.
import type { CSSProperties } from 'react'
import type { VoiceReading } from '../types'
import './kit.css'

export type VoiceOrbProps = {
  reading: Pick<VoiceReading, 'power' | 'care' | 'brightness'> | null
  size?: number
  className?: string
  style?: CSSProperties
}

const clamp01 = (v: number) => (Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0)
const rgba = (rgb: string, a: number) => `rgba(${rgb}, ${a.toFixed(3)})`
const POWER = '255, 77, 77'
const CARE = '77, 139, 255'
const BRIGHT = '255, 216, 77'

export function VoiceOrb({ reading, size = 64, className, style }: VoiceOrbProps) {
  let background: string
  let glow: string
  if (!reading) {
    // "you" before any reading: soft silver
    background =
      'radial-gradient(circle at 32% 28%, rgba(255,255,255,.95), rgba(255,255,255,0) 26%), radial-gradient(circle at 50% 55%, #e9ecf5, #a9aec2 55%, #5a5f78 100%)'
    glow = 'rgba(216, 220, 232, .45)'
  } else {
    const p = clamp01(reading.power)
    const c = clamp01(reading.care)
    const b = clamp01(reading.brightness)
    const sum = p + c + b || 1
    const dom = p >= c && p >= b ? POWER : c >= b ? CARE : BRIGHT
    background = [
      'radial-gradient(circle at 32% 26%, rgba(255,255,255,.9), rgba(255,255,255,0) 24%)',
      `radial-gradient(circle at 26% 70%, ${rgba(POWER, 0.25 + 0.75 * p)}, ${rgba(POWER, 0)} ${Math.round(40 + 40 * (p / sum))}%)`,
      `radial-gradient(circle at 76% 64%, ${rgba(CARE, 0.25 + 0.75 * c)}, ${rgba(CARE, 0)} ${Math.round(40 + 40 * (c / sum))}%)`,
      `radial-gradient(circle at 54% 18%, ${rgba(BRIGHT, 0.25 + 0.75 * b)}, ${rgba(BRIGHT, 0)} ${Math.round(38 + 40 * (b / sum))}%)`,
      'radial-gradient(circle at 50% 50%, #3a2a66, #120a2a 80%)',
    ].join(', ')
    glow = rgba(dom, 0.45)
  }
  return (
    <span
      className={`voice-orb ${className ?? ''}`}
      style={{ width: size, height: size, background, boxShadow: `0 0 ${Math.round(size * 0.35)}px ${glow}, inset 0 -${Math.round(size * 0.12)}px ${Math.round(size * 0.25)}px rgba(0,0,0,.35)`, ...style }}
      aria-hidden="true"
    />
  )
}
