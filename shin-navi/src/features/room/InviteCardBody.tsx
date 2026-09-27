// Invite ticket body (SPEC C-8 ⑦): request / twin / duet on the ticket frame. The right stub
// carries the sender's light. Twin keeps the partner anonymous until both reveal (E-7, E-12),
// so its stub paints over the shell's sender-coloured light with two neutral stars.
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import type { CardBodyComponent, CardBodyProps, MemberId, Reason, VoiceTypeId } from '../../core/types'
import { useNavi } from '../../core/store'
import { SongTitle } from '../../core/ui/SongTitle'
import { sound } from '../../core/sound'
import { SONG_BY_ID } from '../../data/songs'
import { hashString } from '../../lib/rng'
import { useTr } from '../../i18n'
import { R } from './strings'
import { useSim, type DuetState, type TwinState } from './sim'
import { pairName, VOICE_COLOR } from './pairNames'
import './room.css'

// ---------------------------------------------------------------- shared bits

/**
 * Measure the card once. The body root is static inside the shell's absolutely positioned
 * body box (inset 0), so the parent's box is the whole card: 334×262 for the ticket, 306×236
 * on a 360×740 phone. Absolute children of the root are laid out in card pixels.
 */
export function useCardSize(fallback = { w: 334, h: 262 }) {
  const ref = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState(fallback)
  useLayoutEffect(() => {
    const box = ref.current?.parentElement
    if (!box) return
    const w = box.offsetWidth || fallback.w
    const h = box.offsetHeight || fallback.h
    if (w !== size.w || h !== size.h) setSize({ w, h })
  }, [])
  return { ref, ...size, small: size.w < fallback.w - 12 }
}

const memberRef = (id: MemberId) => ({ key: `vocab.member.${id}` })

/** The reason line with its source glyph (the card-reason every card carries). */
function ReasonRow({ reason, className }: { reason: Reason; className?: string }) {
  const trr = useTr()
  return (
    <div className={`rm-reason ${className ?? ''}`} data-testid="card-reason">
      <svg className="rm-reason__glyph" width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
        {reason.source === 'voice' ? (
          <>
            <path d="M5 2v5.2a3 3 0 0 0 6 0V2" />
            <path d="M8 10.2V15" />
          </>
        ) : (
          <>
            <circle cx="8" cy="5.2" r="2.6" />
            <path d="M3 14c.6-3 2.6-4.6 5-4.6s4.4 1.6 5 4.6" />
          </>
        )}
      </svg>
      <span className="rm-reason__text">
        {trr(reason.text)}
        {reason.cause ? <span className="rm-reason__cause">{trr(reason.cause)}</span> : null}
      </span>
    </div>
  )
}

/** A static barcode drawn from the card id (a ticket needs one; it encodes nothing). */
function Barcode({ seed, w = 64, h = 14 }: { seed: string; w?: number; h?: number }) {
  let x = 0
  let hv = hashString(seed)
  const bars: { x: number; w: number }[] = []
  while (x < w) {
    hv = (Math.imul(hv ^ (hv >>> 13), 0x5bd1e995) >>> 0) || 1
    const bw = 1 + (hv % 3)
    if ((hv >>> 5) % 3) bars.push({ x, w: bw * 0.8 })
    x += bw + 0.9
  }
  return (
    <svg className="rm-barcode" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      {bars.map((b, i) => (
        <rect key={i} x={b.x} y={0} width={b.w} height={h} />
      ))}
    </svg>
  )
}

function serialOf(id: string): string {
  return String(hashString(id) % 10000).padStart(4, '0')
}

