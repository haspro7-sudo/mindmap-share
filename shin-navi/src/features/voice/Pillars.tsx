// The voice reveal (SPEC I-4 #6): three light pillars — power (red), care (blue), brightness
// (yellow) — rise to their values 150ms apart, lean together and fuse into a colour orb, and the
// reading's name types itself out: "今回の声は{type}". Only transform and opacity move.
// The same stage idles (dim breathing pillars) before a check and previews quiz answers.
import { useEffect, useMemo, useRef, type CSSProperties, type Ref } from 'react'
import { motion } from 'motion/react'
import type { VoiceTypeId } from '../../core/types'
import { VoiceOrb } from '../../core/ui/VoiceOrb'
import { sound } from '../../core/sound'
import { useTr } from '../../i18n'
import { FACTOR_COLOR, TYPE_COLOR } from './buildReading'
import { V } from './strings'
import './voice.css'

export type PillarValues = { power: number; care: number; brightness: number }
/** idle: dim and breathing · preview: live quiz answers · rise: pillars grow · merge: fuse into the orb · final: the settled end state */
export type StagePhase = 'idle' | 'preview' | 'rise' | 'merge' | 'final'

type Dims = { h: number; floor: number; maxH: number; gap: number; beam: number; orb: number; orbY: number }
const DIMS: Record<'sheet' | 'sheetSmall' | 'card' | 'cardSmall', Dims> = {
  sheet: { h: 214, floor: 36, maxH: 150, gap: 70, beam: 30, orb: 108, orbY: 0.5 },
  sheetSmall: { h: 176, floor: 32, maxH: 118, gap: 62, beam: 26, orb: 90, orbY: 0.5 },
  card: { h: 76, floor: 6, maxH: 66, gap: 24, beam: 11, orb: 50, orbY: 0.52 },
  cardSmall: { h: 62, floor: 5, maxH: 54, gap: 21, beam: 10, orb: 42, orbY: 0.52 },
}

const IDLE: PillarValues = { power: 0.36, care: 0.56, brightness: 0.44 }
/** A pillar never disappears completely: even a quiet factor keeps a stub of light. */
const shown = (v: number) => 0.14 + 0.86 * Math.max(0, Math.min(1, v))

export const RISE_STAGGER = 0.15
const RISE_DUR = 0.62
/** when (ms after `rise`) the pillars have all arrived */
export const RISE_MS = Math.round((2 * RISE_STAGGER + RISE_DUR) * 1000)
const POP_DELAY = 0.2

const FACTORS = [
  { k: 'power' as const, c: FACTOR_COLOR.power, label: 'f.power' as const },
  { k: 'care' as const, c: FACTOR_COLOR.care, label: 'f.care' as const },
  { k: 'brightness' as const, c: FACTOR_COLOR.bright, label: 'f.bright' as const },
]

const SPARKS = Array.from({ length: 12 }, (_, i) => {
  const a = (i / 12) * Math.PI * 2 + (i % 2 ? 0.2 : -0.1)
  const r = i % 3 === 0 ? 1.15 : i % 3 === 1 ? 0.85 : 1
  return { x: Math.cos(a) * r, y: Math.sin(a) * r * 0.9, c: [FACTOR_COLOR.power, FACTOR_COLOR.care, FACTOR_COLOR.bright, '#ffffff'][i % 4] }
})

export type VoiceStageProps = {
  phase: StagePhase
  values?: PillarValues | null
  type?: VoiceTypeId | null
  variant: 'sheet' | 'card'
  small?: boolean
  reduced?: boolean
  /** play the pillar / orbPop sounds on rise and merge */
  withSound?: boolean
  labels?: boolean
  orbRef?: Ref<HTMLDivElement>
  /** change it to start a new reveal: the pillars remount and rise from the floor again */
  runId?: string | number
  className?: string
  onTap?: () => void
}

