// Comparison split (SPEC H-5): static vs dynamic, side by side, in the same room at the same time.
// Left: the self-declared list, a fixed top 5 chosen by companion type only (staticList).
// Right: the dealer's current hand with the one-line reason and its cause. When something
// happens in the room (join / leave / mixer / an event card), only the right side re-reads and
// flashes "updated: <cause>"; the left side says "no change". No competitor is named.
// All visible text comes from the planner strings (ja + en).
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useLayoutEffect, useMemo, useState, type CSSProperties } from 'react'
import { naviApi, useNavi } from '../../core/store'
import { useNaviStable } from '../../core/useStable'
import { useViewMode } from '../../core/layout'
import { bus } from '../../core/events'
import { FRAME_OF, type CardFrame, type CardKind, type CardVariant, type Reason, type TextRef } from '../../core/types'
import { SongTitle } from '../../core/ui/SongTitle'
import { SONG_BY_ID } from '../../data/songs'
import { palette } from '../../lib/art'
import { useTr } from '../../i18n'
import { planner } from './strings'
import { staticList } from './staticList'
import './planner.css'

type Row = { id: string; kind: CardKind; variant?: CardVariant; songId?: string; reason: Reason; rule: string }

/** A tiny outline of the card's frame, so the kinds read by shape here too (C-7). */
function FrameGlyph({ frame }: { frame: CardFrame }) {
  const s = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.4 } as const
  let body: JSX.Element
  switch (frame) {
    case 'medallion':
      body = <circle cx="12" cy="12" r="8" {...s} />
      break
    case 'band':
      body = <rect x="3" y="7" width="18" height="10" rx="3" {...s} />
      break
    case 'constellation':
      body = (
        <g {...s}>
          <path d="M12 12L6 6M12 12l7-3M12 12l-2 7" />
          <circle cx="12" cy="12" r="2" fill="currentColor" />
          <circle cx="6" cy="6" r="1.4" />
          <circle cx="19" cy="9" r="1.4" />
          <circle cx="10" cy="19" r="1.4" />
        </g>
      )
      break
    case 'arch':
      body = <path d="M6 20V11a6 6 0 0 1 12 0v9z" {...s} />
      break
    case 'facet':
      body = <path d="M5 7q7-3 14 0l-2 11q-5 2-10 0z" {...s} />
      break
    case 'ticket':
      body = <path d="M4 7h16v3a2 2 0 0 0 0 4v3H4v-3a2 2 0 0 0 0-4z M15 7v10" {...s} />
      break
    case 'stitch':
      body = (
        <g {...s}>
          <rect x="5" y="4" width="14" height="16" rx="3" />
          <rect x="7.5" y="6.5" width="9" height="11" rx="1.5" strokeDasharray="1.6 1.6" />
        </g>
      )
      break
    case 'coaster':
      body = <path d="M6 5q3 -1.5 6 0t6 0q1.5 3 0 7t0 7q-3 1.5-6 0t-6 0q-1.5-3 0-7t0-7z" {...s} />
      break
    case 'triptych':
      body = (
        <g {...s}>
          <path d="M4 20V10a8 8 0 0 1 16 0v10z" />
          <circle cx="8.5" cy="14" r="1.3" fill="currentColor" />
          <circle cx="12" cy="12.5" r="1.3" fill="currentColor" />
          <circle cx="15.5" cy="14" r="1.3" fill="currentColor" />
        </g>
      )
      break
    case 'pill':
      body = <rect x="3" y="8" width="18" height="8" rx="4" {...s} />
      break
    case 'passport':
      body = (
        <g {...s}>
          <rect x="6" y="4" width="12" height="16" rx="2" strokeDasharray="1.2 1.4" />
          <rect x="8.5" y="7" width="7" height="6" rx="1" />
        </g>
      )
      break
    default:
      body = <rect x="7" y="4" width="10" height="16" rx="3" {...s} />
  }
  return (
    <svg className="sv-glyph" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      {body}
    </svg>
  )
}

function Swatch({ songId }: { songId: string }) {
  const p = palette(songId, SONG_BY_ID[songId]?.energy ?? 0.5)
  return <i className="sv-swatch" style={{ background: `linear-gradient(135deg, ${p.a}, ${p.b})` } as CSSProperties} />
}

