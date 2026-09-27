// Script mode (SPEC E-13): the demo's big events happen only on "next" (→ key / pp-next), in
// this order. Each step builds exactly the state the 3-minute demo (SPEC N) needs; steps that
// the presenter already caused by hand are skipped so a → press is never wasted, and the room's
// two quiet set-up steps run on their own (a → press that finds them pending runs them silently
// and goes on to the next visible step). The room never jumps the queue: songs ahead of the
// target are played through in order, a few hundred ms each.
//
// The → presses (QA DEMO#1): jun-join (beat 5) · advance-2 (beat 6) · my-turn (beat 7) ·
// my-song-end (beat 7, skipped when 歌い終わった was tapped) · coaster (beat 8) · exit (beat 10).
// Saki's request and "15 minutes left" are presenter-panel buttons, not → steps.
import type { NaviApi, NaviState } from '../../core/store/types'
import type { Locale, QueueItem, SongId, TextRef } from '../../core/types'
import { isMine } from '../../core/store'
import { reserveAsMe } from '../../core/actions'
import { after } from '../../core/clock'
import { bus } from '../../core/events'
import { SONG_BY_ID } from '../../data/songs'
import { OPENER_FALLBACK } from '../../data/tables'
import { getLocale, setLocale } from '../../i18n'
import { P } from './strings'
import { isMellow, myScore, pickMemberSong, takenSongs, useSim } from './sim'

export type ScriptStep = {
  id: string
  label: TextRef
  /** the room's own quiet set-up: never a → press of its own */
  auto?: boolean
  run(api: NaviApi): void
}

/** Real ms a song ahead of the target is on stage while the room plays through (pacing). */
export const PASS_MS = 320
/** Real ms each of Saki's slow pair is on stage (long enough to read on the room screen). */
export const PAIR_MS = 1100

/** Real milliseconds → sim milliseconds at the current speed (pacing that looks the same at 1×/4×/8×). */
const simOf = (api: NaviApi, realMs: number) => realMs * api.getState().session.speed

