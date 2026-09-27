// Room screen, centre column (SPEC F-4, B-6, E-11, E-12). A big NOW (56 px) above the room
// ball (the shell places the ball), and the "cards on the table": the ask circle, the proposal
// to change the flow, the closing-song lanterns, a song shown to the room, and the navi's
// "I misread that" bubble. Only shared things appear here: anonymous dots, counts, never
// anyone's hand, voice or history, and never a "does not know".
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useMemo, useState } from 'react'
import type { NowPlaying, QueueItem, RoomPrompt, SongId } from '../../core/types'
import { naviApi, useNavi, presentIds } from '../../core/store'
import { useNaviStable } from '../../core/useStable'
import { selKnowView } from '../../core/selectors'
import { bus } from '../../core/events'
import { introDelay, introPending } from '../../core/intro'
import { SPRING } from '../../core/ui/motion'
import { Icon } from '../../core/ui/Icon'
import { songTitle, useLocale, useTr } from '../../i18n'
import { SONG_BY_ID } from '../../data/songs'
import { S } from './strings'
import { lightColor } from './model'
import { FitLine, MiniDots, ProgressRing, SongDisc, TagPills, useMemberName } from './parts'
import './stage.css'

export function RoomBoard(): JSX.Element {
  const t = S.useT()
  return (
    <div className="sg-board" data-testid="room-board" data-anchor="room-view">
      <BoardNow />
      <div className="sg-board__table">
        <Table />
      </div>
      <div className="sg-board__foot">
        <button type="button" className="sg-board__search" onClick={() => naviApi.getState().openSheet('search')}>
          <Icon name="search" size={16} strokeWidth={2} />
          {t('roomSearch')}
        </button>
        <span className="sg-board__lock">
          <Icon name="lock" size={14} strokeWidth={2} />
          {t('roomLock')}
        </span>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- NOW (56 px)

function BoardNow() {
  const t = S.useT()
  const now = useNavi(s => s.room.now)
  const head = useNavi(s => s.room.queue[0] ?? null)
  const members = useNavi(s => s.room.members)
  const name = useMemberName()
  const intro = introPending('lane')
  const item: QueueItem | null = now?.item ?? head
  return (
    <motion.div className="sg-bnow" initial={intro ? { opacity: 0, y: -16 } : false} animate={{ opacity: 1, y: 0 }} transition={{ ...SPRING.soft, delay: intro ? introDelay('lane') : 0 }}>
      <AnimatePresence mode="wait" initial={false}>
        {item ? (
          <NowBlock key={item.id} item={item} now={now} color={lightColor(members[item.by], false)} name={name(item.by)} />
        ) : (
          <motion.div key="empty" className="sg-bnow__empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <span className="sg-lbl sg-lbl--now">NOW</span>
            <span className="sg-bnow__dash" aria-hidden="true" />
            <span className="sg-bnow__emptytxt">{t('nowEmpty')}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

function NowBlock({ item, now, color, name }: { item: QueueItem; now: NowPlaying; color: string; name: string }) {
  const t = S.useT()
  const l = useLocale()
  const tt = songTitle(item.songId, l)
  const playing = !!now && now.item.id === item.id
  const song = SONG_BY_ID[item.songId]
  return (
    <motion.div
      className={`sg-bnow__block${playing ? ' is-playing' : ' is-waiting'}${item.tags.includes('navi') ? ' is-navi' : ''}`}
      style={{ ['--c' as string]: color }}
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -18, transition: { duration: 0.25 } }}
      transition={SPRING.soft}
    >
      <div className="sg-bnow__top">
        <ProgressRing now={playing ? now : null} size={26} stroke={3} color={color} waiting={!playing}>
          <i className="sg-dot" />
        </ProgressRing>
        <span className="sg-lbl sg-lbl--now">{playing ? 'NOW' : 'NEXT'}</span>
        {!playing ? <span className="sg-bnow__soon">{t('upNext')}</span> : null}
        <TagPills tags={item.tags} max={3} />
      </div>
      <FitLine max={56} min={28} className="sg-bnow__title">
        {tt.main}
      </FitLine>
      <div className="sg-bnow__meta">
        {tt.sub ? (
          <span className="sg-bnow__orig" lang="ja">
            {tt.sub}
          </span>
        ) : null}
        <span className="sg-bnow__artist">{song?.artist}</span>
        <span className="sg-bnow__by">
          <i className="sg-dot" />
          {name}
        </span>
        <MiniDots songId={item.songId} size={7} />
      </div>
    </motion.div>
  )
}

// ---------------------------------------------------------------- the table (room prompts)

type Transient = { kind: 'ask' | 'all' | 'excuse'; songId?: SongId; until: number; n: number }

function useTransients(): Transient | null {
  const [cur, setCur] = useState<Transient | null>(null)
  useEffect(() => {
    let n = 0
    const offs = [
      bus.on('know/asked', e => setCur({ kind: 'ask', songId: e.songId, until: Date.now() + 9000, n: ++n })),
      bus.on('know/answered', e => setCur(c => (c && c.kind === 'ask' && c.songId === e.songId ? { ...c, until: Math.max(c.until, Date.now() + 5000) } : c))),
      bus.on('know/complete', e => setCur({ kind: 'all', songId: e.songId, until: Date.now() + 5200, n: ++n })),
      bus.on('navi/miss', () => setCur({ kind: 'excuse', until: Date.now() + 6000, n: ++n })),
    ]
    return () => offs.forEach(f => f())
  }, [])
  useEffect(() => {
    if (!cur) return
    const id = setTimeout(() => setCur(c => (c && c.n === cur.n && Date.now() >= c.until - 20 ? null : c)), Math.max(50, cur.until - Date.now()))
    return () => clearTimeout(id)
  }, [cur])
  return cur
}

function Table() {
  const prompt = useNavi(s => s.room.prompt)
  const tr = useTransients()
  const [, tick] = useState(0)
  // a "show" prompt is visible for 10 seconds only
  useEffect(() => {
    if (prompt?.kind !== 'show') return
    const left = prompt.at + 10_000 - Date.now()
    const id = setTimeout(() => tick(x => x + 1), Math.max(0, left) + 30)
    return () => clearTimeout(id)
  }, [prompt?.id])
  let node: JSX.Element | null = null
  let key = 'none'
  if (tr?.kind === 'excuse' || prompt?.kind === 'excuse') {
    node = <Excuse />
    key = `ex${tr?.n ?? prompt?.id}`
  } else if (prompt && prompt.kind === 'shift') {
    node = <ShiftProposal prompt={prompt} />
    key = prompt.id
  } else if (prompt && prompt.kind === 'finale') {
    node = <Lanterns prompt={prompt} />
    key = prompt.id
  } else if (prompt && prompt.kind === 'show' && Date.now() - prompt.at < 10_000 && prompt.songIds[0]) {
    node = <Shown songId={prompt.songIds[0]} />
    key = prompt.id
  } else if (tr?.kind === 'all' && tr.songId) {
    node = <AskCircle songId={tr.songId} celebrate />
    key = `all${tr.n}`
  } else if ((tr?.kind === 'ask' && tr.songId) || (prompt?.kind === 'ask' && prompt.songIds[0])) {
    const id = (tr?.kind === 'ask' ? tr.songId : prompt?.songIds[0])!
    node = <AskCircle songId={id} />
    key = `ask${id}`
  }
  return (
    <AnimatePresence mode="wait">
      {node ? (
        <motion.div key={key} className="sg-table" initial={{ opacity: 0, y: 26, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 16, scale: 0.97, transition: { duration: 0.22 } }} transition={SPRING.soft}>
          {node}
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}

function AskCircle({ songId, celebrate }: { songId: SongId; celebrate?: boolean }) {
  const t = S.useT()
  const l = useLocale()
  const view = useNaviStable(selKnowView(songId))
  const size = view?.size ?? 0
  const dots = view?.dots ?? []
  const R = 58
  const knows = view?.knows ?? 0
  return (
    <div className={`sg-ask${celebrate || view?.all ? ' is-all' : ''}`} data-testid="room-ask">
      <div className="sg-ask__medal">
        <svg viewBox="-70 -70 140 140" className="sg-ask__ring" aria-hidden="true">
          <circle r={R} className="sg-ask__track" />
          {dots.map((d, i) => {
            const a = -Math.PI / 2 + (i / Math.max(1, size)) * Math.PI * 2
            return (
              <g key={i} transform={`translate(${(Math.cos(a) * R).toFixed(1)} ${(Math.sin(a) * R).toFixed(1)})`}>
                <motion.circle
                  key={d}
                  r={7}
                  className={`sg-ask__dot sg-ask__dot--${d}`}
                  initial={d === 'empty' ? false : { scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ type: 'spring', stiffness: 500, damping: 14 }}
                />
              </g>
            )
          })}
          {celebrate || view?.all ? <motion.circle r={R + 9} className="sg-ask__prism" initial={{ pathLength: 0, opacity: 1 }} animate={{ pathLength: 1 }} transition={{ duration: 0.7, ease: 'easeInOut' }} /> : null}
        </svg>
        <div className="sg-ask__center">
          <SongDisc songId={songId} size={40} />
        </div>
      </div>
      <div className="sg-ask__txt">
        <span className="sg-lbl">ASK</span>
        <div className="sg-ask__q">{celebrate || view?.all ? t('allKnow') : t('askTitle')}</div>
        <FitLine max={26} min={16} className="sg-ask__title">
          {songTitle(songId, l).main}
        </FitLine>
        <div className="sg-ask__count">
          <b>{Number.isInteger(knows) ? knows : knows.toFixed(1)}</b>
          <span>/{size}</span>
          <span className="sg-ask__note">{t('askNote')}</span>
        </div>
      </div>
    </div>
  )
}

function ShiftProposal({ prompt }: { prompt: RoomPrompt }) {
  const t = S.useT()
  const l = useLocale()
  const others = useNavi(s => presentIds(s).filter(id => id !== 'me').length)
  const agreed = Object.values(prompt.agree ?? {}).filter(Boolean).length
  const songId = prompt.songIds[0]
  return (
    <div className="sg-prop" data-testid="room-shift">
      <SongDisc songId={songId} size={54} className="sg-prop__disc" />
      <div className="sg-prop__txt">
        <span className="sg-lbl">SHIFT</span>
        <div className="sg-prop__q">{t('shiftTitle')}</div>
        <FitLine max={26} min={16} className="sg-prop__title">
          {songTitle(songId, l).main}
        </FitLine>
        <div className="sg-prop__sub">{t('shiftBody')}</div>
        <div className="sg-prop__lights" aria-label={t('orbAgree')}>
          {Array.from({ length: others }, (_, i) => (
            <motion.i key={`${i}:${i < agreed ? 1 : 0}`} className={`sg-prop__light${i < agreed ? ' is-on' : ''}`} initial={i < agreed ? { scale: 0 } : false} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 500, damping: 14 }} />
          ))}
          <span className="sg-prop__wait">{t('shiftWaiting')}</span>
        </div>
      </div>
    </div>
  )
}

function Lanterns({ prompt }: { prompt: RoomPrompt }) {
  const t = S.useT()
  const l = useLocale()
  const size = useNavi(s => presentIds(s).length)
  const tally = useMemo(() => {
    const m = new Map<SongId, number>()
    for (const v of Object.values(prompt.votes ?? {})) if (v) m.set(v, (m.get(v) ?? 0) + 1)
    return m
  }, [prompt.votes])
  return (
    <div className="sg-lanterns" data-testid="room-finale">
      <div className="sg-lanterns__head">
        <span className="sg-lbl sg-lbl--gold">FINALE</span>
        <span className="sg-lanterns__q">{t('finaleTitle')}</span>
        <span className="sg-lanterns__sub">{t('finaleBody')}</span>
      </div>
      <div className="sg-lanterns__row">
        {prompt.songIds.slice(0, 3).map(id => {
          const v = tally.get(id) ?? 0
          const fill = size ? v / size : 0
          return (
            <div key={id} className="sg-lantern" style={{ ['--fill' as string]: fill.toFixed(3) }}>
              <span className="sg-lantern__body">
                <motion.span className="sg-lantern__glow" animate={{ opacity: 0.15 + 0.85 * fill, scale: 0.7 + 0.3 * fill }} transition={SPRING.soft} />
                <span className="sg-lantern__cap" />
              </span>
              <span className="sg-lantern__votes">
                {Array.from({ length: v }, (_, i) => (
                  <motion.i key={i} initial={{ scale: 0, y: -10 }} animate={{ scale: 1, y: 0 }} transition={{ type: 'spring', stiffness: 400, damping: 16 }} />
                ))}
              </span>
              <span className="sg-lantern__title">{songTitle(id, l).main}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function Shown({ songId }: { songId: SongId }) {
  const t = S.useT()
  const l = useLocale()
  return (
    <div className="sg-shown">
      <SongDisc songId={songId} size={48} />
      <div className="sg-shown__txt">
        <span className="sg-shown__q">{t('showTitle')}</span>
        <FitLine max={26} min={16} className="sg-shown__title">
          {songTitle(songId, l).main}
        </FitLine>
      </div>
    </div>
  )
}

function Excuse() {
  const trr = useTr()
  return (
    <div className="sg-excuse" data-testid="room-excuse">
      <span className="sg-excuse__spark" aria-hidden="true">
        <Icon name="sparkle" size={18} strokeWidth={2} />
      </span>
      <span className="sg-excuse__txt">{trr({ key: 'core.excuse' })}</span>
    </div>
  )
}