type Rect = { left: number; top: number; right: number; bottom: number; width: number; height: number }
const rectOf = (sel: string): Rect | null => {
  const r = document.querySelector(sel)?.getBoundingClientRect()
  return r && r.width > 4 && r.height > 4 ? r : null
}

/**
 * Where the panel goes (QA DEMO#0, handshake 8).
 * · room / dual: inside the room screen's centre column (the ball area), under its status bar —
 *   the lane stays readable on the left, the members on the right, and the bottom-right corner is
 *   left to the presenter's pill. If the presenter's panel still reaches into that column, the split
 *   slides left of it or ends above it: its right side (新ナビ) and the 更新 flash are never covered.
 * · phone: over the deck, between the hero and the dock; when the presenter's pill sits in that band
 *   (docked above the action bar) the split ends above it, taking the hero's room if it must.
 * Re-placed on resize and on a slow poll (the pill can be dragged).
 */
export function placeSplit(wide: boolean, vw: number, vh: number, q: (sel: string) => Rect | null = rectOf): CSSProperties {
  const pp = q('[data-testid="presenter-panel"]')
  if (wide) {
    const centre = q('[data-shell="room"] .rs-centre')
    const status = q('[data-shell="room"] .rs-status')
    const room = q('[data-shell="room"]')
    const want = centre ? Math.min(560, Math.max(360, centre.width - 16)) : Math.min(460, Math.max(320, vw * 0.34))
    let width = Math.min(want, vw - 16)
    let left = centre ? centre.left + (centre.width - width) / 2 : vw - 16 - width
    const top = Math.round((status && status.bottom < vh * 0.3 ? status.bottom : 48) + 10)
    let bottom = vh - 16
    if (pp) {
      const floorLeft = Math.max(8, room ? room.left + 8 : 8)
      const clash = () => left < pp.right + 12 && pp.left - 12 < left + width
      if (clash() && pp.top > vh * 0.45) bottom = Math.min(bottom, pp.top - 12) // the pill (or a short panel) at the bottom
      else if (clash()) {
        // a tall panel on the right: end the split left of it, keeping at least a readable width
        const right = pp.left - 12
        width = Math.min(width, Math.max(320, right - floorLeft))
        left = Math.max(8, right - width)
        if (clash() && pp.top > top + 240) bottom = Math.min(bottom, pp.top - 12)
      }
    }
    left = Math.max(8, Math.min(left, vw - 8 - width))
    return { left: Math.round(left), top, width: Math.round(width), maxHeight: Math.max(200, Math.round(bottom - top)) }
  }
  const hero = q('[data-shell="phone"] [data-testid="hero"]')
  const dock = q('[data-shell="phone"] [data-anchor="dock"]')
  const shell = q('[data-shell="phone"]')
  let top = hero && hero.bottom > 80 ? hero.bottom - 6 : vh * 0.45
  let bottom = dock && dock.top > top + 200 ? dock.top - 6 : vh - 84
  const left = shell ? Math.max(6, shell.left + 6) : 6
  const right = shell ? Math.max(6, vw - shell.right + 6) : 6
  if (pp && pp.bottom > top && pp.top < bottom) {
    // the larger free band beside the presenter's pill/panel; above it, the hero may give its room
    const upTop = hero && pp.top - 8 > hero.top + 4 ? Math.max(hero.top + 4, pp.top - 8 - 460) : top
    const above = pp.top - 8 - Math.min(top, upTop)
    const below = bottom - (pp.bottom + 8)
    if (below >= above) top = pp.bottom + 8
    else {
      bottom = pp.top - 8
      if (bottom - top < 300) top = Math.min(top, upTop)
    }
  }
  // as tall as its content: below it the deck (the subject of the comparison) stays in view
  return { left, right, top: Math.round(top), maxHeight: Math.max(220, Math.round(bottom - top)) }
}

function usePlacement(wide: boolean): CSSProperties {
  const [style, setStyle] = useState<CSSProperties>({})
  useLayoutEffect(() => {
    const place = () => {
      const next = placeSplit(wide, window.innerWidth, window.innerHeight)
      setStyle(prev => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next))
    }
    place()
    window.addEventListener('resize', place)
    const poll = window.setInterval(place, 500)
    return () => {
      window.removeEventListener('resize', place)
      window.clearInterval(poll)
    }
  }, [wide])
  return style
}

