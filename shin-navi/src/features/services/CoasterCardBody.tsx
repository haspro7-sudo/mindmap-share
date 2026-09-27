// Toast coaster body (SPEC C-8 #9, coaster frame): "time for a toast?" with three drinks read from
// the room, "water / take a breather" on the same footing (it orders nothing and slows the room for one
// song), and "see the menu". One tap orders: the glass fills and turns into a ticket stamped
// with the venue's time. A second tap on the same drink never orders twice — the card shakes,
// says it was already received, and only an explicit "one more" adds another. No rewards.
// Card-front contract: the question, the cause and the controls. The "arrives in about 2 songs
// (demo)" fine print is a small DEMO badge until something is ordered; then the line under the
// drinks answers with the venue's receipt time and the order's own ETA.
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import type { CardBodyComponent, CardBodyProps } from '../../core/types'
import { naviApi, useNavi } from '../../core/store'
import { bus } from '../../core/events'
import { useBox } from '../../core/layout'
import { sound } from '../../core/sound'
import { Icon } from '../../core/ui/Icon'
import { SPRING } from '../../core/ui/motion'
import { useLocale, useTr } from '../../i18n'
import { Glyph } from './glyphs'
import { MENU_BY_ID, canOrder, coasterDrinks, hhmm, openOrderFor } from './menu'
import { S } from './strings'
import './services.css'

const SHAKE = [0, -9, 8, -6, 4, -2, 0]

