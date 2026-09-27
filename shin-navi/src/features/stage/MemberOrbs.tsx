// Lights on the floor = the people in the room (SPEC B-2, C-11, E-9, F-3).
// floor (phone hero): Minato 0.9 s, Saki 1.15 s, Jun's dashed ring + "on the way…" 1.4 s, and
// my empty ring pulsing at 1.4 s until the first tap pops a silver light into it. Every lit orb
// sends a thin thread up to the ball (the ball is reading the room). Only positive bubbles.
// Joining turns the dashed ring solid and draws a thread; leaving dims, dashes and fades.
// column (room screen): the same people as a list; my light stays silver there (voice data
// never goes to the shared screen).
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Member, MemberId, OtherId } from '../../core/types'
import { useNavi } from '../../core/store'
import { bus } from '../../core/events'
import { registerResolver } from '../../core/targets'
import { introDelay, introPending, type IntroKey } from '../../core/intro'
import { usePhoneMetrics } from '../../core/layout'
import { sound } from '../../core/sound'
import { useTr } from '../../i18n'
import { S } from './strings'
import { FLOOR_SLOTS, lightColor, threadEnd } from './model'
import { useMemberName } from './parts'
import './stage.css'

const INTRO_KEY: Record<MemberId, IntroKey> = { minato: 'orbMinato', saki: 'orbSaki', jun: 'junRing', me: 'junRing' }

// ---------------------------------------------------------------- orb target registry

const floorEls = new Map<MemberId, HTMLElement>()
const columnEls = new Map<MemberId, HTMLElement>()
let resolverOff: (() => void) | null = null
function ensureResolver() {
  if (resolverOff) return
  resolverOff = registerResolver('orb', key => {
    const el = floorEls.get(key as MemberId) ?? columnEls.get(key as MemberId)
    if (!el || !el.isConnected) return null
    const r = el.getBoundingClientRect()
    return r.width > 0 ? r : null
  })
}
function releaseResolver() {
  if (floorEls.size || columnEls.size) return
  resolverOff?.()
  resolverOff = null
}

// ---------------------------------------------------------------- shared state hooks

type OrbState = 'lit' | 'empty' | 'arriving' | 'leaving' | 'gone'

/** Members that just left stay on screen for a moment to play the leave animation. */
function useLeaving(members: Record<MemberId, Member>): Partial<Record<MemberId, true>> {
  const prev = useRef(members)
  const [leaving, setLeaving] = useState<Partial<Record<MemberId, true>>>({})
  useEffect(() => {
    const before = prev.current
    prev.current = members
    const gone = (Object.keys(members) as MemberId[]).filter(id => before[id]?.present && !members[id].present && !members[id].arriving)
    if (!gone.length) return
    setLeaving(l => ({ ...l, ...Object.fromEntries(gone.map(id => [id, true])) }))
    const tm = setTimeout(() => setLeaving(l => Object.fromEntries(Object.entries(l).filter(([k]) => !gone.includes(k as MemberId)))), 1400)
    return () => clearTimeout(tm)
  }, [members])
  return leaving
}

/** Short-lived pulses on an orb: agree light (shift), vote light (finale), reserve hop. */
function usePulses(): Partial<Record<MemberId, { kind: 'agree' | 'vote' | 'hop'; n: number }>> {
  const prompt = useNavi(s => s.room.prompt)
  const [pulses, setPulses] = useState<Partial<Record<MemberId, { kind: 'agree' | 'vote' | 'hop'; n: number }>>>({})
  const seen = useRef<Record<string, true>>({})
  const bump = (id: MemberId, kind: 'agree' | 'vote' | 'hop') => setPulses(p => ({ ...p, [id]: { kind, n: (p[id]?.n ?? 0) + 1 } }))
  useEffect(() => {
    if (!prompt) return
    for (const [id, ok] of Object.entries(prompt.agree ?? {})) {
      const k = `${prompt.id}|a|${id}`
      if (ok && !seen.current[k]) {
        seen.current[k] = true
        bump(id as MemberId, 'agree')
      }
    }
    for (const id of Object.keys(prompt.votes ?? {})) {
      const k = `${prompt.id}|v|${id}`
      if (!seen.current[k]) {
        seen.current[k] = true
        bump(id as MemberId, 'vote')
      }
    }
  }, [prompt])
  useEffect(
    () =>
      bus.on('queue/added', e => {
        if (e.source === 'member' && e.item.by !== 'me') bump(e.item.by, 'hop')
      }),
    [],
  )
  return pulses
}