function StaticCol({ ids, companion, stamp }: { ids: string[]; companion: string; stamp: number }) {
  const t = planner.useT()
  return (
    <div className="sv-col sv-col--static" data-testid="split-static">
      <header className="sv-col__head">
        <span className="sv-col__title">{t('split.static')}</span>
      </header>
      <p className="sv-col__sub sv-col__sub--row">
        <span className="sv-col__chip">{t('split.situation', { c: t(`comp.${companion}` as 'comp.friends') })}</span>
      </p>
      <div className="sv-listwrap">
        <ol className="sv-list">
          {ids.map((id, i) => (
            <li key={id} className="sv-row sv-row--static" data-song-id={id}>
              <span className="sv-rank">{i + 1}</span>
              <Swatch songId={id} />
              <span className="sv-row__main">
                <SongTitle songId={id} variant="chip" className="sv-title" />
                <span className="sv-artist">{SONG_BY_ID[id]?.artist}</span>
              </span>
              <svg className="sv-lock" viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
                <path d="M4.5 7h7v6h-7z M6 7V5.2a2 2 0 0 1 4 0V7" fill="none" stroke="currentColor" strokeWidth="1.3" />
              </svg>
            </li>
          ))}
        </ol>
        <p className="sv-col__explain">{t('split.fixed')}</p>
        <AnimatePresence>
          {stamp ? (
            <motion.span
              key={stamp}
              className="sv-nochange"
              initial={{ opacity: 0, scale: 1.6, rotate: -9 }}
              animate={{ opacity: 1, scale: 1, rotate: -9 }}
              exit={{ opacity: 0, transition: { duration: 0.4 } }}
              transition={{ type: 'spring', stiffness: 420, damping: 18, delay: 0.25 }}
            >
              {t('split.nochange')}
            </motion.span>
          ) : null}
        </AnimatePresence>
      </div>
    </div>
  )
}

function DynRow({ row, i, wave }: { row: Row; i: number; wave: number }) {
  const tr = useTr()
  const t = planner.useT()
  const frame = FRAME_OF(row)
  const title = row.songId ? (
    <SongTitle songId={row.songId} variant="chip" className="sv-title" />
  ) : (
    <span className="sv-title">{t(`kind.${row.kind}` as 'kind.song')}</span>
  )
  return (
    <motion.li
      className={`sv-row sv-row--dyn${i === 0 ? ' is-top' : ''}`}
      data-song-id={row.songId ?? ''}
      data-kind={row.kind}
      initial={{ opacity: 0, rotateX: -80, y: -6 }}
      animate={{ opacity: 1, rotateX: 0, y: 0 }}
      exit={{ opacity: 0, transition: { duration: 0.15 } }}
      transition={{ type: 'spring', stiffness: 300, damping: 24, delay: wave ? i * 0.12 : 0 }}
    >
      <span className={`sv-kind sv-kind--${frame}`}>
        <FrameGlyph frame={frame} />
      </span>
      <span className="sv-row__main">
        <span className="sv-row__line">
          {title}
          <span className="sv-kindname">{t(`kind.${row.kind}` as 'kind.song')}</span>
        </span>
        <span className="sv-reason">{tr(row.reason.text)}</span>
        {row.reason.cause ? <span className="sv-cause">{tr(row.reason.cause)}</span> : null}
      </span>
    </motion.li>
  )
}

function DynamicCol({ rows, flash, wave }: { rows: Row[]; flash: { cause: TextRef; at: number } | null; wave: number }) {
  const tr = useTr()
  const t = planner.useT()
  return (
    <div className={`sv-col sv-col--dyn${flash ? ' is-flash' : ''}`} data-testid="split-dynamic">
      <header className="sv-col__head">
        <span className="sv-col__title">
          <i className="sv-live" />
          {t('split.dynamic')}
        </span>
      </header>
      <p className="sv-col__sub sv-wide-only">{t('split.live')}</p>
      <div className={`sv-flash${flash ? '' : ' is-idle'}`} data-testid="split-flash">
        {flash ? <i key={flash.at} className="sv-flash__sweep" /> : null}
        <motion.span key={flash?.at ?? 'idle'} className="sv-flash__text" initial={{ opacity: 0, y: flash ? -5 : 0 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22 }}>
          {flash ? t('split.updated', { cause: tr(flash.cause) }) : t('split.waiting')}
        </motion.span>
      </div>
      <ol className="sv-list" style={{ perspective: 600 }}>
        <AnimatePresence initial={false}>
          {rows.map((r, i) => (
            <DynRow key={r.id} row={r} i={i} wave={wave} />
          ))}
        </AnimatePresence>
      </ol>
    </div>
  )
}

