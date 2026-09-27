// The stage lane = the room's song queue (SPEC F-3 / F-4 / F-6, I-4 #2).
// Horizontal on the phone (y 44–108): NOW with a progress ring, play order #n in the reserver's
// colour, tags, tiny anonymous "knows it" dots, a drink glass where an order should arrive,
// the "mouth" slot songs are thrown into (it swallows on fx/landed), the flow line with Navi's
// drag preview, and "N songs until your turn". Vertical on the room screen: the same queue as a
// tall column with the last songs, NOW, the order of play and each song's wait.
import { AnimatePresence, animate, motion } from 'motion/react'
import { useCallback, useEffect, useMemo, useRef, type ReactNode } from 'react'
import type { Member, MemberId, NowPlaying, Order, QueueItem, SungEntry } from '../../core/types'
import { isMine, useNavi } from '../../core/store'
import { selMyTurnIn, selRoomUnlinked } from '../../core/selectors'
import { bus } from '../../core/events'
import { sound } from '../../core/sound'
import { registerTarget } from '../../core/targets'
import { introDelay, introPending } from '../../core/intro'
import { usePhoneMetrics } from '../../core/layout'
import { SPRING } from '../../core/ui/motion'
import { SongTitle } from '../../core/ui/SongTitle'
import { SONG_BY_ID } from '../../data/songs'
import { S } from './strings'
import { glassSlots, lightColor, soonestEta, splitAround } from './model'
import { MiniDots, ProgressRing, SongDisc, TagPills, cometLanded, useIncoming, useMemberName } from './parts'
import { FlowLine } from './FlowLine'
import './stage.css'

type LaneProps = { orientation: 'horizontal' | 'vertical'; compact?: boolean }

export function StageLane(p: LaneProps): JSX.Element {
  return p.orientation === 'vertical' ? <VerticalLane /> : <HorizontalLane compact={!!p.compact} />
}

// ================================================================= shared bits

const itemData = (item: QueueItem, testid: 'lane-now' | 'lane-item') => ({
  'data-testid': testid,
  'data-song-id': item.songId,
  'data-by': item.by,
  'data-tags': item.tags.join(' '),
  'data-key': item.keyShift,
  'data-item-id': item.id,
})

function useColors(privateOk: boolean) {
  const members = useNavi(s => s.room.members)
  return useCallback((id: MemberId) => lightColor(members[id] ?? ({ id, color: '#ffffff', voiceType: null } as Member), privateOk), [members, privateOk])
}

/** "N songs until your turn" with the number styled on its own (works for every word order). */
export function MyTurnText({ n, className, short }: { n: number; className?: string; short?: boolean }) {
  const t = S.useT()
  if (n === 0) return <span className={className}>{t('myTurnNow')}</span>
  // the number is styled on its own, so pick the singular key by hand (vars.n is a marker here)
  const key = short ? (n === 1 ? 'myTurnShort.one' : 'myTurnShort') : n === 1 ? 'myTurnIn.one' : 'myTurnIn'
  const [a, b] = splitAround(t(key, { n: '\u0001' }), '\u0001')
  return (
    <span className={className}>
      {a}
      <b className="sg-num">{n}</b>
      {b}
    </span>
  )
}

