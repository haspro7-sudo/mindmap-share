// SPEC H-3: which measure (5-1…5-4) and which way to win (誰繋読訪連) each on-screen element
// serves, how it is verified, and what the prototype measures right now (H-4, store.metrics).
import type { CardKind, Locale, PolicyAnchor, PolicyId, Source, TextRef } from '../../core/types'
import type { NaviState } from '../../core/store/types'
import { presentMembers, isMine } from '../../core/store'
import { knowView } from '../../core/rules'
import { selMyTurnIn } from '../../core/selectors'
import { planner, type PlannerKey } from './strings'
import { parseCardId } from './deal'

export type PolicyEntry = { policies: PolicyId[]; ways: Source[]; metric: TextRef; note?: TextRef }

const P = (k: PlannerKey, vars?: TextRef['vars']): TextRef => planner.ref(k, vars)
const entry = (policies: PolicyId[], ways: Source[], anchor: string, note?: PlannerKey): PolicyEntry => ({
  policies,
  ways,
  metric: P(`metric.${anchor}` as PlannerKey),
  ...(note ? { note: P(note) } : {}),
})

export const POLICY_MAP: Record<PolicyAnchor, PolicyEntry> = {
  lane: entry(['5-2', '5-4'], ['yomu'], 'lane'),
  search: entry(['5-2', '5-1'], ['hou'], 'search'),
  'hero-ball': entry(['5-3', '5-2'], ['ren', 'yomu'], 'hero-ball', 'fut.hero-ball'),
  orbs: entry(['5-2'], ['dare'], 'orbs', 'fut.orbs'),
  mood: entry(['5-2'], ['yomu'], 'mood', 'fut.mood'),
  mixer: entry(['5-2'], ['yomu', 'dare'], 'mixer'),
  'card:song': entry(['5-2'], ['yomu', 'dare'], 'card:song'),
  'card:song.visa': entry(['5-1'], ['hou', 'dare'], 'card:song.visa'),
  'card:ask': entry(['5-2'], ['dare', 'tsunagu'], 'card:ask'),
  'card:shift': entry(['5-2'], ['yomu'], 'card:shift'),
  'card:link': entry(['5-2'], ['tsunagu'], 'card:link'),
  'card:voice': entry(['5-4'], ['dare'], 'card:voice', 'fut.card:voice'),
  'card:gap': entry(['5-2'], ['yomu'], 'card:gap'),
  'card:invite': entry(['5-2', '5-4'], ['dare'], 'card:invite', 'fut.card:invite'),
  'card:import': entry(['5-3'], ['ren'], 'card:import', 'fut.card:import'),
  'card:coaster': entry(['5-4'], ['yomu'], 'card:coaster', 'fut.card:coaster'),
  'card:finale': entry(['5-2'], ['dare', 'yomu'], 'card:finale'),
  'card:breather': entry(['5-2'], ['yomu'], 'card:breather'),
  'navi-tag': entry(['5-2'], ['yomu'], 'navi-tag'),
  dock: entry(['5-4'], [], 'dock'),
  order: entry(['5-4'], [], 'order', 'fut.order'),
  record: entry(['5-3'], ['ren'], 'record', 'fut.record'),
  wrap: entry(['5-3'], ['ren'], 'wrap', 'fut.wrap'),
  'entry-ota': entry(['5-1'], ['hou'], 'entry-ota', 'fut.entry-ota'),
  lang: entry(['5-1'], ['hou'], 'lang', 'fut.lang'),
  'room-view': entry(['5-4'], ['dare', 'yomu'], 'room-view', 'fut.room-view'),
}

export const POLICIES: PolicyId[] = ['5-1', '5-2', '5-3', '5-4']
/** The five ways to win, in the brief's order (voice is a source glyph, not a way). */
export const WAYS: Source[] = ['dare', 'tsunagu', 'yomu', 'hou', 'ren']
export const INITIATIVES: Record<PolicyId, PlannerKey[]> = {
  '5-1': ['init.5-1.a', 'init.5-1.b', 'init.5-1.c'],
  '5-2': ['init.5-2.a', 'init.5-2.b', 'init.5-2.c'],
  '5-3': ['init.5-3.a', 'init.5-3.b', 'init.5-3.c'],
  '5-4': ['init.5-4.a', 'init.5-4.b', 'init.5-4.c'],
}

/**
 * Elements some modules may not tag themselves: the lens still frames them.
 * (selector, anchor) — used only when no element carries that data-anchor.
 */
export const IMPLICIT_ANCHORS: [string, PolicyAnchor][] = [
  ['[data-testid="lang-button"]', 'lang'],
  ['[data-testid="lane-item"][data-tags*="navi"]', 'navi-tag'],
  ['[data-testid="sheet"][data-sheet="mixer"]', 'mixer'],
  ['[data-testid="sheet"][data-sheet="search"]', 'search'],
  ['[data-testid="record-screen"]', 'record'],
  ['[data-testid="wrap"]', 'wrap'],
  ['[data-testid="room-board"]', 'room-view'],
]

