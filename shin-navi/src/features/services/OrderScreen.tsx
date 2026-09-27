// S7 order (SPEC F-1, C-8 #9, E-12, 5-4 MO). A neon bar menu of tactile tiles with generated
// glasses and plates, no prices. Tap = order; the glass fills, bubbles rise, and a ticket stub
// says when the venue received it. A re-tap never orders twice: the tile shakes and says so,
// and "one more" is an explicit extra. The breather sits among the drinks and orders nothing.
// After leaving the room every tile is disabled and ordering is closed. No rewards, ever.
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import type { Order } from '../../core/types'
import { naviApi, useNavi } from '../../core/store'
import { sound } from '../../core/sound'
import { Icon } from '../../core/ui/Icon'
import { SPRING } from '../../core/ui/motion'
import { useTr } from '../../i18n'
import { Glyph } from './glyphs'
import { MENU_BY_ID, MENU_SECTIONS, TRACK, canOrder, hhmm, openCountFor, openOrderFor, trackIndex, type MenuItem } from './menu'
import { S } from './strings'
import './services.css'

type Dup = { menuId: string; orderId: string; key: number }

const SHAKE = [0, -10, 9, -7, 5, -2, 0]

/** One order on the four-station rail: sent, received HH:MM, preparing, delivered. */
function OrderRow({ order }: { order: Order }) {
  const t = S.useT()
  const tr = useTr()
  const item = MENU_BY_ID[order.menuId]
  if (!item) return null
  const idx = trackIndex(order)
  const closed = order.status === 'closed'
  const status =
    order.status === 'sending'
      ? t('status.sending')
      : order.status === 'accepted'
        ? t('status.accepted', { time: hhmm(order.acceptedAt) })
        : order.status === 'preparing'
          ? t('status.preparing')
          : order.status === 'delivered'
            ? t('status.delivered')
            : t('status.closed')
  const eta = order.status === 'accepted' || order.status === 'preparing' ? (order.etaAfterSongs > 0 ? t('order.eta', { n: order.etaAfterSongs }) : t('order.etaSoon')) : null
  return (
    <motion.li
      className={`ord-row is-${order.status}`}
      data-testid="order-status"
      data-status={order.status}
      data-menu={order.menuId}
      style={{ ['--h' as string]: String(item.hue) } as CSSProperties}
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={SPRING.soft}
    >
      <span className="ord-row__glyph">
        <Glyph item={item} size={34} level={idx >= 1 ? 0.95 : 0.6} live={!closed && order.status !== 'delivered'} />
      </span>
      <div className="ord-row__main">
        <div className="ord-row__top">
          <b className="ord-row__name">{tr(item.name)}</b>
          {eta ? <span className="ord-row__eta">{eta}</span> : <span className="ord-row__eta" />}
          <span className={`ord-row__status is-${order.status}`}>
            {order.status === 'sending' ? <i className="ord-dots" aria-hidden="true" /> : null}
            {status}
          </span>
        </div>
        <div className="ord-rail" style={{ ['--p' as string]: String(idx / (TRACK.length - 1)) } as CSSProperties}>
          <span className="ord-rail__line" />
          <span className="ord-rail__fill" />
          {TRACK.map((st, i) => (
            <span key={st} className={`ord-rail__stop${i <= idx ? ' is-on' : ''}${i === idx ? ' is-now' : ''}`} style={{ left: `${(i / (TRACK.length - 1)) * 100}%` }}>
              <i />
              <em>{t(`step.${st}` as 'step.sending')}</em>
            </span>
          ))}
          <span className="ord-rail__tok" aria-hidden="true">
            <span />
          </span>
        </div>
      </div>
    </motion.li>
  )
}

