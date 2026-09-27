// The Sing tab (SPEC F-1 S4): the whole queue in play order with my songs movable and
// cancellable, what is playing now, "your turn", the demo score after I sing (compared only
// with my own best tonight, never ranked), a penlight while someone else sings, standby and
// the way out of the room.
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react'
import type { QueueItem, SungEntry } from '../../core/types'
import { naviApi, useNavi, isMine } from '../../core/store'
import { selMyTurnIn } from '../../core/selectors'
import { bus } from '../../core/events'
import { sound } from '../../core/sound'
import { SPRING } from '../../core/ui/motion'
import { Button } from '../../core/ui/Button'
import { Icon } from '../../core/ui/Icon'
import { SongTitle } from '../../core/ui/SongTitle'
import { SongArt } from '../../ui/SongArt'
import { SONG_BY_ID } from '../../data/songs'
import { S } from './strings'
import { demoScore, lightColor, scoreVerdict } from './model'
import { MiniDots, ProgressRing, SongDisc, TagPills, useMemberName } from './parts'
import { MyTurnText } from './StageLane'
import { absorbPenlights, wavePenlight } from './penlight'
import './stage.css'

export function StageScreen(): JSX.Element {
  const t = S.useT()
  const now = useNavi(s => s.room.now)
  const queue = useNavi(s => s.room.queue)
  const sung = useNavi(s => s.room.sung)
  const members = useNavi(s => s.room.members)
  const myTurn = useNavi(selMyTurnIn)
  const voiceOnTop = useNavi(s => s.deck.cards[0]?.kind === 'voice')
  const name = useMemberName()
  const color = (id: QueueItem['by']) => lightColor(members[id], true)
  const mineNow = !!now && isMine(now.item)

  return (
    <div className="sg-stage" data-testid="stage-screen">
      <header className="sg-stage__head">
        <span className="sg-lbl">STAGE</span>
        <span className="sg-stage__title">{t('stageTitle')}</span>
        <span className="sg-stage__count">{t('queueCount', { n: queue.length })}</span>
      </header>

      <NowCard mine={mineNow} color={now ? color(now.item.by) : '#fff'} name={now ? name(now.item.by) : ''} />

      <TurnPanel myTurn={myTurn} />

      <ScoreCard sung={sung} />

      <AnimatePresence>
        {voiceOnTop && !mineNow ? (
          <motion.div className="sg-nudge" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={SPRING.soft}>
            <span className="sg-nudge__orb" aria-hidden="true" />
            <span className="sg-nudge__txt">{t('voiceNudge')}</span>
            <Button kind="secondary" size="sm" onClick={() => naviApi.getState().setTab('discover')}>
              {t('voiceGo')}
            </Button>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <QueueList queue={queue} hasNow={!!now} color={color} name={name} />

      <History sung={sung} color={color} name={name} />

      <div className="sg-stage__foot">
        <Button kind="secondary" size="md" full icon="sparkle" testid="stage-standby" onClick={() => naviApi.getState().setOverlay('standby')}>
          {t('putDown')}
        </Button>
        <Button kind="ghost" size="md" full testid="stage-exit" onClick={() => naviApi.getState().openSheet('exitConfirm')}>
          {t('exit')}
        </Button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- NOW card (+ penlight stage)

function NowCard({ mine, color, name }: { mine: boolean; color: string; name: string }) {
  const t = S.useT()
  const now = useNavi(s => s.room.now)
  const head = useNavi(s => s.room.queue[0] ?? null)
  const seed = useNavi(s => s.session.seed)
  const host = useRef<HTMLDivElement>(null)
  const orb = useRef<HTMLSpanElement>(null)
  const btn = useRef<HTMLDivElement>(null)
  const nowId = now?.item.id ?? null

  useEffect(
    () =>
      bus.on('song/ended', e => {
        if (host.current) absorbPenlights(host.current, orb.current, e.entry.item.id)
      }),
    [],
  )

  const others = !!now && !mine
  const onTap = (e: PointerEvent) => {
    if (!others || !host.current) return
    if ((e.target as HTMLElement).closest('button')) return
    wavePenlight(host.current, e.clientX, e.clientY, nowId)
  }

  const finish = () => {
    const s = naviApi.getState()
    const cur = s.room.now
    if (!cur || !isMine(cur.item)) return
    const score = demoScore(s.session.seed, cur.item.id)
    const r = btn.current?.getBoundingClientRect()
    s.finishNow({ score })
    sound.play('fanfare')
    sound.haptic([10, 40, 10])
    if (r) bus.emit({ type: 'fx/burst', at: { x: r.left + r.width / 2, y: r.top + r.height / 2 }, preset: 'prism' })
  }

  if (!now) {
    return (
      <section className="sg-nowcard is-idle">
        <div className="sg-nowcard__idle">
          <span className="sg-lbl">NOW</span>
          <span className="sg-nowcard__idletxt">{head ? t('startsSoon') : t('nobodySinging')}</span>
          {head ? (
            <span className="sg-nowcard__next">
              <SongDisc songId={head.songId} size={22} />
              <SongTitle songId={head.songId} variant="lane" />
            </span>
          ) : null}
        </div>
      </section>
    )
  }
  const song = SONG_BY_ID[now.item.songId]
  return (
    <section
      ref={host}
      className={`sg-nowcard${mine ? ' is-mine' : ' is-others'}`}
      style={{ ['--c' as string]: color }}
      onPointerDown={onTap}
      data-testid="stage-now"
      data-seed={seed}
    >
      <div className="sg-nowcard__art" aria-hidden="true">
        <SongArt seed={now.item.songId} energy={song?.energy ?? 0.5} animate={false} />
      </div>
      <div className="sg-nowcard__shade" aria-hidden="true" />
      {mine ? (
        <div className="sg-nowcard__beam" aria-hidden="true">
          <span />
        </div>
      ) : null}
      <div className="sg-nowcard__body">
        <div className="sg-nowcard__top">
          <ProgressRing now={now} size={40} stroke={3} color={color}>
            <span className="sg-nowcard__orb" ref={orb} />
          </ProgressRing>
          <span className="sg-nowcard__who">
            <span className="sg-lbl sg-lbl--now">NOW</span>
            <span className="sg-nowcard__name">{mine ? t('yourTurn') : name}</span>
          </span>
          <TagPills tags={now.item.tags} max={2} />
        </div>
        <SongTitle songId={now.item.songId} variant="card" max={30} min={18} className="sg-nowcard__title" />
        <div className="sg-nowcard__artist">{song?.artist}</div>
        {mine ? (
          <div className="sg-nowcard__mine">
            <span className="sg-nowcard__lead">{t('yourTurnLead')}</span>
            <div ref={btn}>
              <Button kind="primary" size="lg" full testid="stage-finish" onClick={finish}>
                {t('finish')}
              </Button>
            </div>
          </div>
        ) : (
          <div className="sg-nowcard__pen">
            <span className="sg-nowcard__penicon" aria-hidden="true" />
            <span className="sg-nowcard__pentxt">
              <b>{t('penHint')}</b>
              <span>{t('penSub')}</span>
            </span>
          </div>
        )}
      </div>
    </section>
  )
}

// ---------------------------------------------------------------- my turn

function TurnPanel({ myTurn }: { myTurn: number | null }) {
  const t = S.useT()
  if (myTurn === 0) return null
  return (
    <section className={`sg-turnpanel${myTurn === 1 ? ' is-soon' : ''}${myTurn == null ? ' is-none' : ''}`} data-testid={myTurn != null ? 'stage-my-turn' : undefined}>
      {myTurn != null ? (
        <MyTurnText n={myTurn} className="sg-turnpanel__txt" />
      ) : (
        <>
          <span className="sg-turnpanel__none">{t('mineNone')}</span>
          <Button kind="secondary" size="sm" icon="search" onClick={() => naviApi.getState().setTab('discover')}>
            {t('findSong')}
          </Button>
        </>
      )}
    </section>
  )
}

// ---------------------------------------------------------------- score (demo)

function ScoreCard({ sung }: { sung: SungEntry[] }) {
  const t = S.useT()
  const mine = useMemo(() => sung.filter(e => isMine(e.item) && e.score != null), [sung])
  const last = mine[mine.length - 1]
  if (!last) return null
  const verdict = scoreVerdict(last.score!, mine.slice(0, -1).map(e => e.score!))
  return (
    <motion.section key={last.item.id} className={`sg-score is-${verdict.kind}`} data-testid="stage-score" data-score={last.score} initial={{ opacity: 0, y: 16, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={SPRING.soft}>
      <div className="sg-score__left">
        <span className="sg-lbl">{t('scoreLabel')}</span>
        <SongTitle songId={last.item.songId} variant="lane" className="sg-score__song" />
      </div>
      <motion.span className="sg-score__num" initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', stiffness: 300, damping: 14, delay: 0.15 }}>
        {t('scorePts', { n: last.score! })}
      </motion.span>
      <div className="sg-score__verdict">
        {verdict.kind === 'best' ? <Icon name="sparkle" size={14} /> : null}
        {verdict.kind === 'first' ? t('bestFirst') : verdict.kind === 'best' ? t('bestNew') : verdict.kind === 'same' ? t('bestSame') : t('bestGap', { n: verdict.gap })}
      </div>
      <div className="sg-score__note">{t('scoreNote')}</div>
    </motion.section>
  )
}

// ---------------------------------------------------------------- queue list

function QueueList({ queue, hasNow, color, name }: { queue: QueueItem[]; hasNow: boolean; color: (id: QueueItem['by']) => string; name: (id: QueueItem['by']) => string }) {
  const t = S.useT()
  const [confirm, setConfirm] = useState<string | null>(null)
  useEffect(() => {
    if (!confirm) return
    const id = setTimeout(() => setConfirm(null), 2600)
    return () => clearTimeout(id)
  }, [confirm])
  const s = naviApi.getState
  return (
    <section className="sg-queue" data-anchor="lane">
      <div className="sg-sec">
        <span className="sg-sec__t">{t('queueTitle')}</span>
        <span className="sg-sec__s">{t('playOrder')}</span>
      </div>
      {queue.length === 0 ? <div className="sg-queue__empty">{t('queueEmpty')}</div> : null}
      <ol className="sg-queue__list">
        <AnimatePresence initial={false}>
          {queue.map((item, i) => {
            const mine = isMine(item)
            const song = SONG_BY_ID[item.songId]
            const eta = i + (hasNow ? 1 : 0)
            return (
              <motion.li
                key={item.id}
                layout="position"
                className={`sg-qrow${mine ? ' is-mine' : ''}${item.tags.includes('navi') ? ' is-navi' : ''}${item.tags.includes('finale') ? ' is-finale' : ''}`}
                data-testid="stage-queue-item"
                data-song-id={item.songId}
                data-item-id={item.id}
                data-pos={i + 1}
                style={{ ['--c' as string]: color(item.by) }}
                initial={{ opacity: 0, x: 24 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -24, transition: { duration: 0.2 } }}
                transition={SPRING.soft}
              >
                <span className="sg-qrow__pos">#{i + 1}</span>
                <SongDisc songId={item.songId} size={34} />
                <span className="sg-qrow__main">
                  <SongTitle songId={item.songId} variant="lane" className="sg-qrow__title" />
                  <span className="sg-qrow__meta">
                    <i className="sg-dot" />
                    <span className="sg-qrow__by">{name(item.by)}</span>
                    <span className="sg-qrow__artist">{song?.artist}</span>
                    {item.keyShift ? <span className="sg-qrow__key">{item.keyShift > 0 ? `+${item.keyShift}` : item.keyShift}</span> : null}
                  </span>
                  <span className="sg-qrow__tags">
                    <TagPills tags={item.tags} max={3} />
                    <MiniDots songId={item.songId} size={5} />
                    {mine ? <span className="sg-qrow__eta">{eta === 0 ? t('myTurnNow') : t('etaSongs', { n: eta })}</span> : null}
                  </span>
                </span>
                {mine ? (
                  <span className="sg-qrow__ctl">
                    <button type="button" className="sg-iconbtn" aria-label={t('moveUp')} title={t('moveUp')} data-testid="stage-move-up" disabled={i === 0} onClick={() => (sound.play('tap'), s().moveMine(item.id, -1))}>
                      <svg viewBox="0 0 16 16" aria-hidden="true">
                        <path d="M4 10l4-4 4 4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </button>
                    <button type="button" className="sg-iconbtn" aria-label={t('moveDown')} title={t('moveDown')} data-testid="stage-move-down" disabled={i === queue.length - 1} onClick={() => (sound.play('tap'), s().moveMine(item.id, 1))}>
                      <svg viewBox="0 0 16 16" aria-hidden="true">
                        <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      className={`sg-iconbtn sg-iconbtn--x${confirm === item.id ? ' is-armed' : ''}`}
                      aria-label={confirm === item.id ? t('cancelAgain') : t('cancel')}
                      title={confirm === item.id ? t('cancelAgain') : t('cancel')}
                      data-testid="stage-cancel"
                      onClick={() => {
                        if (confirm === item.id) {
                          sound.play('close')
                          s().cancelReserve(item.id)
                          setConfirm(null)
                        } else setConfirm(item.id)
                      }}
                    >
                      {confirm === item.id ? (
                        <span className="sg-iconbtn__again">{t('cancelAgain')}</span>
                      ) : (
                        <svg viewBox="0 0 16 16" aria-hidden="true">
                          <path d="M5 5l6 6M11 5l-6 6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                        </svg>
                      )}
                    </button>
                  </span>
                ) : null}
              </motion.li>
            )
          })}
        </AnimatePresence>
      </ol>
    </section>
  )
}

// ---------------------------------------------------------------- history with crystals

function History({ sung, color, name }: { sung: SungEntry[]; color: (id: QueueItem['by']) => string; name: (id: QueueItem['by']) => string }) {
  const t = S.useT()
  const list = sung.slice(-4).reverse()
  if (!list.length) return null
  return (
    <section className="sg-histlist">
      <div className="sg-sec">
        <span className="sg-sec__t">{t('history')}</span>
        <span className="sg-sec__s">{t('crystal')}</span>
      </div>
      {list.map(e => {
        const size = 8 + Math.min(10, Math.round(e.claps / 7))
        return (
          <div key={e.item.id + e.endedAt} className="sg-hrow" style={{ ['--c' as string]: color(e.item.by) }}>
            <i className="sg-dot" />
            <SongTitle songId={e.item.songId} variant="lane" className="sg-hrow__title" />
            <span className="sg-hrow__by">{name(e.item.by)}</span>
            <span className="sg-crystal" style={{ width: size, height: size }} aria-label={t('crystal')} />
          </div>
        )
      })}
    </section>
  )
}
