// Song selection for the dealer (SPEC C-9). Pure: everything is derived from the DirectorInput.
// readRoom() (engine/reading.ts) reads who is here and the flow of the night; on top of it we add
// the air mixer (hype → target energy, fresh → known vs new, companion → vibe tags) and the
// room's real "知ってる" answers. Ties are broken by the night's seed.
import type { Genre, Locale, Member, MemberId, OtherId, Reason, Song, SongId, TextRef, Vibe, VoiceTypeId } from '../../core/types'
import { SONG_BY_ID } from '../../data/songs'
import { OPENER_FALLBACK } from '../../data/tables'
import { isSleeping, knowView, pKnow, SIM_MS_PER_ROOM_MIN } from '../../core/rules'
import { readRoom, rangeFit, songsForVoice, targetEnergy, type MoodWeight, type Person, type ReadContext, type Scored } from '../../engine/reading'
import { hashString, mulberry32 } from '../../lib/rng'
import type { DirectorInput } from './deal'

/** The mixer weighs in at 0.5 for 20 room-minutes after it was touched, otherwise 0.2 (C-9). */
export const MIXER_RECENT_MS = 20 * SIM_MS_PER_ROOM_MIN

export function moodWeightOf(input: DirectorInput): MoodWeight {
  const m = input.room.mood
  const recent = m.setBy === 'mixer' && input.trigger.at - m.setAt < MIXER_RECENT_MS
  return { hype: m.hype, fresh: m.fresh, companion: m.companion, weight: recent ? 0.5 : 0.2 }
}

const others = (input: DirectorInput): Member[] => input.room.present.filter(m => m.id !== 'me')

/** "me" has no declared taste: it is learned from the faces on my ball (SPEC E-1). */
function myPerson(input: DirectorInput): Person {
  const counts = new Map<Genre, number>()
  for (const id of Object.keys(input.me.faces)) {
    const g = SONG_BY_ID[id]?.genre
    if (g) counts.set(g, (counts.get(g) ?? 0) + 1)
  }
  const max = Math.max(1, ...counts.values())
  const likes: Person['likes'] = {}
  for (const [g, n] of counts) likes[g] = 0.3 + 0.6 * (n / max)
  const me = input.room.present.find(m => m.id === 'me')
  return { id: 'me', generation: me?.generation ?? 20, likes }
}

/** Songs already sung, playing or queued tonight, oldest first (the reading's "history"). */
export function nightHistory(input: DirectorInput): Song[] {
  const ids = [...input.room.sung.map(e => e.item.songId), ...(input.room.now ? [input.room.now.item.songId] : []), ...input.room.queue.map(q => q.songId)]
  return ids.map(id => SONG_BY_ID[id]).filter((s): s is Song => !!s)
}

const TRENDING = new Set(
  Object.values(SONG_BY_ID)
    .filter(s => s.trending)
    .map(s => s.id),
)

export function readingContext(input: DirectorInput, passed: Set<SongId>): ReadContext {
  return {
    me: myPerson(input),
    room: others(input).map(m => ({ id: m.id, generation: m.generation, likes: m.likes })),
    history: nightHistory(input),
    minutesLeft: input.room.minutesLeft,
    kept: new Set(Object.keys(input.me.faces)),
    passed,
    myRange: input.me.voice?.range ?? null,
    trending: TRENDING,
    mood: moodWeightOf(input),
  }
}

/** Current target energy: the flow of the night blended with the mixer. */
export function targetFor(input: DirectorInput): number {
  const w = moodWeightOf(input)
  const t = targetEnergy(nightHistory(input), input.room.minutesLeft)
  return t * (1 - w.weight) + w.hype * w.weight
}

const cache = new WeakMap<DirectorInput, Map<string, Scored[]>>()