function CoasterBody({ card, active, act, setPrimary }: CardBodyProps) {
  const t = S.useT()
  const tr = useTr()
  const l = useLocale()
  const box = useBox()
  const small = box.h < 760 || box.w < 375
  const reduced = useNavi(s => s.ui.reduced)
  const list = useNavi(s => s.orders.list)
  const open = useNavi(canOrder)
  const [drinks] = useState(() => coasterDrinks(naviApi.getState().room.heat))
  const [sel, setSel] = useState(drinks[0])
  const [dup, setDup] = useState<{ menuId: string; key: number } | null>(null)
  const [pops, setPops] = useState<Record<string, number>>({})
  const root = useRef<HTMLDivElement>(null)
  const dupSeen = useRef(naviApi.getState().metrics.mo.dupBlocked)
  const seq = useRef(0)

  const selOrder = openOrderFor(list, sel)
  const selName = tr(MENU_BY_ID[sel].name)

  // the primary (and the upward flick) orders the highlighted drink; once received it says when
  useEffect(() => {
    if (!open) {
      setPrimary({ action: 'order', label: { key: 'core.orderClosed' }, enabled: false })
      return
    }
    const label = selOrder?.acceptedAt ? S.ref('status.accepted', { time: hhmm(selOrder.acceptedAt) }) : S.ref('coaster.order', { item: selName })
    setPrimary({ action: 'order', label, enabled: true, arg: { menuId: sel } })
  }, [card.id, sel, selOrder?.acceptedAt, open, l])

  // every order from this card (tap, primary, flick) comes back here: celebrate or shake
  useEffect(
    () =>
      bus.on('card/acted', e => {
        if (e.card.id !== card.id || e.action !== 'order') return
        const menuId = e.arg?.menuId
        if (!menuId) return
        const blocked = naviApi.getState().metrics.mo.dupBlocked
        if (blocked > dupSeen.current) {
          dupSeen.current = blocked
          seq.current += 1
          setDup({ menuId, key: seq.current })
          const el = root.current
          if (el && typeof el.animate === 'function') {
            const frames: Keyframe[] = naviApi.getState().ui.reduced ? [{ opacity: 1 }, { opacity: 0.6 }, { opacity: 1 }] : SHAKE.map(x => ({ transform: `translateX(${x}px)` }))
            el.animate(frames, { duration: 460, easing: 'ease-out' })
          }
          sound.haptic(12)
        } else if (naviApi.getState().orders.list.some(o => o.menuId === menuId && o.status === 'sending')) {
          // a toast leaves a glass mark on tonight's wall of light (not a reward: no pin, face or stamp)
          naviApi.getState().addMarker('toast')
          setDup(null)
          setPops(p => ({ ...p, [menuId]: (p[menuId] ?? 0) + 1 }))
          sound.haptic(12)
          const g = root.current?.querySelector(`[data-menu="${menuId}"] .co-drink__glass`)?.getBoundingClientRect()
          if (g && !naviApi.getState().ui.reduced) bus.emit({ type: 'fx/burst', at: { x: g.left + g.width / 2, y: g.top + g.height * 0.3 }, preset: 'spark12' })
        }
      }),
    [card.id],
  )
  useEffect(() => {
    if (!dup) return
    const id = setTimeout(() => setDup(d => (d && d.key === dup.key ? null : d)), 6000)
    return () => clearTimeout(id)
  }, [dup?.key])

  const orderDrink = (menuId: string, again?: boolean) => {
    if (!canOrder(naviApi.getState())) return
    setSel(menuId)
    act('order', { menuId, again })
  }
  const dupOrder = dup ? openOrderFor(list, dup.menuId) : undefined
  const anyOrder = drinks.map(id => openOrderFor(list, id)).find(Boolean)
  const glyph = small ? 40 : 46
  return (
    <div className={`co${small ? ' is-small' : ''}${!open ? ' is-closed' : ''}`} ref={root} data-active={active ? '1' : '0'}>
      <div className="co__title" data-testid="card-reason">
        <b>{tr(card.reason.text)}</b>
        {card.reason.cause ? <span className="co__cause">{tr(card.reason.cause)}</span> : null}
      </div>

      <div className="co__drinks">
        {drinks.map((id, i) => {
          const item = MENU_BY_ID[id]
          const o = openOrderFor(list, id)
          const on = id === sel
          return (
            <motion.button
              key={id}
              type="button"
              className={`co-drink${on ? ' is-sel' : ''}${o ? ` has-order is-${o.status}` : ''}`}
              style={{ ['--h' as string]: String(item.hue) } as CSSProperties}
              data-testid="coaster-drink"
              data-menu={id}
              disabled={!open}
              whileTap={open ? { scale: 0.9 } : undefined}
              transition={SPRING.snappy}
              onClick={() => orderDrink(id)}
              aria-label={i === 0 ? `${t('coaster.order', { item: tr(item.name) })} · ${t('coaster.pick')}` : t('coaster.order', { item: tr(item.name) })}
            >
              <span className="co-drink__coaster" aria-hidden="true" />
              {i === 0 && !o ? (
                <span className="co-drink__pick" title={t('coaster.pick')} aria-hidden="true">
                  <svg width="12" height="12" viewBox="0 0 12 12">
                    <path d="M6 .9l1.5 3.2 3.5.4-2.6 2.4.7 3.5L6 8.7 2.9 10.4l.7-3.5L1 4.5l3.5-.4z" fill="currentColor" />
                  </svg>
                </span>
              ) : null}
              <span className="co-drink__glass">
                <Glyph item={item} size={glyph} level={o ? 1 : 0.5} live={active && (!!o || on)} slosh={pops[id] ?? 0} />
              </span>
              {pops[id] ? <span key={pops[id]} className="co-drink__ring" aria-hidden="true" /> : null}
              <span className="co-drink__name">{tr(item.name)}</span>
              <AnimatePresence initial={false}>
                {o ? (
                  <motion.span
                    key={o.status === 'sending' ? 's' : 'a'}
                    className={`co-drink__ticket is-${o.status}`}
                    initial={reduced ? { opacity: 0 } : { opacity: 0, y: 8, rotate: -8, scale: 0.8 }}
                    animate={{ opacity: 1, y: 0, rotate: -4, scale: 1 }}
                    exit={{ opacity: 0 }}
                    transition={SPRING.snappy}
                  >
                    {o.status === 'sending' ? <i className="ord-dots" aria-hidden="true" /> : o.acceptedAt ? hhmm(o.acceptedAt) : null}
                  </motion.span>
                ) : null}
              </AnimatePresence>
            </motion.button>
          )
        })}
      </div>

      <AnimatePresence mode="wait" initial={false}>
        {dup && open ? (
          <motion.div key={`d${dup.key}`} className="co__dup" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.16 }}>
            <span className="co__dupnote" data-testid="coaster-dup-note">
              {dupOrder?.acceptedAt ? t('dup', { time: hhmm(dupOrder.acceptedAt) }) : t('dupSending')}
            </span>
            <button type="button" className="co__again" data-testid="coaster-again" onClick={() => orderDrink(dup.menuId, true)}>
              <Icon name="plus" size={13} strokeWidth={2.6} />
              {t('again')}
            </button>
          </motion.div>
        ) : !open ? (
          <motion.div key="closed" className="co__closed" data-testid="coaster-closed" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <Icon name="lock" size={14} strokeWidth={2} />
            {tr({ key: 'core.orderClosed' })}
          </motion.div>
        ) : (
          <motion.div key="row" className="co__row" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.14 }}>
            <button type="button" className="co__rest" data-testid="coaster-rest" onClick={() => act('rest')}>
              <Glyph item={MENU_BY_ID.rest} size={18} />
              {t('coaster.rest')}
            </button>
            <button type="button" className="co__menu" data-testid="coaster-menu" onClick={() => naviApi.getState().setTab('order')}>
              {t('coaster.menu')}
              <Icon name="chevron" size={13} strokeWidth={2.4} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="co__eta">
        {anyOrder?.acceptedAt ? (
          <>
            <span className="co__etaok">
              <i className="co__etadot" aria-hidden="true" />
              {t('status.acceptedVenue', { time: hhmm(anyOrder.acceptedAt) })}
            </span>
            <span className="co__etan">{anyOrder.etaAfterSongs > 0 ? t('order.eta', { n: anyOrder.etaAfterSongs }) : t('order.etaSoon')}</span>
          </>
        ) : (
          <span className="co__demo" data-testid="coaster-demo" title={t('order.etaCard', { n: 2 })}>
            {t('demo')}
          </span>
        )}
      </div>
    </div>
  )
}

export const CoasterCardBody: CardBodyComponent = p => <CoasterBody {...p} />
