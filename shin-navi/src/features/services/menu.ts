// Order menu (SPEC J-5, owned by M10) and the pure helpers the order/coaster/import/entry UIs
// share. No prices anywhere: "価格は店舗の表示に従います（デモ）". Ordering never earns anything.
import type { NaviState } from '../../core/store/types'
import type { Order, OrderStatus, TextRef, VersionId } from '../../core/types'

export type MenuKind = 'drink' | 'food' | 'water' | 'rest'
export type MenuItem = { id: string; kind: MenuKind; name: TextRef; hue: number }

export const MENU: MenuItem[] = [
  { id: 'highball', kind: 'drink', name: { key: 'services.menu.highball' }, hue: 42 },
  { id: 'oolong', kind: 'drink', name: { key: 'services.menu.oolong' }, hue: 24 },
  { id: 'ginger', kind: 'drink', name: { key: 'services.menu.ginger' }, hue: 50 },
  { id: 'cola', kind: 'drink', name: { key: 'services.menu.cola' }, hue: 6 },
  { id: 'fries', kind: 'food', name: { key: 'services.menu.fries' }, hue: 46 },
  { id: 'karaage', kind: 'food', name: { key: 'services.menu.karaage' }, hue: 28 },
  { id: 'water', kind: 'water', name: { key: 'services.menu.water' }, hue: 196 },
  { id: 'rest', kind: 'rest', name: { key: 'services.menu.rest' }, hue: 262 },
]

export const MENU_BY_ID: Record<string, MenuItem> = Object.fromEntries(MENU.map(m => [m.id, m]))

/** "ひと休み" is on the menu next to the drinks, but it never creates an order. */
export const isOrderable = (id: string): boolean => {
  const m = MENU_BY_ID[id]
  return !!m && m.kind !== 'rest'
}

/** Menu grid sections: the drinks row puts water and the breather on the same footing (ruling 12). */
export const MENU_SECTIONS: { kind: 'drink' | 'food'; ids: string[] }[] = [
  { kind: 'drink', ids: ['highball', 'oolong', 'ginger', 'cola', 'water', 'rest'] },
  { kind: 'food', ids: ['fries', 'karaage'] },
]

/** The three drinks on a toast coaster: the room's heat picks the mood of the round. */
export function coasterDrinks(heat: number): string[] {
  return heat >= 0.65 ? ['highball', 'cola', 'ginger'] : ['highball', 'oolong', 'ginger']
}

export const OPEN_STATUSES: readonly OrderStatus[] = ['sending', 'accepted', 'preparing']
export const TRACK: readonly OrderStatus[] = ['sending', 'accepted', 'preparing', 'delivered']

/** Index on the four-station tracker (closed orders stay where they stopped). */
export function trackIndex(o: Pick<Order, 'status' | 'acceptedAt'>): number {
  if (o.status === 'closed') return o.acceptedAt ? 1 : 0
  return Math.max(0, TRACK.indexOf(o.status))
}

/** The open order for a menu item, if any (the one a re-tap would duplicate). */
export function openOrderFor(list: readonly Order[], menuId: string): Order | undefined {
  for (let i = list.length - 1; i >= 0; i--) {
    const o = list[i]
    if (o.menuId === menuId && OPEN_STATUSES.includes(o.status)) return o
  }
  return undefined
}

export function openCountFor(list: readonly Order[], menuId: string): number {
  let n = 0
  for (const o of list) if (o.menuId === menuId && OPEN_STATUSES.includes(o.status)) n++
  return n
}

/** HH:MM of a real timestamp (the venue clock). */
export function hhmm(ms: number | undefined): string {
  if (ms == null) return '--:--'
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export const canOrder = (s: Pick<NaviState, 'orders' | 'session'>): boolean => !s.orders.closed && s.session.phase === 'live'

// ---------------------------------------------------------------- bring-in (import)

export const VERSION_ORDER: readonly VersionId[] = ['original', 'artistMv', 'anime', 'karaoke']

/** Versions offered for a candidate, original first (it is preselected). */
export function versionsFor(available: readonly VersionId[]): VersionId[] {
  const set = new Set(available)
  set.add('original')
  return VERSION_ORDER.filter(v => set.has(v))
}

// ---------------------------------------------------------------- entrance

/**
 * Nothing of mine has happened tonight yet: no card acted on, nothing reserved or sung by me,
 * no order, no face gained. Walking in from the entrance then starts the night afresh.
 */
export function nightUntouched(s: Pick<NaviState, 'deck' | 'room' | 'orders' | 'col' | 'session'>): boolean {
  if (s.session.phase !== 'live') return false
  if (s.deck.history.length) return false
  if (s.room.queue.some(q => q.by === 'me') || s.room.sung.some(e => e.item.by === 'me') || s.room.now?.item.by === 'me') return false
  if (s.orders.list.length) return false
  const night = s.col.nights.find(n => n.id === s.session.nightId)
  if (night && (night.facesGained.length || night.points.some(p => p.by === 'me'))) return false
  return true
}

/** A short, stable voucher code for the travel journal (demo, never a real booking). */
export function voucherCode(seed: string): string {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  const A = 'ACDEFGHJKLMNPQRTUVWXY'
  const D = '23456789'
  let x = h >>> 0
  let out = 'DEMO-'
  for (let i = 0; i < 4; i++) {
    out += i % 2 ? D[x % D.length] : A[x % A.length]
    x = Math.floor(x / 7) + 104729 * (i + 1)
  }
  return out
}

/** The voucher's QR-like mark: a stable 21×21 bit grid (decorative, encodes nothing). */
export function voucherGrid(code: string, n = 21): boolean[] {
  let h = 0x811c9dc5
  for (let i = 0; i < code.length; i++) h = Math.imul(h ^ code.charCodeAt(i), 16777619)
  const bits: boolean[] = []
  let x = h >>> 0
  for (let i = 0; i < n * n; i++) {
    x ^= x << 13
    x ^= x >>> 17
    x ^= x << 5
    x >>>= 0
    bits.push((x & 3) === 0 || (x & 7) === 5)
  }
  // three finder squares, like the real thing
  const finder = (r0: number, c0: number) => {
    // a 7×7 ring with a 3×3 core, plus a one-cell quiet border
    for (let r = -1; r <= 7; r++)
      for (let c = -1; c <= 7; c++) {
        const rr = r0 + r
        const cc = c0 + c
        if (rr < 0 || cc < 0 || rr >= n || cc >= n) continue
        const inside = r >= 0 && r <= 6 && c >= 0 && c <= 6
        const edge = inside && (r === 0 || r === 6 || c === 0 || c === 6)
        const core = r >= 2 && r <= 4 && c >= 2 && c <= 4
        bits[rr * n + cc] = edge || core
      }
  }
  finder(0, 0)
  finder(0, n - 7)
  finder(n - 7, 0)
  return bits
}
