// Script mode (SPEC E-13): the demo's big events happen only on "next" (→ key / pp-next), in
// this order. Each step builds exactly the state the 3-minute demo (SPEC N) needs; steps that
// the presenter already caused by hand are skipped so a → press is never wasted.
import type { NaviApi, NaviState } from '../../core/store/types'
import type { QueueItem, SongId, TextRef } from '../../core/types'
import { isMine } from '../../core/store'
import { reserveAsMe } from '../../core/actions'
import { after } from '../../core/clock'
import { bus } from '../../core/events'
import { roomMinutesLeft } from '../../core/rules'
import { SONG_BY_ID } from '../../data/songs'
import { OPENER_FALLBACK } from '../../data/tables'
import { P } from './strings'
import { isMellow, myScore, pickMemberSong, sendRequest, takenSongs, useSim } from './sim'

export type ScriptStep = { id: string; label: TextRef; run(api: NaviApi): void }

/** Real milliseconds → sim milliseconds at the current speed (pacing that looks the same at 1×/4×/8×). */
const simOf = (api: NaviApi, realMs: number) => realMs * api.getState().session.speed

/** Only while the same night is live. */
function later(api: NaviApi, realMs: number, fn: () => void) {
  const night = api.getState().session.nightId
  after(simOf(api, realMs), () => {
    const s = api.getState()
    if (s.session.nightId !== night || s.session.phase !== 'live') return
    fn()
  })
}

/** Put these queue items first, in this order (the script jumps the queue on purpose). */
export function moveToFront(api: NaviApi, ids: string[]): void {
  api.setState(st => {
    const q = st.room.queue
    const front = ids.map(id => q.find(x => x.id === id)).filter((x): x is QueueItem => !!x)
    if (!front.length) return {}
    return { room: { ...st.room, queue: [...front, ...q.filter(x => !ids.includes(x.id))] } }
  })
}

// ---------------------------------------------------------------- building blocks (also used by presenter commands)

/** Finish what is playing (my song gets its demo score). */
export function finishCurrent(api: NaviApi): void {
  const s = api.getState()
  const now = s.room.now
  if (!now) return
  s.finishNow(isMine(now.item) ? { score: myScore(s, now.item) } : undefined)
}

/** "曲を進める": the current song ends and the next one starts. */
export function advanceOne(api: NaviApi): void {
  if (api.getState().session.phase !== 'live') return
  finishCurrent(api)
  api.getState().startNext()
}

/** Finish my song if it is playing. */
export function finishMine(api: NaviApi, score?: number): boolean {
  const s = api.getState()
  const now = s.room.now
  if (!now || !isMine(now.item)) return false
  s.finishNow({ score: score ?? myScore(s, now.item) })
  return true
}

/** "あなたの番": my next reservation becomes NOW (reserving the top card's song if I have none). */
export function makeMyTurn(api: NaviApi): boolean {
  const s = api.getState()
  if (s.session.phase !== 'live') return false
  if (s.room.now && isMine(s.room.now.item)) return true
  let mine = s.room.queue.find(isMine)
  if (!mine) {
    const taken = takenSongs(s)
    const top = s.deck.cards.find(c => c.songId && SONG_BY_ID[c.songId]?.reservable && !taken.has(c.songId))
    const songId = top?.songId ?? OPENER_FALLBACK.find(id => SONG_BY_ID[id]?.reservable && !taken.has(id))
    if (!songId) return false
    mine = reserveAsMe(api, songId, { source: 'card' })?.item
    if (!mine) return false
  }
  if (api.getState().room.now) api.getState().finishNow()
  moveToFront(api, [mine.id])
  api.getState().startNext()
  return true
}

/** Finish my song; if it is not playing yet, give me the stage first and finish a beat later. */
export function finishMineOrTurn(api: NaviApi, score?: number): void {
  if (finishMine(api, score)) return
  if (makeMyTurn(api)) later(api, 900, () => finishMine(api, score))
}

/** Saki's slow pair (E-13 step 3): Lemon and Dry Flower, or other mellow songs if those are taken. */
function sakiMellow(api: NaviApi): void {
  const s = api.getState()
  if (s.session.phase !== 'live') return
  const taken = takenSongs(s)
  const wanted: SongId[] = ['lemon', 'dry-flower'].filter(id => SONG_BY_ID[id]?.reservable && !taken.has(id))
  for (const id of wanted) api.getState().reserve(id, { by: 'saki', source: 'member' })
  for (let k = wanted.length; k < 2; k++) {
    const id = pickMemberSong(api.getState(), 'saki', `script-mellow-${k}`, x => x.energy < 0.5)
    if (id) api.getState().reserve(id, { by: 'saki', source: 'member' })
  }
}

/**
 * "曲を2曲進める" (E-13 step 5): two slow roommate songs play back to back so the last two
 * finished songs are both under 0.5 energy → the dealer's mellow2 shift fires on the second.
 */