/** readRoom() over the reservable songs, memoised per input (the dealer asks several times). */
export function ranked(input: DirectorInput, passed: Set<SongId>): Scored[] {
  let m = cache.get(input)
  if (!m) cache.set(input, (m = new Map()))
  const key = [...passed].sort().join(',')
  const hit = m.get(key)
  if (hit) return hit
  const pool = input.songs.filter(s => s.reservable)
  const out = readRoom(readingContext(input, passed), pool)
  m.set(key, out)
  return out
}

/** Expected share of the present people who know a song (E-2 model, never shown as a number). */
export function expectedShare(present: Member[], song: Song): number {
  if (!present.length) return 0
  return present.reduce((a, m) => a + (m.id === 'me' ? song.knownRate[m.generation] / 100 : pKnow(m, song)), 0) / present.length
}

/** Deterministic tie-break jitter from the night's seed. */
export function jitter(seed: string, key: string, amp = 0.05): number {
  return mulberry32(hashString(`${seed}|dealer|${key}`))() * amp
}

type Pick = (s: Song) => number
function best(input: DirectorInput, exclude: Set<SongId>, passed: Set<SongId>, score: Pick, salt: string, filter?: (s: Song) => boolean, variety = 0.05): Song | null {
  let top: Song | null = null
  let topV = -Infinity
  for (const r of ranked(input, passed)) {
    const s = r.song
    if (exclude.has(s.id) || (filter && !filter(s))) continue
    const v = r.score * 0.35 + score(s) + jitter(input.seed, `${salt}|${s.id}`, variety)
    if (v > topV) {
      topV = v
      top = s
    }
  }
  return top
}

function fallback(exclude: Set<SongId>): Song | null {
  for (const id of OPENER_FALLBACK) if (!exclude.has(id) && SONG_BY_ID[id]?.reservable) return SONG_BY_ID[id]
  return null
}

// ---------------------------------------------------------------- purposes

/** 口火の1曲: lifts the room, everyone present is likely to know it, "1曲目向き" helps. */
export function pickOpener(input: DirectorInput, exclude: Set<SongId>, passed: Set<SongId>): Song | null {
  const present = input.room.present
  const target = targetFor(input)
  const opener = new Set<string>(OPENER_FALLBACK)
  return (
    best(
      input,
      exclude,
      passed,
      s => {
        const minKnow = Math.min(...others(input).map(m => pKnow(m, s)), 1)
        return (
          expectedShare(present, s) * 1.4 +
          minKnow * 1.2 +
          (1 - Math.abs(s.energy - target)) * 0.8 +
          (s.tags.hypothesis.includes('1曲目向き') ? 0.35 : 0) +
          (opener.has(s.id) ? 0.25 : 0)
        )
      },
      'opener',
      undefined,
      // every night opens differently among the songs that fit the room almost equally well
      0.35,
    ) ?? fallback(exclude)
  )
}

/** Everyone present answered "知ってる" (real answers, not an estimate). */
export function allKnow(input: DirectorInput, songId: SongId): boolean {
  const t = input.room.knowing[songId]
  return !!t && knowView(t, input.room.present.map(m => m.id)).all
}

/**
 * A plain "now" song: the reading plus a little seeded variety. Songs the whole room said it
 * knows, and songs I kept earlier tonight, are favoured: the answers change what comes next.
 */
export function pickSong(input: DirectorInput, exclude: Set<SongId>, passed: Set<SongId>, salt: string): Song | null {
  return best(input, exclude, passed, s => (allKnow(input, s.id) ? 0.7 : 0) + (input.me.faces[s.id]?.state === 'sketch' ? 0.25 : 0), `song|${salt}`) ?? fallback(exclude)
}

/** 越境: a Japanese song with a local title in `target`'s script, loved there (E-2 aware). */
export function pickVisa(input: DirectorInput, exclude: Set<SongId>, passed: Set<SongId>, target: Locale, forMember: Member | null, salt: string): Song | null {
  const present = input.room.present
  const key = target === 'ja' ? 'ko' : target
  return best(
    input,
    exclude,
    passed,
    s => (forMember ? pKnow(forMember, s) * 1.6 : 0) + expectedShare(present, s) * 0.8 + (s.lang === 'ja' ? 0.3 : -1) + s.knownRate[20] / 200,
    `visa|${target}|${salt}`,
    s => s.lang === 'ja' && !!s.inboundTitle[key as 'en' | 'zhHant' | 'zhHans' | 'ko'],
  )
}

