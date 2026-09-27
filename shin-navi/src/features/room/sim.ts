// Room-sim decisions (SPEC E-3…E-8): who reserves what, which of my songs Saki asks for, where
// a "twin star" hides, how each roommate votes, what I score. Pure functions of the store
// snapshot + the night's seed, so the same seed replays the same night. Also the small
// module-local UI state that the invite / finale bodies and the presenter panel read.
import { create } from 'zustand'
import type { NaviApi, NaviState } from '../../core/store/types'
import type { Member, MemberId, OtherId, QueueItem, SongId } from '../../core/types'
import { isMine, presentMembers } from '../../core/store'
import { roomMinutesLeft } from '../../core/rules'
import { SONGS, SONG_BY_ID, type Song } from '../../data/songs'
import { OPENER_FALLBACK } from '../../data/tables'
import { readRoom, type Person } from '../../engine/reading'
import { seeded } from '../../lib/rng'
import { modelKnows } from './knowModel'

// ---------------------------------------------------------------- module-local UI state

export type TwinState = { mine: boolean; them: 'wait' | 'yes' | 'no' }
export type DuetState = 'asking' | 'yes' | 'sent'
export type VoteFlight = { member: MemberId; songId: SongId; at: number }

export type SimUi = {
  nightId: string
  /** script steps done (step 1 `enter` is the night start itself) */
  scriptPos: number
  lastStep: { id: string; at: number } | null
  /** by card id */
  twin: Record<string, TwinState>
  duet: Record<string, DuetState>
  /** by prompt id: roommates' finale votes, shown on the lanterns as they arrive */
  votes: Record<string, VoteFlight[]>
  /** by prompt id: the lantern that won (flares before the room confirms it) */
  decided: Record<string, SongId>
}

export const freshSim = (nightId: string): SimUi => ({ nightId, scriptPos: 1, lastStep: null, twin: {}, duet: {}, votes: {}, decided: {} })
export const useSim = create<SimUi>(() => freshSim(''))

// ---------------------------------------------------------------- small helpers

/** Songs already in the room tonight (queue, now, sung): roommates never double-book. */
export function takenSongs(s: NaviState): Set<SongId> {
  const out = new Set<SongId>()
  for (const q of s.room.queue) out.add(q.songId)
  if (s.room.now) out.add(s.room.now.item.songId)
  for (const e of s.room.sung) out.add(e.item.songId)
  return out
}

export const queuedBy = (s: NaviState, id: MemberId): number => s.room.queue.filter(q => q.by === id).length
export const hasSongOf = (s: NaviState, id: MemberId): boolean => queuedBy(s, id) > 0 || s.room.now?.item.by === id
export const others = (s: NaviState): Member[] => presentMembers(s).filter(m => m.id !== 'me')
const person = (m: Member): Person => ({ id: m.id, generation: m.generation, likes: m.likes })

/** Sim ms the room leaves the opener slot to me before roommates start queueing (free play). */
export const OPENER_GRACE_MS = 60_000

/** Roommates reserve on their own only in free play, while the night is open and the finale is not fixed. */
export function membersMayReserve(s: NaviState): boolean {
  if (s.session.phase !== 'live' || s.session.script) return false
  if (s.room.queue.some(q => q.tags.includes('finale'))) return false
  if (roomMinutesLeft(s.session.simMs) <= 4) return false
  const mine = s.room.queue.some(isMine) || s.room.sung.some(e => isMine(e.item)) || (!!s.room.now && isMine(s.room.now.item))
  return mine || s.metrics.firstReserveMs != null || s.session.simMs >= OPENER_GRACE_MS
}

/** E-3 Minato: keeps the queue (NOW excluded) at 2 songs or more. */
export const minatoWants = (s: NaviState): boolean => s.room.members.minato.present && s.room.queue.length < 2 && queuedBy(s, 'minato') < 2
/** E-3 Jun: once he is here, he keeps one song of his own in the queue. */
export const junWants = (s: NaviState): boolean => s.room.members.jun.present && !hasSongOf(s, 'jun')
/** E-3 Saki: every second song, as long as she has fewer than two waiting. */
export const sakiWants = (s: NaviState): boolean => s.room.members.saki.present && queuedBy(s, 'saki') < 2

