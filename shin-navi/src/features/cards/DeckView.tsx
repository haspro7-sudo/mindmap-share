// The pile (SPEC C-1, C-7, B-2, C-11): the top card with its body, the two peeking silhouettes
// of the next cards, pointer gestures (flick up / right / left, tap, long-press), the redeal
// flip and the intro rise. Every flick has a button twin in ActionBar through deckCtl.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent as RPointerEvent, type MouseEvent as RMouseEvent } from 'react'
import { AnimatePresence, animate, motion, useMotionValue, useTransform, type MotionValue, type Variants } from 'motion/react'
import { useShallow } from 'zustand/react/shallow'
import type { ActArg, CardAction, CardBodyComponent, CardKind, DeckCard, PrimarySpec, SongId } from '../../core/types'
import { KEEPABLE } from '../../core/types'
import { naviApi, useNavi } from '../../core/store'
import type { NaviState } from '../../core/store/types'
import { selPeeks, selTopCard } from '../../core/selectors'
import { usePhoneMetrics, useLayoutFrame } from '../../core/layout'
import { introPending, introWait, useIntroMode } from '../../core/intro'
import { fxState } from '../../core/fxState'
import { resolveTarget } from '../../core/targets'
import type { TargetId } from '../../core/events'
import { songColor } from '../../core/actions'
import { sound } from '../../core/sound'
import { SPRING } from '../../core/ui/motion'
import { SongTitle } from '../../core/ui/SongTitle'
import { SONG_BY_ID } from '../../data/songs'
import { useTr } from '../../i18n'
import { CardShell, KindLabel } from './CardShell'
import { FRAMES, PEEKS, PEEK_BOOST, frameOf, frameSize, kindKey, peeksFor } from './frames'
import { LONG_MS, TAP_SLOP, VelocityTracker, classifyGesture, dragDirection, dragProgress, resist, tiltFor } from './gestures'
import { S } from './strings'

// ---------------------------------------------------------------- shared controller

export type CommitDir = 'up' | 'right' | 'left'

/** The ActionBar and FlightLayer talk to the mounted pile through this (one phone shell). */
export const deckCtl: {
  commit: ((dir: CommitDir) => void) | null
  topEl: HTMLElement | null
  /** ActionBar root, lit while a drag heads toward one of its buttons */
  barEl: HTMLElement | null
  /** the deck root: --drag-p wakes the next card up while the top one is dragged */
  deckEl: HTMLElement | null
  /** GhostHand listens to dismiss itself on the first touch */
  onTouch: (() => void) | null
  /** FlightLayer: launch a flight right now (the store action follows one frame later) */
  preflight: ((e: PreFlight) => void) | null
} = { commit: null, topEl: null, barEl: null, deckEl: null, onTouch: null, preflight: null }

export type PreFlight = { from: DOMRectReadOnly; to: TargetId; kind: 'reserve' | 'keep'; songId: SongId; color: string }

/** Run fn after the next frame has been painted (so compositor animations are already running). */
function afterPaint(fn: () => void) {
  if (typeof requestAnimationFrame !== 'function') return void setTimeout(fn, 0)
  requestAnimationFrame(() => setTimeout(fn, 0))
}

/** Actions whose card leaves the pile as a flight token (FlightLayer draws the flight). */
const HANDOFF: ReadonlySet<CardAction> = new Set<CardAction>(['reserve', 'accept', 'insert', 'keep'])
/** Other actions that take the card off the pile. */
const REMOVES: ReadonlySet<CardAction> = new Set<CardAction>(['openArea', 'putDown', 'oneMore', 'rest', 'decline', 'save'])

type ExitKind = 'handoff' | 'mist' | 'hold' | 'lift' | 'demote' | 'fade'
const exitOf = new Map<string, ExitKind>()
/** How a card left (so an undo can bring it back from the same direction). */
const leftVia = new Map<string, CommitDir>()
const shownIds = new Set<string>()

const INTERACTIVE = 'button, a, input, select, textarea, label, [role=button], [role=switch], [data-nodrag]'
const ASKABLE: ReadonlySet<CardKind> = new Set<CardKind>(['song', 'ask', 'link'])

function resolveExit(id: string): ExitKind {
  const k = exitOf.get(id)
  if (k) return k
  return naviApi.getState().deck.cards.some(c => c.id === id) ? 'demote' : 'fade'
}

function songOfCard(s: NaviState, card: DeckCard): SongId | undefined {
  return s.deck.selection[card.id] ?? card.songId ?? card.options?.[0]
}

function clearDrag() {
  fxState.drag.dir = null
  fxState.drag.progress = 0
  fxState.drag.songId = undefined
  paintBar(null, 0)
  deckCtl.deckEl?.classList.remove('is-drag-far')
}

/** Run fn after the next paint, `sec` seconds later (intro moments measured after the first paint). */
function laterAfterPaint(fn: () => void, sec: () => number): () => void {
  let id = 0
  const raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame(() => (id = window.setTimeout(fn, sec() * 1000))) : 0
  if (!raf) id = window.setTimeout(fn, sec() * 1000)
  return () => {
    if (raf) cancelAnimationFrame(raf)
    window.clearTimeout(id)
  }
}