export function VoiceStage({ phase, values, type, variant, small, reduced, withSound, labels = variant === 'sheet', orbRef, runId = 0, className, onTap }: VoiceStageProps) {
  const t = V.useT()
  const d = DIMS[variant === 'sheet' ? (small ? 'sheetSmall' : 'sheet') : small ? 'cardSmall' : 'card']
  const vals = phase === 'idle' || !values ? IDLE : values
  const merged = phase === 'merge' || phase === 'final'
  const instant = reduced || phase === 'final'
  const tc = type ? TYPE_COLOR[type] : '#D8DCE8'

  // sounds: one note per pillar (C5 E5 G5), then the pop as the orb forms
  const played = useRef<string>('')
  useEffect(() => {
    const k = `${runId}:${phase}`
    if (!withSound || played.current === k) return
    played.current = k
    const timers: number[] = []
    if (phase === 'rise') FACTORS.forEach((_, i) => timers.push(window.setTimeout(() => sound.play('pillar', { index: i }), reduced ? 0 : i * RISE_STAGGER * 1000)))
    if (phase === 'merge') timers.push(window.setTimeout(() => sound.play('orbPop'), reduced ? 0 : POP_DELAY * 1000 + 120))
    return () => timers.forEach(clearTimeout)
  }, [phase, withSound, reduced, runId])

  const style = { height: d.h, '--tc': tc, '--beam': `${d.beam}px`, '--maxh': `${d.maxH}px`, '--floor': `${d.floor}px`, '--orb': `${d.orb}px` } as CSSProperties
  const orbTop = d.h - d.floor - d.maxH * d.orbY - d.orb / 2
  return (
    <div className={`vst vst--${variant} vst--${phase}${small ? ' is-small' : ''} ${className ?? ''}`} style={style} onClick={onTap} aria-hidden="true">
      <div className="vst__floor" />
      {FACTORS.map((f, i) => {
        const v = shown(vals[f.k])
        const dx = (i - 1) * d.gap
        const riseT = instant ? { duration: reduced ? 0.25 : 0 } : phase === 'rise' ? { delay: i * RISE_STAGGER, duration: RISE_DUR, ease: [0.2, 1.28, 0.42, 1] as const } : { type: 'spring' as const, stiffness: 180, damping: 18 }
        const mergeT = instant ? { duration: reduced ? 0.25 : 0 } : { duration: 0.5, ease: [0.55, 0, 0.2, 1] as const }
        const from = phase === 'rise' && !reduced ? 0 : undefined
        return (
          <motion.div
            key={`${f.k}:${runId}`}
            className={`vst__col vst__col--${f.k}`}
            style={{ left: `calc(50% + ${dx}px - var(--beam) / 2)`, ['--c' as string]: f.c } as CSSProperties}
            initial={false}
            animate={merged ? { x: -dx * 0.62, scaleX: 0.42, opacity: 0.42 } : { x: 0, scaleX: 1, opacity: phase === 'idle' ? 0.5 : 1 }}
            transition={mergeT}
          >
            <motion.div className="vst__beam" initial={from != null ? { scaleY: 0 } : false} animate={{ scaleY: v }} transition={riseT} />
            <motion.div className="vst__cap" initial={from != null ? { y: 0, opacity: 0 } : false} animate={{ y: -v * d.maxH, opacity: phase === 'idle' ? 0.5 : 1 }} transition={riseT} />
            <motion.div className="vst__refl" initial={from != null ? { scaleY: 0 } : false} animate={{ scaleY: v }} transition={riseT} />
          </motion.div>
        )
      })}
      {labels ? (
        <div className="vst__labels" style={{ ['--gap' as string]: `${d.gap}px` } as CSSProperties}>
          {FACTORS.map(f => (
            <span key={f.k} className="vst__label" style={{ ['--c' as string]: f.c } as CSSProperties}>
              <i />
              {t(f.label)}
            </span>
          ))}
        </div>
      ) : null}
      <motion.div
        className="vst__orb"
        ref={orbRef}
        style={{ top: orbTop }}
        initial={false}
        animate={merged ? { scale: 1, opacity: 1 } : { scale: 0, opacity: 0 }}
        transition={instant ? { duration: reduced ? 0.3 : 0 } : merged ? { delay: POP_DELAY, duration: 0.6, ease: [0.2, 1.6, 0.4, 1] } : { duration: 0.2 }}
      >
        <span className="vst__halo" />
        <VoiceOrb reading={values ?? null} size={d.orb} className="vst__core" />
        <span className="vst__sheen" />
      </motion.div>
      {merged && !instant ? <Burst key={`b:${runId}`} size={d.orb} top={orbTop} /> : null}
    </div>
  )
}