// ---------------------------------------------------------------- song choice (E-3)

/**
 * A roommate's next song: the room reading from their point of view (readRoom with their
 * likes), a personal flavour (Minato: hot songs that match the heat; Saki: under 0.6 energy;
 * Jun: songs known in Korean), plus a small seeded wobble. Never a song already in the room.
 */
export function pickMemberSong(s: NaviState, id: OtherId, salt: string | number, filter?: (x: Song) => boolean): SongId | null {
  const m = s.room.members[id]
  const seed = s.session.seed
  const taken = takenSongs(s)
  const pool = SONGS.filter(x => x.reservable && !taken.has(x.id) && (!filter || filter(x)))
  if (!pool.length) return null
  const history = [...s.room.sung.map(e => e.item.songId), ...(s.room.now ? [s.room.now.item.songId] : []), ...s.room.queue.map(q => q.songId)]
    .map(x => SONG_BY_ID[x])
    .filter((x): x is Song => !!x)
  const scored = readRoom(
    {
      me: person(m),
      room: presentMembers(s)
        .filter(p => p.id !== id)
        .map(person),
      history,
      minutesLeft: roomMinutesLeft(s.session.simMs),
      kept: new Set(),
      passed: new Set(),
    },
    pool,
  )
  const heat = s.room.heat
  let best: SongId | null = null
  let bestScore = -Infinity
  for (const x of scored) {
    const e = x.song.energy
    const like = m.likes[x.song.genre] ?? 0
    let f = 0
    if (id === 'minato') f = 1.5 * e - 1.1 * Math.abs(e - Math.max(0.75, heat + 0.15)) + 0.4 * like
    else if (id === 'saki') f = (e < 0.6 ? 0.8 : -0.7) + 0.7 * like
    else f = (x.song.inboundTitle.ko ? 0.5 : 0) + 0.7 * like
    const wobble = seeded(`${seed}|pick|${id}|${salt}|${x.song.id}`)() * 0.5
    const score = 0.6 * x.score + f + wobble
    if (score > bestScore) {
      bestScore = score
      best = x.song.id
    }
  }
  return best
}

/** Mellow songs for the script (Saki's slow pair). */
export const isMellow = (id: SongId): boolean => (SONG_BY_ID[id]?.energy ?? 1) < 0.5

// ---------------------------------------------------------------- Saki's request (E-6)

/** One of MY faces Saki would love to hear: her taste ≥ 0.5 or energy < 0.6. */
export function pickRequestSong(s: NaviState, force = false): SongId | null {
  const saki = s.room.members.saki
  const seed = s.session.seed
  const taken = takenSongs(s)
  const asked = new Set(s.room.invites.map(i => i.songId))
  const rank = { sketch: 1, neon: 2, mirror: 3, prism: 4 } as const
  let best: SongId | null = null
  let bestScore = -Infinity
  for (const f of Object.values(s.col.faces)) {
    const song = SONG_BY_ID[f.songId]
    if (!song || !song.reservable || taken.has(song.id) || asked.has(song.id)) continue
    const taste = saki.likes[song.genre] ?? 0
    if (!(taste >= 0.5 || song.energy < 0.6)) continue
    const sc = taste + (song.energy < 0.6 ? 0.3 : 0) + 0.05 * rank[f.state] + seeded(`${seed}|req|${song.id}`)() * 0.2
    if (sc > bestScore) {
      bestScore = sc
      best = song.id
    }
  }
  if (best || !force) return best
  // presenter / script: no face fits yet → a song Saki loves that the room has not used
  const fallback = ['marigold', 'pretender', 'hakujitsu', 'lemon', 'subtitle', ...OPENER_FALLBACK]
  return fallback.find(id => SONG_BY_ID[id]?.reservable && !taken.has(id) && !asked.has(id)) ?? null
}

// ---------------------------------------------------------------- twin star (E-7)

/** Does a roommate know this song? Their real answer if the room was asked, else the model. */
export function memberKnows(s: NaviState, m: Member, songId: SongId): boolean {
  const a = s.room.knowing[songId]?.answers[m.id]?.a
  if (a) return a === 'know'
  const song = SONG_BY_ID[songId]
  return !!song && modelKnows(s.session.seed, m, song)
}