function paintBar(dir: 'up' | 'right' | 'left' | null, p: number) {
  deckCtl.deckEl?.style.setProperty('--drag-p', dir ? Math.min(1, p * 1.4).toFixed(3) : '0')
  const el = deckCtl.barEl
  if (!el) return
  const v = (d: string) => (dir === d ? p.toFixed(3) : '0')
  el.style.setProperty('--drag-up', v('up'))
  el.style.setProperty('--drag-left', v('left'))
  el.style.setProperty('--drag-right', v('right'))
}

// ---------------------------------------------------------------- variants

const INTRO_POSE = { y: 80, scale: 0.92, opacity: 0 }

const TOP_VARIANTS: Variants = {
  rest: { x: 0, y: 0, scale: 1, opacity: 1 },
  /** first visit: the opener waits below its place, invisible, until the B-2 1.4 s beat */
  held: INTRO_POSE,
  heldShort: { opacity: 0 },
  exit: (id: string) => {
    switch (resolveExit(id)) {
      case 'handoff':
        return { opacity: 0, transition: { duration: 0.05 } }
      case 'hold':
        // the visuals already run on the compositor (WAAPI); just stay mounted until they end
        return { opacity: 1, transition: { duration: 0.46 } }
      case 'mist':
        return { x: -70, y: -8, scale: 1.07, opacity: 0, transition: { duration: 0.46, ease: [0.2, 0.6, 0.3, 1] as [number, number, number, number] } }
      case 'lift':
        return { y: -150, scale: 0.9, opacity: 0, transition: { duration: 0.3, ease: 'easeIn' as const } }
      case 'demote':
        return { y: -PEEKS[0].lift, scale: PEEKS[0].scale, opacity: 0, transition: { duration: 0.22 } }
      default:
        return { opacity: 0, scale: 0.96, transition: { duration: 0.18 } }
    }
  },
}

const MIST_VARIANTS: Variants = {
  rest: { opacity: 0 },
  exit: (id: string) => (resolveExit(id) === 'mist' ? { opacity: 1, scale: 1.12, transition: { duration: 0.42, ease: 'easeOut' as const } } : { opacity: 0 }),
}

type Entrance = 'intro' | 'short' | 'promote' | 'insert' | 'undo-up' | 'undo-right' | 'undo-left' | 'redeal' | 'none'

function entranceInitial(e: Entrance): Record<string, number> | false {
  switch (e) {
    case 'intro':
      return INTRO_POSE
    case 'short':
      return { opacity: 0 }
    case 'promote':
      return { y: -PEEKS[0].lift, scale: PEEKS[0].scale, opacity: 0.6 }
    case 'insert':
      return { y: -64, scale: 1.05, opacity: 0 }
    case 'undo-up':
      return { y: -300, scale: 0.35, opacity: 0 }
    case 'undo-right':
      return { x: 180, y: -200, scale: 0.3, opacity: 0 }
    case 'undo-left':
      return { x: -140, opacity: 0 }
    case 'redeal':
      return { opacity: 0 }
    default:
      return false
  }
}

function entranceTransition(e: Entrance, reduced: boolean) {
  if (reduced) return { duration: 0.3 }
  switch (e) {
    case 'intro':
      // B-2: the opener rises 1.4–1.9 s (y +80 → 0, scale 0.92 → 1); the release timer holds it until then
      return { y: { type: 'spring', stiffness: 170, damping: 19 }, scale: { type: 'spring', stiffness: 170, damping: 19 }, opacity: { duration: 0.32, ease: 'easeOut' } } as const
    case 'short':
      return { duration: 0.3 }
    case 'redeal':
      return { duration: 0.16 }
    case 'insert':
      return { type: 'spring', stiffness: 380, damping: 24 } as const
    default:
      return SPRING.soft
  }
}

// ---------------------------------------------------------------- drag hints (inside the silhouette)

function DragHints({ x, y, w, h, keepable, primaryLabel }: { x: MotionValue<number>; y: MotionValue<number>; w: number; h: number; keepable: boolean; primaryLabel: string }) {
  const t = S.useT()
  // each hint only lights while its direction dominates the drag
  const clamp01 = (v: number) => Math.max(0, Math.min(1, v))
  const up = useTransform([x, y] as MotionValue<number>[], ([vx, vy]: number[]) => (-vy > Math.abs(vx) ? clamp01(-vy / (h * 0.35)) : 0))
  const left = useTransform([x, y] as MotionValue<number>[], ([vx, vy]: number[]) => (-vx > Math.abs(vy) ? clamp01(-vx / (w * 0.35)) : 0))
  const right = useTransform([x, y] as MotionValue<number>[], ([vx, vy]: number[]) => (keepable && vx > Math.abs(vy) ? clamp01(vx / (w * 0.35)) : 0))
  const upScale = useTransform(up, v => 0.8 + v * 0.2)
  const mist = useTransform(left, v => v * 0.72)
  return (
    <>
      <motion.div className="hint-mist" style={{ opacity: mist }} aria-hidden="true" />
      <motion.div className="hint-edge hint-edge--up" style={{ opacity: up }} aria-hidden="true" />
      <motion.div className="hint-edge hint-edge--right" style={{ opacity: right }} aria-hidden="true" />
      <motion.div className="hint-stamp hint-stamp--up" style={{ opacity: up, scale: upScale }} aria-hidden="true">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M8 13V3M3.5 7.5L8 3l4.5 4.5" />
        </svg>
        <span>{primaryLabel}</span>
      </motion.div>
      {keepable ? (
        <motion.div className="hint-stamp hint-stamp--right" style={{ opacity: right }} aria-hidden="true">
          <span>{t('hint.keep')}</span>
        </motion.div>
      ) : null}
      <motion.div className="hint-stamp hint-stamp--left" style={{ opacity: left }} aria-hidden="true">
        <span>{t('hint.pass')}</span>
      </motion.div>
    </>
  )
}