function Glass({ count, vertical, eta }: { count: number; vertical?: boolean; eta: number }) {
  const t = S.useT()
  return (
    <motion.span
      className={`sg-glass${vertical ? ' is-v' : ''}`}
      data-testid="lane-glass"
      title={t('glassIn', { n: eta })}
      aria-label={t('glass')}
      initial={{ opacity: 0, scale: 0.4 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={SPRING.snappy}
    >
      <span className="sg-glass__halo" />
      <svg viewBox="0 0 16 20" className="sg-glass__icon" aria-hidden="true">
        <path d="M3 2h10l-1.2 7.4a3.9 3.9 0 0 1-7.6 0z" fill="rgba(255,196,110,.28)" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
        <path d="M4.2 5.6h7.6" stroke="currentColor" strokeWidth="1" opacity=".7" />
        <path d="M8 13v4.6M5.2 18h5.6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      </svg>
      {count > 1 ? <span className="sg-glass__n">{count}</span> : null}
      {vertical ? <span className="sg-glass__txt">{t('glassIn', { n: eta })}</span> : null}
    </motion.span>
  )
}

function openOrders(list: Order[]): Order[] {
  return list.filter(o => o.status === 'sending' || o.status === 'accepted' || o.status === 'preparing')
}

/** The swallow: scale 1 → 1.18 → 1 (snappy) plus a ring of light. */
function swallow(el: HTMLElement | null) {
  if (!el) return
  animate(el, { scale: [1, 1.18, 1] }, { duration: 0.36, times: [0, 0.38, 1], ease: 'easeOut' })
  const ring = document.createElement('span')
  ring.className = 'sg-burst'
  el.appendChild(ring)
  ring.addEventListener('animationend', () => ring.remove())
  setTimeout(() => ring.remove(), 900)
}

// ================================================================= horizontal (phone)

function HorizontalLane({ compact }: { compact: boolean }) {
  const t = S.useT()
  const m = usePhoneMetrics()
  const now = useNavi(s => s.room.now)
  const queue = useNavi(s => s.room.queue)
  const orders = useNavi(s => s.orders.list)
  const myTurnLive = useNavi(selMyTurnIn)
  // after the exit the lane is no longer the live room: no "your turn", no NEXT (E-12, QA POLICY#0)
  const unlinked = useNavi(selRoomUnlinked)
  const myTurn = unlinked ? null : myTurnLive
  const color = useColors(true)
  const name = useMemberName()
  const incoming = useIncoming('phone')

  const head: { item: QueueItem; playing: boolean } | null = now ? { item: now.item, playing: true } : queue[0] ? { item: queue[0], playing: false } : null
  const rest = now ? queue : queue.slice(1)
  const rowCount = (now ? 1 : 0) + queue.length
  const glasses = useMemo(() => glassSlots(rowCount, openOrders(orders)), [rowCount, orders])
  const empty = !head || unlinked

  // flight targets
  const mouth = useRef<HTMLDivElement>(null)
  const mouthIn = useRef<HTMLSpanElement>(null)
  const well = useRef<HTMLSpanElement>(null)
  const track = useRef<HTMLDivElement>(null)
  const insertEl = useRef<HTMLElement | null>(null)
  useEffect(() => {
    const next = empty ? well.current : mouth.current
    registerTarget('lane:next', next)
    registerTarget('lane:end', next)
    registerTarget('lane:insert', insertEl.current)
  })
  useEffect(
    () => () => {
      registerTarget('lane:next', null)
      registerTarget('lane:end', null)
      registerTarget('lane:insert', null)
    },
    [],
  )

  // swallow on landing: the slot gulps (the new chip pops in its own entrance). When the song
  // became the head of an empty lane, the head tile itself is what pops.
  const headId = head?.item.id
  useEffect(
    () =>
      bus.on('fx/landed', e => {
        if (e.to !== 'lane:next' && e.to !== 'lane:end' && e.to !== 'lane:insert') return
        if (empty) return swallow(well.current)
        if (headId && incoming[headId]) return
        swallow(e.to === 'lane:insert' ? insertEl.current ?? mouth.current : mouth.current)
      }),
    [empty, headId, incoming],
  )

  // The track normally rests at the start (NOW, #1, the drink glass…). When one of my songs
  // lands out of view, glide to it so the landing is seen, then drift back after a moment.
  const touched = useRef(0)
  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = []
    const reveal = (sel: string) => {
      const tr = track.current
      const el = tr?.querySelector<HTMLElement>(sel)
      if (!tr || !el) return
      const visible = el.offsetLeft >= tr.scrollLeft && el.offsetLeft + el.offsetWidth <= tr.scrollLeft + tr.clientWidth
      if (visible) return
      tr.scrollTo({ left: Math.max(0, el.offsetLeft - tr.clientWidth + el.offsetWidth + 16), behavior: 'smooth' })
      timers.push(
        setTimeout(() => {
          if (Date.now() - touched.current > 2500) track.current?.scrollTo({ left: 0, behavior: 'smooth' })
        }, 2600),
      )
    }
    const offs = [
      bus.on('queue/added', e => {
        if (e.source === 'member') return
        timers.push(setTimeout(() => reveal(`[data-item-id="${e.item.id}"]`), 620))
      }),
      bus.on('order/status', e => {
        if (e.order.status === 'accepted') timers.push(setTimeout(() => reveal('[data-testid="lane-glass"]'), 120))
      }),
    ]
    return () => {
      offs.forEach(f => f())
      timers.forEach(clearTimeout)
    }
  }, [])

  // drag anticipation: the mouth leans toward the card being thrown
  const onDrag = useCallback((p: number) => {
    const el = empty ? well.current : mouthIn.current
    if (!el) return
    const v = p.toFixed(3)
    if (el.dataset.p === v) return
    el.dataset.p = v
    el.style.transform = p > 0 ? `scale(${(1 + 0.16 * p).toFixed(3)})` : ''
    el.style.setProperty('--lean', v)
  }, [empty])

  const intro = introPending('lane')
  const chipH = compact ? 34 : m.small ? 36 : 40
  const stripH = m.small ? 11 : 14

  const glassAt = (at: number) => {
    const n = glasses.get(at)
    return n ? <Glass key={`g${at}`} count={n} eta={at} /> : null
  }

  const chips: ReactNode[] = []
  if (!empty) {
    const startAt = head ? 1 : 0
    const g0 = (glasses.get(0) ?? 0) + (glasses.get(startAt) ?? 0)
    if (g0) chips.push(<Glass key="g-start" count={g0} eta={startAt} />)
    rest.forEach((item, i) => {
      const pos = now ? i + 1 : i + 2
      const isInsertTarget = (now && i === 0) || false
      chips.push(
        <Chip
          key={item.id}
          item={item}
          pos={pos}
          color={color(item.by)}
          name={name(item.by)}
          incoming={!!incoming[item.id]}
          h={chipH}
          refFn={isInsertTarget ? el => (insertEl.current = el) : undefined}
        />,
      )
      const at = startAt + i + 1
      if (at < rowCount) {
        const g = glassAt(at)
        if (g) chips.push(g)
      }
    })
    if (rowCount > startAt) {
      const g = glassAt(rowCount)
      if (g) chips.push(g)
    }
  }

  return (
    <motion.div
      className={`sg-lane sg-lane--h${compact ? ' is-compact' : ''}${m.small ? ' is-small' : ''}`}
      data-testid="stage-lane"
      data-orientation="horizontal"
      data-anchor="lane"
      aria-label={t('laneAria')}
      initial={intro ? { y: -20, opacity: 0 } : false}
      animate={{ y: 0, opacity: 1 }}
      transition={{ ...SPRING.soft, delay: intro ? introDelay('lane') : 0 }}
    >
      <div className="sg-lane__row" style={{ height: chipH }}>
        {unlinked ? (
          <div className="sg-empty is-bye" data-testid="lane-unlinked">
            <span className="sg-empty__well" ref={well}>
              <span className="sg-lbl">BYE</span>
            </span>
            <span className="sg-empty__dash" aria-hidden="true" />
            <span className="sg-empty__txt">
              {t('unlinkedBye')} · {t('unlinked')}
            </span>
          </div>
        ) : empty ? (
          <>
            <div className="sg-empty" data-testid="lane-slot-empty">
              <span className="sg-empty__well" ref={well}>
                <span className="sg-lbl">NOW</span>
              </span>
              <span className="sg-empty__dash" aria-hidden="true" />
              <span className="sg-empty__txt">{t('nowEmpty')}</span>
            </div>
            {glasses.get(0) ? <Glass count={glasses.get(0)!} eta={soonestEta(orders)} /> : null}
          </>
        ) : (
          <>
            <AnimatePresence mode="popLayout" initial={false}>
              <HeadTile
                key={head!.item.id}
                item={head!.item}
                now={head!.playing ? now : null}
                color={color(head!.item.by)}
                name={name(head!.item.by)}
                incoming={!!incoming[head!.item.id]}
                h={chipH}
                compact={compact}
                finish={!compact}
                refFn={!now ? el => (insertEl.current = el) : undefined}
              />
            </AnimatePresence>
            <div className="sg-lane__track" ref={track} onPointerDown={() => (touched.current = Date.now())} onWheel={() => (touched.current = Date.now())}>
              <AnimatePresence mode="popLayout" initial={false}>
                {chips}
              </AnimatePresence>
            </div>
            <div className="sg-mouth" ref={mouth} data-testid="lane-slot-next" aria-label={t('dropHere')} style={{ width: chipH - 4, height: chipH - 4 }}>
              <span className="sg-mouth__in" ref={mouthIn}>
                <svg viewBox="0 0 16 16" aria-hidden="true">
                  <path d="M8 3.5v9M3.5 8h9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                </svg>
              </span>
            </div>
          </>
        )}
        {compact && myTurn != null ? (
          <span className={`sg-turnpill${myTurn === 0 ? ' is-now' : ''}`} data-testid="lane-my-turn">
            <MyTurnText n={myTurn} short />
          </span>
        ) : null}
      </div>
      {compact ? null : (
        <div className="sg-lane__strip" style={{ height: stripH }}>
          <FlowLine height={stripH} onDrag={onDrag} />
          {myTurn != null ? (
            <motion.span key={myTurn} className={`sg-turn${myTurn === 0 ? ' is-now' : myTurn === 1 ? ' is-soon' : ''}`} data-testid="lane-my-turn" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={SPRING.snappy}>
              <MyTurnText n={myTurn} />
            </motion.span>
          ) : null}
        </div>
      )}
    </motion.div>
  )
}