/** Songs I know: a face on my ball, or "know" in the room's tally. */
export function songsIKnow(s: NaviState): SongId[] {
  const out = new Set<SongId>(Object.keys(s.col.faces))
  for (const t of Object.values(s.room.knowing)) if (t.answers.me?.a === 'know') out.add(t.songId)
  return [...out]
}

/**
 * A song only I and exactly one other present roommate know. Needs two or more roommates so
 * the partner stays anonymous. With `force` (presenter), falls back to any song exactly one
 * roommate knows (demo).
 */
export function findTwin(s: NaviState, force = false): { songId: SongId; partner: OtherId } | null {
  const room = others(s)
  if (room.length < 2) return null
  const seed = s.session.seed
  const taken = takenSongs(s)
  const used = new Set(s.room.invites.filter(i => i.variant === 'twin').map(i => i.songId))
  const scan = (ids: SongId[]) => {
    const cands: { songId: SongId; partner: OtherId; w: number }[] = []
    for (const id of ids) {
      const song = SONG_BY_ID[id]
      if (!song || !song.reservable || taken.has(id) || used.has(id)) continue
      const knowers = room.filter(m => memberKnows(s, m, id))
      if (knowers.length !== 1) continue
      const asked = s.room.knowing[id] ? 1 : 0
      cands.push({ songId: id, partner: knowers[0].id as OtherId, w: asked + seeded(`${seed}|twin|${id}`)() * 0.5 })
    }
    cands.sort((a, b) => b.w - a.w)
    return cands[0] ?? null
  }
  const mine = scan(songsIKnow(s))
  if (mine || !force) return mine ? { songId: mine.songId, partner: mine.partner } : null
  const any = scan(SONGS.map(x => x.id))
  return any ? { songId: any.songId, partner: any.partner } : null
}

// ---------------------------------------------------------------- finale vote (E-5)

/** Each roommate votes for the candidate their own taste likes best (seeded tie-break). */
export function finaleVote(seed: string, m: Pick<Member, 'id' | 'likes'>, options: SongId[]): SongId {
  let best = options[0]
  let bs = -Infinity
  for (const id of options) {
    const song = SONG_BY_ID[id]
    if (!song) continue
    const taste = m.likes[song.genre] ?? 0.2
    const lean = m.id === 'saki' && song.energy < 0.6 ? 0.1 : m.id === 'minato' ? 0.1 * song.energy : 0
    const sc = taste + lean + seeded(`${seed}|vote|${m.id}|${id}`)() * 0.08
    if (sc > bs) {
      bs = sc
      best = id
    }
  }
  return best
}

/** Same winner rule as the store (most votes, ties to the earlier candidate). */
export function finaleWinner(options: SongId[], votes: Partial<Record<MemberId, SongId>>): SongId {
  const tally = new Map<SongId, number>()
  for (const v of Object.values(votes)) if (v) tally.set(v, (tally.get(v) ?? 0) + 1)
  return [...options].sort((a, b) => (tally.get(b) ?? 0) - (tally.get(a) ?? 0))[0]
}

// ---------------------------------------------------------------- score (E-4)

/** Demo score 78–96, seeded by the night, the song and how many songs I have sung. */
export function scoreFor(seed: string, songId: SongId, n: number): number {
  return 78 + Math.floor(seeded(`${seed}|score|${songId}|${n}`)() * 19)
}

export function myScore(s: NaviState, item: QueueItem): number {
  return scoreFor(s.session.seed, item.songId, s.room.sung.filter(e => isMine(e.item)).length)
}

// ---------------------------------------------------------------- invites the room sends

/** Saki sends a request for one of my songs (E-6). Returns the invite id. */
export function sendRequest(api: NaviApi, force = false): string | null {
  const s = api.getState()
  if (s.session.phase !== 'live' || !s.room.members.saki.present) return null
  const songId = pickRequestSong(s, force)
  if (!songId) return null
  return s.openInvite({ variant: 'request', from: 'saki', songId })
}

/** A twin star appears (E-7). Returns the invite id. */
export function sendTwin(api: NaviApi, force = false): string | null {
  const s = api.getState()
  if (s.session.phase !== 'live') return null
  const t = findTwin(s, force)
  if (!t) return null
  return s.openInvite({ variant: 'twin', from: t.partner, songId: t.songId })
}