// ---------------------------------------------------------------- the top card

type TopProps = {
  card: DeckCard
  Body: CardBodyComponent
  small: boolean
  topY: number
  entrance: Entrance
  /** for 'promote': where the peek stood, relative to this card's resting place */
  promoteY: number
  hidden: boolean
  scale: number
}

function TopCard({ card, Body, small, topY, entrance, promoteY, hidden, scale }: TopProps) {
  const frame = frameOf(card)
  const { w, h } = frameSize(frame, small)
  const t = S.useT()
  const trr = useTr()
  const flipped = useNavi(s => s.deck.flippedId === card.id)
  const tabActive = useNavi(s => s.ui.tab === 'discover' && s.ui.overlay == null)
  const reduced = useNavi(s => s.ui.reduced)
  const primary = useNavi(s => s.deck.primary)
  const backSong = useNavi(s => songOfCard(s, card))
  const keepable = KEEPABLE.has(card.kind)

  const x = useMotionValue(0)
  const y = useMotionValue(0)
  const press = useMotionValue(1)
  const rotate = useTransform(x, v => tiltFor(v))
  const glow = useTransform([x, y] as MotionValue<number>[], ([vx, vy]: number[]) => 0.6 + 0.4 * Math.min(1, Math.max(Math.abs(vx) / (w * 0.35), -vy / (h * 0.35), 0)))

  const el = useRef<HTMLDivElement>(null)
  const cardRef = useRef(card)
  cardRef.current = card
  const busy = useRef(false)
  const suppressClick = useRef(false)
  const vt = useRef(new VelocityTracker())
  const st = useRef<{ id: number; x0: number; y0: number; t0: number; moved: number; dragging: boolean; long: boolean; interactive: boolean; timer: number; ringTimer: number } | null>(null)
  const [ring, setRing] = useState<{ x: number; y: number; k: number } | null>(null)
  const [asking, setAsking] = useState(0)
  // the intro entrance waits for its beat, measured after the first paint (robust to a late intro clock)
  const [held, setHeld] = useState(() => (entrance === 'intro' || entrance === 'short') && !reduced)
  useEffect(() => {
    if (!held) return
    return laterAfterPaint(() => setHeld(false), () => introWait('cardRise'))
  }, [])

  const springBack = () => {
    animate(x, 0, { type: 'spring', stiffness: 520, damping: 30 })
    animate(y, 0, { type: 'spring', stiffness: 520, damping: 30 })
  }
  const pulse = () => {
    animate(press, [1, 1.04, 1], { duration: 0.34, ease: 'easeOut' })
  }
  const wobble = () => {
    animate(x, [x.get(), -16, 11, -6, 0], { duration: 0.42, ease: 'easeOut' })
    animate(y, 0, { type: 'spring', stiffness: 520, damping: 30 })
  }
  const bump = () => {
    animate(y, [y.get(), 12, 0], { duration: 0.32, ease: 'easeOut' })
    animate(x, 0, { type: 'spring', stiffness: 520, damping: 30 })
  }

  const doAct = (a: CardAction, arg: ActArg = {}, exit?: ExitKind, via?: CommitDir) => {
    const c = cardRef.current
    const rect = arg.fromRect ?? el.current?.getBoundingClientRect()
    const kind: ExitKind | undefined = exit ?? (HANDOFF.has(a) ? 'handoff' : a === 'pass' ? 'mist' : REMOVES.has(a) ? 'lift' : undefined)
    if (kind) exitOf.set(c.id, kind)
    if (via) leftVia.set(c.id, via)
    naviApi.getState().act(c.id, a, { ...arg, fromRect: rect })
    const still = naviApi.getState().deck.cards.some(k => k.id === c.id)
    if (still) {
      exitOf.delete(c.id)
      leftVia.delete(c.id)
    }
    return !still
  }

  const faceEl = () => el.current?.querySelector(':scope > .cs') as HTMLElement | null
  const running = useRef<Animation[]>([])
  const restoreVisual = () => {
    running.current.splice(0).forEach(a => a.cancel())
  }

  /**
   * Flicks and their button twins: the visual answer starts on this very frame (flight token or
   * mist on the compositor); the store action runs one painted frame later, so the React commit
   * it causes can never stall the throw.
   */
  const throwCard = (a: CardAction, arg: ActArg, visual: 'flight' | 'mist', via: CommitDir, target?: TargetId) => {
    const cs = faceEl()
    const rect = el.current?.getBoundingClientRect()
    busy.current = true
    if (cs && !naviApi.getState().ui.reduced && typeof cs.animate === 'function') {
      if (visual === 'flight' && rect && arg.songId && target && deckCtl.preflight) {
        running.current.push(cs.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 70, fill: 'forwards' }))
        deckCtl.preflight({ from: rect, to: target, kind: a === 'keep' ? 'keep' : 'reserve', songId: arg.songId, color: songColor(arg.songId) })
      } else if (visual === 'mist') {
        running.current.push(
          cs.animate(
            [
              { transform: 'none', opacity: 1 },
              { transform: 'translate3d(-26px,-4px,0) scale(1.03)', opacity: 0.85, offset: 0.35 },
              { transform: 'translate3d(-70px,-10px,0) scale(1.08)', opacity: 0 },
            ],
            { duration: 440, easing: 'cubic-bezier(.2,.6,.3,1)', fill: 'forwards' },
          ),
        )
        const mist = el.current?.querySelector('.hint-mist--exit') as HTMLElement | null
        if (mist) running.current.push(mist.animate([{ opacity: 0, transform: 'scale(1)' }, { opacity: 1, transform: 'scale(1.12)' }], { duration: 380, easing: 'ease-out', fill: 'forwards' }))
      }
    }
    afterPaint(() => {
      const gone = doAct(a, { ...arg, fromRect: rect }, visual === 'mist' ? 'hold' : 'handoff', via)
      if (!gone) {
        busy.current = false
        restoreVisual()
        if (via === 'right') wobble()
        else springBack()
      }
    })
  }

  const commit = (dir: CommitDir) => {
    const c = cardRef.current
    if (busy.current || hidden) return
    deckCtl.onTouch?.()
    const s = naviApi.getState()
    if (dir === 'up') {
      const p: PrimarySpec | null = s.deck.primary
      if (!p || !p.enabled) return bump()
      if (p.action === 'keep') {
        // fair share (handshake 5): the primary keeps the song on the ball instead of reserving it
        const songId = p.arg?.songId ?? songOfCard(s, c)
        if (songId) return throwCard('keep', { songId }, 'flight', 'up', `face:${songId}`)
      }
      if (p.action === 'reserve' || p.action === 'accept' || p.action === 'insert') {
        const songId = p.arg?.songId ?? songOfCard(s, c)
        if (songId && SONG_BY_ID[songId]?.reservable) return throwCard(p.action, { ...p.arg, songId }, 'flight', 'up', p.action === 'insert' ? 'lane:insert' : 'lane:next')
      }
      const gone = doAct(p.action, p.arg ?? {}, undefined, 'up')
      if (gone) busy.current = true
      else {
        springBack()
        pulse()
      }
      return
    }
    if (dir === 'right') {
      if (!keepable) return wobble()
      const songId = s.deck.primary?.arg?.songId ?? songOfCard(s, c)
      if (!songId) return wobble()
      return throwCard('keep', { songId }, 'flight', 'right', `face:${songId}`)
    }
    // left
    if (c.kind === 'breather') return wobble()
    const action: CardAction = c.kind === 'invite' && c.variant !== 'twin' ? 'decline' : 'pass'
    throwCard(action, {}, 'mist', 'left')
  }

  // expose to ActionBar / GhostHand
  useLayoutEffect(() => {
    deckCtl.commit = commit
    deckCtl.topEl = el.current
    return () => {
      if (deckCtl.topEl === el.current) {
        deckCtl.topEl = null
        deckCtl.commit = null
      }
    }
  })

  const canAsk = ASKABLE.has(card.kind)

  const onLong = () => {
    const s = st.current
    if (!s) return
    s.long = true
    setRing(null)
    const songId = songOfCard(naviApi.getState(), cardRef.current)
    if (!songId) return
    const asked = !!naviApi.getState().room.knowing[songId]
    sound.haptic(18)
    pulse()
    if (!asked) {
      naviApi.getState().act(cardRef.current.id, 'ask', { songId })
      setAsking(k => k + 1)
    }
  }

  const onPointerDown = (e: RPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    if (busy.current || hidden || st.current) return
    deckCtl.onTouch?.()
    const interactive = !!(e.target as Element).closest?.(INTERACTIVE)
    vt.current.reset()
    vt.current.add(e.timeStamp, e.clientX, e.clientY)
    const s = { id: e.pointerId, x0: e.clientX, y0: e.clientY, t0: e.timeStamp, moved: 0, dragging: false, long: false, interactive, timer: 0, ringTimer: 0 }
    st.current = s
    if (!interactive && canAsk) {
      s.timer = window.setTimeout(onLong, LONG_MS)
      const r = el.current?.getBoundingClientRect()
      if (r) {
        const lx = (e.clientX - r.left) / scale
        const ly = (e.clientY - r.top) / scale
        s.ringTimer = window.setTimeout(() => setRing({ x: lx, y: ly, k: Date.now() }), 150)
      }
    }
  }

  const endPress = () => {
    const s = st.current
    if (!s) return
    window.clearTimeout(s.timer)
    window.clearTimeout(s.ringTimer)
    setRing(null)
  }

  const onPointerMove = (e: RPointerEvent<HTMLDivElement>) => {
    const s = st.current
    if (!s || e.pointerId !== s.id) return
    const dx = e.clientX - s.x0
    const dy = e.clientY - s.y0
    s.moved = Math.max(s.moved, Math.hypot(dx, dy))
    vt.current.add(e.timeStamp, e.clientX, e.clientY)
    if (!s.dragging && s.moved >= TAP_SLOP) {
      s.dragging = true
      window.clearTimeout(s.timer)
      window.clearTimeout(s.ringTimer)
      setRing(null)
      try {
        el.current?.setPointerCapture(e.pointerId)
      } catch {
        /* capture is best-effort */
      }
    }
    if (!s.dragging) return
    const lx = dx / scale
    const ly = dy / scale
    let ex = lx
    let ey = ly
    if (ly > 0 && Math.abs(ly) > Math.abs(lx)) ey = resist(ly)
    if (lx > 0 && !keepable) ex = resist(lx, 0.45, 56)
    if (card.kind === 'breather' && lx < 0) ex = resist(lx, 0.45, 56)
    x.set(ex)
    y.set(ey)
    let dir = dragDirection(lx, ly)
    if (dir === 'right' && !keepable) dir = null
    if (dir === 'left' && card.kind === 'breather') dir = null
    const p = dir ? dragProgress(lx, ly, w, h) : 0
    // anticipation: past 40 px the next card lifts a little and brightens (CSS, 150 ms)
    deckCtl.deckEl?.classList.toggle('is-drag-far', Math.hypot(lx, ly) > 40)
    fxState.drag.dir = dir
    fxState.drag.progress = p
    fxState.drag.songId = songOfCard(naviApi.getState(), card)
    paintBar(dir, p)
  }

  const finish = (e: RPointerEvent<HTMLDivElement>, cancelled: boolean) => {
    const s = st.current
    if (!s || e.pointerId !== s.id) return
    endPress()
    st.current = null
    try {
      el.current?.releasePointerCapture(e.pointerId)
    } catch {
      /* not captured */
    }
    clearDrag()
    if (s.dragging) suppressClick.current = true
    if (cancelled || s.long) {
      springBack()
      return
    }
    const dx = (e.clientX - s.x0) / scale
    const dy = (e.clientY - s.y0) / scale
    const v = vt.current.velocity(e.timeStamp)
    const g = classifyGesture({ dx, dy, vx: v.vx / scale, vy: v.vy / scale, w, h, ms: e.timeStamp - s.t0, moved: s.moved / scale })
    switch (g) {
      case 'tap':
        if (!s.interactive) naviApi.getState().act(card.id, 'flip')
        break
      case 'long':
        if (!s.interactive && canAsk && !s.long) onLong()
        break
      case 'up':
      case 'right':
      case 'left':
        commit(g)
        break
      default:
        springBack()
    }
  }

  const onClickCapture = (e: RMouseEvent) => {
    if (suppressClick.current) {
      suppressClick.current = false
      e.stopPropagation()
      e.preventDefault()
    }
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return
    const map: Record<string, CommitDir | 'flip'> = { ArrowUp: 'up', ArrowRight: 'right', ArrowLeft: 'left', Enter: 'flip', ' ': 'flip' }
    // script mode: → belongs to the presenter ("next beat"), even while a card has focus (DEMO#2)
    if (naviApi.getState().session.script) delete map.ArrowRight
    const k = map[e.key]
    if (!k) return
    e.preventDefault()
    e.stopPropagation()
    if (k === 'flip') naviApi.getState().act(card.id, 'flip')
    else commit(k)
  }

  useEffect(() => () => clearDrag(), [])

  // freeze the label once this card is no longer on top (it may still be leaving)
  const isTop = useNavi(s => s.deck.cards[0]?.id === card.id)
  const wasTop = useRef(isTop)
  useEffect(() => {
    // back on top before its exit finished (a very quick undo): undo the throw visuals too
    if (isTop && !wasTop.current) {
      restoreVisual()
      busy.current = false
      x.set(0)
      y.set(0)
    }
    wasTop.current = isTop
  }, [isTop])
  const labelRef = useRef(t('reserve'))
  if (isTop && primary) labelRef.current = trr(primary.label)
  const primaryLabel = labelRef.current
  const bodyAct = (a: CardAction, arg?: ActArg) => {
    doAct(a, arg ?? {}, undefined, a === 'pass' ? 'left' : HANDOFF.has(a) ? 'up' : undefined)
  }
  // Only the card on top may drive the action bar (an exiting card keeps rendering briefly).
  const setPrimary = (p: PrimarySpec) => {
    if (naviApi.getState().deck.cards[0]?.id === cardRef.current.id) naviApi.getState().setPrimary(p)
  }
  const active = tabActive && !flipped && !hidden

  const base = entranceInitial(entrance)
  const pk = peeksFor(small)[0]
  const initial = base && entrance === 'promote' ? { ...base, y: promoteY - (1 - pk.scale) * 0.6 * h, scale: pk.scale } : base
  return (
    <motion.div
      className={`deck__top${hidden ? ' is-hidden' : ''}${held ? ' is-held' : ''}`}
      style={{ top: topY, left: '50%', marginLeft: -w / 2, width: w, height: h }}
      custom={card.id}
      variants={TOP_VARIANTS}
      initial={initial === false ? false : initial}
      animate={held ? (entrance === 'short' ? 'heldShort' : 'held') : 'rest'}
      exit="exit"
      transition={entranceTransition(entrance, reduced)}
      data-testid="card-top"
      data-kind={card.kind}
      data-variant={card.variant ?? ''}
      data-card-id={card.id}
      data-flipped={flipped ? '1' : '0'}
    >
      <motion.div
        ref={el}
        className="deck__drag"
        style={{ x, y, rotate, scale: press }}
        tabIndex={0}
        role="group"
        aria-label={t('aria.card', { kind: t(kindKey(card)), primary: primaryLabel })}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={e => finish(e, false)}
        onPointerCancel={e => finish(e, true)}
        onClickCapture={onClickCapture}
        onKeyDown={onKeyDown}
      >
        <CardShell
          card={card}
          frame={frame}
          w={w}
          h={h}
          small={small}
          role="top"
          flipped={flipped}
          glow={glow}
          backSong={backSong}
          overlay={
            <>
              <DragHints x={x} y={y} w={w} h={h} keepable={keepable} primaryLabel={primaryLabel} />
              <motion.div className="hint-mist hint-mist--exit" custom={card.id} variants={MIST_VARIANTS} initial="rest" animate="rest" exit="exit" aria-hidden="true" />
              {ring ? (
                <svg key={ring.k} className="press-ring" style={{ left: ring.x - 30, top: ring.y - 30 }} width="60" height="60" viewBox="0 0 60 60" aria-hidden="true">
                  <circle cx="30" cy="30" r="24" className="press-ring__track" />
                  <circle cx="30" cy="30" r="24" className="press-ring__fill" />
                </svg>
              ) : null}
              <AnimatePresence>
                {asking ? (
                  <motion.div
                    key={asking}
                    className="asking-badge"
                    initial={{ opacity: 0, y: 8, scale: 0.9 }}
                    animate={{ opacity: [0, 1, 1, 0], y: 0, scale: 1 }}
                    transition={{ duration: 1.6, times: [0, 0.12, 0.75, 1] }}
                    onAnimationComplete={() => setAsking(0)}
                  >
                    {t('hint.asking')}
                  </motion.div>
                ) : null}
              </AnimatePresence>
            </>
          }
        >
          <Body card={card} active={active} flipped={flipped} act={bodyAct} setPrimary={setPrimary} />
        </CardShell>
      </motion.div>
    </motion.div>
  )
}