function HeadTile({ item, now, color, name, incoming, h, compact, finish, refFn }: { item: QueueItem; now: NowPlaying; color: string; name: string; incoming: boolean; h: number; compact: boolean; finish: boolean; refFn?: (el: HTMLElement | null) => void }) {
  const t = S.useT()
  const playing = !!now
  const mine = isMine(item)
  // my song is on: the chip keeps a gold pulse for as long as I sing (QA OWNER#3)
  const onstage = playing && mine
  const ring = compact ? h - 6 : h - 4
  return (
    <motion.div
      ref={refFn as never}
      layout="position"
      className={`sg-head${playing ? ' is-playing' : ' is-waiting'}${mine ? ' is-mine' : ''}${onstage ? ' is-onstage' : ''}${item.tags.includes('navi') ? ' is-navi' : ''}${item.tags.includes('finale') ? ' is-finale' : ''}`}
      {...itemData(item, playing ? 'lane-now' : 'lane-item')}
      data-onstage={onstage ? '1' : undefined}
      style={{ height: h, ['--c' as string]: color }}
      initial={incoming ? { opacity: 0, scale: 0.5 } : { opacity: 0, x: 28 }}
      animate={incoming ? { opacity: 0, scale: 0.5 } : { opacity: 1, x: 0, scale: [null, 1.12, 1] as unknown as number }}
      exit={{ opacity: 0, x: -28, transition: { duration: 0.22 } }}
      transition={incoming ? { duration: 0 } : { duration: 0.42, ease: 'easeOut' }}
    >
      {onstage ? <span className="sg-head__pulse" aria-hidden="true" /> : null}
      <ProgressRing now={now} size={ring} color={onstage ? '#FFD36B' : color} waiting={!playing}>
        <SongDisc songId={item.songId} size={ring - 9} playing={playing} />
      </ProgressRing>
      <span className="sg-head__txt">
        <span className="sg-head__top">
          <span className="sg-lbl sg-lbl--now">{playing ? 'NOW' : 'NEXT'}</span>
          <span className="sg-head__by">{playing ? name : t('upNext')}</span>
          <TagPills tags={item.tags} iconOnly max={onstage ? 1 : 2} />
        </span>
        <SongTitle songId={item.songId} variant="lane" />
      </span>
      {onstage && finish ? <FinishPill /> : null}
    </motion.div>
  )
}

