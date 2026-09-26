// Orders, UI and metrics slices.
import type { StateCreator } from 'zustand'
import type { MetricsSlice, NaviState, OrdersSlice, UiSlice } from './types'
import type { Order, OrderStatus } from '../types'
import { freshMetrics, freshOrders, freshUi, uid } from './initial'
import { bus } from '../events'
import { orderIdem } from '../rules'
import { coreStrings } from '../../i18n/core'

const OPEN: OrderStatus[] = ['sending', 'accepted', 'preparing']
let nonce = 0

export const createOrdersSlice: StateCreator<NaviState, [], [], OrdersSlice> = (set, get) => ({
  orders: freshOrders(),

  placeOrder(menuId, o) {
    const s = get()
    if (s.orders.closed || s.session.phase !== 'live') {
      s.noteMo('afterExitBlocked')
      s.toast({ text: coreStrings.ref('orderClosed'), kind: 'info', ttl: 2000 })
      return { ok: false, dup: false, order: null }
    }
    const existing = s.orders.list.find(x => x.menuId === menuId && OPEN.includes(x.status))
    if (existing && !o?.again) {
      s.noteMo('dupBlocked')
      return { ok: false, dup: true, order: existing }
    }
    nonce += 1
    const order: Order = {
      id: uid('o'),
      menuId,
      qty: 1,
      status: 'sending',
      idem: orderIdem(menuId, s.session.simMs, nonce),
      createdAt: Date.now(),
      etaAfterSongs: 2,
    }
    set(st => ({ orders: { ...st.orders, list: [...st.orders.list, order] } }))
    s.noteMo('placed')
    bus.emit({ type: 'order/status', order })
    // The venue acknowledges shortly after (simulated).
    setTimeout(() => {
      const cur = get().orders.list.find(x => x.id === order.id)
      if (!cur || cur.status !== 'sending') return
      const next: Order = { ...cur, status: 'accepted', acceptedAt: Date.now() }
      set(st => ({ orders: { ...st.orders, list: st.orders.list.map(x => (x.id === order.id ? next : x)) } }))
      bus.emit({ type: 'order/status', order: next })
    }, 900)
    return { ok: true, dup: false, order }
  },

  advanceOrders() {
    const changed: Order[] = []
    set(st => ({
      orders: {
        ...st.orders,
        list: st.orders.list.map(o => {
          if (o.status === 'accepted' || o.status === 'preparing') {
            const etaAfterSongs = Math.max(0, o.etaAfterSongs - 1)
            const status: OrderStatus = etaAfterSongs === 0 ? 'delivered' : 'preparing'
            const n = { ...o, etaAfterSongs, status }
            changed.push(n)
            return n
          }
          return o
        }),
      },
    }))
    for (const o of changed) bus.emit({ type: 'order/status', order: o })
  },

  closeOrders() {
    const changed: Order[] = []
    set(st => ({
      orders: {
        closed: true,
        list: st.orders.list.map(o => {
          if (OPEN.includes(o.status)) {
            const n = { ...o, status: 'closed' as const }
            changed.push(n)
            return n
          }
          return o
        }),
      },
    }))
    for (const o of changed) bus.emit({ type: 'order/status', order: o })
  },
})

export const createUiSlice: StateCreator<NaviState, [], [], UiSlice> = set => ({
  ui: freshUi(),
  setTab(tab) {
    set(s => ({ ui: { ...s.ui, tab, sheet: null } }))
  },
  openSheet(id, arg) {
    set(s => ({ ui: { ...s.ui, sheet: { id, arg } } }))
  },
  closeSheet() {
    set(s => ({ ui: { ...s.ui, sheet: null } }))
  },
  setOverlay(overlay) {
    set(s => ({ ui: { ...s.ui, overlay } }))
  },
  toast(t) {
    set(s => ({ ui: { ...s.ui, toast: { ...t, id: uid('t'), at: Date.now() } } }))
  },
  dismissToast() {
    set(s => ({ ui: { ...s.ui, toast: null } }))
  },
  togglePresenter() {
    set(s => ({ ui: { ...s.ui, presenter: !s.ui.presenter } }))
  },
  toggleLens() {
    set(s => ({ ui: { ...s.ui, lens: !s.ui.lens } }))
  },
  toggleSplit() {
    set(s => ({ ui: { ...s.ui, split: !s.ui.split } }))
  },
  coachDone(k) {
    set(s => ({ ui: { ...s.ui, coach: { ...s.ui.coach, [k]: true } } }))
  },
  setReduced(reduced) {
    set(s => ({ ui: { ...s.ui, reduced } }))
  },
})

export const createMetricsSlice: StateCreator<NaviState, [], [], MetricsSlice> = set => ({
  metrics: freshMetrics(),
  markShown(k) {
    set(s => ({ metrics: { ...s.metrics, shown: { ...s.metrics.shown, [k]: (s.metrics.shown[k] ?? 0) + 1 } } }))
  },
  markActed(k, a) {
    set(s => ({
      metrics: {
        ...s.metrics,
        acted: { ...s.metrics.acted, [k]: (s.metrics.acted[k] ?? 0) + 1 },
        actions: { ...s.metrics.actions, [a]: (s.metrics.actions[a] ?? 0) + 1 },
      },
    }))
  },
  logSearch(e, ms) {
    set(s => {
      const search = { ...s.metrics.search }
      if (e === 'query') search.queries += 1
      else if (e === 'miss') search.misses += 1
      else if (ms != null) search.msToReserve = [...search.msToReserve, ms]
      return { metrics: { ...s.metrics, search } }
    })
  },
  submitSurvey(survey) {
    set(s => ({ metrics: { ...s.metrics, survey } }))
  },
  resetMetrics() {
    set({ metrics: freshMetrics() })
  },
  noteCo(e, which) {
    set(s => ({ metrics: { ...s.metrics, [which]: { ...s.metrics[which], [e]: s.metrics[which][e] + 1 } } }))
  },
  noteMo(e) {
    set(s => ({ metrics: { ...s.metrics, mo: { ...s.metrics.mo, [e]: s.metrics.mo[e] + 1 } } }))
  },
  noteVoiceToReserve() {
    set(s => ({ metrics: { ...s.metrics, voiceToReserve: s.metrics.voiceToReserve + 1 } }))
  },
  noteImportSaved() {
    set(s => ({ metrics: { ...s.metrics, importSaved: s.metrics.importSaved + 1 } }))
  },
})