// ---------------------------------------------------------------- peeks

function PeekCard({ card, i, small, topY, intro, stackW, teaser }: { card: DeckCard; i: number; small: boolean; topY: number; intro: boolean; stackW: number; teaser: boolean }) {
  const frame = frameOf(card)
  const { w, h } = frameSize(frame, small)
  const poses = peeksFor(small)
  const pose = poses[i] ?? poses[poses.length - 1]
  const y = topY - pose.lift
  // intro: measured from now, so a peek that mounts a little late still lands on its beat
  const [delay] = useState(() => (intro ? introWait('peeks') + i * 0.09 : 0))
  return (
    <motion.div
      className={`deck__peek deck__peek--${i}`}
      style={{ left: (stackW - w) / 2, width: w, height: h, zIndex: 3 - i, transformOrigin: '50% 0%', ['--pk-lift' as string]: `${PEEK_BOOST}px` } as CSSProperties}
      initial={intro ? { y: topY + 16, scale: pose.scale, opacity: 0 } : { y: topY + 6, scale: pose.scale * 0.96, opacity: 0 }}
      animate={{ y, scale: pose.scale, opacity: pose.opacity }}
      exit={{ opacity: 0, transition: { duration: 0 } }}
      transition={intro ? { ...SPRING.soft, delay } : SPRING.soft}
      data-testid="card-peek"
      data-kind={card.kind}
      data-variant={card.variant ?? ''}
      data-teaser={teaser ? '1' : '0'}
      aria-hidden="true"
    >
      <div className={`peek-lift${teaser ? '' : ' no-teaser'}`}>
        <div className="peek-edge">
          <CardShell card={card} frame={frame} w={w} h={h} small={small} role="peek" peekScale={pose.scale} />
        </div>
        {i === 0 ? (
          <div className="peek-full">
            <CardShell card={card} frame={frame} w={w} h={h} small={small} role="peek" peekScale={pose.scale} />
          </div>
        ) : null}
      </div>
    </motion.div>
  )
}