/**
 * The demo-only "I finished" control (handshake 1): a small ghost pill inside my NOW chip, never
 * the biggest thing on screen. It asks the room sim to end my song (presenter/cmd finishMine).
 */
function FinishPill() {
  const t = S.useT()
  const ref = useRef<HTMLButtonElement>(null)
  const finish = (e: { stopPropagation(): void }) => {
    e.stopPropagation()
    const r = ref.current?.getBoundingClientRect()
    sound.play('fanfare')
    sound.haptic([10, 40, 10])
    if (r) bus.emit({ type: 'fx/burst', at: { x: r.left + r.width / 2, y: r.top + r.height / 2 }, preset: 'prism' })
    bus.emit({ type: 'presenter/cmd', cmd: { t: 'finishMine' } })
  }
  return (
    <motion.button
      ref={ref}
      type="button"
      className="sg-finish"
      data-testid="btn-finish"
      aria-label={t('finish')}
      title={t('finish')}
      onClick={finish}
      onPointerDown={e => e.stopPropagation()}
      initial={{ opacity: 0, x: 8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.3, delay: 0.5 }}
      whileTap={{ scale: 0.94 }}
    >
      <span className="sg-finish__main">{t('finishPill')}</span>
      <span className="sg-finish__demo">{t('finishPillDemo')}</span>
    </motion.button>
  )
}

