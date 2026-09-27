// Bring-in (SPEC C-8 ⑧, 5-3): the save moment and the 10-second "show the room". Shared by the
// import card and the import sheet so a save looks the same wherever it starts. Saving is only
// ever an explicit tap; nothing here runs on its own.
import type { SongId, VersionId } from '../../core/types'
import type { NaviApi } from '../../core/store/types'
import { bus } from '../../core/events'
import { songColor } from '../../core/actions'
import { uid } from '../../core/store/initial'
import { sound } from '../../core/sound'

const launched = new Map<SongId, number>()

/**
 * Throw the silver disc to its face on the ball (M3's flight layer turns it into the song's
 * colour on the way). A save started from the card and seen again through card/acted is
 * thrown only once.
 */
export function launchDisc(songId: SongId, el: Element | null | undefined): void {
  const now = Date.now()
  const last = launched.get(songId)
  if (last != null && now - last < 900) return
  launched.set(songId, now)
  const r = el?.getBoundingClientRect()
  if (!r) return
  bus.emit({ type: 'fx/flight', from: r, to: `face:${songId}`, kind: 'import', songId, color: songColor(songId) })
}

/** Whether a save flight for this song was thrown a moment ago (the card/acted echo). */
export function justLaunched(songId: SongId): boolean {
  const last = launched.get(songId)
  return last != null && Date.now() - last < 900
}

/**
 * Save a candidate to My Songs with its version. With a live import card, the card action does
 * the store work (face, stitch mark, pin, metrics); without one (the sheet opened on its own)
 * the same steps run here.
 */
export function saveCandidate(api: NaviApi, songId: SongId, version: VersionId, fromEl: Element | null | undefined, cardId?: string): void {
  const s = api.getState()
  if (s.col.saved.some(x => x.songId === songId && x.from === 'import')) return
  launchDisc(songId, fromEl)
  const card = cardId ? s.deck.cards.find(c => c.id === cardId && c.kind === 'import') : undefined
  if (card) {
    s.act(card.id, 'save', { songId, version, flightLaunched: true })
    return
  }
  s.saveSong(songId, version, 'import')
  api.getState().faceEvent(songId, 'import', { mark: 'stitch' })
  api.getState().noteImportSaved()
  if (api.getState().col.saved.filter(x => x.from === 'import').length >= 3) api.getState().earnPin('importer')
  sound.play('keepFold')
}

// ---------------------------------------------------------------- show the room (10 s)

export const SHOW_MS = 10_000
let showTimer: ReturnType<typeof setTimeout> | null = null

/** The shared screen is busy with something the room is doing together (ask, shift, finale…). */
export function roomBusy(api: NaviApi): boolean {
  const p = api.getState().room.prompt
  return !!p && p.kind !== 'show'
}

/**
 * Show one candidate's title on the room screen for ten seconds, then take it down. Only the
 * title goes up, never where it came from (E-12).
 */
export function showToRoom(api: NaviApi, songId: SongId, cardId?: string): boolean {
  if (roomBusy(api)) return false
  const s = api.getState()
  const card = cardId ? s.deck.cards.find(c => c.id === cardId) : undefined
  if (card) s.act(card.id, 'showRoom', { songId })
  else s.setPrompt({ id: uid('p'), kind: 'show', songIds: [songId], at: Date.now() })
  const p = api.getState().room.prompt
  if (!p || p.kind !== 'show') return false
  sound.play('orbPop')
  if (showTimer) clearTimeout(showTimer)
  const id = p.id
  showTimer = setTimeout(() => {
    showTimer = null
    const cur = api.getState().room.prompt
    if (cur && cur.id === id) api.getState().setPrompt(null)
  }, SHOW_MS)
  return true
}