function stateOf(m: Member, audioOn: boolean, leaving: boolean): OrbState {
  if (m.id === 'me') return audioOn ? 'lit' : 'empty'
  if (m.present) return 'lit'
  if (m.arriving) return 'arriving'
  if (leaving) return 'leaving'
  return 'gone'
}

// ---------------------------------------------------------------- the orb itself

function OrbLight({ state, color, size, singing, pulse }: { state: OrbState; color: string; size: number; singing: boolean; pulse?: { kind: string; n: number } }) {
  return (
    <span className={`sg-orb sg-orb--${state}${singing ? ' is-singing' : ''}`} style={{ width: size, height: size, ['--c' as string]: color }}>
      <span className="sg-orb__halo" />
      <span className="sg-orb__ring" />
      <AnimatePresence>
        {state === 'lit' || state === 'leaving' ? (
          <motion.span
            key="core"
            className="sg-orb__core"
            initial={{ scale: 0 }}
            animate={{ scale: [0, 1.2, 1] }}
            exit={{ scale: 0, opacity: 0 }}
            transition={{ duration: 0.45, times: [0, 0.6, 1], ease: 'easeOut' }}
          />
        ) : null}
      </AnimatePresence>
      {singing ? <span className="sg-orb__sing" /> : null}
      {pulse ? <span key={`${pulse.kind}${pulse.n}`} className={`sg-orb__pulse sg-orb__pulse--${pulse.kind}`} /> : null}
    </span>
  )
}

function Bubble({ member }: { member: MemberId }) {
  const trr = useTr()
  const b = useNavi(s => {
    for (let i = s.room.bubbles.length - 1; i >= 0; i--) if (s.room.bubbles[i].member === member) return s.room.bubbles[i]
    return null
  })
  return (
    <AnimatePresence>
      {b ? (
        <motion.span
          key={b.id}
          className="sg-bubble"
          initial={{ opacity: 0, y: 6, scale: 0.7 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -6, transition: { duration: 0.2 } }}
          transition={{ type: 'spring', stiffness: 500, damping: 20 }}
        >
          {trr(b.text)}
        </motion.span>
      ) : null}
    </AnimatePresence>
  )
}

// ---------------------------------------------------------------- floor layout (phone hero)