function Chip({ item, pos, color, name, incoming, h, refFn }: { item: QueueItem; pos: number; color: string; name: string; incoming: boolean; h: number; refFn?: (el: HTMLElement | null) => void }) {
  const mine = item.by === 'me' || item.with === 'me'
  const cls = `sg-chip${mine ? ' is-mine' : ''}${item.tags.includes('navi') ? ' is-navi' : ''}${item.tags.includes('finale') ? ' is-finale' : ''}${item.tags.includes('insert') ? ' is-insert' : ''}`
  return (
    <motion.div
      ref={refFn as never}
      layout="position"
      className={cls}
      {...itemData(item, 'lane-item')}
      style={{ height: h, ['--c' as string]: color }}
      title={name}
      initial={incoming ? { opacity: 0, scale: 0.4 } : item.by === 'me' ? { opacity: 0, scale: 0.6 } : { opacity: 0, x: 36 }}
      animate={incoming ? { opacity: 0, scale: 0.4 } : { opacity: 1, x: 0, scale: [null, 1.18, 1] as unknown as number }}
      exit={{ opacity: 0, scale: 0.7, transition: { duration: 0.2 } }}
      transition={incoming ? { duration: 0 } : { duration: 0.42, ease: 'easeOut' }}
    >
      <span className="sg-chip__top">
        <span className="sg-chip__pos">#{pos}</span>
        <span className="sg-chip__by">{name}</span>
        <TagPills tags={item.tags} iconOnly max={2} />
        <MiniDots songId={item.songId} size={4} />
      </span>
      <SongTitle songId={item.songId} variant="lane" />
    </motion.div>
  )
}

// ================================================================= vertical (room screen)

