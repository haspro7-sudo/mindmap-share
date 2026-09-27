// Shape checks for persisted data (QA ROBUST#1). A snapshot written by an earlier build under the
// same v1 key, or edited by hand, must never blank the app: every field falls back to its fresh
// default on its own, and entries that point at unknown songs are dropped.
import type { CollectionState, DeckState, MetricsState, OrdersState, Phase, RoomState } from './store/types'
import type { Face, FaceState, Link, Member, MemberId, Night, Pin, QueueItem } from './types'
import { PIN_IDS } from './types'
import { freshCollection, freshDeck, freshMetrics, freshMembers, freshOrders, freshRoom } from './store/initial'
import { SONG_BY_ID } from '../data/songs'

type Obj = Record<string, unknown>

export const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)
const arr = <T = unknown>(v: unknown): T[] | null => (Array.isArray(v) ? (v as T[]) : null)
const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d)
const str = (v: unknown): v is string => typeof v === 'string' && v.length > 0
const knownSong = (id: unknown): id is string => typeof id === 'string' && !!SONG_BY_ID[id]
const objOr = <T>(v: unknown, d: T): T => (isObj(v) ? (v as T) : d)

const FACE_STATES: FaceState[] = ['sketch', 'neon', 'mirror', 'prism']
const PHASES: Phase[] = ['live', 'wrap', 'closed']
const MEMBER_IDS: MemberId[] = ['me', 'minato', 'saki', 'jun']

// ---------------------------------------------------------------- collection

function face(id: string, v: unknown): Face | null {
  if (!isObj(v) || !knownSong(id) || !FACE_STATES.includes(v.state as FaceState)) return null
  return {
    ...(v as unknown as Face),
    songId: id,
    state: v.state as FaceState,
    marks: (arr<string>(v.marks) ?? []).filter(m => typeof m === 'string') as Face['marks'],
    firstNightId: typeof v.firstNightId === 'string' ? v.firstNightId : '',
    firstAt: num(v.firstAt, 0),
    sungCount: num(v.sungCount, 0),
  }
}

export function night(v: unknown): Night | null {
  if (!isObj(v) || !str(v.id)) return null
  const pal = arr<string>(v.palette)
  const allKnow = arr<{ songId: string; size: number; at: number }>(v.allKnow)
  const { name, endedAt, ...rest } = v
  return {
    ...(rest as unknown as Night),
    ...(isObj(name) && typeof name.key === 'string' ? { name: name as Night['name'] } : {}),
    ...(typeof endedAt === 'number' && Number.isFinite(endedAt) ? { endedAt } : {}),
    id: v.id,
    startedAt: num(v.startedAt, 0),
    points: (arr<Night['points'][number]>(v.points) ?? []).filter(p => isObj(p) && typeof p.t === 'number' && typeof p.heat === 'number').map(p => ({ ...p, markers: arr(p.markers) ? p.markers : [] })),
    melody: (arr<number>(v.melody) ?? []).filter(n => typeof n === 'number'),
    facesGained: (arr(v.facesGained) ?? []).filter(knownSong),
    shared: (arr(v.shared) ?? []).filter(knownSong),
    claps: num(v.claps, 0),
    stamped: !!v.stamped,
    palette: pal && pal.length === 3 && pal.every(c => typeof c === 'string') ? (pal as Night['palette']) : ['#3B2A8F', '#1E4FA8', '#5B2A7A'],
    ...(allKnow ? { allKnow: allKnow.filter(a => isObj(a) && knownSong(a.songId)).map(a => ({ songId: a.songId, size: num(a.size, 1), at: num(a.at, 0) })) } : {}),
  }
}

/** Collection: each field is checked on its own and replaced by its default when malformed. */
export function sanitizeCollection(c: unknown): CollectionState {
  const base = freshCollection()
  if (!isObj(c)) return base
  const faces: Record<string, Face> = {}
  if (isObj(c.faces)) {
    for (const [id, v] of Object.entries(c.faces)) {
      const f = face(id, v)
      if (f) faces[id] = f
    }
  }
  return {
    faces,
    links: (arr<Link>(c.links) ?? base.links).filter(l => isObj(l) && knownSong(l.a) && knownSong(l.b)),
    nights: (arr(c.nights) ?? base.nights).map(night).filter((n): n is Night => !!n),
    pins: (arr<Pin>(c.pins) ?? base.pins).filter(p => isObj(p) && PIN_IDS.includes(p.id)),
    voices: (arr(c.voices) ?? base.voices).filter(isObj) as unknown as CollectionState['voices'],
    saved: (arr<{ songId: string }>(c.saved) ?? base.saved).filter(x => isObj(x) && knownSong(x.songId)) as CollectionState['saved'],
    imports: (arr<{ songId: string; versions?: unknown }>(c.imports) ?? base.imports)
      .filter(x => isObj(x) && knownSong(x.songId))
      .map(x => ({ ...x, versions: arr(x.versions) ?? ['original'] })) as CollectionState['imports'],
    passReasons: objOr(c.passReasons, base.passReasons),
  }
}

// ---------------------------------------------------------------- night snapshot