/** Only while the same night is live. Returns a cancel function. */
function later(api: NaviApi, realMs: number, fn: () => void): () => void {
  const night = api.getState().session.nightId
  return after(simOf(api, realMs), () => {
    const s = api.getState()
    if (s.session.nightId !== night || s.session.phase !== 'live') return
    fn()
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

/**
 * In script mode the voice card belongs to the song the presenter gives me in beat 7. When the
 * room plays one of my earlier songs through (the opener in advance-2), the director's
 * 「今夜の声」 card for it is held back, so the shift card of beat 6 is the one on top.
 */
function holdVoiceCard(api: NaviApi): void {
  const s0 = api.getState()
  const before = new Set(s0.deck.cards.map(c => c.id))
  // the card on top keeps its button and its side when it comes back on top (as the director
  // does when a re-deal leaves the top card in place)
  const prevTop = s0.deck.cards[0]?.id
  const { primary, flippedId } = s0.deck
  const mineSung = (s: NaviState) => s.room.sung.filter(e => isMine(e.item)).length
  const n = mineSung(s0)
  const drop = () => {
    const s = api.getState()
    // only the card for this song: once another song of mine has ended, its card stays
    if (mineSung(s) !== n + 1) return
    const held = s.deck.cards.filter(c => c.kind === 'voice' && !before.has(c.id) && c.rule.startsWith('insert.voice'))
    if (!held.length) return
    for (const c of held) api.getState().dropCard(c.id)
    const st = api.getState()
    if (!prevTop || st.deck.cards[0]?.id !== prevTop) return
    if (primary) st.setPrimary(primary)
    if (flippedId === prevTop && st.deck.flippedId !== prevTop) st.flip(prevTop)
  }
  // the director deals in a microtask after song/ended; drop right after it, and once more later
  queueMicrotask(() => queueMicrotask(drop))
  setTimeout(drop, 0)
}

// ---------------------------------------------------------------- playing through in order (no queue jumps)

type Chain = { flush(): void }
let chain: Chain | null = null

/** Settle a play-through still running (a new step or command never races it). */
export function settleChain(): void {
  const c = chain
  chain = null
  c?.flush()
}

type PlayOpts = {
  /** queue item id the chain is heading for */
  target: string
  /** 'reach': stop once the target is on stage; 'through': stop once it has ended */
  mode: 'reach' | 'through'
  /** real ms each song stays on stage before the chain moves on */
  pace(item: QueueItem): number
  /** called just before a song is finished by the chain */
  onFinish?(item: QueueItem): void
  onDone?(reached: boolean): void
}

/**
 * Play the room's songs in queue order until the target: what is on stage ends, then every song
 * ahead starts and ends in turn (never moved, never skipped).
 */
function playInOrder(api: NaviApi, o: PlayOpts): void {
  settleChain()
  const night = api.getState().session.nightId
  let cancel: (() => void) | null = null
  let over = false
  let reached = false
  /** one move; false when the chain is over */
  const move = (): boolean => {
    const s = api.getState()
    if (s.session.nightId !== night || s.session.phase !== 'live') return false
    const now = s.room.now
    if (now) {
      if (now.item.id === o.target && o.mode === 'reach') {
        reached = true
        return false
      }
      o.onFinish?.(now.item)
      finishCurrent(api)
      if (now.item.id === o.target) {
        reached = true
        return false
      }
    }
    const st = api.getState()
    if (st.session.phase !== 'live' || !st.room.queue.some(q => q.id === o.target)) return false
    st.startNext()
    const head = api.getState().room.now?.item
    if (!head) return false
    if (head.id === o.target && o.mode === 'reach') {
      reached = true
      return false
    }
    return true
  }
  const done = () => {
    if (over) return
    over = true
    cancel?.()
    cancel = null
    if (chain === me) chain = null
    o.onDone?.(reached)
  }
  const loop = () => {
    cancel = null
    if (over) return
    if (!move()) return done()
    const cur = api.getState().room.now?.item
    if (!cur) return done()
    cancel = later(api, o.pace(cur), loop)
  }
  const me: Chain = {
    flush() {
      cancel?.()
      cancel = null
      let guard = 0
      while (!over && guard++ < 40 && move()) {
        /* play through at once */
      }
      done()
    },
  }
  chain = me
  loop()
}

// ---------------------------------------------------------------- "曲を進める", "あなたの番", "歌い終わる"

/** "曲を進める": the current song ends and the next one starts. */
export function advanceOne(api: NaviApi): void {
  if (api.getState().session.phase !== 'live') return
  settleChain()
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

/** Songs I brought or kept for myself: never put on the shared screen by the presenter (E-12). */
function privateSongs(s: NaviState): Set<SongId> {
  return new Set<SongId>([...s.col.imports.map(i => i.songId), ...s.col.saved.map(x => x.songId)])
}

/**
 * The song "あなたの番" reserves when I have nothing waiting (QA POLICY#1): only a public song
 * card of the hand (kind 'song': opener, visa, discoveries), never an import candidate, an
 * invite, a voice or link card, nor anything from my imports or saved songs; else the fallback.
 */
export function pickMyTurnSong(s: NaviState): SongId | null {
  const taken = takenSongs(s)
  const mine = privateSongs(s)
  const ok = (id: SongId | undefined): id is SongId => !!id && !!SONG_BY_ID[id]?.reservable && !taken.has(id) && !mine.has(id)
  const card = s.deck.cards.find(c => c.kind === 'song' && ok(c.songId))
  return card?.songId ?? OPENER_FALLBACK.find(id => ok(id)) ?? null
}

/**
 * "あなたの番": my next reservation becomes NOW (reserving a public song card if I have none).
 * The songs ahead of it are played through in order, a few hundred ms each (no queue jump).
 * `onStage` runs once my song is on stage (at once when it already is).
 */
export function makeMyTurn(api: NaviApi, onStage?: () => void): boolean {
  const s = api.getState()
  if (s.session.phase !== 'live') return false
  settleChain()
  if (s.room.now && isMine(s.room.now.item)) {
    onStage?.()
    return true
  }
  let mine = s.room.queue.find(isMine)
  if (!mine) {
    const songId = pickMyTurnSong(s)
    if (!songId) return false
    mine = reserveAsMe(api, songId, { source: 'card' })?.item
    if (!mine) return false
  }
  playInOrder(api, {
    target: mine.id,
    mode: 'reach',
    pace: () => PASS_MS,
    onDone: reached => {
      if (reached) onStage?.()
    },
  })
  return true
}

/** Finish my song; if it is not playing yet, give me the stage first and finish a beat later. */
export function finishMineOrTurn(api: NaviApi, score?: number): void {
  settleChain()
  if (finishMine(api, score)) return
  makeMyTurn(api, () => {
    later(api, 900, () => finishMine(api, score))
  })
}

// ---------------------------------------------------------------- Saki's slow pair and advance-2

/** Saki's slow pair (E-13): Lemon and Dry Flower, or other mellow songs if those are taken. */
function sakiMellow(api: NaviApi, n = 2): void {
  const s = api.getState()
  if (s.session.phase !== 'live') return
  const taken = takenSongs(s)
  const wanted: SongId[] = ['lemon', 'dry-flower'].filter(id => SONG_BY_ID[id]?.reservable && !taken.has(id)).slice(0, n)
  for (const id of wanted) api.getState().reserve(id, { by: 'saki', source: 'member' })
  for (let k = wanted.length; k < n; k++) {
    const id = pickMemberSong(api.getState(), 'saki', `script-mellow-${k}`, x => x.energy < 0.5)
    if (id) api.getState().reserve(id, { by: 'saki', source: 'member' })
  }
}

const mellowOther = (q: QueueItem) => !isMine(q) && isMellow(q.songId)

/**
 * "曲を2曲進める" (E-13, beat 6): what is on stage ends first (the opener: its mirror face, melody
 * note and wall point), then the room plays on in queue order until two slow roommate songs have
 * ended back to back, so the dealer's mellow2 shift card is dealt on the second.
 */
export function advanceTwo(api: NaviApi): void {
  const s = api.getState()
  if (s.session.phase !== 'live') return
  settleChain()
  const script = s.session.script
  const hold = (item: QueueItem) => {
    if (script && isMine(item)) holdVoiceCard(api)
  }
  // a slow song already on stage counts as the first of the pair
  const onStage = s.room.now?.item
  const need = onStage && mellowOther(onStage) ? 1 : 2
  let pair = s.room.queue.filter(mellowOther)
  if (pair.length < need) {
    sakiMellow(api, need - pair.length)
    pair = api.getState().room.queue.filter(mellowOther)
  }
  if (pair.length < need) {
    // nothing slow left to play: just move the room two songs on
    const q = api.getState().room.queue
    const target = q[Math.min(q.length, onStage ? 1 : 2) - 1]
    if (!target) {
      if (onStage) hold(onStage)
      finishCurrent(api)
      return
    }
    playInOrder(api, { target: target.id, mode: 'through', pace: () => PASS_MS, onFinish: hold })
    return
  }
  const pairIds = new Set([...(need === 1 && onStage ? [onStage.id] : []), ...pair.slice(0, need).map(p => p.id)])
  const last = pair[need - 1]
  playInOrder(api, {
    target: last.id,
    mode: 'through',
    pace: item => (pairIds.has(item.id) ? PAIR_MS : PASS_MS),
    onFinish: hold,
  })
}

// ---------------------------------------------------------------- the language the demo is told in

/** The locale at the night's start (step `enter`) and at the first → press. */
export function homeLocale(): Locale | null {
  return useSim.getState().homeLocale
}

function noteHome(first: boolean): void {
  if (first || !useSim.getState().homeLocale) useSim.setState({ homeLocale: getLocale() })
}

/** Beat 10: the wrap and the lens come back in the language the demo was told in (QA DEMO#5). */
export function restoreHome(): void {
  const home = useSim.getState().homeLocale
  if (home && home !== getLocale()) setLocale(home)
}

// ---------------------------------------------------------------- the steps

const step = (id: string, run: (api: NaviApi) => void, auto = false): ScriptStep => ({
  id,
  label: P.ref(`step.${id}` as Parameters<typeof P.ref>[0]),
  ...(auto ? { auto } : {}),
  run,
})

export const SCRIPT: ScriptStep[] = [
  step('enter', api => {
    const s = api.getState()
    s.startNight({ seed: s.session.seed })
  }),
  // the room's own reaction to my first song: Saki's slow pair first, so advance-2 plays on
  // in queue order, then Minato's song
  step('saki-mellow', api => sakiMellow(api), true),
  step(
    'minato-reserve',
    api => {
      const s = api.getState()
      if (s.session.phase !== 'live' || !s.room.members.minato.present) return
      const id = pickMemberSong(s, 'minato', 'script')
      if (id) s.reserve(id, { by: 'minato', source: 'member' })
    },
    true,
  ),
  step('jun-join', api => {
    const s = api.getState()
    if (!s.room.members.jun.present) s.memberJoin('jun')
  }),
  step('advance-2', advanceTwo),
  step('my-turn', api => void makeMyTurn(api)),
  step('my-song-end', api => finishMineOrTurn(api)),
  step('coaster', () => bus.emit({ type: 'presenter/cmd', cmd: { t: 'coaster' } })),
  step('exit', api => {
    restoreHome()
    api.getState().exitRoom()
  }),
]

export const SCRIPT_IDS = SCRIPT.map(s => s.id)
/** The steps a → press lands on (the presenter's count per beat). */
export const PRESS_IDS = SCRIPT.filter(s => s.id !== 'enter' && !s.auto).map(s => s.id)

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
    case 'exit':
      return s.session.phase !== 'live'
    default:
      return false
  }
}

/** Index of the next step not already on screen (auto steps included), or SCRIPT.length. */
export function nextStepIndex(s: NaviState, pos: number): number {
  let i = Math.max(0, pos)
  while (i < SCRIPT.length && stepDone(s, SCRIPT[i].id)) i++
  return i
}

/** Index of the step the next → press shows (auto steps pass silently), or SCRIPT.length. */
export function nextPressIndex(s: NaviState, pos: number): number {
  let i = nextStepIndex(s, pos)
  while (i < SCRIPT.length && SCRIPT[i].auto) i = nextStepIndex(s, i + 1)
  return i
}

/**
 * Run the next → step: pending quiet set-up steps run first without a press of their own, so
 * every press shows its own result. Returns the id of the visible step, or null when over.
 */
export function runNext(api: NaviApi): string | null {
  settleChain()
  const firstPress = useSim.getState().presses === 0
  let i = nextStepIndex(api.getState(), useSim.getState().scriptPos)
  while (i < SCRIPT.length && SCRIPT[i].auto) {
    runAt(api, i)
    i = nextStepIndex(api.getState(), useSim.getState().scriptPos)
  }
  if (i >= SCRIPT.length) return null
  if (SCRIPT[i].id !== 'exit') noteHome(firstPress)
  useSim.setState(u => ({ presses: u.presses + 1 }))
  return runAt(api, i)
}

/**
 * The two quiet set-up steps (Saki's slow pair after my first song, then Minato's) happen as
 * the room's own reaction in script mode, so the presenter's first → is Jun's arrival (T03,
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
  if (i < 0) return null
  settleChain()
  return runAt(api, i)
}

function runAt(api: NaviApi, i: number): string {
  const st = SCRIPT[i]
  // the cursor moves first: a step may start a new night (enter), which resets it
  useSim.setState({ scriptPos: i + 1, lastStep: { id: st.id, at: Date.now() } })
  st.run(api)
  if (st.id === 'enter') useSim.setState({ scriptPos: 1, lastStep: { id: st.id, at: Date.now() } })
  return st.id
}