function SplitPanel() {
  const view = useViewMode()
  const t = planner.useT()
  const wide = view !== 'phone' || window.innerWidth >= 700
  const style = usePlacement(wide)
  const small = !wide && (window.innerWidth < 375 || window.innerHeight < 760 || (typeof style.maxHeight === 'number' && style.maxHeight < 380))
  // a split inside the room's centre column is narrower than a side sheet: rows drop the lock glyph
  const narrow = wide && typeof style.width === 'number' && style.width < 480
  // the declared situation is frozen when the split opens: that is what "self-declared" means
  const [companion] = useState(() => naviApi.getState().room.mood.companion)
  const ids = useMemo(() => staticList(companion), [companion])
  const rows = useNaviStable(s =>
    s.deck.cards.slice(0, 5).map(
      (c): Row => ({ id: c.id, kind: c.kind, ...(c.variant ? { variant: c.variant } : {}), ...(c.songId ?? c.options?.[0] ? { songId: c.songId ?? c.options?.[0] } : {}), reason: c.reason, rule: c.rule }),
    ),
  )
  const [flash, setFlash] = useState<{ cause: TextRef; at: number } | null>(null)
  const [count, setCount] = useState(0)
  const [wave, setWave] = useState(0)
  useEffect(() => {
    const hit = (cause: TextRef) => {
      setFlash({ cause, at: Date.now() })
      setCount(n => n + 1)
      setWave(w => w + 1)
    }
    const off = bus.on('deck/redeal', e => hit(e.cause))
    const unsub = naviApi.subscribe((s, p) => {
      const a = s.deck.cards[0]
      const b = p.deck.cards[0]
      // an event card landing on top (voice, shift, finale, link, coaster...) is a re-read too
      if (a && a.id !== b?.id && a.reason.cause && a.rule.startsWith('insert.') && !p.deck.cards.some(c => c.id === a.id)) hit(a.reason.cause)
    })
    return () => {
      off()
      unsub()
    }
  }, [])
  useEffect(() => {
    if (!flash) return
    const id = window.setTimeout(() => setFlash(f => (f && f.at === flash.at ? null : f)), 3200)
    return () => window.clearTimeout(id)
  }, [flash])
  return (
    <motion.div
      className={`sv-root${wide ? ' is-wide' : ''}${small ? ' is-small' : ''}${narrow ? ' is-narrow' : ''}`}
      data-testid="split-view"
      style={{ pointerEvents: 'none' }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25 }}
    >
      <motion.section
        className="sv-panel"
        style={{ ...style, pointerEvents: 'auto' }}
        {...(view === 'room' ? { 'data-private': '1' } : {})}
        initial={{ opacity: 0, y: wide ? 0 : 24, x: wide ? 24 : 0 }}
        animate={{ opacity: 1, y: 0, x: 0 }}
        exit={{ opacity: 0, y: wide ? 0 : 24, x: wide ? 24 : 0 }}
        transition={{ type: 'spring', stiffness: 260, damping: 26 }}
      >
        <header className="sv-head">
          <span className="sv-head__title">{t('split.title')}</span>
          <span className="sv-score" data-testid="split-score">
            <span className="sv-score__label">{t('split.rereadsLabel')}</span>
            <b className="sv-score__static">0</b>
            <i>vs</i>
            <motion.b key={count} className="sv-score__dyn" initial={{ scale: 1.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', stiffness: 500, damping: 18 }}>
              {count}
            </motion.b>
          </span>
        </header>
        <div className="sv-cols">
          <StaticCol ids={ids} companion={companion} stamp={flash?.at ?? 0} />
          <div className="sv-divider" aria-hidden="true" />
          <DynamicCol rows={rows} flash={flash} wave={wave} />
        </div>
        <footer className="sv-note">{t('split.note')}</footer>
      </motion.section>
    </motion.div>
  )
}

export function SplitView(): JSX.Element {
  const on = useNavi(s => s.ui.split)
  return <AnimatePresence>{on ? <SplitPanel key="split" /> : null}</AnimatePresence>
}