// ---------------------------------------------------------------- redeal (C-11)

const REDEAL_MS = 1250
/** Height of the member-orb row under the hero horizon (stage's floor lights), in phone px. */
const ORB_ROW = 30
const ORB_ROW_SMALL = 26

function TokenFace({ card }: { card: DeckCard }) {
  const spec = FRAMES[frameOf(card)]
  const songish = card.songId && card.kind !== 'gap'
  return (
    <div className="tokface">
      <KindLabel card={card} align={spec.labelAlign} />
      {songish ? (
        <div className="tokface__title">
          <SongTitle songId={card.songId!} variant="chip" />
        </div>
      ) : null}
    </div>
  )
}

function FlipSlot({ oldCard, newCard, i, small, topY, stackW, stackH }: { oldCard?: DeckCard; newCard?: DeckCard; i: number; small: boolean; topY: number; stackW: number; stackH: number }) {
  const order = 2 - i // back to front: the top card turns last
  const d0 = 0.12 + order * 0.12
  const half = 0.24
  const pose = i === 0 ? { lift: 0, scale: 1, opacity: 1 } : peeksFor(small)[i - 1]
  const slot = (c: DeckCard | undefined, phase: 'out' | 'in') => {
    if (!c) return null
    const frame = frameOf(c)
    const { w, h } = frameSize(frame, small)
    const pal = c.songId ? SONG_BY_ID[c.songId] : null
    const y = i === 0 ? stackH - h : topY - pose.lift
    return (
      <motion.div
        key={`${phase}-${c.id}`}
        className="deck__flip"
        style={{ left: (stackW - w) / 2, width: w, height: h, top: 0, y, scale: pose.scale, transformOrigin: i === 0 ? '50% 50%' : '50% 0%', zIndex: 10 - i, opacity: pose.opacity }}
        initial={{ rotateY: phase === 'out' ? 0 : -90 }}
        animate={{ rotateY: phase === 'out' ? 90 : 0 }}
        transition={{ duration: half, delay: phase === 'out' ? d0 : d0 + half, ease: phase === 'out' ? 'easeIn' : 'easeOut' }}
        data-song={pal ? pal.id : undefined}
      >
        <CardShell card={c} frame={frame} w={w} h={h} small={small} role="token">
          <TokenFace card={c} />
        </CardShell>
      </motion.div>
    )
  }
  return (
    <>
      {slot(oldCard, 'out')}
      {slot(newCard, 'in')}
    </>
  )
}

