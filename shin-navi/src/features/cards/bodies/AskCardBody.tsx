// Ask card body (SPEC C-8 2): a round medallion with one anonymous dot per person around the
// rim. "Know / Just the chorus" fill my own dot; the primary asks the room, and once the count
// is over it turns into Reserve. Unknown and unanswered look identical (an empty ring).
// Card-front contract: question, title, artist, one reason line and the answer controls; how the
// count works lives on the evidence side.
import { useEffect, useMemo } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import type { CardBodyComponent, CardBodyProps, KnowView } from '../../../core/types'
import { useNavi, presentMembers } from '../../../core/store'
import { useNaviStable } from '../../../core/useStable'
import { selKnowView, selRoomSize } from '../../../core/selectors'
import { KnowDots } from '../../../core/ui/KnowDots'
import { SongTitle } from '../../../core/ui/SongTitle'
import { SONG_BY_ID } from '../../../data/songs'
import { useBox } from '../../../core/layout'
import { ReasonLine } from '../CardShell'
import { FRAMES } from '../frames'
import { S } from '../strings'

/** Sim ms after the ask when the count is treated as over even if someone never answers. */
const COUNT_MS = 6500

function RimDots({ view, size, d, meIndex }: { view: KnowView | null; size: number; d: number; meIndex: number }) {
  const n = view?.dots.length ?? size
  const dots = view?.dots ?? Array.from({ length: n }, () => 'empty' as const)
  const R = d / 2 - 12
  return (
    <div className="ask__rim" style={{ width: d, height: d }} aria-hidden="true">
      {dots.map((k, i) => {
        const a = -Math.PI / 2 + (i / n) * Math.PI * 2 + Math.PI / n
        const x = d / 2 + R * Math.cos(a)
        const y = d / 2 + R * Math.sin(a)
        return (
          <motion.span
            key={`${i}:${k}`}
            className={`ask__rimdot ask__rimdot--${k}${i === meIndex ? ' is-me' : ''}`}
            style={{ left: x - 8, top: y - 8 }}
            initial={k !== 'empty' ? { scale: 0 } : false}
            animate={{ scale: k !== 'empty' ? [0, 1.35, 1] : 1 }}
            transition={{ duration: 0.42, times: [0, 0.55, 1], ease: 'easeOut' }}
          />
        )
      })}
    </div>
  )
}

function AskBody({ card, setPrimary, act }: CardBodyProps) {
  const t = S.useT()
  const box = useBox()
  const small = box.h < 760 || box.w < 375
  const songId = card.songId ?? ''
  const song = SONG_BY_ID[songId]
  const view = useNaviStable(selKnowView(songId))
  const roomSize = useNavi(selRoomSize)
  const asked = view != null
  const myAnswer = useNavi(s => s.room.knowing[songId]?.answers.me?.a ?? null)
  const counted = useNavi(s => {
    const tally = s.room.knowing[songId]
    if (!tally) return false
    if (s.session.simMs - tally.askedAt >= COUNT_MS) return true
    return presentMembers(s).every(m => m.id === 'me' || !!tally.answers[m.id])
  })
  const queued = useNavi(s => s.room.queue.some(q => q.songId === songId) || s.room.now?.item.songId === songId)

  useEffect(() => {
    if (!song) return
    if (!asked) setPrimary({ action: 'ask', label: S.ref('ask'), enabled: true, arg: { songId } })
    else if (!counted) setPrimary({ action: 'ask', label: S.ref('counting'), enabled: false, arg: { songId } })
    else setPrimary({ action: 'reserve', label: S.ref('reserve'), enabled: song.reservable && !queued, arg: { songId } })
  }, [card.id, asked, counted, queued])

  const d = Math.round((small ? FRAMES.medallion.small.w : FRAMES.medallion.size.w))
  const meIndex = asked && !myAnswer ? (view?.dots.filter(x => x !== 'empty').length ?? -1) : -1
  const all = !!view?.all
  const sweepKey = useMemo(() => (all ? Date.now() : 0), [all])

  if (!song) return <div className="ask" />
  return (
    <div className={`ask${all ? ' is-all' : ''}`}>
      <div className="ask__halo" aria-hidden="true" />
      <RimDots view={view} size={roomSize} d={d} meIndex={meIndex} />
      <AnimatePresence>
        {all ? (
          <motion.svg key={sweepKey} className="ask__sweep" width={d} height={d} viewBox={`0 0 ${d} ${d}`} aria-hidden="true" initial={{ opacity: 1 }} animate={{ opacity: [1, 1, 0.55] }} transition={{ duration: 1.4, times: [0, 0.6, 1] }}>
            <defs>
              <linearGradient id={`askp-${card.id}`} x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="#FF3DA8" />
                <stop offset="0.25" stopColor="#FFB547" />
                <stop offset="0.5" stopColor="#C6FF3D" />
                <stop offset="0.75" stopColor="#2EF2FF" />
                <stop offset="1" stopColor="#8A6BFF" />
              </linearGradient>
            </defs>
            <motion.circle
              cx={d / 2}
              cy={d / 2}
              r={d / 2 - 12}
              fill="none"
              stroke={`url(#askp-${card.id})`}
              strokeWidth={4}
              strokeLinecap="round"
              transform={`rotate(-90 ${d / 2} ${d / 2})`}
              initial={{ pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: 0.7, ease: 'easeInOut' }}
            />
          </motion.svg>
        ) : null}
      </AnimatePresence>
      <div className="ask__inner">
        <div className="ask__q">{card.variant === 'welcome' ? t('ask.welcomeQ') : t('ask.question')}</div>
        <SongTitle songId={song.id} variant="card" max={small ? 22 : 25} min={15} className="ask__title" />
        <div className="ask__artist">{song.artist}</div>
        <ReasonLine reason={card.reason} className="ask__reason" />
        {asked ? (
          <div className="ask__state">
            <KnowDots songId={song.id} size={small ? 10 : 11} label className="ask__kd" />
          </div>
        ) : null}
        {myAnswer && myAnswer !== 'none' ? (
          <div className="ask__mine is-done">
            <span className={`ask__mydot ask__mydot--${myAnswer}`} aria-hidden="true" />
            {t('ask.answered')}
          </div>
        ) : (
          <div className="ask__mine">
            <motion.button type="button" className="ask__btn" data-testid="ask-know" whileTap={{ scale: 0.93 }} onClick={() => act('answer', { songId, answer: 'know' })}>
              <span className="ask__glyph ask__glyph--know" aria-hidden="true" />
              {t('ask.know')}
            </motion.button>
            <motion.button type="button" className="ask__btn" data-testid="ask-chorus" whileTap={{ scale: 0.93 }} onClick={() => act('answer', { songId, answer: 'chorus' })}>
              <span className="ask__glyph ask__glyph--chorus" aria-hidden="true" />
              {t('ask.chorus')}
            </motion.button>
          </div>
        )}
        {all ? (
          <div className="ask__note">
            <b className="ask__allmsg">{t('ask.all')}</b>
          </div>
        ) : asked && counted ? (
          <div className="ask__note">{t('ask.done')}</div>
        ) : null}
      </div>
    </div>
  )
}

export const AskCardBody: CardBodyComponent = p => <AskBody {...p} />
