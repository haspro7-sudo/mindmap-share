// Small shared pieces of the stage module: progress ring, song disc, anonymous mini dots,
// tag pills, one-line fitting text and the "incoming" choreography for lane chips.
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { motion } from 'motion/react'
import type { Member, MemberId, NowPlaying, QueueTag, SongId } from '../../core/types'
import { useNavi } from '../../core/store'
import { useNaviStable } from '../../core/useStable'
import { selKnowView } from '../../core/selectors'
import { ticker } from '../../core/ticker'
import { simNow } from '../../core/clock'
import { bus } from '../../core/events'
import { SONG_BY_ID } from '../../data/songs'
import { palette } from '../../lib/art'
import { clamp } from '../../lib/rng'
import { useTr } from '../../i18n'
import { S } from './strings'
import { signal } from './model'

// ---------------------------------------------------------------- choreography signals

/** The seam comet reached the room lane with this queue item. */
export const cometLanded = signal<string>()
/** The seam is mounted (dual view): the room lane waits for the comet before showing my songs. */
let seamCount = 0
export function markSeam(on: boolean): void {
  seamCount = Math.max(0, seamCount + (on ? 1 : -1))
}
export const seamMounted = (): boolean => seamCount > 0

// ---------------------------------------------------------------- members

const ORDER: MemberId[] = ['me', 'minato', 'saki', 'jun']
/** Present members (me first) from the members record, without touching the whole store. */
export function presentOf(members: Record<MemberId, Member>): Member[] {
  return ORDER.map(id => members[id]).filter(m => m && m.present)
}

export function useMemberName(): (id: MemberId) => string {
  const t = useTr()
  return id => t({ key: `vocab.member.${id}` })
}

// ---------------------------------------------------------------- progress ring

/**
 * Ring that fills with the song's progress. Driven by the shared ticker and written straight
 * to the SVG attribute, so a playing song never re-renders React.
 */