function VerticalLane() {
  const t = S.useT()
  const now = useNavi(s => s.room.now)
  const queue = useNavi(s => s.room.queue)
  const sung = useNavi(s => s.room.sung)
  const orders = useNavi(s => s.orders.list)
  // E-12 exit: the room screen is unlinked from this phone — nothing personal, orders closed
  const unlinked = useNavi(selRoomUnlinked)
  const color = useColors(false)
  const name = useMemberName()
  const incoming = useIncoming('room')
  const end = useRef<HTMLDivElement>(null)
  const list = useRef<HTMLDivElement>(null)

  const head: { item: QueueItem; playing: boolean } | null = now ? { item: now.item, playing: true } : queue[0] ? { item: queue[0], playing: false } : null
  const rest = now ? queue : queue.slice(1)
  const rowCount = (now ? 1 : 0) + queue.length
  const glasses = useMemo(() => glassSlots(rowCount, openOrders(orders)), [rowCount, orders])
  const history = sung.slice(-2)

  useEffect(() => {
    registerTarget('room:lane', end.current)
    return () => registerTarget('room:lane', null)
  }, [])
  useEffect(
    () =>
      bus.on('fx/landed', e => {
        if (e.to === 'room:lane') swallow(end.current)
      }),
    [],
  )
  // a comet landing lights the matching row
  useEffect(
    () =>
      cometLanded.on(id => {
        const el = list.current?.parentElement?.querySelector<HTMLElement>(`[data-item-id="${id}"]`)
        if (el) setTimeout(() => swallow(el), 30)
      }),
    [],
  )

  const intro = introPending('lane')
  const rows: ReactNode[] = []
  const startAt = head ? 1 : 0
  // an empty lane shows its one glass inside the empty card (QA ROBUST#15), never a second row
  const g0 = head ? (glasses.get(0) ?? 0) + (glasses.get(1) ?? 0) : 0
  if (g0) rows.push(<Glass key="g-start" count={g0} eta={1} vertical />)
  if (!unlinked) rest.forEach((item, i) => {
    const pos = now ? i + 1 : i + 2
    const eta = startAt + i
    rows.push(<VRow key={item.id} item={item} pos={pos} eta={eta} color={color(item.by)} name={name(item.by)} incoming={!!incoming[item.id]} />)
    const at = startAt + i + 1
    const g = glasses.get(at)
    if (g && at < rowCount) rows.push(<Glass key={`g${at}`} count={g} eta={at} vertical />)
  })
  if (!unlinked && rowCount > startAt && glasses.get(rowCount)) rows.push(<Glass key="g-end" count={glasses.get(rowCount)!} eta={rowCount} vertical />)

  return (
    <motion.div
      className="sg-vlane"
      data-testid="stage-lane"
      data-orientation="vertical"
      data-anchor="lane"
      aria-label={t('laneAria')}
      initial={intro ? { y: -20, opacity: 0 } : false}
      animate={{ y: 0, opacity: 1 }}
      transition={{ ...SPRING.soft, delay: intro ? introDelay('lane') : 0 }}
    >
      <div className="sg-vlane__head">
        <span className="sg-lbl">STAGE</span>
        {unlinked ? null : <span className="sg-vlane__count">{t('queueCount', { n: queue.length })}</span>}
      </div>
      {unlinked ? (
        <motion.div className="sg-vbye" data-testid="lane-unlinked" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={SPRING.soft}>
          <span className="sg-vbye__moon" aria-hidden="true" />
          <span className="sg-vbye__txt">{t('laneClosed')}</span>
          <span className="sg-vbye__sub">{t('ordersClosed')}</span>
        </motion.div>
      ) : null}
      {!unlinked && history.length ? (
        <div className="sg-vlane__hist">
          {history.map(e => (
            <HistRow key={e.item.id + e.endedAt} e={e} color={color(e.item.by)} name={name(e.item.by)} />
          ))}
        </div>
      ) : null}
      {unlinked ? null : <div className="sg-vlane__rail" aria-hidden="true" />}
      {unlinked ? null : head ? (
        <AnimatePresence mode="popLayout" initial={false}>
          <VNow key={head.item.id} item={head.item} now={head.playing ? now : null} color={color(head.item.by)} name={name(head.item.by)} incoming={!!incoming[head.item.id]} />
        </AnimatePresence>
      ) : (
        <div className="sg-vempty" data-testid="lane-slot-empty">
          <span className="sg-vempty__txt">{t('roomLaneEmpty')}</span>
          {glasses.get(0) ? <Glass count={glasses.get(0)!} eta={soonestEta(orders)} vertical /> : null}
        </div>
      )}
      <div className="sg-vlane__list" ref={list}>
        <AnimatePresence mode="popLayout" initial={false}>
          {rows}
        </AnimatePresence>
        {unlinked ? null : (
          <div className="sg-vlane__end" ref={end} aria-hidden="true">
            <span className="sg-vlane__plus">+</span>
          </div>
        )}
      </div>
    </motion.div>
  )
}

