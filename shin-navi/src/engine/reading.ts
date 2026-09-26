// The "reading" engine: scores songs against who is in the room, the flow of the
// session and the singer's own voice. Pure functions only (no store access).
import { SONGS, SONG_BY_ID, type Generation, type Song, type Vibe } from '../data/songs'
import { hashString, mulberry32, clamp } from '../lib/rng'

export type Person = {
  id: string
  generation: Generation
  /** genre affinity 0..1 */
  likes: Partial<Record<Song['genre'], number>>
}

export type ReasonKind = 'dare' | 'tsunagu' | 'yomu' | 'hou' | 'ren' | 'voice'

export type Reason = { kind: ReasonKind; text: string }

export type Scored = { song: Song; score: number; reasons: Reason[]; knownBy: string[] }

/** Deterministic "does this person know this song" so the room stays consistent. */
export function knows(person: Person, song: Song): boolean {
  const p = song.known[person.generation] / 100
  const likeBoost = (person.likes[song.genre] ?? 0) * 0.25
  const roll = mulberry32(hashString(person.id + '|' + song.id))()
  return roll < clamp(p + likeBoost, 0, 0.99)
}

export function knownBy(people: Person[], song: Song): string[] {
  return people.filter(p => knows(p, song)).map(p => p.id)
}

/** Energy the room "wants" next: rises early, peaks, breathes, and asks for a finale. */
export function targetEnergy(history: Song[], minutesLeft: number): number {
  if (history.length === 0) return 0.85 // 1曲目は場を作る
  const recent = history.slice(-3)
  const avg = recent.reduce((a, s) => a + s.energy, 0) / recent.length
  if (minutesLeft <= 12) return 0.95 // ラスト
  if (avg > 0.85 && recent.length >= 3) return 0.45 // 盛り上がり続きなら一息
  if (avg < 0.45) return 0.8 // しっとり続きなら戻す
  return clamp(avg + 0.08, 0.3, 0.95)
}

export type ReadContext = {
  me: Person
  room: Person[] // others in the room
  history: Song[] // sung / reserved in order
  minutesLeft: number
  kept: Set<string> // songs the user already saved
  passed: Set<string>
  myRange?: [number, number] | null
  trending?: Set<string>
}

const vibeText: Partial<Record<Vibe, string>> = {
  盛り上がる: '盛り上がりを作れる',
  しっとり: '一息つける',
  みんなで: 'みんなで歌える',
  叫べる: 'サビで叫べる',
  エモい: 'エモい流れにつながる',
  ラスト向き: '締めにぴったり',
  '1曲目向き': '1曲目で空気を作れる',
}

export function readRoom(ctx: ReadContext, pool: Song[] = SONGS): Scored[] {
  const everyone = [ctx.me, ...ctx.room]
  const target = targetEnergy(ctx.history, ctx.minutesLeft)
  const lastId = ctx.history.at(-1)?.id
  const recentIds = new Set(ctx.history.map(s => s.id))
  const co = lastId ? new Set(coOccur(lastId, 6).map(s => s.id)) : new Set<string>()
  const out: Scored[] = []
  for (const song of pool) {
    if (recentIds.has(song.id) || ctx.passed.has(song.id)) continue
    const kb = knownBy(everyone, song)
    const share = kb.length / everyone.length
    const energyFit = 1 - Math.abs(song.energy - target)
    const taste = ctx.me.likes[song.genre] ?? 0.3
    const roomTaste = ctx.room.reduce((a, p) => a + (p.likes[song.genre] ?? 0.2), 0) / Math.max(1, ctx.room.length)
    const fit = ctx.myRange ? rangeFit(song, ctx.myRange).fit : 0.5
    const trend = ctx.trending?.has(song.id) ? 1 : 0
    const rand = mulberry32(hashString(song.id + ':' + ctx.history.length))() * 0.08
    const score = share * 1.6 + energyFit * 1.2 + taste * 0.6 + roomTaste * 0.5 + fit * 0.4 + trend * 0.35 + (co.has(song.id) ? 0.45 : 0) + rand
    const reasons: Reason[] = []
    if (share >= 0.99) reasons.push({ kind: 'dare', text: `この部屋の${everyone.length}人全員が知ってる` })
    else if (share >= 0.74) reasons.push({ kind: 'dare', text: `${everyone.length}人中${kb.length}人が知ってる` })
    if (co.has(song.id) && lastId) reasons.push({ kind: 'tsunagu', text: `「${SONG_BY_ID[lastId]?.title}」を選んだ人はこれも` })
    if (energyFit > 0.8) {
      const v = song.vibes.find(x => vibeText[x])
      reasons.push({ kind: 'yomu', text: `今の流れなら${v ? vibeText[v] : 'ちょうどいい'}` })
    }
    if (trend) reasons.push({ kind: 'yomu', text: '今週この街でよく歌われている' })
    if (ctx.myRange && fit > 0.8) reasons.push({ kind: 'voice', text: 'あなたの声域にぴったり' })
    out.push({ song, score, reasons, knownBy: kb })
  }
  return out.sort((a, b) => b.score - a.score)
}