export function ProgressRing({ now, size, stroke = 2.5, color, waiting, children, className }: { now: NowPlaying; size: number; stroke?: number; color: string; waiting?: boolean; children?: ReactNode; className?: string }) {
  const arc = useRef<SVGCircleElement>(null)
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const id = now?.item.id
  const startedAt = now?.startedAt ?? 0
  const dur = now?.durationMs ?? 1
  useEffect(() => {
    const el = arc.current
    if (!el) return
    if (!id) {
      el.setAttribute('stroke-dashoffset', String(c))
      return
    }
    let last = -1
    const upd = () => {
      const p = clamp((simNow() - startedAt) / dur, 0, 1)
      if (Math.abs(p - last) < 0.0015) return
      last = p
      el.setAttribute('stroke-dashoffset', (c * (1 - p)).toFixed(2))
    }
    upd()
    return ticker.add(upd, 10)
  }, [id, startedAt, dur, c])
  return (
    <span className={`sg-ring${waiting ? ' is-waiting' : ''} ${className ?? ''}`} style={{ width: size, height: size, ['--rc' as string]: color }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" className="sg-ring__track" strokeWidth={stroke} strokeDasharray={waiting ? '2 3.2' : undefined} />
        <circle
          ref={arc}
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          className="sg-ring__arc"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c.toFixed(2)}
          strokeDashoffset={c.toFixed(2)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <span className="sg-ring__in">{children}</span>
    </span>
  )
}

// ---------------------------------------------------------------- song disc

/** Round swatch of a song's generated palette (cheap CSS gradient, never the full SongArt). */
export function SongDisc({ songId, size, playing, className }: { songId: SongId; size: number; playing?: boolean; className?: string }) {
  const song = SONG_BY_ID[songId]
  const p = palette(songId, song?.energy ?? 0.5)
  return (
    <span className={`sg-disc${playing ? ' is-playing' : ''} ${className ?? ''}`} style={{ width: size, height: size, background: `radial-gradient(circle at 32% 28%, ${p.c} 0%, ${p.a} 34%, ${p.b} 70%, ${p.deep} 100%)` }} aria-hidden="true">
      {playing ? (
        <span className="sg-eq">
          <i />
          <i />
          <i />
        </span>
      ) : null}
    </span>
  )
}

// ---------------------------------------------------------------- anonymous mini dots

/**
 * Tiny anonymous "knows it" dots for lane chips and the room screen. Lit dots come first in
 * arrival order; "no" and "no answer" are the same empty ring. No "?" marker here, so the
 * shared screen never hints at whose answer is missing.
 */
export function MiniDots({ songId, size = 5, className }: { songId: SongId; size?: number; className?: string }) {
  const view = useNaviStable(selKnowView(songId))
  if (!view) return null
  return (
    <span className={`sg-mdots ${className ?? ''}`} role="img" aria-label={`${view.knows}/${view.size}`} data-knows={view.knows} data-size={view.size} data-all={view.all ? '1' : '0'}>
      {view.dots.map((d, i) => (
        <motion.i
          key={`${i}:${d}`}
          className={`sg-mdot sg-mdot--${d}`}
          style={{ width: size, height: size }}
          initial={d === 'empty' ? false : { scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: 'spring', stiffness: 500, damping: 16 }}
        />
      ))}
    </span>
  )
}

// ---------------------------------------------------------------- tags

const TAG_ORDER: QueueTag[] = ['finale', 'navi', 'request', 'duet', 'visa', 'insert', 'room']

export function TagIcon({ tag }: { tag: QueueTag }) {
  switch (tag) {
    case 'navi':
      return (
        <svg viewBox="0 0 12 12" className="sg-tagi" aria-hidden="true">
          <path d="M6 .8l1.3 3.4 3.5.4-2.7 2.3.9 3.5L6 8.5 3 10.4l.9-3.5L1.2 4.6l3.5-.4z" fill="currentColor" />
        </svg>
      )
    case 'finale':
      return (
        <svg viewBox="0 0 12 12" className="sg-tagi" aria-hidden="true">
          <path d="M3.2 3.2h5.6l-.6 6.2H3.8z" fill="currentColor" opacity=".9" />
          <path d="M4.4 3.2V1.6h3.2v1.6M6 9.4v1.8" stroke="currentColor" strokeWidth="1" fill="none" />
        </svg>
      )
    case 'request':
      return (
        <svg viewBox="0 0 12 12" className="sg-tagi" aria-hidden="true">
          <circle cx="6" cy="6" r="4.4" fill="currentColor" />
          <path d="M6 3.6v4.8M3.6 6h4.8" stroke="#2a0b1a" strokeWidth="1.1" />
        </svg>
      )
    case 'duet':
      return (
        <svg viewBox="0 0 12 12" className="sg-tagi" aria-hidden="true">
          <circle cx="4.4" cy="6" r="3" fill="currentColor" opacity=".85" />
          <circle cx="7.6" cy="6" r="3" fill="none" stroke="currentColor" strokeWidth="1.1" />
        </svg>
      )
    case 'visa':
      return (
        <svg viewBox="0 0 12 12" className="sg-tagi" aria-hidden="true">
          <rect x="1.4" y="2.2" width="9.2" height="7.6" rx="1.6" fill="none" stroke="currentColor" strokeWidth="1.1" strokeDasharray="1.4 1" />
          <circle cx="6" cy="6" r="1.6" fill="currentColor" />
        </svg>
      )
    case 'insert':
      return (
        <svg viewBox="0 0 12 12" className="sg-tagi" aria-hidden="true">
          <path d="M2 6h6.5M6 3.2L8.8 6 6 8.8" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )
    case 'room':
      return (
        <svg viewBox="0 0 12 12" className="sg-tagi" aria-hidden="true">
          <rect x="1.5" y="2.5" width="9" height="6" rx="1" fill="none" stroke="currentColor" strokeWidth="1.1" />
          <path d="M4 10.2h4" stroke="currentColor" strokeWidth="1.1" />
        </svg>
      )
  }
}

/** Queue tags as pills (word + icon) or icon-only badges for tight chips. */
export function TagPills({ tags, iconOnly, max = 3, className }: { tags: QueueTag[]; iconOnly?: boolean; max?: number; className?: string }) {
  const t = S.useT()
  const list = TAG_ORDER.filter(x => tags.includes(x)).slice(0, max)
  if (!list.length) return null
  return (
    <span className={`sg-tags ${className ?? ''}`}>
      {list.map(tag => (
        <span key={tag} className={`sg-tag sg-tag--${tag}${iconOnly ? ' is-icon' : ''}`} title={t(`tag.${tag}`)} data-anchor={tag === 'navi' ? 'navi-tag' : undefined}>
          <TagIcon tag={tag} />
          {iconOnly ? null : <span className="sg-tag__txt">{t(`tag.${tag}`)}</span>}
        </span>
      ))}
    </span>
  )
}

// ---------------------------------------------------------------- one-line fitting text

/** Shrinks its font size until the text fits on one line (measured on text/width change only). */
export function FitLine({ children, max, min, className, style }: { children: ReactNode; max: number; min: number; className?: string; style?: CSSProperties }) {
  const ref = useRef<HTMLDivElement>(null)
  const key = typeof children === 'string' ? children : String(Array.isArray(children) ? children.join('') : '')
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const fit = () => {
      let size = max
      el.style.fontSize = `${size}px`
      while (size > min && el.scrollWidth > el.clientWidth + 1) {
        size -= 2
        el.style.fontSize = `${size}px`
      }
    }
    fit()
    if (typeof ResizeObserver === 'undefined') return
    let w = el.clientWidth
    const ro = new ResizeObserver(() => {
      if (el.clientWidth !== w) {
        w = el.clientWidth
        fit()
      }
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [key, max, min])
  return (
    <div ref={ref} className={`sg-fit ${className ?? ''}`} style={{ fontSize: max, ...style }}>
      {children}
    </div>
  )
}

// ---------------------------------------------------------------- incoming chips

/**
 * My freshly reserved songs stay hidden until their flight lands in the lane (phone) or the
 * seam comet reaches the room lane (dual), then pop in with the "swallow". Fallback timers
 * make sure nothing stays hidden if a flight or comet never arrives.
 */
export function useIncoming(mode: 'phone' | 'room'): Record<string, true> {
  const [incoming, setIncoming] = useState<Record<string, true>>({})
  useEffect(() => {
    const timers = new Map<string, ReturnType<typeof setTimeout>>()
    const reveal = (ids: string[] | 'all') =>
      setIncoming(m => {
        const keys = ids === 'all' ? Object.keys(m) : ids.filter(id => m[id])
        if (!keys.length) return m
        const n = { ...m }
        for (const k of keys) {
          delete n[k]
          const tm = timers.get(k)
          if (tm) clearTimeout(tm)
          timers.delete(k)
        }
        return n
      })
    const offs: (() => void)[] = []
    offs.push(
      bus.on('queue/added', e => {
        if (e.source === 'member') return
        if (mode === 'room' && !seamMounted()) return
        const id = e.item.id
        setIncoming(m => ({ ...m, [id]: true }))
        timers.set(
          id,
          setTimeout(() => reveal([id]), mode === 'phone' ? 560 : 1500),
        )
      }),
    )
    if (mode === 'phone') offs.push(bus.on('fx/landed', e => (e.to === 'lane:next' || e.to === 'lane:insert' || e.to === 'lane:end' ? reveal('all') : undefined)))
    else offs.push(cometLanded.on(id => reveal([id])))
    return () => {
      offs.forEach(f => f())
      timers.forEach(clearTimeout)
    }
  }, [mode])
  return incoming
}

/** Rows in play order: NOW first when something plays. */
export function useLaneRows() {
  const now = useNavi(s => s.room.now)
  const queue = useNavi(s => s.room.queue)
  return { now, queue }
}
