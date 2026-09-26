// Pure game rules (SPEC K-4). Everything here is deterministic and unit-tested.
import { GENRES, type Song } from '../data/songs'
import type {
  AreaKey,
  AuroraKey,
  Face,
  FaceEvent,
  FaceState,
  KnowTally,
  KnowView,
  Member,
  MemberId,
  MoodWordId,
  Tempo,
} from './types'
import { clamp } from '../lib/rng'

export const ROOM_MINUTES = 90
/** sim ms per room minute: 90 room minutes = 800 s of sim time at 1× (SPEC E-4) */
export const SIM_MS_PER_ROOM_MIN = 8889
/** one song lasts 40 s of sim time at 1× (4.5 room minutes) */
export const SONG_SIM_MS = 40_000

const ORDER: FaceState[] = ['sketch', 'neon', 'mirror', 'prism']
const TARGET: Record<FaceEvent, FaceState> = { keep: 'sketch', import: 'sketch', reserve: 'neon', sung: 'mirror', sungAllKnow: 'prism' }

/** Faces only ever move up: sketch < neon < mirror < prism. */
export function nextFaceState(cur: FaceState | undefined, ev: FaceEvent): FaceState {
  const t = TARGET[ev]
  if (!cur) return t
  return ORDER.indexOf(t) > ORDER.indexOf(cur) ? t : cur
}

export function faceRank(s: FaceState | undefined): number {
  return s ? ORDER.indexOf(s) + 1 : 0
}

const PENTA = [0, 2, 4, 7, 9]
const OCTAVE: Record<Tempo, number> = { fast: 84, mid: 72, slow: 60 }

/** C major pentatonic: degree from genre index, octave from tempo (SPEC D-8). */
export function faceNote(song: Pick<Song, 'genre' | 'tempo'>): number {
  const g = Math.max(0, GENRES.indexOf(song.genre))
  return OCTAVE[song.tempo] + PENTA[g % 5]
}

export function isPentatonic(midi: number): boolean {
  return PENTA.includes(((midi % 12) + 12) % 12)
}

/** Room heat after a song (SPEC E-4). */
export function heatAfter(heat: number, e: { energy: number; knowShare: number; claps: number }): number {
  return clamp(0.55 * heat + 0.45 * (0.6 * e.energy + 0.4 * e.knowShare) + 0.05 * Math.min(1, e.claps / 40), 0, 1)
}

export type MoodInput = {
  heat: number
  trend: -1 | 0 | 1
  started: boolean
  recentEnergies: number[] // oldest → newest, songs that ended
  override?: MoodWordId | null
}

export function moodWordFor(r: MoodInput): MoodWordId {
  if (r.override) return r.override
  if (!r.started) return 'blank'
  const last2 = r.recentEnergies.slice(-2)
  if (last2.length === 2 && last2.every(e => e < 0.5)) return 'mellow'
  if (r.heat >= 0.8) return 'peak'
  if (r.heat >= 0.65) return r.trend > 0 ? 'rising' : 'warming'
  if (r.heat >= 0.45) return 'warming'
  return 'loosening'
}

export function auroraFor(w: MoodWordId): AuroraKey {
  switch (w) {
    case 'blank':
    case 'loosening':
    case 'back':
      return 'quiet'
    case 'mellow':
      return 'mellow'
    case 'warming':
    case 'welcome':
      return 'warm'
    case 'rising':
    case 'peak':
      return 'hot'
  }
}

/**
 * Anonymous dots in arrival order. "Don't know" and "no answer" are the same empty dot,
 * so nobody can tell who does not know a song.
 */
export function knowView(tally: KnowTally | undefined, presentIds: MemberId[]): KnowView {
  const size = presentIds.length
  const lit: { a: 'know' | 'chorus'; at: number }[] = []
  if (tally) {
    for (const id of presentIds) {
      const ans = tally.answers[id]
      if (ans && ans.a !== 'none') lit.push({ a: ans.a, at: ans.at })
    }
  }
  lit.sort((x, y) => x.at - y.at)
  const dots: KnowView['dots'] = lit.map(x => x.a)
  while (dots.length < size) dots.push('empty')
  const know = lit.filter(x => x.a === 'know').length
  const chorus = lit.length - know
  return { dots, knows: know + chorus * 0.5, size, all: size > 0 && know === size }
}

/** Expected probability that a member knows a song (SPEC E-2 formula; used for hidden heat estimates). */
export function pKnow(m: Pick<Member, 'id' | 'likes' | 'generation'>, s: Song): number {
  const taste = m.likes[s.genre] ?? 0.2
  let aware = s.knownRate[m.generation] / 100
  if (m.id === 'jun') aware *= s.inboundTitle.ko ? 1 : 0.5
  return clamp(0.15 + 0.6 * taste + 0.35 * aware, 0, 0.97)
}

export const areaKey = (tempo: Tempo, genre: Song['genre']): AreaKey => `${tempo}:${genre}`

/** Areas with at least 3 songs and no lit face, largest first (SPEC D-2). */
export function gapAreas(faces: Record<string, Face>, songs: Song[]): AreaKey[] {
  const count = new Map<AreaKey, number>()
  const lit = new Set<AreaKey>()
  for (const s of songs) {
    const k = areaKey(s.tempo, s.genre)
    count.set(k, (count.get(k) ?? 0) + 1)
    if (faces[s.id]) lit.add(k)
  }
  return [...count.entries()]
    .filter(([k, n]) => n >= 3 && !lit.has(k))
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .map(([k]) => k)
}

export function orderIdem(menuId: string, simMs: number, nonce: number): string {
  return `${menuId}:${Math.floor(simMs / 1000)}:${nonce}`
}

export function roomMinutesLeft(simMs: number): number {
  return Math.max(0, Math.floor(ROOM_MINUTES - simMs / SIM_MS_PER_ROOM_MIN))
}

export function simMsForMinutesLeft(m: number): number {
  return Math.max(0, (ROOM_MINUTES - m) * SIM_MS_PER_ROOM_MIN)
}

/** 60 days without singing → the face sleeps (moon mark). Nothing is lost. */
export const SLEEP_MS = 60 * 24 * 3600 * 1000
export function isSleeping(f: Face, now: number): boolean {
  const last = f.polishedAt ?? f.lastSungAt
  return f.sungCount > 0 && last != null && now - last > SLEEP_MS
}

export type HeatBucket = 'quiet' | 'mellow' | 'warm' | 'hot'
export function heatBucket(h: number): HeatBucket {
  if (h < 0.35) return 'quiet'
  if (h < 0.55) return 'mellow'
  if (h < 0.75) return 'warm'
  return 'hot'
}

export const AURORA_PALETTES: Record<AuroraKey, [string, string, string]> = {
  quiet: ['#3B2A8F', '#1E4FA8', '#5B2A7A'],
  mellow: ['#5B6CFF', '#9D8CFF', '#2EF2FF'],
  warm: ['#8A6BFF', '#FF3DA8', '#2EF2FF'],
  hot: ['#FF3DA8', '#FFB547', '#FF6A3D'],
}

/** Area colour for genre index i (tokens --area-i). */
export function areaColor(genre: Song['genre']): string {
  const i = Math.max(0, GENRES.indexOf(genre))
  return `hsl(${(330 + 30 * i) % 360} 85% 62%)`
}
