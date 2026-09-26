// Read models (SPEC K-5). Components read through these; wrap array/object results in useShallow.
import type { NaviState } from './store/types'
import type { DeckCard, KnowView, Member, Night, NowPlaying, Order, QueueItem, SongId, Face, MoodWordId, AuroraKey } from './types'
import { presentMembers, isMine } from './store/room'
import { auroraFor, knowView, roomMinutesLeft } from './rules'

export const selTopCard = (s: NaviState): DeckCard | undefined => s.deck.cards[0]

export const selPeeks = (s: NaviState, n = 2): DeckCard[] => s.deck.cards.slice(1, 1 + n)

export const selPresent = (s: NaviState): Member[] => presentMembers(s)

export const selRoomSize = (s: NaviState): number => presentMembers(s).length

export const selKnowView =
  (songId: SongId) =>
  (s: NaviState): KnowView | null => {
    const t = s.room.knowing[songId]
    if (!t) return null
    return knowView(t, presentMembers(s).map(m => m.id))
  }

export type QueueRow = { item: QueueItem; pos: number; mine: boolean; etaSongs: number }

/** pos 0 is NOW; queued items start at 1. */
export const selQueueView = (s: NaviState): QueueRow[] => {
  const rows: QueueRow[] = []
  if (s.room.now) rows.push({ item: s.room.now.item, pos: 0, mine: isMine(s.room.now.item), etaSongs: 0 })
  s.room.queue.forEach((item, i) => rows.push({ item, pos: i + 1, mine: isMine(item), etaSongs: i + (s.room.now ? 1 : 0) }))
  return rows
}

/** Songs until my next turn (0 = I am singing now), or null if nothing is queued for me. */
export const selMyTurnIn = (s: NaviState): number | null => {
  if (s.room.now && isMine(s.room.now.item)) return 0
  const i = s.room.queue.findIndex(isMine)
  if (i < 0) return null
  return i + (s.room.now ? 1 : 0)
}

export const selNow = (s: NaviState): NowPlaying => s.room.now

export const selMinutesLeft = (s: NaviState): number => roomMinutesLeft(s.session.simMs)

export const selHeat = (s: NaviState): { heat: number; trend: -1 | 0 | 1; word: MoodWordId; aurora: AuroraKey } => ({
  heat: s.room.heat,
  trend: s.room.trend,
  word: s.room.moodWord,
  aurora: auroraFor(s.room.moodWord),
})

export const selFace =
  (songId: SongId) =>
  (s: NaviState): Face | undefined =>
    s.col.faces[songId]

export type FaceStats = { total: number; sketch: number; neon: number; mirror: number; prism: number; lit: number }
export const selFaceStats = (s: NaviState): FaceStats => {
  const st: FaceStats = { total: 0, sketch: 0, neon: 0, mirror: 0, prism: 0, lit: 0 }
  for (const f of Object.values(s.col.faces)) {
    st.total += 1
    st[f.state] += 1
  }
  st.lit = st.total
  return st
}

/** Background light specks: 12 + mirror/prism faces, capped at 60 (SPEC D-4). */
export const selSpeckTarget = (s: NaviState): number => {
  let n = 0
  for (const f of Object.values(s.col.faces)) if (f.state === 'mirror' || f.state === 'prism') n++
  return 12 + Math.min(48, n)
}

const EMPTY_NIGHT: Night = { id: '', startedAt: 0, points: [], melody: [], facesGained: [], shared: [], claps: 0, stamped: false, palette: ['#3B2A8F', '#1E4FA8', '#5B2A7A'] }
export const selTonight = (s: NaviState): Night => s.col.nights.find(n => n.id === s.session.nightId) ?? EMPTY_NIGHT

export const selPastNights = (s: NaviState): Night[] => s.col.nights.filter(n => n.id !== s.session.nightId)

export const selOrdersOpen = (s: NaviState): Order[] => s.orders.list.filter(o => o.status === 'sending' || o.status === 'accepted' || o.status === 'preparing')

export const selCanOrder = (s: NaviState): boolean => !s.orders.closed && s.session.phase === 'live'

/** "予約済み #n": position in play order (1 = next after NOW), 0 when it is playing, null if not queued. */
export const selReservedPos =
  (songId: SongId) =>
  (s: NaviState): number | null => {
    if (s.room.now?.item.songId === songId) return 0
    const i = s.room.queue.findIndex(q => q.songId === songId)
    return i < 0 ? null : i + 1
  }

/** Personal things (ball, imports, voice) are only shown on the phone view. */
export const selPrivateAllowed = (s: NaviState): boolean => s.session.view !== 'room'