function FloorOrbs() {
  const t = S.useT()
  const name = useMemberName()
  const m = usePhoneMetrics()
  const members = useNavi(s => s.room.members)
  const audioOn = useNavi(s => s.session.audioOn)
  const singer = useNavi(s => s.room.now?.item.by ?? null)
  const duetWith = useNavi(s => s.room.now?.item.with ?? null)
  const leaving = useLeaving(members)
  const pulses = usePulses()
  const box = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(0)
  // bubbles float above the mood word, so they live in the hero's own stacking layer
  const [heroEl, setHeroEl] = useState<HTMLElement | null>(null)

  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    setHeroEl((el.closest('[data-testid="hero"]') as HTMLElement | null) ?? null)
    const measure = () => setW(el.clientWidth)
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // the silver "you" light pops into the ring on the first tap (SPEC B-4)
  const hadAudio = useRef(audioOn)
  useEffect(() => {
    if (audioOn && !hadAudio.current) setTimeout(() => sound.play('orbPop'), 140)
    hadAudio.current = audioOn
  }, [audioOn])

  useEffect(() => {
    ensureResolver()
    return () => {
      floorEls.clear()
      releaseResolver()
    }
  }, [])

  const size = m.small ? 22 : 28
  const meSize = m.small ? 26 : 32
  const cy = m.small ? 12 : 16
  const meCy = cy + (m.small ? 2 : 3)
  const ball = { x: w / 2, y: m.ballCy - m.horizon, r: m.ball / 2 }

  return (
    <div ref={box} className={`sg-floor${m.small ? ' is-small' : ''}`} data-anchor="orbs">
      {w > 0 ? (
        <svg className="sg-threads" width={w} height={1} viewBox={`0 0 ${w} 1`} aria-hidden="true">
          <defs>
            {FLOOR_SLOTS.map(sl => {
              const mem = members[sl.id]
              if (!mem) return null
              return (
                <linearGradient key={sl.id} id={`sgth-${sl.id}`} gradientUnits="userSpaceOnUse" x1={sl.x * w} y1={sl.front ? meCy : cy} x2={ball.x} y2={ball.y}>
                  <stop offset="0" stopColor={lightColor(mem, true)} stopOpacity="0.95" />
                  <stop offset="1" stopColor="#FFF6D8" stopOpacity="0.05" />
                </linearGradient>
              )
            })}
          </defs>
          {FLOOR_SLOTS.map(sl => {
            const mem = members[sl.id]
            if (!mem) return null
            const st = stateOf(mem, audioOn, !!leaving[sl.id])
            if (st !== 'lit') return null
            const o = { x: sl.x * w, y: sl.front ? meCy : cy }
            const e = threadEnd(o, ball, 0.92)
            const intro = introPending(INTRO_KEY[sl.id])
            const delay = sl.id !== 'me' && intro ? introDelay(INTRO_KEY[sl.id]) + 0.25 : 0.2
            return (
              <motion.line
                key={`${sl.id}-${st}`}
                x1={o.x}
                y1={o.y - (sl.front ? meSize : size) / 2}
                x2={e.x}
                y2={e.y}
                stroke={`url(#sgth-${sl.id})`}
                className={`sg-thread sg-thread--${sl.id}`}
                strokeWidth={1.1}
                initial={{ pathLength: 0, opacity: 0 }}
                animate={{ pathLength: 1, opacity: 1 }}
                transition={{ pathLength: { duration: 0.3, delay, ease: 'easeOut' }, opacity: { duration: 0.1, delay } }}
              />
            )
          })}
        </svg>
      ) : null}
      {w > 0
        ? FLOOR_SLOTS.map((sl, i) => {
            // a small light travels up each thread now and then: the ball is reading the room
            const mem = members[sl.id]
            if (!mem || stateOf(mem, audioOn, !!leaving[sl.id]) !== 'lit') return null
            const sz0 = sl.front ? meSize : size
            const o = { x: sl.x * w, y: (sl.front ? meCy : cy) - sz0 / 2 }
            const e = threadEnd({ x: o.x, y: o.y + sz0 / 2 }, ball, 0.92)
            return (
              <span
                key={`spark-${sl.id}`}
                className="sg-spark"
                aria-hidden="true"
                style={{
                  left: o.x,
                  top: o.y,
                  ['--dx' as string]: `${(e.x - o.x).toFixed(1)}px`,
                  ['--dy' as string]: `${(e.y - o.y).toFixed(1)}px`,
                  ['--c' as string]: lightColor(mem, true),
                  animationDelay: `${(1.2 + i * 1.3).toFixed(1)}s`,
                }}
              />
            )
          })
        : null}
      {FLOOR_SLOTS.map(sl => {
        const mem = members[sl.id]
        if (!mem) return null
        const st = stateOf(mem, audioOn, !!leaving[sl.id])
        if (st === 'gone') return null
        const k = INTRO_KEY[sl.id]
        const intro = introPending(k)
        const sz = sl.front ? meSize : size
        const singing = st === 'lit' && (singer === sl.id || duetWith === sl.id)
        return (
          <motion.div
            key={sl.id}
            ref={el => {
              if (el) floorEls.set(sl.id, el)
              else floorEls.delete(sl.id)
            }}
            className={`sg-seat${sl.front ? ' is-front' : ''} sg-seat--${st}`}
            data-testid="member-orb"
            data-member={sl.id}
            data-present={mem.present ? '1' : '0'}
            data-arriving={mem.arriving ? '1' : '0'}
            data-state={st}
            style={{ left: `${sl.x * 100}%`, top: sl.front ? meCy : cy }}
            initial={intro ? { opacity: 0, scale: sl.id === 'me' || sl.id === 'jun' ? 0.6 : 0 } : false}
            animate={st === 'leaving' ? { opacity: [1, 0.55, 0.55, 0], scale: [1, 0.92, 0.92, 0.6] } : { opacity: 1, scale: sl.id === 'me' || sl.id === 'jun' ? 1 : [0, 1.2, 1] }}
            transition={
              st === 'leaving'
                ? { duration: 1.3, times: [0, 0.3, 0.75, 1] }
                : intro
                  ? { duration: sl.id === 'me' || sl.id === 'jun' ? 0.3 : 0.45, times: sl.id === 'me' || sl.id === 'jun' ? undefined : [0, 0.6, 1], delay: introDelay(k), ease: 'easeOut' }
                  : { duration: 0.2 }
            }
          >
            <OrbLight state={st} color={lightColor(mem, true)} size={sz} singing={singing} pulse={pulses[sl.id]} />
            <span className="sg-seat__reflect" style={{ ['--c' as string]: lightColor(mem, true) }} />
            <span className="sg-seat__name">{name(sl.id)}</span>
            {st === 'arriving' ? (
              <span className="sg-seat__status">
                {t('orbArriving')}
              </span>
            ) : null}
          </motion.div>
        )
      })}
      {(() => {
        const layer = (
          <div className="sg-bubbles" style={{ top: heroEl ? m.horizon : 0 }} aria-live="polite">
            {FLOOR_SLOTS.map(sl => {
              const mem = members[sl.id]
              if (!mem || sl.id === 'me' || stateOf(mem, audioOn, !!leaving[sl.id]) !== 'lit') return null
              return (
                <div key={sl.id} className="sg-bubble-anchor" style={{ left: `${sl.x * 100}%`, top: cy, ['--sz' as string]: `${size}px` }}>
                  <Bubble member={sl.id} />
                </div>
              )
            })}
          </div>
        )
        return heroEl ? createPortal(layer, heroEl) : layer
      })()}
    </div>
  )
}