function queueItem(v: unknown): QueueItem | null {
  if (!isObj(v) || !str(v.id) || !knownSong(v.songId) || !MEMBER_IDS.includes(v.by as MemberId)) return null
  return { ...(v as unknown as QueueItem), keyShift: num(v.keyShift, 0), version: (typeof v.version === 'string' ? v.version : 'original') as QueueItem['version'], tags: (arr(v.tags) ?? []) as QueueItem['tags'], addedAt: num(v.addedAt, 0) }
}

export function sanitizeRoom(r: unknown): RoomState {
  const base = freshRoom()
  if (!isObj(r)) return base
  const members = freshMembers()
  if (isObj(r.members)) {
    for (const id of MEMBER_IDS) {
      const m = r.members[id]
      if (isObj(m)) members[id] = { ...members[id], ...(m as Partial<Member>), id, likes: objOr(m.likes, members[id].likes), present: !!m.present, arriving: !!m.arriving }
    }
  }
  const nowRaw = r.now
  const nowItem = isObj(nowRaw) ? queueItem(nowRaw.item) : null
  return {
    ...base,
    members,
    heat: Math.min(1, Math.max(0, num(r.heat, base.heat))),
    trend: r.trend === 1 || r.trend === -1 ? r.trend : 0,
    mood: isObj(r.mood) ? { ...base.mood, ...(r.mood as Partial<RoomState['mood']>) } : base.mood,
    moodWord: typeof r.moodWord === 'string' ? (r.moodWord as RoomState['moodWord']) : base.moodWord,
    queue: (arr(r.queue) ?? []).map(queueItem).filter((q): q is QueueItem => !!q),
    now: nowItem && isObj(nowRaw) ? { item: nowItem, startedAt: num(nowRaw.startedAt, 0), durationMs: num(nowRaw.durationMs, 40_000) } : null,
    sung: (arr<Obj>(r.sung) ?? []).filter(e => isObj(e) && !!queueItem(e.item)) as unknown as RoomState['sung'],
    knowing: isObj(r.knowing) ? (Object.fromEntries(Object.entries(r.knowing).filter(([id, t]) => knownSong(id) && isObj(t) && isObj(t.answers))) as RoomState['knowing']) : base.knowing,
    bubbles: [],
    prompt: isObj(r.prompt) && arr(r.prompt.songIds) ? (r.prompt as unknown as RoomState['prompt']) : null,
    invites: (arr<Obj>(r.invites) ?? []).filter(i => isObj(i) && str(i.id) && knownSong(i.songId)) as unknown as RoomState['invites'],
    restUntil: num(r.restUntil, 0),
    wordOverrideUntil: num(r.wordOverrideUntil, 0),
  }
}

export function sanitizeDeck(d: unknown): Pick<DeckState, 'cards' | 'round' | 'consumedInRound' | 'offers' | 'history' | 'selection' | 'passStreak'> {
  const base = freshDeck()
  if (!isObj(d)) return base
  return {
    cards: (arr<Obj>(d.cards) ?? []).filter(c => isObj(c) && str(c.id) && typeof c.kind === 'string' && isObj(c.reason) && isObj(c.trigger) && (c.songId == null || knownSong(c.songId))) as unknown as DeckState['cards'],
    round: Math.max(1, num(d.round, 1)),
    consumedInRound: num(d.consumedInRound, 0),
    offers: objOr(d.offers, base.offers),
    history: (arr<Obj>(d.history) ?? []).filter(isObj) as unknown as DeckState['history'],
    selection: objOr(d.selection, base.selection),
    passStreak: num(d.passStreak, 0),
  }
}

export function sanitizeOrders(o: unknown): OrdersState {
  const base = freshOrders()
  if (!isObj(o)) return base
  return { list: (arr<Obj>(o.list) ?? []).filter(x => isObj(x) && str(x.id) && typeof x.menuId === 'string' && typeof x.status === 'string') as unknown as OrdersState['list'], closed: !!o.closed }
}

export function sanitizeMetrics(m: unknown): MetricsState {
  const base = freshMetrics()
  if (!isObj(m)) return base
  const out = { ...base } as Record<string, unknown>
  for (const [k, v] of Object.entries(base)) {
    const got = m[k]
    if (Array.isArray(v)) out[k] = Array.isArray(got) ? got : v
    else if (isObj(v)) out[k] = isObj(got) ? { ...v, ...got } : v
    else if (typeof v === 'number') out[k] = num(got, v)
  }
  if (typeof m.firstReserveMs === 'number') out.firstReserveMs = m.firstReserveMs
  if (isObj(m.survey)) out.survey = m.survey
  // nested arrays inside search
  const search = out.search as MetricsState['search']
  if (!Array.isArray(search.msToReserve)) out.search = { ...search, msToReserve: [] }
  return out as MetricsState
}

export type SessionSnapshot = { nightId: string; seed: string; phase: Phase; simMs: number; visit: number; linked: boolean; enteredAt: number }

export function sanitizeSession(s: unknown): SessionSnapshot | null {
  if (!isObj(s) || !str(s.nightId) || !PHASES.includes(s.phase as Phase)) return null
  return {
    nightId: s.nightId,
    seed: typeof s.seed === 'string' ? s.seed : '',
    phase: s.phase as Phase,
    simMs: Math.max(0, num(s.simMs, 0)),
    visit: Math.max(1, Math.floor(num(s.visit, 1))),
    linked: !!s.linked,
    enteredAt: num(s.enteredAt, Date.now()),
  }
}
