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

/** Songs every present member knew tonight (asked in the room), then the shared songs I sang. */
export function selCommon(s: Pick<NaviState, 'room' | 'col' | 'session'>): { ids: SongId[]; size: number } {
  const ids = presentIdsOf(s)
  const all = Object.values(s.room.knowing)
    .filter(t => knowView(t, ids).all)
    .sort((a, b) => a.askedAt - b.askedAt)
    .map(t => t.songId)
  const night = s.col.nights.find(n => n.id === s.session.nightId)
  for (const id of night?.shared ?? []) if (!all.includes(id)) all.push(id)
  return { ids: all, size: ids.length }
}