function hhmm(ms: number): string {
  const d = new Date(ms > 1e12 ? ms : Date.now())
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function TicketMeta({ card }: { card: CardBodyProps['card'] }) {
  return (
    <div className="rm-inv__meta" aria-hidden="true">
      <Barcode seed={card.id} />
      <span>No.{serialOf(card.id)}</span>
      <span className="rm-inv__metadot" />
      <span>ROOM 12</span>
      <span className="rm-inv__metadot" />
      <span>{hhmm(card.dealtAt)}</span>
    </div>
  )
}

// ---------------------------------------------------------------- request

function RequestStub({ from, active }: { from: MemberId; active: boolean }) {
  const trr = useTr()
  const reduced = useNavi(s => s.ui.reduced)
  // the wax seal presses onto the stub the first time the ticket is on top
  const [stamped, setStamped] = useState(reduced)
  useEffect(() => {
    if (active && !stamped) setStamped(true)
  }, [active])
  const color = useNavi(s => s.room.members[from]?.color ?? '#FF6FB1')
  const id = `rq-${from}`
  return (
    <div className="rm-stub rm-stub--request" style={{ ['--from' as string]: color } as CSSProperties} aria-hidden="true">
      <span className="rm-stub__halo" />
      <svg className={`rm-stub__ring${reduced ? '' : ' is-spin'}`} width="60" height="60" viewBox="0 0 60 60">
        <defs>
          <path id={id} d="M30,30 m-20,0 a20,20 0 1,1 40,0 a20,20 0 1,1 -40,0" />
        </defs>
        <text className="rm-stub__ringtext">
          <textPath href={`#${id}`}>REQUEST · FOR YOU · REQUEST · </textPath>
        </text>
      </svg>
      <span className="rm-stub__name">{trr(memberRef(from))}</span>
      <motion.svg
        className="rm-stub__seal"
        width="30"
        height="30"
        viewBox="0 0 30 30"
        initial={false}
        animate={stamped ? { scale: 1, rotate: 0, opacity: 1 } : { scale: 1.9, rotate: -24, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 520, damping: 17, delay: stamped && active ? 0.32 : 0 }}
      >
        <path d="M15 1.8l2.6 2.1 3.3-.5 1.3 3.1 3.1 1.3-.5 3.3 2.1 2.6-2.1 2.6.5 3.3-3.1 1.3-1.3 3.1-3.3-.5L15 28.2l-2.6-2.1-3.3.5-1.3-3.1-3.1-1.3.5-3.3L3.1 15l2.1-2.6-.5-3.3 3.1-1.3 1.3-3.1 3.3.5z" />
        <path className="rm-stub__sealnote" d="M13.2 18.6a1.9 1.9 0 1 1-1.3-1.8V10l6.2-1.4v6.9a1.9 1.9 0 1 1-1.3-1.8V10.9l-3.6.8z" />
      </motion.svg>
    </div>
  )
}

function RequestBody({ card, setPrimary, active }: CardBodyProps) {
  const t = R.useT()
  const size = useCardSize()
  const song = card.songId ? SONG_BY_ID[card.songId] : undefined
  const queued = useNavi(s => !!card.songId && (s.room.queue.some(q => q.songId === card.songId) || s.room.now?.item.songId === card.songId))
  const from = card.from ?? 'saki'
  useEffect(() => {
    setPrimary({ action: 'accept', label: R.ref('act.sing'), enabled: !!song?.reservable && !queued, arg: { songId: card.songId } })
  }, [card.id, queued])
  if (!song) return <div className="rm-inv" ref={size.ref} />
  return (
    <div className={`rm-inv rm-inv--request${size.small ? ' is-small' : ''}`} ref={size.ref} data-testid="invite-body" data-variant="request" data-state="open">
      <div className="rm-inv__main">
        <SongTitle songId={song.id} variant="card" max={size.small ? 23 : 26} min={15} className="rm-inv__title" />
        <div className="rm-inv__artist">{song.artist}</div>
        <ReasonRow reason={card.reason} className="rm-inv__note" />
        <div className="rm-inv__perks">
          <span className="rm-inv__perk">
            <i className="rm-inv__sealdot" aria-hidden="true" />
            {t('inv.req.seal')}
          </span>
          <span className="rm-inv__private">{t('inv.req.private')}</span>
        </div>
        <TicketMeta card={card} />
      </div>
      <RequestStub from={from} active={active} />
      <div className="rm-inv__holo" aria-hidden="true" />
    </div>
  )
}

// ---------------------------------------------------------------- twin

function TwinStub({ mine, them, partner }: { mine: boolean; them: 'wait' | 'yes' | 'no' | null; partner: MemberId }) {
  const trr = useTr()
  const reduced = useNavi(s => s.ui.reduced)
  const color = useNavi(s => s.room.members[partner]?.color ?? '#FFFFFF')
  const met = them === 'yes'
  const pull = { type: 'spring', stiffness: 150, damping: 13 } as const
  return (
    <div className={`rm-stub rm-stub--twin${met ? ' is-met' : ''}${mine ? ' is-mine' : ''}`} style={{ ['--them' as string]: met ? color : '#E9E4FF' } as CSSProperties} aria-hidden="true">
      <span className="rm-stub__cover" />
      <span className="rm-twin__field" />
      <span className={`rm-twin__orbit${reduced ? '' : ' is-spin'}`}>
        <motion.span className="rm-twin__star rm-twin__star--me" animate={{ x: met ? 15 : 0 }} transition={pull} />
        <motion.span className={`rm-twin__star rm-twin__star--them${them === 'no' ? ' is-shy' : ''}`} animate={{ x: met ? -15 : 0 }} transition={pull}>
          {met ? null : <b>?</b>}
        </motion.span>
      </span>
      <AnimatePresence>
        {met ? (
          <motion.span key="burst" className="rm-twin__burst" initial={{ scale: 0.2, opacity: 1 }} animate={{ scale: 2.6, opacity: 0 }} transition={{ duration: 1, ease: 'easeOut', delay: 0.25 }} />
        ) : null}
      </AnimatePresence>
      <AnimatePresence mode="wait">
        {met ? (
          <motion.span key="name" className="rm-stub__name rm-stub__name--met" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35 }}>
            {trr(memberRef(partner))}
          </motion.span>
        ) : (
          <motion.span key="who" className="rm-stub__name rm-stub__name--anon" exit={{ opacity: 0 }}>
            ? ? ?
          </motion.span>
        )}
      </AnimatePresence>
    </div>
  )
}