export const policyName = (p: PolicyId): TextRef => P(`policy.${p}` as PlannerKey)
export const wayName = (w: Source): TextRef => P(`way.${w}` as PlannerKey)
export const elementName = (a: PolicyAnchor): TextRef => (POLICY_MAP[a] ? P(`el.${a}` as PlannerKey) : { key: a })
export const shortMetric = (a: PolicyAnchor): TextRef | null => (POLICY_MAP[a] ? P(`short.${a}` as PlannerKey) : null)
export const hereText = (a: PolicyAnchor): TextRef | null => (POLICY_MAP[a] ? P(`here.${a}` as PlannerKey) : null)

const KIND_OF_ANCHOR = (a: string): CardKind | null => (a.startsWith('card:') ? (a.slice(5).split('.')[0] as CardKind) : null)

const EVIDENCE: Partial<Record<string, PlannerKey>> = {
  mixer: 'evi.mixer',
  'card:ask': 'evi.card:ask',
  'card:shift': 'evi.card:shift',
  'card:link': 'evi.card:link',
  'card:voice': 'evi.card:voice',
  'hero-ball': 'evi.hero-ball',
  record: 'evi.hero-ball',
  orbs: 'evi.orbs',
  'card:song.visa': 'evi.card:song.visa',
}

const fx = (n: number, d = 2) => (Number.isFinite(n) ? n.toFixed(d) : '—')

/** Evidence vs hypothesis for an element, with live hypothesis values where they exist. */
export function evidenceFor(a: PolicyAnchor, s: NaviState): TextRef[] {
  if (a === 'mood') return [P('evi.mood', { heat: fx(s.room.heat) })]
  const k = EVIDENCE[a]
  const out: TextRef[] = [P(k ?? 'evi.default')]
  if (a === 'card:song' || a === 'mood') out.push(P('evi.trend'))
  return out
}

/** Current measured values for an element (H-4 / H-6), recomputed while the panel is open. */
export function measure(a: PolicyAnchor, s: NaviState, extra: { privateOnRoom?: number; locale?: Locale } = {}): { main: TextRef | null; lines: TextRef[] } {
  const m = s.metrics
  const lines: TextRef[] = []
  let main: TextRef | null = null
  const kind = KIND_OF_ANCHOR(a)
  const mineQueued = s.room.queue.filter(isMine).length
  const sungMine = s.room.sung.filter(e => isMine(e.item))
  const allMine = [...s.room.queue.filter(isMine).map(q => q.tags), ...(s.room.now && isMine(s.room.now.item) ? [s.room.now.item.tags] : []), ...sungMine.map(e => e.item.tags)]
  switch (a) {
    case 'card:song': {
      const secs = m.firstReserveMs != null ? m.firstReserveMs / 1000 : null
      main = secs != null ? P('val.firstReserve', { s: fx(secs, 1) }) : P('val.measuring', { s: fx(Math.max(0, Date.now() - s.session.enteredAt) / 1000, 0) })
      lines.push(P('val.target180'))
      break
    }
    case 'lane': {
      main = P('val.lane', { n: s.room.queue.length + (s.room.now ? 1 : 0), mine: mineQueued })
      const turn = selMyTurnIn(s)
      if (turn != null && turn > 0) lines.push(P('val.turn', { k: turn }))
      break
    }
    case 'search': {
      const r = m.search.msToReserve
      main = P('val.search', { q: m.search.queries, miss: m.search.misses, avg: r.length ? fx(r.reduce((x, y) => x + y, 0) / r.length / 1000, 1) : '—' })
      break
    }
    case 'hero-ball':
    case 'record': {
      const lit = Object.keys(s.col.faces).length
      main = a === 'record' ? P('val.record', { nights: s.col.nights.length, pins: s.col.pins.length, saved: s.col.saved.length }) : P('val.heroBall', { lit, saved: s.col.saved.length })
      break
    }
    case 'orbs':
      main = P('val.orbs', { n: presentMembers(s).length })
      break
    case 'mood':
      main = P('val.heat', { heat: fx(s.room.heat) })
      break
    case 'mixer': {
      const recent = s.room.mood.setBy === 'mixer' && s.session.simMs - s.room.mood.setAt < 20 * 8889
      main = P('val.mixer', { hype: fx(s.room.mood.hype), fresh: fx(s.room.mood.fresh), w: recent ? '0.5' : '0.2' })
      break
    }
    case 'card:song.visa':
      main = P('val.visa', { n: allMine.filter(t => t.includes('visa')).length })
      break
    case 'card:ask': {
      const ids = presentMembers(s).map(x => x.id)
      const tallies = Object.values(s.room.knowing)
      main = P('val.ask', { asked: tallies.length, all: tallies.filter(t => knowView(t, ids).all).length })
      break
    }
    case 'card:shift': {
      const ins = s.room.sung.filter(e => e.item.tags.includes('insert'))
      const d = ins.length ? ins.reduce((x, e) => x + (e.heatAfter - e.heatBefore), 0) / ins.length : NaN
      main = P('val.shift', { n: ins.length + s.room.queue.filter(q => q.tags.includes('insert')).length, delta: Number.isFinite(d) ? `${d >= 0 ? '+' : ''}${fx(d)}` : '—' })
      break
    }
    case 'card:link':
      main = P('val.link', { cp: m.co.picked, cs: m.co.shown, tp: m.tag.picked, ts: m.tag.shown })
      break
    case 'card:voice':
      main = P('val.voice', { n: m.voiceToReserve })
      break
    case 'card:invite':
      main = P('val.invite', { n: s.room.invites.length, acc: s.room.invites.filter(i => i.status === 'accepted').length })
      break
    case 'card:import':
      main = P('val.import', { saved: m.importSaved, cand: s.col.imports.length })
      break
    case 'card:coaster':
    case 'order':
      main = P('val.mo', { placed: m.mo.placed, dup: m.mo.dupBlocked, after: m.mo.afterExitBlocked })
      break
    case 'card:finale': {
      const p = s.room.prompt
      main = P('val.finale', { votes: p?.kind === 'finale' ? Object.keys(p.votes ?? {}).length : 0, n: presentMembers(s).length })
      break
    }
    case 'card:breather':
      main = P('val.breather', { n: m.actions.putDown ?? 0 })
      break
    case 'navi-tag':
      main = P('val.navi', { navi: allMine.filter(t => t.includes('navi')).length, mine: allMine.length })
      break
    case 'dock':
      main = P('val.dock')
      break
    case 'wrap':
      main = P(m.survey ? 'val.wrapDone' : 'val.wrapOpen')
      break
    case 'entry-ota':
      main = P('val.ota')
      break
    case 'lang':
      main = P('val.lang', { locale: { locale: extra.locale ?? 'ja' } })
      break
    case 'room-view':
      main = P('val.private', { n: extra.privateOnRoom ?? 0 })
      break
  }
  if (kind) lines.push(P('val.shownActed', { shown: m.shown[kind] ?? 0, acted: m.acted[kind] ?? 0 }))
  return { main, lines }
}