function Tile({ item, open, count, order, resting, onTap, dupKey, burst, colIndex, dup, onAgain, onKeep }: {
  item: MenuItem
  open: boolean
  count: number
  order: Order | undefined
  resting: boolean
  onTap: (item: MenuItem, el: HTMLElement | null) => void
  dupKey: number
  burst: number
  colIndex: number
  dup: Dup | null
  onAgain: () => void
  onKeep: () => void
}) {
  const t = S.useT()
  const tr = useTr()
  const ref = useRef<HTMLButtonElement>(null)
  const reduced = useNavi(s => s.ui.reduced)
  const dupOrder = useNavi(s => (dup ? s.orders.list.find(o => o.id === dup.orderId) : undefined))
  const isRest = item.kind === 'rest'
  const live = isRest ? resting : !!order

  // a duplicate re-tap: the tile shakes (a soft blink under reduced motion), nothing is added
  useEffect(() => {
    const el = ref.current
    if (!dupKey || !el || typeof el.animate !== 'function') return
    const frames: Keyframe[] = reduced ? [{ opacity: 1 }, { opacity: 0.55 }, { opacity: 1 }] : SHAKE.map(x => ({ transform: `translateX(${x}px)` }))
    const a = el.animate(frames, { duration: reduced ? 320 : 460, easing: 'ease-out' })
    return () => a.cancel()
  }, [dupKey])
  const level = order ? (order.status === 'sending' ? 0.8 : 1) : 0.46
  const name = tr(item.name)
  const tag = item.kind === 'water' ? t('tag.free') : isRest ? t('tag.noOrder') : null
  return (
    <div className={`ord-cell col-${colIndex}`}>
      <motion.button
        ref={ref}
        type="button"
        className={`ord-tile ord-tile--${item.kind}${live ? ' is-live' : ''}${order ? ` has-order is-${order.status}` : ''}${!open ? ' is-closed' : ''}`}
        data-testid="order-item"
        data-menu={item.id}
        data-count={count}
        disabled={!open}
        aria-disabled={!open}
        aria-label={isRest ? name : t('order.aria', { item: name })}
        style={{ ['--h' as string]: String(item.hue) } as CSSProperties}
        whileTap={open ? { scale: 0.93 } : undefined}
        transition={SPRING.snappy}
        onClick={() => onTap(item, ref.current)}
      >
        <span className="ord-tile__halo" aria-hidden="true" />
        <span className="ord-tile__glyph">
          <Glyph item={item} size={66} level={level} live={live} slosh={burst} />
        </span>
        <span className="ord-tile__name">{name}</span>
        {tag ? <span className="ord-tile__tag">{tag}</span> : null}
        {count > 1 ? <span className="ord-tile__count">{t('order.count', { n: count })}</span> : null}
        <AnimatePresence initial={false}>
          {order ? (
            <motion.span
              key={order.status === 'sending' ? 's' : 'a'}
              className={`ord-tile__stub is-${order.status}`}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={SPRING.snappy}
            >
              {order.status === 'sending' ? (
                <>
                  <i className="ord-dots" aria-hidden="true" />
                  {t('status.sending')}
                </>
              ) : (
                t('status.accepted', { time: hhmm(order.acceptedAt) })
              )}
            </motion.span>
          ) : isRest && resting ? (
            <motion.span key="rest" className="ord-tile__stub is-rest" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              {t('order.restOn')}
            </motion.span>
          ) : null}
        </AnimatePresence>
        {burst ? <span key={`r${burst}`} className="ord-tile__ring" aria-hidden="true" /> : null}
      </motion.button>
      <AnimatePresence>
        {dup && dup.menuId === item.id ? (
          <motion.div
            key={dup.key}
            className={`ord-dup col-${colIndex}`}
            role="status"
            initial={{ opacity: 0, y: -6, scale: 0.94 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.97, transition: { duration: 0.16 } }}
            transition={SPRING.snappy}
          >
            <span className="ord-dup__tail" aria-hidden="true" />
            <p className="ord-dup__note" data-testid="order-dup-note">
              <Icon name="glass" size={15} strokeWidth={2} />
              {dupOrder?.acceptedAt ? t('dup', { time: hhmm(dupOrder.acceptedAt) }) : t('dupSending')}
            </p>
            <div className="ord-dup__acts">
              <button type="button" className="ord-dup__keep" onClick={onKeep}>
                {t('keepAsIs')}
              </button>
              <motion.button type="button" className="ord-dup__again" data-testid="order-again" whileTap={{ scale: 0.94 }} onClick={onAgain}>
                <Icon name="plus" size={15} strokeWidth={2.4} />
                {t('again')}
              </motion.button>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  )
}

export function OrderScreen(): JSX.Element {
  const t = S.useT()
  const tr = useTr()
  const list = useNavi(s => s.orders.list)
  const open = useNavi(canOrder)
  const resting = useNavi(s => s.room.restUntil > s.session.simMs)
  const [dup, setDup] = useState<Dup | null>(null)
  const [shake, setShake] = useState<Record<string, number>>({})
  const [bursts, setBursts] = useState<Record<string, number>>({})
  const seq = useRef(0)

  // a duplicate note fades on its own after a while (it is information, not a prompt)
  useEffect(() => {
    if (!dup) return
    const id = setTimeout(() => setDup(d => (d && d.key === dup.key ? null : d)), 6000)
    return () => clearTimeout(id)
  }, [dup?.key])
  useEffect(() => {
    if (!open) setDup(null)
  }, [open])

  const pop = (menuId: string) => setBursts(b => ({ ...b, [menuId]: (b[menuId] ?? 0) + 1 }))

  const onTap = (item: MenuItem) => {
    const s = naviApi.getState()
    if (!canOrder(s)) return
    if (item.kind === 'rest') {
      // the breather: no order is created; the room just flows at half speed for one song
      s.restOneSong()
      sound.play('tap')
      pop(item.id)
      setDup(null)
      return
    }
    const r = s.placeOrder(item.id)
    if (r.dup && r.order) {
      seq.current += 1
      setShake(m => ({ ...m, [item.id]: seq.current }))
      setDup({ menuId: item.id, orderId: r.order.id, key: seq.current })
      sound.haptic(12)
    } else if (r.ok) {
      setDup(null)
      pop(item.id)
      sound.haptic(12)
    }
  }

  const onAgain = () => {
    const d = dup
    if (!d) return
    const r = naviApi.getState().placeOrder(d.menuId, { again: true })
    setDup(null)
    if (r.ok) pop(d.menuId)
  }

  // open orders first (newest on top), then the finished ones; a long night folds the tail
  const newest = [...list].reverse()
  const ordered = [...newest.filter(o => o.status === 'sending' || o.status === 'accepted' || o.status === 'preparing'), ...newest.filter(o => o.status === 'delivered' || o.status === 'closed')]
  const orders = ordered.slice(0, 4)
  const hidden = ordered.length - orders.length
  let col = 0
  return (
    <div className="ord" data-anchor="order" data-private="1" data-testid="order-screen">
      <header className="ord-head">
        <div className="ord-head__sign" aria-hidden="true">
          <span className="ord-sign__tube">
            <Icon name="glass" size={30} strokeWidth={1.6} />
          </span>
          <span className="ord-sign__glow" />
        </div>
        <div className="ord-head__text">
          <div className="svc-eyebrow">ORDER · TABLE SERVICE</div>
          <h1 className="ord-head__title">{t('order.title')}</h1>
          <p className="ord-head__lead">{t('order.lead')}</p>
        </div>
      </header>

      <AnimatePresence initial={false}>
        {!open ? (
          <motion.div className="ord-closed" data-testid="order-closed" initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={SPRING.soft}>
            <Icon name="lock" size={20} strokeWidth={2} />
            <div>
              <b>{tr({ key: 'core.orderClosed' })}</b>
              <span>{t('order.closedSub')}</span>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      {orders.length ? (
        <section className="ord-track" aria-label={t('order.tracker')}>
          <h2 className="svc-h">
            <span className="svc-h__en">STATUS</span>
            {t('order.tracker')}
          </h2>
          <ul className="ord-track__list">
            {orders.map(o => (
              <OrderRow key={o.id} order={o} />
            ))}
          </ul>
          {hidden > 0 ? <p className="ord-track__more">{t('order.more', { n: hidden })}</p> : null}
        </section>
      ) : null}

      {MENU_SECTIONS.map(sec => (
        <section key={sec.kind} className={`ord-sec ord-sec--${sec.kind}`}>
          <h2 className="svc-h">
            <span className="svc-h__en">{sec.kind === 'drink' ? 'DRINK' : 'FOOD'}</span>
            {t(sec.kind === 'drink' ? 'kind.drink' : 'kind.food')}
          </h2>
          <div className="ord-grid">
            {sec.ids.map(id => {
              const item = MENU_BY_ID[id]
              const c = col++ % 3
              return (
                <Tile
                  key={id}
                  item={item}
                  open={open}
                  count={openCountFor(list, id)}
                  order={openOrderFor(list, id)}
                  resting={resting}
                  onTap={onTap}
                  dupKey={shake[id] ?? 0}
                  burst={bursts[id] ?? 0}
                  colIndex={c}
                  dup={dup}
                  onAgain={onAgain}
                  onKeep={() => setDup(null)}
                />
              )
            })}
            {sec.kind === 'food' ? (
              <div className="ord-cell col-2">
                <div className="ord-eta-card">
                  <span className="ord-eta-card__lane" aria-hidden="true">
                    <i />
                    <i />
                    <i className="is-glass" />
                  </span>
                  <span>{t('order.etaCard', { n: 2 })}</span>
                </div>
              </div>
            ) : null}
          </div>
        </section>
      ))}

      <footer className="ord-foot">
        <p className="ord-foot__price">{t('order.price')}</p>
      </footer>
    </div>
  )
}