/** The shockwave ring and sparks that fly out when the pillars fuse. */
function Burst({ size, top }: { size: number; top: number }) {
  const R = size * 1.05
  return (
    <div className="vst__burst" style={{ top, width: size, height: size, marginLeft: -size / 2 }}>
      <motion.span className="vst__ring" initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: [0.5, 2.3], opacity: [0.95, 0] }} transition={{ delay: POP_DELAY + 0.08, duration: 0.8, ease: 'easeOut' }} />
      {SPARKS.map((s, i) => (
        <motion.span
          key={i}
          className="vst__spark"
          style={{ background: s.c }}
          initial={{ x: 0, y: 0, opacity: 0, scale: 0.4 }}
          animate={{ x: s.x * R, y: s.y * R, opacity: [0, 1, 0], scale: [0.4, 1, 0.3] }}
          transition={{ delay: POP_DELAY + 0.06 + (i % 3) * 0.03, duration: 0.75, ease: [0.1, 0.8, 0.3, 1] }}
        />
      ))}
    </div>
  )
}

/**
 * "今回の声は{type}" — the prefix fades in and the type name types out one glyph at a time
 * (CSS animation delays, no re-render per glyph). Never "あなたは…タイプ".
 */
export function TypeLine({ type, play, delayMs = 0, reduced, compact, className }: { type: VoiceTypeId; play: boolean; delayMs?: number; reduced?: boolean; compact?: boolean; className?: string }) {
  const t = V.useT()
  const trr = useTr()
  const MARK = String.fromCharCode(1)
  const [pre, post] = useMemo(() => {
    const s = t('result', { type: MARK })
    const at = s.indexOf(MARK)
    return at < 0 ? [s, ''] : [s.slice(0, at).trim(), s.slice(at + 1).trim()]
  }, [t, MARK])
  const name = trr({ key: `vocab.voice.${type}` })
  const glyphs = Array.from(name)
  const animated = play && !reduced
  const step = 72
  const st = (ms: number) => (animated ? ({ animationDelay: `${ms}ms` } as CSSProperties) : undefined)
  return (
    <div className={`vtl${compact ? ' vtl--compact' : ''}${animated ? ' is-typing' : ''} ${className ?? ''}`} style={{ ['--tc' as string]: TYPE_COLOR[type] } as CSSProperties} aria-label={`${pre} ${name} ${post}`.trim()}>
      <span className="vtl__pre" style={st(delayMs)} aria-hidden="true">
        {pre}
      </span>
      <span className="vtl__name" aria-hidden="true">
        {glyphs.map((g, i) => (
          <span key={i} className="vtl__g" style={st(delayMs + 180 + i * step)}>
            {g}
          </span>
        ))}
        {animated ? <span className="vtl__caret" style={{ animationDelay: `${delayMs + 120}ms, ${delayMs + 260 + glyphs.length * step + 700}ms` }} /> : null}
      </span>
      {post ? (
        <span className="vtl__post" style={st(delayMs + 180 + glyphs.length * step)} aria-hidden="true">
          {post}
        </span>
      ) : null}
    </div>
  )
}

/** ms from the start of TypeLine until the last glyph has appeared. */
export function typeLineMs(glyphCount: number): number {
  return 180 + glyphCount * 72 + 200
}
