// Finale body (SPEC C-8 ⑩): a gold triptych with three paper lanterns, one per candidate.
// Tap a lantern and vote; the roommates' votes travel up as threads of light and fill the
// lanterns (0.6–3 s each, E-5). The fullest lantern flares gold and becomes the closing slot.
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import type { CardBodyComponent, CardBodyProps, MemberId, SongId } from '../../core/types'
import { presentMembers, useNavi } from '../../core/store'
import { useNaviStable } from '../../core/useStable'
import { bus } from '../../core/events'
import { fxState } from '../../core/fxState'
import { sound } from '../../core/sound'
import { SONG_BY_ID } from '../../data/songs'
import { songTitle, useLocale, useTr } from '../../i18n'
import { R } from './strings'
import { useSim } from './sim'
import { useCardSize } from './InviteCardBody'
import './room.css'

const ORDER: MemberId[] = ['me', 'minato', 'saki', 'jun']

type Slot = { songId: SongId; cx: number; top: number; w: number; h: number; centre: boolean }

/** Lantern boxes inside the triptych (fractions of the card, matching the frame's arches). */
function layout(w: number, h: number, options: SongId[], small: boolean): Slot[] {
  // on the 290×260 card the lanterns hang a little higher and smaller so two-line titles and
  // the headline below never meet
  const pos = small
    ? [
        { cx: 0.5, top: 0.15, lw: 0.19, lh: 0.265, centre: true },
        { cx: 0.14, top: 0.232, lw: 0.145, lh: 0.195, centre: false },
        { cx: 0.86, top: 0.232, lw: 0.145, lh: 0.195, centre: false },
      ]
    : [
        { cx: 0.5, top: 0.165, lw: 0.2, lh: 0.29, centre: true },
        { cx: 0.14, top: 0.255, lw: 0.15, lh: 0.215, centre: false },
        { cx: 0.86, top: 0.255, lw: 0.15, lh: 0.215, centre: false },
      ]
  return options.slice(0, 3).map((songId, i) => ({ songId, cx: pos[i].cx * w, top: pos[i].top * h, w: pos[i].lw * w, h: pos[i].lh * h, centre: pos[i].centre }))
}