/** 知ってる？: a kept song not asked yet, or a mid-awareness song worth asking (0.4–0.8). */
export function pickAsk(input: DirectorInput, exclude: Set<SongId>, passed: Set<SongId>, welcome: Member | null): Song | null {
  const asked = new Set(Object.keys(input.room.knowing))
  const kept = Object.values(input.me.faces)
    .filter(f => f.state === 'sketch' && !asked.has(f.songId) && !exclude.has(f.songId) && SONG_BY_ID[f.songId]?.reservable)
    .sort((a, b) => b.firstAt - a.firstAt)
  if (!welcome && kept.length) return SONG_BY_ID[kept[0].songId]
  const present = input.room.present
  return best(
    input,
    new Set([...exclude, ...asked]),
    passed,
    s => {
      if (welcome) return pKnow(welcome, s) * 1.8 + expectedShare(present, s) * 0.6
      const aware = expectedShare(present, s)
      return aware >= 0.4 && aware <= 0.8 ? 1.2 - Math.abs(aware - 0.6) : 0
    },
    welcome ? `welcome|${welcome.id}` : 'ask',
  )
}

/** Songs the room surely knows: the real answers first, then the E-2 estimate. */
function knownScore(input: DirectorInput, s: Song): number {
  const t = input.room.knowing[s.id]
  const ids = input.room.present.map(m => m.id)
  if (t) {
    const v = knowView(t, ids)
    if (v.size) return (v.knows / v.size) * 1.2 + (v.all ? 0.4 : 0)
  }
  return expectedShare(input.room.present, s)
}

/** 取り返しの1曲: after a misread, the song most people know (E-11). */
export function pickRecover(input: DirectorInput, exclude: Set<SongId>, passed: Set<SongId>): Song | null {
  return best(input, exclude, passed, s => knownScore(input, s) * 2 + s.energy * 0.4, 'recover') ?? fallback(exclude)
}

export type ShiftCause = 'mellow2' | 'peak3' | 'mixed'

/**
 * 空気の変わり目: two candidates — ride the flow (close to the recent energy) and change it
 * (towards what the room needs). Returns [ride, change] and the navi's pick.
 */
export function pickShift(input: DirectorInput, exclude: Set<SongId>, passed: Set<SongId>, cause: ShiftCause): { ride: Song; change: Song; pick: SongId } | null {
  const recent = input.room.sung.slice(-2).map(e => SONG_BY_ID[e.item.songId]?.energy ?? 0.5)
  const avg = recent.length ? recent.reduce((a, b) => a + b, 0) / recent.length : 0.5
  const hype = input.room.mood.hype
  const changeTo = cause === 'mellow2' ? 0.88 : cause === 'peak3' ? 0.5 : hype
  const ride = best(input, exclude, passed, s => (1 - Math.abs(s.energy - avg)) * 1.6 + knownScore(input, s), 'shift|ride')
  if (!ride) return null
  const change = best(input, new Set([...exclude, ride.id]), passed, s => (1 - Math.abs(s.energy - changeTo)) * 2 + knownScore(input, s) * 1.2, 'shift|change')
  if (!change) return null
  const pick = cause === 'mixed' ? (Math.abs(ride.energy - hype) < Math.abs(change.energy - hype) ? ride.id : change.id) : change.id
  return { ride, change, pick }
}