/** Two stars on a chart: a dotted path between "you" and "someone" that lights up when both reveal. */
function TwinLine({ phase, partner }: { phase: 'idle' | 'wait' | 'met' | 'shy'; partner: MemberId }) {
  const t = R.useT()
  const trr = useTr()
  const met = phase === 'met'
  return (
    <div className={`rm-twinline is-${phase}`} aria-hidden="true">
      <span className="rm-twinline__end">
        <i className="rm-twinline__dot rm-twinline__dot--me" />
        {trr({ key: 'vocab.member.me' })}
      </span>
      <span className="rm-twinline__track">
        <motion.i className="rm-twinline__fill" initial={false} animate={{ scaleX: met ? 1 : phase === 'wait' ? 0.5 : 0 }} transition={{ type: 'spring', stiffness: 90, damping: 16 }} />
      </span>
      <span className="rm-twinline__end rm-twinline__end--them">
        {met ? trr(memberRef(partner)) : t('inv.twin.who')}
        <i className="rm-twinline__dot rm-twinline__dot--them" />
      </span>
    </div>
  )
}

function TwinBody({ card, setPrimary, act, active }: CardBodyProps) {
  const t = R.useT()
  const size = useCardSize()
  const song = card.songId ? SONG_BY_ID[card.songId] : undefined
  const partner = (card.from ?? 'saki') as MemberId
  const st = useSim(u => (u.twin[card.id] as TwinState | undefined) ?? null)
  const audio = useNavi(s => s.session.audioOn)
  const partnerColor = useNavi(s => s.room.members[partner]?.color ?? '#FFD36B')
  const mine = !!st?.mine
  const them = st?.them ?? null
  const phase: 'idle' | 'wait' | 'met' | 'shy' = !mine ? 'idle' : them === 'yes' ? 'met' : them === 'no' ? 'shy' : 'wait'

  useEffect(() => {
    if (phase === 'idle') setPrimary({ action: 'reveal', label: R.ref('act.reveal'), enabled: true, arg: { songId: card.songId } })
    else if (phase === 'wait') setPrimary({ action: 'reveal', label: R.ref('act.waiting'), enabled: false, arg: { songId: card.songId } })
    else if (phase === 'met') setPrimary({ action: 'accept', label: R.ref('act.duetReserve'), enabled: !!song?.reservable, arg: { songId: card.songId } })
    else setPrimary({ action: 'decline', label: R.ref('inv.twin.keep'), enabled: true, arg: { songId: card.songId } })
  }, [card.id, phase])

  // the harmony (major 2nd sliding to a fifth) plays the moment both stars meet
  const played = useRef(false)
  useEffect(() => {
    if (phase === 'met' && !played.current && active) {
      played.current = true
      if (audio) sound.play('twin')
      sound.haptic([10, 40, 10])
    }
  }, [phase, active])

  if (!song) return <div className="rm-inv" ref={size.ref} />
  const status =
    phase === 'idle' ? t('inv.twin.hint') : phase === 'wait' ? t('inv.twin.waiting') : phase === 'met' ? t('inv.twin.both', { member: { member: partner } }) : t('inv.twin.notYet')
  return (
    <div
      className={`rm-inv rm-inv--twin is-${phase}${size.small ? ' is-small' : ''}`}
      ref={size.ref}
      data-testid="invite-body"
      data-variant="twin"
      data-state={phase}
      style={{ ['--rm-them' as string]: phase === 'met' ? partnerColor : '#E9E4FF' } as CSSProperties}
    >
      <div className="rm-inv__main">
        <ReasonRow reason={card.reason} className="rm-inv__lead" />
        <SongTitle songId={song.id} variant="card" max={size.small ? 24 : 28} min={15} className="rm-inv__title" />
        <div className="rm-inv__artist">{song.artist}</div>
        <AnimatePresence mode="wait">
          <motion.div
            key={phase}
            className={`rm-inv__status rm-inv__status--${phase}`}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.22 }}
          >
            {phase === 'wait' ? (
              <span className="rm-dots" aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
            ) : null}
            {status}
          </motion.div>
        </AnimatePresence>
        {phase === 'met' ? (
          <motion.button type="button" className="rm-inv__ghostbtn" data-testid="twin-keep-secret" initial={{ opacity: 0 }} animate={{ opacity: 1 }} whileTap={{ scale: 0.95 }} onClick={() => act('decline', { songId: card.songId })}>
            {t('inv.twin.keep')}
          </motion.button>
        ) : null}
        <TwinLine phase={phase} partner={partner} />
      </div>
      <TwinStub mine={mine} them={them} partner={partner} />
    </div>
  )
}