function Lantern({ slot, fill, votes, total, voters, mine, selected, winner, dim, sway, onPick, disabled, index }: {
  slot: Slot
  dim: boolean
  fill: number
  votes: number
  total: number
  /** colours of the people whose vote landed here, in arrival order */
  voters: string[]
  mine: boolean
  selected: boolean
  winner: boolean
  sway: boolean
  onPick: () => void
  disabled: boolean
  index: number
}) {
  const l = useLocale()
  const t = R.useT()
  const title = songTitle(slot.songId, l).main
  const cls = `rm-lantern${slot.centre ? ' is-centre' : ''}${selected ? ' is-selected' : ''}${winner ? ' is-winner' : ''}${fill > 0 ? ' is-lit' : ''}${dim ? ' is-dim' : ''}`
  return (
    <>
      <motion.div
        className={cls}
        style={{ left: slot.cx - slot.w / 2, top: slot.top, width: slot.w, height: slot.h }}
        aria-hidden="true"
        initial={sway ? { y: -34 } : false}
        animate={{ y: 0 }}
        transition={{ type: 'spring', stiffness: 120, damping: 11, delay: 0.1 + index * 0.13 }}
      >
        <span className="rm-lantern__string" />
        <div className={`rm-lantern__sway${sway ? ' is-sway' : ''}`} style={{ animationDelay: `${-index * 1.3}s` }}>
          <motion.span
            className="rm-lantern__glow"
            animate={{ opacity: winner ? 1 : Math.max(selected ? 0.42 : 0.16, 0.2 + 0.8 * fill), scale: winner ? 1.3 : 0.82 + 0.3 * fill }}
            transition={{ type: 'spring', stiffness: 160, damping: 18, delay: fill > 0 ? 0.4 : 0 }}
          />
          <span className="rm-lantern__cap rm-lantern__cap--top" />
          <motion.span className="rm-lantern__body" animate={{ scale: winner ? 1.08 : 1 }} transition={{ type: 'spring', stiffness: 300, damping: 12 }}>
            <span className="rm-lantern__core" />
            <motion.span className="rm-lantern__fill" initial={false} animate={{ scaleY: fill > 0 ? fill : 0.001 }} transition={{ type: 'spring', stiffness: 110, damping: 15, delay: 0.42 }} />
            <svg className="rm-lantern__ribs" viewBox="0 0 100 100" preserveAspectRatio="none">
              {[18, 34, 50, 66, 82].map(y => (
                <path key={y} d={`M0,${y} Q50,${y + (y - 50) * 0.18 + 5} 100,${y}`} vectorEffect="non-scaling-stroke" />
              ))}
              <path d="M50,0 V100" vectorEffect="non-scaling-stroke" className="rm-lantern__spine" />
            </svg>
            <span className="rm-lantern__shine" />
          </motion.span>
          <span className="rm-lantern__cap rm-lantern__cap--bottom" />
          <span className="rm-lantern__tassel" />
          <span className="rm-lantern__minewrap">
            <AnimatePresence>
              {mine ? (
                <motion.span key="mine" className="rm-lantern__mine" initial={{ opacity: 0, scale: 0.5, y: 6 }} animate={{ opacity: 1, scale: 1, y: 0 }} transition={{ type: 'spring', stiffness: 420, damping: 18 }}>
                  {t('fin.yours')}
                </motion.span>
              ) : null}
            </AnimatePresence>
          </span>
        </div>
        <AnimatePresence>
          {winner ? (
            <motion.span key="rays" className="rm-lantern__rays" initial={{ opacity: 0, scale: 0.4, rotate: -20 }} animate={{ opacity: 1, scale: 1, rotate: 0 }} transition={{ duration: 0.7, ease: 'easeOut' }} />
          ) : null}
        </AnimatePresence>
      </motion.div>
      <button
        type="button"
        className={`rm-lantern__hit${selected ? ' is-selected' : ''}`}
        style={{ left: slot.cx - (slot.centre ? slot.w * 1.05 : slot.w * 0.92), top: slot.top - 6, width: slot.centre ? slot.w * 2.1 : slot.w * 1.84 }}
        data-testid="finale-lantern"
        data-song-id={slot.songId}
        data-votes={votes}
        aria-pressed={selected}
        disabled={disabled}
        onClick={onPick}
      >
        <span className="rm-lantern__spacer" style={{ height: slot.h + 12 }} />
        <span className={`rm-lantern__title${slot.centre ? ' is-centre' : ''}`}>{title}</span>
        <span className="rm-lantern__pips" aria-label={`${votes}/${total}`}>
          {Array.from({ length: total }, (_, i) => (
            <i key={i} className={i < voters.length ? 'is-on' : ''} style={i < voters.length ? ({ ['--c' as string]: voters[i] } as CSSProperties) : undefined} />
          ))}
        </span>
      </button>
    </>
  )
}

