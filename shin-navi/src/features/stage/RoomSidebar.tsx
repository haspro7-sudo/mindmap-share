// Room screen, right column (SPEC F-4): who is here, the air, tonight's light-sign (a slot the
// shell fills with the public constellation), order status as counts only, and how to join:
// "join on your phone (QR, no install, no login)" cycling through the five languages next
// to a stylised (placeholder) QR.
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { OrderStatus } from '../../core/types'
import { useNavi } from '../../core/store'
import { useBox } from '../../core/layout'
import { LOCALES, trIn } from '../../i18n'
import { common } from '../../i18n/common'
import { S } from './strings'
import { qrMatrix } from './model'
import { MemberOrbs } from './MemberOrbs'
import { MoodWord } from './MoodWord'
import './stage.css'

export function RoomSidebar(p: { constellation: ReactNode }): JSX.Element {
  const t = S.useT()
  const box = useBox()
  const tight = box.h < 780 || box.w < 1180
  return (
    <div className={`sg-side${tight ? ' is-tight' : ''}`} data-testid="room-sidebar">
      <section className="sg-side__sec">
        <h3 className="sg-side__h">{t('members')}</h3>
        <MemberOrbs layout="column" />
      </section>
      <section className="sg-side__sec">
        <h3 className="sg-side__h">{t('air')}</h3>
        <MoodWord size="room" />
      </section>
      <section className="sg-side__sec sg-side__sky">
        <h3 className="sg-side__h">{t('constellation')}</h3>
        <div className="sg-side__constellation">{p.constellation}</div>
      </section>
      <section className="sg-side__sec">
        <h3 className="sg-side__h">{t('orders')}</h3>
        <OrderCounts />
      </section>
      <section className="sg-side__join">
        <Qr size={tight ? 84 : 112} />
        <JoinCycle />
      </section>
    </div>
  )
}

const SHOWN: OrderStatus[] = ['sending', 'accepted', 'preparing', 'delivered']

function OrderCounts() {
  const t = S.useT()
  const list = useNavi(s => s.orders.list)
  const closed = useNavi(s => s.orders.closed)
  const counts = useMemo(() => {
    const m = new Map<OrderStatus, number>()
    for (const o of list) if (SHOWN.includes(o.status)) m.set(o.status, (m.get(o.status) ?? 0) + 1)
    return SHOWN.filter(s => m.get(s)).map(s => [s, m.get(s)!] as const)
  }, [list])
  if (!counts.length || closed) return <div className="sg-orders is-none">{t('ordersNone')}</div>
  return (
    <div className="sg-orders" data-testid="room-orders">
      {counts.map(([status, n]) => (
        <motion.span key={status} className={`sg-orders__pill is-${status}`} initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }}>
          <i className="sg-orders__dot" />
          {t(`order.${status}` as 'order.sending')}
          <b>{t('ordersCount', { n })}</b>
        </motion.span>
      ))}
    </div>
  )
}

function JoinCycle() {
  const [i, setI] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setI(x => (x + 1) % LOCALES.length), 2800)
    return () => clearInterval(id)
  }, [])
  const l = LOCALES[i]
  return (
    <div className="sg-join">
      <span className="sg-join__room">{trIn(common.ref('roomNo', { n: 12 }), l.id)}</span>
      <div className="sg-join__cycle" aria-live="off">
        <AnimatePresence mode="wait" initial={false}>
          <motion.span key={l.id} lang={l.htmlLang} className="sg-join__txt" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.35 }}>
            {trIn(S.ref('joinQr'), l.id)}
          </motion.span>
        </AnimatePresence>
      </div>
      <div className="sg-join__langs" aria-hidden="true">
        {LOCALES.map((x, k) => (
          <i key={x.id} className={k === i ? 'is-on' : ''}>
            {x.short}
          </i>
        ))}
      </div>
      <span className="sg-join__note">{trIn(S.ref('qrNote'), l.id)}</span>
    </div>
  )
}

function Qr({ size }: { size: number }) {
  const m = useMemo(() => qrMatrix('room-12'), [])
  const n = m.length
  const cell = 100 / n
  return (
    <div className="sg-qr" style={{ width: size, height: size }} aria-hidden="true">
      <svg viewBox="0 0 100 100" width={size} height={size}>
        <defs>
          <linearGradient id="sg-qr-g" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#FFFFFF" />
            <stop offset="0.6" stopColor="#E9E3FF" />
            <stop offset="1" stopColor="#C9F7FF" />
          </linearGradient>
        </defs>
        <rect width="100" height="100" rx="8" fill="#0E0826" />
        {m.flatMap((row, y) =>
          row.map((on, x) => (on ? <rect key={`${x}-${y}`} x={x * cell + 0.35} y={y * cell + 0.35} width={cell - 0.7} height={cell - 0.7} rx={cell * 0.28} fill="url(#sg-qr-g)" /> : null)),
        )}
        <circle cx="50" cy="50" r="7.5" fill="#0E0826" />
        <circle cx="50" cy="50" r="5.6" className="sg-qr__ball" />
      </svg>
      <span className="sg-qr__scan" />
    </div>
  )
}