// ---------------------------------------------------------------- duet

function DuetStub({ mineType, theirType, state, partner }: { mineType: VoiceTypeId; theirType: VoiceTypeId; state: 'idle' | 'asking' | 'yes' | 'sent'; partner: MemberId }) {
  const trr = useTr()
  const color = useNavi(s => s.room.members[partner]?.color ?? '#FF6FB1')
  const pull = { type: 'spring', stiffness: 200, damping: 14 } as const
  return (
    <div
      className={`rm-stub rm-stub--duet is-${state}`}
      style={{ ['--va' as string]: VOICE_COLOR[theirType], ['--vb' as string]: VOICE_COLOR[mineType], ['--from' as string]: color } as CSSProperties}
      aria-hidden="true"
    >
      <span className="rm-stub__cover" />
      <span className="rm-duet__halo" />
      <span className="rm-duet__pair">
        <motion.span className="rm-duet__orb rm-duet__orb--them" animate={{ x: state === 'yes' ? 8 : 0 }} transition={pull} />
        <motion.span className="rm-duet__orb rm-duet__orb--me" animate={{ x: state === 'yes' ? -8 : 0 }} transition={pull} />
        {state === 'asking' ? <span className="rm-duet__call" /> : null}
      </span>
      <AnimatePresence>
        {state === 'yes' ? (
          <motion.span key="spark" className="rm-twin__burst rm-twin__burst--duet" initial={{ scale: 0.3, opacity: 1 }} animate={{ scale: 2.4, opacity: 0 }} transition={{ duration: 0.8, ease: 'easeOut' }} />
        ) : null}
      </AnimatePresence>
      <span className="rm-duet__x">DUET</span>
      <span className="rm-stub__name">{trr(memberRef(partner))}</span>
    </div>
  )
}