function FinaleBody({ card, setPrimary, act, active }: CardBodyProps) {
  const t = R.useT()
  const trr = useTr()
  const size = useCardSize({ w: 320, h: 296 })
  const options = useMemo(() => (card.options ?? []).filter(id => SONG_BY_ID[id]).slice(0, 3), [card.id])
  const prompt = useNavi(s => (s.room.prompt?.kind === 'finale' ? s.room.prompt : null))
  const present = useNaviStable(s => presentMembers(s).map(m => ({ id: m.id, color: m.color })))
  const flights = useSim(u => (prompt ? u.votes[prompt.id] : undefined))
  const decided = useSim(u => (prompt ? u.decided[prompt.id] : undefined))
  const reduced = useNavi(s => s.ui.reduced)
  const audio = useNavi(s => s.session.audioOn)
  const [sel, setSel] = useState<SongId | undefined>(options[0])

  // every vote the card knows about: the room's, plus the ones still travelling
  const votes: Partial<Record<MemberId, SongId>> = { ...(prompt?.votes ?? {}) }
  for (const f of flights ?? []) votes[f.member] = f.songId
  const myVote = votes.me
  const total = present.length || 1

  useEffect(() => {
    if (myVote) setPrimary({ action: 'vote', label: R.ref('act.gathering'), enabled: false, arg: { songId: myVote } })
    else setPrimary({ action: 'vote', label: R.ref('act.vote'), enabled: !!sel, arg: { songId: sel } })
  }, [card.id, sel, !!myVote])

  // a soft note for each vote that lands, and a gold room when the lantern is chosen
  const heard = useRef(new Set<string>())
  const voteKey = ORDER.filter(id => votes[id]).map(id => `${id}:${votes[id]}`).join(',')
  useEffect(() => {
    const keys = voteKey ? voteKey.split(',') : []
    let i = 0
    for (const k of keys) {
      if (heard.current.has(k)) continue
      heard.current.add(k)
      const n = heard.current.size - 1
      if (audio && active) setTimeout(() => sound.play('knowTick', { index: Math.min(3, n) }), 420 + i * 60)
      i++
    }
  }, [voteKey])
  useEffect(() => {
    if (!decided) return
    const glow = setTimeout(() => {
      fxState.gold = 1
      bus.emit({ type: 'fx/flash', strength: 0.6 })
      if (audio) sound.play('knowChord')
    }, 450)
    // the winning lantern's light flies to the end of the lane just as the room fixes it there
    const fly = setTimeout(() => {
      const el = size.ref.current?.querySelector('.rm-lantern.is-winner .rm-lantern__body')
      if (el) bus.emit({ type: 'fx/flight', from: el.getBoundingClientRect(), to: 'lane:end', kind: 'reserve', songId: decided, color: '#FFD36B' })
    }, 1420)
    return () => {
      clearTimeout(glow)
      clearTimeout(fly)
    }
  }, [decided])

  if (!options.length) return <div className="rm-fin" ref={size.ref} />
  const { w, h } = size
  const slots = layout(w, h, options, size.small)
  const count = (id: SongId) => Object.values(votes).filter(v => v === id).length
  const lightY = h * (size.small ? 0.925 : 0.905)
  const lightX = (i: number, n: number) => w / 2 + (i - (n - 1) / 2) * 22
  const voters = ORDER.filter(id => present.some(p => p.id === id))
  // who voted, in the order the votes landed (mine first, then the room's threads)
  const arrival = [...new Set<MemberId>([...(prompt?.votes?.me ? (['me'] as MemberId[]) : []), ...ORDER.filter(id => prompt?.votes?.[id]), ...(flights ?? []).map(f => f.member)])]
  const status = decided ? t('fin.decided') : myVote ? t('fin.gathering') : t('fin.pick')

  return (
    <div className={`rm-fin${size.small ? ' is-small' : ''}${decided ? ' is-decided' : ''}`} ref={size.ref} data-testid="finale-body" data-voted={myVote ? '1' : '0'} data-decided={decided ?? ''}>
      {/* threads of light: each vote rides up from its person's light as a comet and fills a
          lantern; the trail then fades, so nothing is left crossing the words at rest */}
      <svg className="rm-fin__threads" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
        {reduced
          ? null
          : voters.map((id, i) => {
              const v = votes[id]
              const slot = v ? slots.find(s => s.songId === v) : undefined
              if (!slot) return null
              const x0 = lightX(i, voters.length)
              const y0 = lightY - 6
              const x1 = slot.cx
              const y1 = slot.top + slot.h + 2
              const color = present.find(p => p.id === id)?.color ?? '#FFD36B'
              const d = `M${x0},${y0} Q${(x0 + x1) / 2 + (x1 > x0 ? -26 : 26)},${(y0 + y1) / 2 + 14} ${x1},${y1}`
              return (
                <g key={`${id}:${v}`}>
                  <motion.path
                    d={d}
                    fill="none"
                    stroke={color}
                    strokeWidth={1.4}
                    strokeLinecap="round"
                    initial={{ pathLength: 0, opacity: 0.85 }}
                    animate={{ pathLength: 1, opacity: [0.85, 0.85, 0] }}
                    transition={{ pathLength: { duration: 0.5, ease: 'easeOut' }, opacity: { duration: 1.5, times: [0, 0.4, 1] } }}
                  />
                  <motion.path
                    d={d}
                    fill="none"
                    stroke="#FFF8E4"
                    strokeWidth={3.2}
                    strokeLinecap="round"
                    initial={{ pathLength: 0.14, pathOffset: 0, opacity: 1 }}
                    animate={{ pathOffset: 0.86, opacity: [1, 1, 0] }}
                    transition={{ pathOffset: { duration: 0.5, ease: 'easeOut' }, opacity: { duration: 0.62, times: [0, 0.8, 1] } }}
                  />
                  <motion.circle
                    cx={x1}
                    cy={y1}
                    r={10}
                    fill="none"
                    stroke={color}
                    strokeWidth={1.5}
                    style={{ transformOrigin: `${x1}px ${y1}px` }}
                    initial={{ scale: 0.2, opacity: 0 }}
                    animate={{ scale: [0.2, 1.8], opacity: [0, 1, 0] }}
                    transition={{ delay: 0.42, duration: 0.6, times: [0, 0.2, 1] }}
                  />
                </g>
              )
            })}
      </svg>

      {slots.map((slot, i) => (
        <Lantern
          key={slot.songId}
          index={i}
          slot={slot}
          fill={decided === slot.songId ? 1 : count(slot.songId) / total}
          votes={count(slot.songId)}
          total={total}
          voters={arrival.filter(id => votes[id] === slot.songId).map(id => present.find(p => p.id === id)?.color ?? '#FFD36B')}
          mine={myVote === slot.songId}
          selected={!myVote && sel === slot.songId}
          winner={decided === slot.songId}
          dim={!!decided && decided !== slot.songId}
          sway={active && !reduced}
          disabled={!!myVote}
          onPick={() => {
            if (myVote) return
            if (sel !== slot.songId) sound.play('tap')
            setSel(slot.songId)
            act('select', { songId: slot.songId })
          }}
        />
      ))}

      <div className="rm-fin__foot" style={{ top: h * (size.small ? 0.64 : 0.665) } as CSSProperties}>
        <div className="rm-fin__head" data-testid="card-reason">
          <span className="rm-fin__headtext">{trr(card.reason.text)}</span>
          {card.reason.cause ? <span className="rm-fin__cause">{trr(card.reason.cause)}</span> : null}
        </div>
        <AnimatePresence mode="wait">
          <motion.div key={status} className="rm-fin__status" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
            {status}
          </motion.div>
        </AnimatePresence>
      </div>

      <div className="rm-fin__lights" style={{ top: lightY - 5 }} aria-hidden="true">
        {voters.map((id, i) => {
          const color = present.find(p => p.id === id)?.color ?? '#D8DCE8'
          const on = !!votes[id]
          return (
            <span key={id} className={`rm-fin__light${on ? ' is-on' : ''}${id === 'me' ? ' is-me' : ''}`} style={{ left: lightX(i, voters.length) - w / 2 - 5, ['--c' as string]: color } as CSSProperties}>
              {on ? <motion.i key="pop" initial={{ scale: 0 }} animate={{ scale: [0, 1.5, 1] }} transition={{ duration: 0.4 }} /> : null}
            </span>
          )
        })}
      </div>
    </div>
  )
}

export const FinaleCardBody: CardBodyComponent = p => <FinaleBody {...p} />