// ---------------------------------------------------------------- the deck

export function DeckView(p: { bodies: Record<CardKind, CardBodyComponent> }): JSX.Element {
  const top = useNavi(selTopCard)
  const peeks = useNavi(useShallow((s: NaviState) => selPeeks(s, 2)))
  const redealAt = useNavi(s => s.deck.redeal?.at ?? 0)
  const reduced = useNavi(s => s.ui.reduced)
  const introMode = useIntroMode()
  const m = usePhoneMetrics()
  const frameCtx = useLayoutFrame()
  const t = S.useT()
  const small = m.small
  const stackH = m.cardH
  const stackRef = useRef<HTMLDivElement>(null)
  const deckRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    deckCtl.deckEl = deckRef.current
    return () => {
      if (deckCtl.deckEl === deckRef.current) deckCtl.deckEl = null
    }
  }, [])
  const [stackW, setStackW] = useState(m.small ? 328 : 358)
  const [deckH, setDeckH] = useState(0)

  useLayoutEffect(() => {
    const el = stackRef.current
    const dk = deckRef.current
    if (!el) return
    const measure = () => {
      setStackW(Math.round(el.clientWidth) || 358)
      if (dk) setDeckH(Math.round(dk.clientHeight))
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    if (dk) ro.observe(dk)
    return () => ro.disconnect()
  }, [])

  // ---- entrance bookkeeping
  // the director deals the opener one commit after mount: the intro belongs to the first card
  // that actually reaches the top, not to the first render (OWNER#4 / DEMO#7)
  const hadTop = useRef(false)
  const prevVisible = useRef<string[]>([])
  const prevCards = useRef<DeckCard[]>([])
  const entranceRef = useRef<{ id: string; e: Entrance; py: number }>({ id: '', e: 'none', py: 0 })
  const prevTopY = useRef(0)
  if (top && entranceRef.current.id !== top.id) {
    let e: Entrance = 'none'
    if (!hadTop.current) {
      e = introMode === 'none' ? 'none' : introPending('cardRise') ? (introMode === 'short' ? 'short' : 'intro') : 'none'
    } else if (leftVia.has(top.id)) {
      const via = leftVia.get(top.id)!
      e = via === 'up' ? 'undo-up' : via === 'right' ? 'undo-right' : 'undo-left'
      leftVia.delete(top.id)
      exitOf.delete(top.id)
    } else if (prevVisible.current[1] === top.id) e = 'promote'
    else e = 'insert'
    hadTop.current = true
    const newTopY = stackH - frameSize(frameOf(top), small).h
    entranceRef.current = { id: top.id, e, py: prevTopY.current - peeksFor(small)[0].lift - newTopY }
  }
  const introPeeks = introMode !== 'none' && introPending('peeks')

  // ---- redeal
  const [redeal, setRedeal] = useState<{ at: number; old: DeckCard[]; fading?: boolean } | null>(null)
  const handledRedeal = useRef(0)
  useLayoutEffect(() => {
    if (!redealAt || handledRedeal.current === redealAt || Date.now() - redealAt > 1500) return
    handledRedeal.current = redealAt
    if (reduced) return
    setRedeal({ at: redealAt, old: prevCards.current })
    entranceRef.current = { id: top?.id ?? '', e: 'redeal', py: 0 }
  }, [redealAt])
  useEffect(() => {
    if (!redeal) return
    // the real top card appears under the last flip token, then the tokens fade away
    const a = window.setTimeout(() => setRedeal(r => (r && r.at === redeal.at ? { ...r, fading: true } : r)), REDEAL_MS - 200)
    const b = window.setTimeout(() => setRedeal(r => (r && r.at === redeal.at ? null : r)), REDEAL_MS)
    return () => {
      window.clearTimeout(a)
      window.clearTimeout(b)
    }
  }, [redeal?.at])
  const redealingAttr = redeal != null || (reduced && redealAt > 0 && Date.now() - redealAt < REDEAL_MS)
  // reduced motion still reports the redeal window for tests / lens (no flipping)
  const [, bump] = useState(0)
  useEffect(() => {
    if (!reduced || !redealAt) return
    const id = window.setTimeout(() => bump(k => k + 1), Math.max(0, redealAt + REDEAL_MS - Date.now()) + 20)
    return () => window.clearTimeout(id)
  }, [reduced, redealAt])

  useEffect(() => {
    prevVisible.current = [top?.id ?? '', ...peeks.map(c => c.id)]
    prevTopY.current = top ? stackH - frameSize(frameOf(top), small).h : 0
    if (!redeal) prevCards.current = [top, ...peeks].filter((c): c is DeckCard => !!c)
  })

  // ---- metrics: a card counts as shown once it reaches the top
  useEffect(() => {
    if (!top || shownIds.has(top.id)) return
    shownIds.add(top.id)
    naviApi.getState().markShown(top.kind)
  }, [top?.id])

  // ---- intro light: a streak falls from the ball onto the rising first card (B-2 1.4 s)
  const [beam, setBeam] = useState<{ h: number; k: string } | null>(null)
  const introId = entranceRef.current.e === 'intro' ? entranceRef.current.id : ''
  useEffect(() => {
    if (!introId || reduced) return
    return laterAfterPaint(
      () => {
        const ball = resolveTarget('hero:ball')
        const st = stackRef.current?.getBoundingClientRect()
        if (!st) return
        const cur = naviApi.getState().deck.cards[0]
        const topFrame = cur ? frameSize(frameOf(cur), small).h : stackH
        const cardTop = st.top + (stackH - topFrame) * frameCtx.scale
        const from = ball ? ball.top + ball.height * 0.72 : cardTop - 80 * frameCtx.scale
        setBeam({ h: Math.max(30, (cardTop - from) / frameCtx.scale), k: introId })
      },
      () => Math.max(0, introWait('cardRise') - 0.22),
    )
  }, [introId])

  const topFrame = top ? frameOf(top) : 'portrait'
  const topSize = frameSize(topFrame, small)
  const topY = stackH - topSize.h
  const Body = top ? p.bodies[top.kind] : null
  // The peeks stand behind the floor lights (the orbs stay readable in front). The second peek's
  // teaser only shows when it has a clear strip between the orb row and the first peek.
  const poses = peeksFor(small)
  const gap = m.hero - m.horizon + 2 + deckH - topSize.h
  const secondTeaser = deckH > 0 && gap - (small ? ORB_ROW_SMALL : ORB_ROW) - poses[0].lift >= 16
  const anchor = top ? `card:${top.kind}${top.kind === 'song' && top.variant === 'visa' ? '.visa' : ''}` : undefined

  const newVisible = useMemo(() => [top, ...peeks], [top, peeks])

  return (
    <div className="deck" ref={deckRef} data-testid="deck" data-redealing={redealingAttr ? '1' : '0'} data-anchor={anchor} data-private="1" aria-label={t('aria.deck')}>
      <div className="deck__stack" ref={stackRef} style={{ height: stackH, ['--stack-h' as string]: `${stackH}px` } as CSSProperties}>
        <div className={`deck__peeks${redeal && !redeal.fading ? ' is-hidden' : ''}`} style={{ clipPath: `inset(-120px -60px ${Math.max(0, stackH - (topY + topSize.h))}px -60px)` }}>
          <AnimatePresence initial={false}>
            {peeks.map((c, i) => (
              <PeekCard key={c.id} card={c} i={i} small={small} topY={topY} intro={introPeeks} stackW={stackW} teaser={i === 0 || secondTeaser} />
            ))}
          </AnimatePresence>
        </div>
        {beam ? (
          <motion.div
            key={beam.k}
            className="deck__beam"
            data-testid="intro-beam"
            style={{ height: beam.h, bottom: stackH - topY }}
            initial={{ scaleY: 0, opacity: 0 }}
            animate={{ scaleY: [0, 1, 1], opacity: [0, 1, 0] }}
            transition={{ duration: 0.9, times: [0, 0.3, 1], ease: 'easeOut' }}
            onAnimationComplete={() => setBeam(null)}
            aria-hidden="true"
          />
        ) : null}
        <AnimatePresence initial={false}>
          {top && Body ? (
            <TopCard key={top.id} card={top} Body={Body} small={small} topY={topY} entrance={entranceRef.current.id === top.id ? entranceRef.current.e : 'none'} promoteY={entranceRef.current.py} hidden={!!redeal && !redeal.fading} scale={frameCtx.scale} />
          ) : null}
        </AnimatePresence>
        {redeal ? (
          <div className={`deck__redeal${redeal.fading ? ' is-fading' : ''}`} aria-hidden="true">
            {[0, 1, 2].map(i => (
              <FlipSlot key={`${redeal.at}-${i}`} oldCard={redeal.old[i]} newCard={newVisible[i] ?? undefined} i={i} small={small} topY={topY} stackW={stackW} stackH={stackH} />
            ))}
          </div>
        ) : null}
      </div>
    </div>
  )
}
