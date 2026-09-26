// "知ってる" dots (SPEC B-2, C-8②, I-4 #4). Anonymous: dots light in arrival order and nobody's
// dot is labelled. "Don't know" and "no answer" look the same (an empty ring), so silence
// never reveals who does not know a song. Only the viewer's own unanswered dot shows "?".
import { motion } from 'motion/react'
import { useEffect, useId, useRef, useState } from 'react'
import { common } from '../../i18n/common'
import { bus } from '../events'
import { introPending, introWait } from '../intro'
import { selKnowView, selRoomSize } from '../selectors'
import { sound } from '../sound'
import { naviApi, useNavi } from '../store'
import { useNaviStable } from '../useStable'
import type { KnowView } from '../types'
import './kit.css'

type Dot = KnowView['dots'][number]

export type KnowDotsProps = {
  songId: string
  /** dot diameter in px (default 12) */
  size?: number
  /** show "k of n know it" next to the dots */
  label?: boolean
  className?: string
}

const STAGGER = 0.15
const GAP_RATIO = 0.5
// Several KnowDots can show the same song (card, lane chip, room screen): play sounds once.
const recentSounds = new Map<string, number>()
function once(key: string, windowMs: number): boolean {
  const now = performance.now()
  const last = recentSounds.get(key) ?? -Infinity
  if (now - last < windowMs) return false
  recentSounds.set(key, now)
  if (recentSounds.size > 64) recentSounds.clear()
  return true
}

const fmt = (k: number) => (Number.isInteger(k) ? String(k) : k.toFixed(1))

export function KnowDots({ songId, size = 12, label = false, className }: KnowDotsProps) {
  const t = common.useT()
  const view = useNaviStable(selKnowView(songId))
  const roomSize = useNavi(selRoomSize)
  const meAnswered = useNavi(s => !!s.room.knowing[songId]?.answers.me)
  const reduced = useNavi(s => s.ui.reduced)
  const uid = useId().replace(/:/g, '')

  const dots: Dot[] = view ? view.dots : Array.from({ length: roomSize }, () => 'empty' as const)
  const n = dots.length
  const litCount = dots.filter(d => d !== 'empty').length

  // What was on screen last commit (null before the first commit).
  const prevRef = useRef<Dot[] | null>(null)
  const prevAllRef = useRef<boolean | null>(null)
  const prev = prevRef.current

  // Per-dot entrance: delay in seconds, or null for no animation.
  const anim: (number | null)[] = dots.map(() => null)
  const grow: boolean[] = dots.map(() => false)
  if (prev === null) {
    if (introPending('knowDots') && !reduced) {
      let order = 0
      const base = introWait('knowDots')
      dots.forEach((d, i) => {
        if (d !== 'empty') anim[i] = base + order++ * STAGGER
      })
    }
  } else {
    let order = 0
    dots.forEach((d, i) => {
      if (d !== 'empty' && prev[i] !== d) anim[i] = reduced ? 0 : order++ * STAGGER
      else if (i >= prev.length) grow[i] = true
    })
  }

  // Sounds for dots that light after mount; chord + sweep when everyone knows.
  const [sweep, setSweep] = useState(0)
  useEffect(() => {
    const before = prevRef.current
    prevRef.current = dots
    const wasAll = prevAllRef.current
    const all = !!view?.all
    prevAllRef.current = all
    if (before === null) return
    const timers: ReturnType<typeof setTimeout>[] = []
    const audio = naviApi.getState().session.audioOn
    let order = 0
    dots.forEach((d, i) => {
      if (d === 'empty' || before[i] === d) return
      const delay = order++ * STAGGER * 1000
      if (audio && once(`${songId}|${i}|${d}`, 400)) timers.push(setTimeout(() => sound.play('knowTick', { index: Math.min(3, i), half: d === 'chorus' }), delay))
    })
    if (all && wasAll === false) {
      const delay = Math.max(0, order - 1) * STAGGER * 1000 + 180
      timers.push(
        setTimeout(() => {
          setSweep(k => k + 1)
          if (once(`${songId}|all`, 1500)) {
            if (audio) sound.play('knowChord')
            bus.emit({ type: 'fx/flash', strength: 0.8 })
          }
        }, delay),
      )
    }
    return () => timers.forEach(clearTimeout)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dots.join(','), view?.all, songId])

  const gap = Math.max(4, Math.round(size * GAP_RATIO))
  const pad = Math.max(4, Math.round(size * 0.42))
  const w = n * size + Math.max(0, n - 1) * gap + pad * 2
  const h = size + pad * 2
  const qIndex = view && !meAnswered ? litCount : -1 // the first empty dot stands for "you"

  return (
    <span
      className={`kd ${className ?? ''}`}
      data-testid="know-dots"
      data-size={n}
      data-knows={view?.knows ?? 0}
      data-all={view?.all ? '1' : '0'}
      role="img"
      aria-label={t('knowCount', { n, k: fmt(view?.knows ?? 0) })}
    >
      <span className="kd__row" style={{ gap, padding: pad }}>
        {dots.map((d, i) => {
          const delay = anim[i]
          const q = i === qIndex
          return (
            <motion.span
              key={`${i}:${d}`}
              className={`kd__dot kd__dot--${d}${q ? ' kd__dot--q' : ''}`}
              style={{ width: size, height: size }}
              initial={delay != null || grow[i] ? { scale: 0 } : false}
              animate={delay != null ? { scale: [0, 1.35, 1] } : { scale: 1 }}
              transition={delay != null ? { duration: 0.42, times: [0, 0.55, 1], ease: 'easeOut', delay } : { duration: 0.2 }}
            >
              {q ? (
                <span className="kd__q" style={{ fontSize: Math.max(8, Math.round(size * 0.72)) }}>
                  ?
                </span>
              ) : null}
            </motion.span>
          )
        })}
        {sweep > 0 ? (
          <svg key={sweep} className="kd__sweep" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
            <defs>
              <linearGradient id={`kdp${uid}`} x1="0" y1="0" x2="1" y2="0">
                <stop offset="0" stopColor="#FF3DA8" />
                <stop offset="0.25" stopColor="#FFB547" />
                <stop offset="0.5" stopColor="#C6FF3D" />
                <stop offset="0.75" stopColor="#2EF2FF" />
                <stop offset="1" stopColor="#8A6BFF" />
              </linearGradient>
            </defs>
            <motion.rect
              x={1.25}
              y={1.25}
              width={w - 2.5}
              height={h - 2.5}
              rx={(h - 2.5) / 2}
              fill="none"
              stroke={`url(#kdp${uid})`}
              strokeWidth={2.5}
              initial={{ pathLength: 0, opacity: 1 }}
              animate={{ pathLength: 1, opacity: [1, 1, 0] }}
              transition={{ pathLength: { duration: 0.7, ease: 'easeInOut' }, opacity: { duration: 1.1, times: [0, 0.7, 1] } }}
            />
          </svg>
        ) : null}
      </span>
      {label ? (
        <span className="kd__label">
          <b>{fmt(view?.knows ?? 0)}</b>/{n}
        </span>
      ) : null}
    </span>
  )
}