function VNow({ item, now, color, name, incoming }: { item: QueueItem; now: NowPlaying; color: string; name: string; incoming: boolean }) {
  const t = S.useT()
  const playing = !!now
  const song = SONG_BY_ID[item.songId]
  return (
    <motion.div
      className={`sg-vnow${playing ? ' is-playing' : ' is-waiting'}${item.tags.includes('navi') ? ' is-navi' : ''}${item.tags.includes('finale') ? ' is-finale' : ''}`}
      {...itemData(item, playing ? 'lane-now' : 'lane-item')}
      style={{ ['--c' as string]: color }}
      initial={incoming ? { opacity: 0, scale: 0.8 } : { opacity: 0, y: 24 }}
      animate={incoming ? { opacity: 0, scale: 0.8 } : { opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -24, transition: { duration: 0.25 } }}
      transition={SPRING.soft}
    >
      <ProgressRing now={now} size={60} stroke={3.5} color={color} waiting={!playing}>
        <SongDisc songId={item.songId} size={46} playing={playing} />
      </ProgressRing>
      <div className="sg-vnow__txt">
        <div className="sg-vnow__top">
          <span className="sg-lbl sg-lbl--now">{playing ? 'NOW' : 'NEXT'}</span>
          {!playing ? <span className="sg-vnow__soon">{t('upNext')}</span> : null}
          <MiniDots songId={item.songId} size={6} />
        </div>
        <SongTitle songId={item.songId} variant="lane" className="sg-vnow__title" />
        <div className="sg-vnow__meta">
          <span className="sg-vnow__artist">{song?.artist}</span>
        </div>
        <div className="sg-vnow__by">
          <i className="sg-dot" />
          {name}
          <TagPills tags={item.tags} />
        </div>
      </div>
    </motion.div>
  )
}

function VRow({ item, pos, eta, color, name, incoming }: { item: QueueItem; pos: number; eta: number; color: string; name: string; incoming: boolean }) {
  const t = S.useT()
  const song = SONG_BY_ID[item.songId]
  return (
    <motion.div
      layout="position"
      className={`sg-vrow${item.tags.includes('navi') ? ' is-navi' : ''}${item.tags.includes('finale') ? ' is-finale' : ''}${item.tags.includes('insert') ? ' is-insert' : ''}`}
      {...itemData(item, 'lane-item')}
      style={{ ['--c' as string]: color }}
      initial={incoming ? { opacity: 0, x: -30 } : { opacity: 0, x: 30 }}
      animate={incoming ? { opacity: 0, x: -30 } : { opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20, transition: { duration: 0.2 } }}
      transition={SPRING.soft}
    >
      <span className="sg-vrow__pos">{pos}</span>
      <span className="sg-vrow__main">
        <SongTitle songId={item.songId} variant="lane" className="sg-vrow__title" />
        <span className="sg-vrow__meta">
          <i className="sg-dot" />
          <span className="sg-vrow__by">{name}</span>
          <span className="sg-vrow__artist">{song?.artist}</span>
        </span>
        <TagPills tags={item.tags} max={2} />
      </span>
      <span className="sg-vrow__side">
        <span className="sg-vrow__eta">{t('etaSongs', { n: eta })}</span>
        <MiniDots songId={item.songId} size={5} />
      </span>
    </motion.div>
  )
}

function HistRow({ e, color, name }: { e: SungEntry; color: string; name: string }) {
  const size = 7 + Math.min(9, Math.round(e.claps / 8))
  return (
    <div className="sg-hist" style={{ ['--c' as string]: color }}>
      <SongTitle songId={e.item.songId} variant="lane" className="sg-hist__title" />
      <span className="sg-hist__by">{name}</span>
      <span className="sg-crystal" style={{ width: size, height: size }} aria-hidden="true" />
    </div>
  )
}