// ---------------------------------------------------------------- column layout (room screen)

const COLUMN_ORDER: MemberId[] = ['minato', 'saki', 'jun', 'me']

function ColumnOrbs() {
  const t = S.useT()
  const name = useMemberName()
  const members = useNavi(s => s.room.members)
  const singer = useNavi(s => s.room.now?.item.by ?? null)
  const duetWith = useNavi(s => s.room.now?.item.with ?? null)
  const leaving = useLeaving(members)
  const pulses = usePulses()
  useEffect(() => {
    ensureResolver()
    return () => {
      columnEls.clear()
      releaseResolver()
    }
  }, [])
  return (
    <div className="sg-colorbs" data-anchor="orbs">
      {COLUMN_ORDER.map(id => {
        const mem = members[id]
        if (!mem) return null
        // The shared screen shows me as a steady light: no first-tap state, no voice colour.
        const st: OrbState = id === 'me' ? 'lit' : stateOf(mem, true, !!leaving[id])
        if (st === 'gone') return null
        const intro = introPending(INTRO_KEY[id])
        const singing = st === 'lit' && (singer === id || duetWith === id)
        const color = lightColor(mem, false)
        return (
          <motion.div
            key={id}
            ref={el => {
              if (el) columnEls.set(id, el)
              else columnEls.delete(id)
            }}
            className={`sg-crow sg-crow--${st}${singing ? ' is-singing' : ''}`}
            data-testid="member-orb"
            data-member={id}
            data-present={mem.present ? '1' : '0'}
            data-arriving={mem.arriving ? '1' : '0'}
            data-state={st}
            style={{ ['--c' as string]: color }}
            initial={intro ? { opacity: 0, x: 16 } : false}
            animate={st === 'leaving' ? { opacity: [1, 0.5, 0.5, 0] } : { opacity: 1, x: 0 }}
            transition={st === 'leaving' ? { duration: 1.3, times: [0, 0.3, 0.75, 1] } : { duration: 0.4, delay: intro ? introDelay(INTRO_KEY[id]) : 0 }}
          >
            {st === 'lit' ? <motion.span key={`beam-${id}-${mem.joinedAt ?? 0}`} className="sg-crow__beam" initial={{ scaleX: 0, opacity: 1 }} animate={{ scaleX: 1, opacity: [1, 1, 0.35] }} transition={{ duration: 0.6, delay: intro ? introDelay(INTRO_KEY[id]) + 0.1 : 0.05 }} /> : null}
            <OrbLight state={st} color={color} size={26} singing={singing} pulse={pulses[id as OtherId]} />
            <span className="sg-crow__txt">
              <span className="sg-crow__name">{name(id)}</span>
              {st === 'arriving' ? <span className="sg-crow__status">{t('orbArriving')}</span> : singing ? <span className="sg-crow__status is-sing">{t('orbSinging')}</span> : null}
            </span>
            {id !== 'me' ? <Bubble member={id} /> : null}
          </motion.div>
        )
      })}
    </div>
  )
}

export function MemberOrbs(p: { layout: 'floor' | 'column' }): JSX.Element {
  return p.layout === 'floor' ? <FloorOrbs /> : <ColumnOrbs />
}
