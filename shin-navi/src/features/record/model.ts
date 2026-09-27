// Pure read models for the recap (unit-tested): what "take it home" saves, and tonight's songs
// that everyone in the room knew. No store import, so tests can feed plain state objects.
import type { NaviState } from '../../core/store/types'
import type { MemberId, QueueItem, SongId, VersionId } from '../../core/types'
import { knowView } from '../../core/rules'
import { SONG_BY_ID } from '../../data/songs'

const ORDER: MemberId[] = ['me', 'minato', 'saki', 'jun']
const mine = (i: QueueItem) => i.by === 'me' || i.with === 'me'
export const presentIdsOf = (s: Pick<NaviState, 'room'>): MemberId[] => ORDER.filter(id => s.room.members[id]?.present)

/**
 * Songs "take it home to My Songs" saves (SPEC C-4, D-13): everything I reserved or sang tonight
 * (with the version I chose) and tonight's new faces. Songs already saved are left untouched, so
 * a brought-along song keeps its origin.
 */
export function takeHomeSongs(s: Pick<NaviState, 'room' | 'col' | 'session'>): { songId: SongId; version: VersionId }[] {
  const night = s.col.nights.find(n => n.id === s.session.nightId)
  const out = new Map<SongId, VersionId>()
  const items = [...s.room.sung.map(e => e.item), ...(s.room.now ? [s.room.now.item] : []), ...s.room.queue].filter(mine)
  for (const it of items) if (!out.has(it.songId)) out.set(it.songId, it.version)
  for (const id of night?.facesGained ?? []) if (!out.has(id)) out.set(id, 'original')
  const have = new Set(s.col.saved.map(x => x.songId))
  return [...out.entries()].filter(([id]) => !have.has(id) && SONG_BY_ID[id]).map(([songId, version]) => ({ songId, version }))
}

export type CommonSong = { songId: SongId; size: number }

/**
 * Songs everyone in the room knew tonight (wrap page 3), each with the room size at that moment:
 * first the moments core remembered in `night.allKnow` (a later arrival makes it 3/4, but
 * "青と夏 · 3人全員" happened), then tallies that are all-know among the members present now,
 * then the shared songs I sang. Never names who was missing; a room of one is not "everyone".
 */
export function selCommon(s: Pick<NaviState, 'room' | 'col' | 'session'>): { items: CommonSong[]; size: number } {
  const ids = presentIdsOf(s)
  const night = s.col.nights.find(n => n.id === s.session.nightId)
  const items: CommonSong[] = []
  const push = (songId: SongId, size: number) => {
    if (!SONG_BY_ID[songId] || size < 2) return
    const had = items.find(x => x.songId === songId)
    // the same song all-know again with more people (Jun joined and knew it too) keeps the bigger room
    if (had) had.size = Math.max(had.size, size)
    else items.push({ songId, size })
  }
  for (const a of [...(night?.allKnow ?? [])].sort((x, y) => x.at - y.at)) push(a.songId, a.size)
  const live = Object.values(s.room.knowing)
    .filter(t => knowView(t, ids).all)
    .sort((a, b) => a.askedAt - b.askedAt)
  for (const t of live) push(t.songId, ids.length)
  for (const id of night?.shared ?? []) if (!items.some(x => x.songId === id)) push(id, ids.length)
  return { items, size: ids.length }
}