/** 締めの1曲: three candidates from tonight's shared songs and heat (C-8 ⑩). */
export function pickFinale(input: DirectorInput, exclude: Set<SongId>, passed: Set<SongId>): Song[] {
  const out: Song[] = []
  const ex = new Set(exclude)
  // songs everyone knew tonight (from real answers) that have not been sung yet
  const sung = new Set(input.room.sung.map(e => e.item.songId))
  const ids = input.room.present.map(m => m.id)
  const shared = Object.values(input.room.knowing)
    .filter(t => knowView(t, ids).all && !ex.has(t.songId) && !sung.has(t.songId) && SONG_BY_ID[t.songId]?.reservable)
    .map(t => SONG_BY_ID[t.songId])
    .sort((a, b) => b.energy - a.energy)
  if (shared[0]) {
    out.push(shared[0])
    ex.add(shared[0].id)
  }
  for (let i = out.length; i < 3; i++) {
    const s = best(
      input,
      ex,
      passed,
      x => knownScore(input, x) * 1.6 + x.energy * 0.9 + (x.tags.hypothesis.includes('ラスト向き') ? 0.5 : 0) + (x.tags.hypothesis.includes('みんなで') ? 0.25 : 0),
      `finale|${i}`,
    )
    if (!s) break
    out.push(s)
    ex.add(s.id)
  }
  return out
}

/** つながる: three songs picked together with `center` (curated co-occurrence first). */
export function pickLinkOptions(input: DirectorInput, center: SongId, exclude: Set<SongId>, passed: Set<SongId>): SongId[] {
  const base = SONG_BY_ID[center]
  if (!base) return []
  const ok = (id: string) => id !== center && !exclude.has(id) && !passed.has(id) && !!SONG_BY_ID[id]?.reservable
  const out = base.coOccurrence.filter(ok).slice(0, 3)
  if (out.length < 3) {
    // widen with the songs co-picked with the co-picked songs (still "一緒に選ばれている", never tags),
    // the ones this room is likelier to know first
    const second = new Set<string>()
    for (const id of base.coOccurrence) for (const j of SONG_BY_ID[id]?.coOccurrence ?? []) if (ok(j) && !out.includes(j)) second.add(j)
    const room = input.room.present
    out.push(...[...second].sort((a, b) => expectedShare(room, SONG_BY_ID[b]) - expectedShare(room, SONG_BY_ID[a]) || (a < b ? -1 : 1)).slice(0, 3 - out.length))
  }
  return out.slice(0, 3)
}

/** サキからのリクエスト (E-6): one of my faces Saki likes (≥0.5) or that is calm (< 0.6). */
export function pickRequest(input: DirectorInput, from: Member, exclude: Set<SongId>): Song | null {
  const cand = Object.values(input.me.faces)
    .map(f => SONG_BY_ID[f.songId])
    .filter((s): s is Song => !!s && s.reservable && !exclude.has(s.id))
    .filter(s => (from.likes[s.genre] ?? 0) >= 0.5 || s.energy < 0.6)
    .sort((a, b) => (from.likes[b.genre] ?? 0) - (from.likes[a.genre] ?? 0) || jitter(input.seed, `req|${b.id}`) - jitter(input.seed, `req|${a.id}`))
  // prefer faces that are only kept (not yet reserved) so the request brings something new
  const kept = cand.filter(s => input.me.faces[s.id]?.state === 'sketch')
  return kept[0] ?? cand[0] ?? null
}

/** 声の相性: a duet-friendly song for me and `with` (C-8 ⑦ duet). */
export function pickDuetSong(input: DirectorInput, exclude: Set<SongId>, passed: Set<SongId>, mine: VoiceTypeId): Song | null {
  const fits = new Set(songsForVoice(mine, input.me.voice?.range ?? null, 12).map(s => s.id))
  return best(input, exclude, passed, s => (s.tags.hypothesis.includes('デュエット') ? 1.4 : 0) + (fits.has(s.id) ? 0.4 : 0) + expectedShare(input.room.present, s) * 0.5, 'duet')
}

/** Representative songs of a dark area (for the gap card preview). */
export function areaSongs(input: DirectorInput, tempo: Song['tempo'], genre: Genre, n = 3): SongId[] {
  return input.songs
    .filter(s => s.tempo === tempo && s.genre === genre && s.reservable)
    .sort((a, b) => b.knownRate[20] - a.knownRate[20])
    .slice(0, n)
    .map(s => s.id)
}