export function advanceTwo(api: NaviApi): void {
  const s = api.getState()
  if (s.session.phase !== 'live') return
  const pickPair = () => api.getState().room.queue.filter(q => !isMine(q) && isMellow(q.songId))
  if (pickPair().length < 2) sakiMellow(api)
  const pair = pickPair().slice(0, 2)
  if (pair.length < 2) {
    // nothing mellow to play: just move the room two songs on
    advanceOne(api)
    later(api, 1100, () => finishCurrent(api))
    return
  }
  finishCurrent(api)
  moveToFront(
    api,
    pair.map(p => p.id),
  )
  api.getState().startNext()
  later(api, 1100, () => {
    if (api.getState().room.now?.item.id === pair[0].id) api.getState().finishNow()
    api.getState().startNext()
    later(api, 1100, () => {
      if (api.getState().room.now?.item.id === pair[1].id) api.getState().finishNow()
    })
  })
}

// ---------------------------------------------------------------- the eleven steps

const step = (id: string, run: (api: NaviApi) => void): ScriptStep => ({ id, label: P.ref(`step.${id}` as Parameters<typeof P.ref>[0]), run })

export const SCRIPT: ScriptStep[] = [
  step('enter', api => {
    const s = api.getState()
    s.startNight({ seed: s.session.seed })
  }),
  step('minato-reserve', api => {
    const s = api.getState()
    if (s.session.phase !== 'live' || !s.room.members.minato.present) return
    const id = pickMemberSong(s, 'minato', 'script')
    if (id) s.reserve(id, { by: 'minato', source: 'member' })
  }),
  step('saki-mellow', sakiMellow),
  step('jun-join', api => {
    const s = api.getState()
    if (!s.room.members.jun.present) s.memberJoin('jun')
  }),
  step('advance-2', advanceTwo),
  step('my-turn', api => void makeMyTurn(api)),
  step('my-song-end', api => finishMineOrTurn(api)),
  step('request-saki', api => void sendRequest(api, true)),
  step('coaster', () => bus.emit({ type: 'presenter/cmd', cmd: { t: 'coaster' } })),
  step('minutes-15', api => {
    if (roomMinutesLeft(api.getState().session.simMs) > 15) api.getState().jumpToMinutesLeft(15)
  }),
  step('exit', api => api.getState().exitRoom()),
]

export const SCRIPT_IDS = SCRIPT.map(s => s.id)

/** Everything a member has in the room tonight (waiting, singing, sung). */
function itemsBy(s: NaviState, id: string): QueueItem[] {
  return [...s.room.queue, ...(s.room.now ? [s.room.now.item] : []), ...s.room.sung.map(e => e.item)].filter(q => q.by === id)
}

/** A step whose outcome is already on screen (the presenter did it by hand) is skipped. */
export function stepDone(s: NaviState, id: string): boolean {
  const now = s.room.now
  switch (id) {
    case 'minato-reserve':
      return itemsBy(s, 'minato').length > 0
    case 'saki-mellow':
      return itemsBy(s, 'saki').filter(q => isMellow(q.songId)).length >= 2
    case 'jun-join':
      return s.room.members.jun.present
    case 'my-turn':
      return !!now && isMine(now.item)
    case 'my-song-end':
      return !(now && isMine(now.item)) && !!s.room.sung.length && isMine(s.room.sung[s.room.sung.length - 1].item)
    case 'minutes-15':
      return roomMinutesLeft(s.session.simMs) <= 15
    case 'exit':
      return s.session.phase !== 'live'
    default:
      return false
  }
}

/** Index of the step "next" would run, or SCRIPT.length when the script is over. */
export function nextStepIndex(s: NaviState, pos: number): number {
  let i = Math.max(0, pos)
  while (i < SCRIPT.length && stepDone(s, SCRIPT[i].id)) i++
  return i
}

/** Run the next step. Returns its id, or null when the script is over. */
export function runNext(api: NaviApi): string | null {
  const i = nextStepIndex(api.getState(), useSim.getState().scriptPos)
  if (i >= SCRIPT.length) return null
  return runAt(api, i)
}

/**
 * The two quiet set-up steps (Minato's song after my first one, then Saki's slow pair) happen
 * as the room's own reaction in script mode, so the presenter's first → is Jun's arrival (T03,
 * SPEC N). They run only when they are exactly the next step; a → press beats them to it.
 */
export function autoStep(api: NaviApi, id: string): string | null {
  const s = api.getState()
  if (!s.session.script || s.session.phase !== 'live') return null
  const i = nextStepIndex(s, useSim.getState().scriptPos)
  if (SCRIPT[i]?.id !== id) return null
  return runAt(api, i)
}

/** Run a step by id (PresenterCmd `step`), moving the cursor after it. */
export function runStep(api: NaviApi, id: string): string | null {
  const i = SCRIPT.findIndex(x => x.id === id)
  return i < 0 ? null : runAt(api, i)
}

function runAt(api: NaviApi, i: number): string {
  const st = SCRIPT[i]
  // the cursor moves first: a step may start a new night (enter), which resets it
  useSim.setState({ scriptPos: i + 1, lastStep: { id: st.id, at: Date.now() } })
  st.run(api)
  if (st.id === 'enter') useSim.setState({ scriptPos: 1, lastStep: { id: st.id, at: Date.now() } })
  return st.id
}