/** "この曲を選んだ人はこれも" — similarity by era, genre and vibes (demo co-occurrence). */
export function coOccur(songId: string, n = 5): Song[] {
  const base = SONG_BY_ID[songId]
  if (!base) return []
  return SONGS.filter(s => s.id !== songId)
    .map(s => {
      const vibeOverlap = s.vibes.filter(v => base.vibes.includes(v)).length
      const era = 1 - Math.min(1, Math.abs(s.year - base.year) / 25)
      const g = s.genre === base.genre ? 1 : 0
      const artist = s.artist === base.artist ? 0.6 : 0
      return { s, v: vibeOverlap * 0.5 + era * 1.2 + g * 0.8 + artist + (1 - Math.abs(s.energy - base.energy)) * 0.6 }
    })
    .sort((a, b) => b.v - a.v)
    .slice(0, n)
    .map(x => x.s)
}

/** How well a song sits in the singer's comfortable range, and the key shift that helps. */
export function rangeFit(song: Song, my: [number, number]): { fit: number; shift: number; note: string } {
  const [lo, hi] = song.range
  const [mlo, mhi] = my
  let best = { fit: -Infinity, shift: 0 }
  for (let k = -6; k <= 6; k++) {
    const over = Math.max(0, hi + k - mhi)
    const under = Math.max(0, mlo - (lo + k))
    // Compare unclamped so a smaller overshoot still wins when nothing fits fully.
    const fit = 1 - (over * 1.2 + under * 0.8) / 6 - Math.abs(k) * 0.015
    if (fit > best.fit) best = { fit, shift: k }
  }
  const baseOver = Math.max(0, hi - mhi)
  let note = '原曲キーで歌いやすい可能性が高い'
  if (best.shift < 0) note = `今のキーだと高音が続く。キーを${Math.abs(best.shift)}下げると歌いやすい可能性がある`
  else if (best.shift > 0) note = `キーを${best.shift}上げると声が前に出やすい可能性がある`
  else if (baseOver > 0) note = 'サビの最高音だけ少し高め'
  return { fit: clamp(best.fit, 0, 1), shift: best.shift, note }
}

export type VoiceTypeId = 'clear' | 'power' | 'groove' | 'emotional'

export type VoiceFeatures = {
  /** 0..1 迫力性 */
  power: number
  /** 0..1 丁寧さ (pitch stability) */
  care: number
  /** 0..1 明るさ */
  brightness: number
  /** 0..1 rhythmic drive */
  groove: number
}

/** Map the three impression factors (+rhythm) to a playful, provisional type name. */
export function voiceType(f: VoiceFeatures): VoiceTypeId {
  const scores: Record<VoiceTypeId, number> = {
    clear: f.brightness * 0.6 + f.care * 0.6,
    power: f.power * 1.1 + f.brightness * 0.1,
    groove: f.groove * 1.1 + f.power * 0.1,
    emotional: (1 - f.care) * 0.4 + f.power * 0.3 + (1 - f.brightness) * 0.5,
  }
  return (Object.keys(scores) as VoiceTypeId[]).sort((a, b) => scores[b] - scores[a])[0]
}

/** Songs that suit a voice type, used for 「この声で歌ってみたい曲」. */
export function songsForVoice(type: VoiceTypeId, my: [number, number] | null, n = 3): Song[] {
  const want: Record<VoiceTypeId, (s: Song) => number> = {
    clear: s => (s.vibes.includes('しっとり') ? 1 : 0) + (s.vibes.includes('エモい') ? 0.6 : 0) + (1 - s.energy) * 0.5,
    power: s => (s.vibes.includes('叫べる') ? 1 : 0) + s.energy,
    groove: s => (s.vibes.includes('ノれる') ? 1.2 : 0) + (s.tempo === 'mid' ? 0.4 : 0),
    emotional: s => (s.vibes.includes('泣ける') ? 1 : 0) + (s.vibes.includes('エモい') ? 0.8 : 0),
  }
  return SONGS.map(s => ({ s, v: want[type](s) + (my ? rangeFit(s, my).fit * 0.8 : 0) + mulberry32(hashString(type + s.id))() * 0.2 }))
    .sort((a, b) => b.v - a.v)
    .slice(0, n)
    .map(x => x.s)
}