// ---------------------------------------------------------------- reasons

const HIGH_VIBES: Vibe[] = ['盛り上がる', 'ノれる', '叫べる', 'みんなで', 'かっこいい', '1曲目向き']
const LOW_VIBES: Vibe[] = ['しっとり', 'エモい', '泣ける', '懐かしい', 'デュエット']

const ref = (key: string, vars?: TextRef['vars']): TextRef => (vars ? { key, vars } : { key })

/**
 * Why this song, in one line (reason.* only). Facts come from real data: the room's answers,
 * my faces, co-occurrence, trending (sample data); otherwise the flow of the night.
 * `avoid` keeps two song cards in a row from giving the same kind of reason.
 */
export function songReason(input: DirectorInput, s: Song, avoid?: string): Reason {
  const cands: Reason[] = []
  const ids = input.room.present.map(m => m.id)
  const tally = input.room.knowing[s.id]
  if (tally) {
    const v = knowView(tally, ids)
    if (v.all && v.size >= 2) cands.push({ source: 'dare', text: ref('reason.allKnow', { n: v.size }) })
    else if (v.knows >= 2) cands.push({ source: 'dare', text: ref('reason.mostKnow', { n: v.size, k: Math.floor(v.knows) }) })
  }
  const face = input.me.faces[s.id]
  const now = input.now
  if (face && (isSleeping(face, now) || face.polishedAt != null)) cands.push({ source: 'ren', text: ref('reason.reunion', { date: { date: face.polishedAt ?? face.lastSungAt ?? face.firstAt } }) })
  if (input.me.saved.some(x => x.songId === s.id)) cands.push({ source: 'ren', text: ref('reason.brought') })
  const lastMine = lastMineSong(input)
  if (lastMine && lastMine !== s.id && SONG_BY_ID[lastMine]?.coOccurrence.includes(s.id)) cands.push({ source: 'tsunagu', text: ref('reason.co', { song: { song: lastMine } }) })
  if (input.me.voice?.range && rangeFit(s, input.me.voice.range).fit > 0.85) cands.push({ source: 'voice', text: ref('reason.voiceFit') })
  if (s.trending) cands.push({ source: 'yomu', text: ref('reason.trend') })
  cands.push({ source: 'yomu', text: ref('reason.flow', { vibe: { vibe: vibeFor(input, s) } }) })
  const pick = cands.find(c => c.text.key !== avoid) ?? cands[0]
  return pick
}

/** The hypothesis tag that best explains a song right now (shown as "今の流れなら…"). */
export function vibeFor(input: DirectorInput, s: Song): Vibe {
  const high = targetFor(input) >= 0.6
  const order = high ? HIGH_VIBES : LOW_VIBES
  const c = input.room.mood.companion
  const companionFirst: Partial<Record<typeof c, Vibe[]>> = { date: ['デュエット', 'エモい'], work: ['みんなで', '懐かしい'], family: ['懐かしい', 'みんなで'] }
  for (const v of companionFirst[c] ?? []) if (s.tags.hypothesis.includes(v)) return v
  for (const v of order) if (s.tags.hypothesis.includes(v)) return v
  return s.tags.hypothesis[0] ?? (high ? '盛り上がる' : 'しっとり')
}

/** My most recent reservation tonight (queue, now, then sung), used as the "繋" anchor. */
export function lastMineSong(input: DirectorInput): SongId | undefined {
  const mine = (by: MemberId, w?: MemberId) => by === 'me' || w === 'me'
  const q = [...input.room.queue].reverse().find(i => mine(i.by, i.with))
  if (q) return q.songId
  if (input.room.now && mine(input.room.now.item.by, input.room.now.item.with)) return input.room.now.item.songId
  const e = [...input.room.sung].reverse().find(x => mine(x.item.by, x.item.with))
  return e?.item.songId
}

export function memberById(input: DirectorInput, id: OtherId): Member | null {
  return input.room.present.find(m => m.id === id) ?? null
}