/**
 * What actually ran in this room tonight (for the closing lens on the wrap): measures and ways
 * are lit only by real events of the night, never by a percentage.
 */
export function tonightLit(s: NaviState, locale: Locale): { policies: PolicyId[]; ways: Source[] } {
  const m = s.metrics
  const items = [...s.room.sung.map(e => e.item), ...(s.room.now ? [s.room.now.item] : []), ...s.room.queue]
  const acted = (k: CardKind) => (m.acted[k] ?? 0) > 0
  // an inbound guest in the room (Jun) or a crossing card played means 5-1 ran tonight
  const visitor = Object.values(s.room.members).some(x => x.id !== 'me' && x.locale !== 'ja' && x.joinedAt != null)
  const visa =
    visitor ||
    items.some(i => i.tags.includes('visa')) ||
    s.deck.history.some(h => parseCardId(h.cardId)?.kv === 'song.visa') ||
    s.deck.cards.some(c => c.variant === 'visa')
  const p = new Set<PolicyId>()
  const w = new Set<Source>()
  if (visa || locale !== 'ja' || m.search.queries > 0) p.add('5-1')
  if (m.firstReserveMs != null || acted('ask') || acted('link') || acted('gap') || acted('shift') || m.search.queries > 0) p.add('5-2')
  if (s.col.saved.length > 0 || Object.keys(s.col.faces).length > 0) p.add('5-3')
  if (m.mo.placed > 0 || acted('voice') || acted('coaster') || s.col.voices.some(v => v.nightId === s.session.nightId)) p.add('5-4')
  if (Object.keys(s.room.knowing).length > 0 || s.room.members.jun.joinedAt != null) w.add('dare')
  if (s.col.links.length > 0 || m.co.picked > 0) w.add('tsunagu')
  if (s.room.sung.length > 0 || acted('shift') || s.room.mood.setBy === 'mixer') w.add('yomu')
  if (visa || locale !== 'ja') w.add('hou')
  if (s.col.saved.length > 0 || Object.keys(s.col.faces).length > 0) w.add('ren')
  return { policies: POLICIES.filter(x => p.has(x)), ways: WAYS.filter(x => w.has(x)) }
}
