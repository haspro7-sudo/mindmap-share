// "ON STAGE" (QA OWNER#3, handshake 7): the moment my own song starts, the whole phone becomes a
// stage for ~2 s. A warm beam falls from the top onto the ball, the rest of the room goes dark,
// the song title stands in big type with "you", and the floor lights (my friends) throw applause
// sparks in their colours. Then it steps back: the title shrinks into the lane's NOW chip, which
// keeps a gold pulse while I sing. Tap anywhere to skip. Reduced motion: a still version.
// Everything that moves is transform/opacity; the beam and glows are static gradients.
import { motion } from 'motion/react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { MemberId, QueueItem } from '../../core/types'
import { naviApi, useNavi } from '../../core/store'
import { bus } from '../../core/events'
import { sound } from '../../core/sound'
import { usePhoneMetrics } from '../../core/layout'
import { SongTitle } from '../../core/ui/SongTitle'
import { SONG_BY_ID } from '../../data/songs'
import { S } from './strings'
import { lightColor } from './model'
import { floorOrbEl } from './MemberOrbs'
import './stage.css'

/** How long the moment holds before stepping back (the exit adds ~0.5 s: 2.25 s in all). */
export const MOMENT_HOLD_MS = 1750
const MOMENT_OUT_MS = 480

type Moment = { item: QueueItem; n: number }
type Spark = { key: string; x: number; y: number; dx: number; dy: number; c: string; d: number; s: number; star: boolean }

const SPARKS_PER_ORB = 8
const VOLLEYS = [0.3, 0.86, 1.42]

/** Applause sparks from each friend's floor light, in local (unscaled) phone coordinates. */
function makeSparks(host: HTMLElement, n: number): Spark[] {
  const s = naviApi.getState()
  const hr = host.getBoundingClientRect()
  const scale = host.offsetWidth > 0 ? hr.width / host.offsetWidth : 1
  const out: Spark[] = []
  const ids: MemberId[] = ['minato', 'saki', 'jun']
  ids.forEach((id, k) => {
    const m = s.room.members[id]
    const el = floorOrbEl(id)
    if (!m?.present || !el || !el.isConnected) return
    const r = el.getBoundingClientRect()
    if (!r.width) return
    const x = (r.left - hr.left + r.width / 2) / scale
    const y = (r.top - hr.top + r.height / 2) / scale
    const c = lightColor(m, true)
    VOLLEYS.forEach((d0, v) => {
      for (let i = 0; i < SPARKS_PER_ORB; i++) {
        // a little fountain: upward, fanned, each orb slightly different (deterministic per turn)
        const f = (i + 0.5) / SPARKS_PER_ORB
        const wob = Math.sin((n + 1) * 7.3 + k * 3.1 + i * 1.7 + v * 2.3)
        const ang = (-90 + (f - 0.5) * 110 + wob * 9) * (Math.PI / 180)
        const dist = 78 + 86 * Math.abs(Math.sin(i * 2.1 + k + v))
        out.push({
          key: `${id}-${v}-${i}`,
          x,
          y,
          dx: Math.cos(ang) * dist,
          dy: Math.sin(ang) * dist,
          c,
          d: d0 + i * 0.035 + k * 0.06,
          s: 7 + ((i + k + v) % 3) * 2,
          star: (i + v) % 2 === 1,
        })
      }
    })
  })
  return out
}

export function StageMoment(): JSX.Element {
  const anchor = useRef<HTMLSpanElement>(null)
  const [host, setHost] = useState<HTMLElement | null>(null)
  const [moment, setMoment] = useState<Moment | null>(null)
  const nowId = useNavi(s => s.room.now?.item.id ?? null)

  useLayoutEffect(() => {
    setHost((anchor.current?.closest('[data-shell="phone"]') as HTMLElement | null) ?? null)
  }, [])

  // only a live transition into my turn plays it (never a reload that finds my song on)
  useEffect(() => {
    let n = 0
    return bus.on('turn/mine', e => {
      const s = naviApi.getState()
      if (s.session.phase !== 'live' || s.ui.overlay) return
      setMoment({ item: e.item, n: ++n })
    })
  }, [])

  // my song ended (or was finished) before the moment was over: step back at once
  useEffect(() => {
    if (moment && nowId !== moment.item.id) setMoment(null)
  }, [nowId, moment])

  return (
    <>
      <span ref={anchor} hidden />
      {host && moment ? createPortal(<MomentView key={moment.n} moment={moment} host={host} onDone={() => setMoment(null)} />, host) : null}
    </>
  )
}