function DuetBody({ card, setPrimary, act, active }: CardBodyProps) {
  const t = R.useT()
  const trr = useTr()
  const size = useCardSize()
  const song = card.songId ? SONG_BY_ID[card.songId] : undefined
  const partner = (card.from ?? 'saki') as MemberId
  const mineType = useNavi(s => s.room.members.me.voiceType ?? s.col.voices[s.col.voices.length - 1]?.type ?? 'clear')
  const theirType = useNavi(s => s.room.members[partner]?.voiceType ?? 'clear')
  const st = useSim(u => (u.duet[card.id] as DuetState | undefined) ?? null)
  const audio = useNavi(s => s.session.audioOn)
  const state: 'idle' | DuetState = st ?? 'idle'

  useEffect(() => {
    if (state === 'idle') setPrimary({ action: 'reveal', label: R.ref('act.invite'), enabled: !!song?.reservable, arg: { songId: card.songId } })
    else if (state === 'asking') setPrimary({ action: 'reveal', label: R.ref('act.asking'), enabled: false, arg: { songId: card.songId } })
    else if (state === 'yes') setPrimary({ action: 'accept', label: R.ref('act.duetReserve'), enabled: true, arg: { songId: card.songId } })
    else setPrimary({ action: 'reveal', label: R.ref('act.waiting'), enabled: false, arg: { songId: card.songId } })
  }, [card.id, state])

  // an accepted invitation flies into the queue as a duet on its own, a beat after the "OK"
  const sent = useRef(false)
  useEffect(() => {
    if (state !== 'yes' || sent.current || !active) return
    if (audio) sound.play('orbPop')
    const id = setTimeout(() => {
      if (sent.current) return
      sent.current = true
      act('accept', { songId: card.songId })
    }, 900)
    return () => clearTimeout(id)
  }, [state, active])

  if (!song) return <div className="rm-inv" ref={size.ref} />
  const pair = trr(pairName(mineType, theirType))
  const status = state === 'asking' ? t('inv.duet.asking', { member: { member: partner } }) : state === 'yes' ? t('inv.duet.yes', { member: { member: partner } }) : state === 'sent' ? t('inv.duet.sent') : t('inv.duet.note')
  return (
    <div
      className={`rm-inv rm-inv--duet is-${state}${size.small ? ' is-small' : ''}`}
      ref={size.ref}
      data-testid="invite-body"
      data-variant="duet"
      data-state={state}
      style={{ ['--va' as string]: VOICE_COLOR[theirType], ['--vb' as string]: VOICE_COLOR[mineType] } as CSSProperties}
    >
      <div className="rm-inv__main">
        {/* the formula as two lights (the reason line, read out whole for screen readers) */}
        <div className="rm-duo" data-testid="card-reason">
          <span className="rm-vh">{trr(card.reason.text)}</span>
          <span className="rm-duo__who" aria-hidden="true">
            <i style={{ ['--c' as string]: VOICE_COLOR[theirType] } as CSSProperties} />
            {trr(memberRef(partner))}
          </span>
          <span className="rm-duo__x" aria-hidden="true">
            ×
          </span>
          <span className="rm-duo__who" aria-hidden="true">
            <i style={{ ['--c' as string]: VOICE_COLOR[mineType] } as CSSProperties} />
            {trr(memberRef('me'))}
          </span>
          {card.reason.cause ? <span className="rm-reason__cause">{trr(card.reason.cause)}</span> : null}
        </div>
        <div className="rm-inv__pair">{pair}</div>
        <div className="rm-inv__songlabel">{t('inv.duet.song')}</div>
        <SongTitle songId={song.id} variant="card" max={size.small ? 19 : 21} min={14} className="rm-inv__title rm-inv__title--mid" />
        <div className="rm-inv__artist">{song.artist}</div>
        <AnimatePresence mode="wait">
          <motion.div key={state} className={`rm-inv__status rm-inv__status--${state}`} initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
            {state === 'asking' ? <span className="rm-dots" aria-hidden="true"><i /><i /><i /></span> : null}
            {status}
          </motion.div>
        </AnimatePresence>
      </div>
      <DuetStub mineType={mineType} theirType={theirType} state={state} partner={partner} />
    </div>
  )
}

// ---------------------------------------------------------------- entry

function InviteBody(p: CardBodyProps) {
  if (p.card.variant === 'twin') return <TwinBody {...p} />
  if (p.card.variant === 'duet') return <DuetBody {...p} />
  return <RequestBody {...p} />
}

export const InviteCardBody: CardBodyComponent = p => <InviteBody {...p} />