function MomentView({ moment, host, onDone }: { moment: Moment; host: HTMLElement; onDone: () => void }) {
  const t = S.useT()
  const m = usePhoneMetrics()
  const reduced = useNavi(s => s.ui.reduced)
  // on the other tabs there is no hero under the beam: an even dark room, the title in the middle
  const onHero = useNavi(s => s.ui.tab === 'discover')
  // 'tap': the tap that skipped it is swallowed until it is gone; 'timer': taps pass through at once
  const [out, setOut] = useState<null | 'tap' | 'timer'>(null)
  const [fly, setFly] = useState<{ x: number; y: number } | null>(null)
  const card = useRef<HTMLDivElement>(null)
  const done = useRef(onDone)
  done.current = onDone
  const outTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(
    () => () => {
      if (outTimer.current) clearTimeout(outTimer.current)
    },
    [],
  )
  const sparks = useMemo(() => (reduced ? [] : makeSparks(host, moment.n)), [host, moment.n, reduced])
  const song = SONG_BY_ID[moment.item.songId]

  const leave = (by: 'tap' | 'timer') => {
    // the title steps back into the lane's NOW chip (it keeps a gold pulse there)
    const chip = host.querySelector<HTMLElement>('[data-testid="lane-now"]')
    const el = card.current
    // (only when that chip is on screen: the sing tab hides the lane)
    if (chip && el && !reduced && !chip.closest('.is-hidden')) {
      const a = chip.getBoundingClientRect()
      const b = el.getBoundingClientRect()
      const hr = host.getBoundingClientRect()
      const scale = host.offsetWidth > 0 ? hr.width / host.offsetWidth : 1
      if (a.width && b.width) setFly({ x: (a.left + a.width / 2 - (b.left + b.width / 2)) / scale, y: (a.top + a.height / 2 - (b.top + b.height / 2)) / scale })
    }
    setOut(o => o ?? by)
    // unmount after the exit, timed from the moment it starts (not from a later effect flush)
    if (!outTimer.current) outTimer.current = setTimeout(() => done.current(), MOMENT_OUT_MS)
  }

  useEffect(() => {
    sound.play('lightOn')
    sound.haptic([14, 60, 14])
    const id = setTimeout(() => leave('timer'), reduced ? MOMENT_HOLD_MS + 150 : MOMENT_HOLD_MS)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const top = m.status + m.lane + m.search
  const vars = {
    ['--sm-ball' as string]: `${top + m.ballCy}px`,
    ['--sm-horizon' as string]: `${top + m.horizon}px`,
    ['--sm-herob' as string]: `${top + m.hero}px`,
    ['--sm-ballr' as string]: `${m.ball / 2}px`,
  }
  const cardTop = onHero ? top + m.hero + (m.small ? 22 : 34) : Math.round(m.status + (m.small ? 330 : 400))
  const still = reduced

  return (
    <motion.div
      className={`sg-moment${onHero ? '' : ' is-tab'}${m.small ? ' is-small' : ''}${still ? ' is-still' : ''}${out === 'timer' ? ' is-out' : ''}`}
      data-testid="stage-moment"
      data-song-id={moment.item.songId}
      data-phase={out ? 'out' : 'in'}
      role="status"
      aria-live="polite"
      style={vars}
      onPointerDown={e => {
        e.stopPropagation()
        e.preventDefault()
        leave('tap')
      }}
      initial={{ opacity: 0 }}
      animate={{ opacity: out ? 0 : 1 }}
      transition={{ duration: out ? MOMENT_OUT_MS / 1000 : still ? 0.2 : 0.32, ease: 'easeOut', delay: out && fly ? 0.12 : 0 }}
    >
      <span className="sg-moment__veil" aria-hidden="true" />
      <motion.span
        className="sg-moment__beam"
        aria-hidden="true"
        initial={still ? false : { scaleY: 0.25, opacity: 0 }}
        animate={{ scaleY: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 110, damping: 17 }}
      />
      <motion.span
        className="sg-moment__source"
        aria-hidden="true"
        initial={still ? false : { scale: 0.2, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.35, ease: 'easeOut' }}
      />
      <motion.span
        className="sg-moment__pool"
        aria-hidden="true"
        initial={still ? false : { scale: 0.3, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.6, delay: 0.18, ease: 'easeOut' }}
      />
      <span className="sg-moment__sparks" aria-hidden="true">
        {sparks.map(p => (
          <i
            key={p.key}
            className={`sg-moment__spark${p.star ? ' is-star' : ''}`}
            style={{
              left: p.x,
              top: p.y,
              width: p.s,
              height: p.s,
              marginLeft: -p.s / 2,
              marginTop: -p.s / 2,
              animationDelay: `${p.d.toFixed(2)}s`,
              ['--dx' as string]: `${p.dx.toFixed(1)}px`,
              ['--dy' as string]: `${p.dy.toFixed(1)}px`,
              ['--c' as string]: p.c,
            }}
          />
        ))}
      </span>
      <motion.div
        ref={card}
        className="sg-moment__card"
        style={{ top: cardTop }}
        initial={still ? false : { opacity: 0, y: 26, scale: 0.9 }}
        animate={out && fly ? { opacity: 0, x: fly.x, y: fly.y, scale: 0.2 } : { opacity: 1, x: 0, y: 0, scale: 1 }}
        transition={out ? { duration: 0.46, ease: [0.5, 0, 0.75, 0] } : { type: 'spring', stiffness: 260, damping: 20, delay: 0.16 }}
      >
        <span className="sg-moment__glow" aria-hidden="true" />
        <motion.span
          className="sg-moment__label"
          initial={still ? false : { opacity: 0, scaleX: 0.55 }}
          animate={{ opacity: 1, scaleX: 1 }}
          transition={{ duration: 0.45, delay: 0.12, ease: [0.2, 0.8, 0.2, 1] }}
        >
          <i aria-hidden="true" />
          {t('onStage')}
          <i aria-hidden="true" />
        </motion.span>
        <SongTitle songId={moment.item.songId} variant="card" max={m.small ? 30 : 34} min={20} className="sg-moment__title" />
        <motion.span className="sg-moment__who" initial={still ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, delay: 0.42 }}>
          <i className="sg-moment__dot" aria-hidden="true" />
          <b>{t('onStageYou')}</b>
          {song?.artist ? <span className="sg-moment__artist">{song.artist}</span> : null}
        </motion.span>
        <motion.span className="sg-moment__hint" initial={still ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.4, delay: 0.75 }}>
          {t('onStageHint')}
        </motion.span>
      </motion.div>
    </motion.div>
  )
}
