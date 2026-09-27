// Pure helpers for the stage module (no React, no DOM): unit-tested in stage.test.ts.
import type { AuroraKey, Member, MemberId, MoodWordId, Order, SongId, SungEntry, VoiceTypeId } from '../../core/types'
import { SONG_BY_ID } from '../../data/songs'
import { auroraFor, heatAfter, moodWordFor, pKnow } from '../../core/rules'
import { seeded, clamp } from '../../lib/rng'

// ---------------------------------------------------------------- colours

export const VOICE_COLOR: Record<VoiceTypeId, string> = {
  clear: '#7FE7FF',
  power: '#FF5A36',
  groove: '#C6FF3D',
  emotional: '#C77DFF',
}

export const SILVER = '#D8DCE8'

/**
 * Colour of a member's light. "me" turns from silver into the voice colour once a voice
 * reading exists, but only on the private phone view (the room screen never shows voice data).
 */
export function lightColor(m: Pick<Member, 'id' | 'color' | 'voiceType'>, privateOk: boolean): string {
  if (m.id !== 'me') return m.color
  if (privateOk && m.voiceType) return VOICE_COLOR[m.voiceType]
  return SILVER
}

/** Text-safe gradient stops per aurora palette (the raw aurora colours are too dark for type). */
export const MOOD_INK: Record<'quiet' | 'mellow' | 'warm' | 'hot', [string, string, string]> = {
  quiet: ['#C3B4FF', '#86A9FF', '#DDA2FF'],
  mellow: ['#98A6FF', '#CFC4FF', '#7DF9FF'],
  warm: ['#C0A6FF', '#FF74C2', '#74F5FF'],
  hot: ['#FF62B9', '#FFCB74', '#FF8C5A'],
}

// ---------------------------------------------------------------- score (demo)

/** Demo score for one of my songs: 78..96, fixed per night seed and queue item. */
export function demoScore(seed: string, itemId: string): number {
  const r = seeded(`${seed}|score|${itemId}`)()
  return 78 + Math.min(18, Math.floor(r * 19))
}

export type ScoreVerdict = { kind: 'first' | 'best' | 'same' | 'gap'; best: number; gap: number }

/** Compare a score only with my own earlier scores tonight (never with other people). */
export function scoreVerdict(score: number, earlier: number[]): ScoreVerdict {
  if (!earlier.length) return { kind: 'first', best: score, gap: 0 }
  const prev = Math.max(...earlier)
  if (score > prev) return { kind: 'best', best: score, gap: 0 }
  if (score === prev) return { kind: 'same', best: prev, gap: 0 }
  return { kind: 'gap', best: prev, gap: prev - score }
}

// ---------------------------------------------------------------- lane

/**
 * Where drink glasses float in the lane. Rows are in play order (NOW first when playing).
 * An order that arrives after `etaAfterSongs` songs sits after row index eta-1; a longer
 * wait than the lane shows parks the glass at the end. Returns rowIndex → glass count,
 * where rowIndex = rows.length means "after the last row".
 */
export function glassSlots(rowCount: number, orders: Pick<Order, 'status' | 'etaAfterSongs'>[]): Map<number, number> {
  const out = new Map<number, number>()
  for (const o of orders) {
    if (o.status !== 'sending' && o.status !== 'accepted' && o.status !== 'preparing') continue
    const eta = Math.max(1, o.etaAfterSongs)
    const at = Math.min(rowCount, eta)
    out.set(at, (out.get(at) ?? 0) + 1)
  }
  return out
}

/**
 * The ETA the empty lane shows for its single glass (QA ROBUST#15): the soonest open order's own
 * etaAfterSongs (at least 1), so the lane and the order never disagree.
 */
export function soonestEta(orders: Pick<Order, 'status' | 'etaAfterSongs'>[]): number {
  const open = orders.filter(o => o.status === 'sending' || o.status === 'accepted' || o.status === 'preparing')
  return open.length ? Math.max(1, Math.min(...open.map(o => o.etaAfterSongs))) : 1
}

/** The hero's forecast word key for the word the air is heading to, worded by direction (QA OWNER#7). */
export function forecastKey(word: MoodWordId, rising: boolean): 'fc.hot' | 'fc.warmUp' | 'fc.warmDown' | 'fc.mellowUp' | 'fc.mellowDown' | 'fc.quiet' {
  switch (word) {
    case 'peak':
    case 'rising':
      return 'fc.hot'
    case 'warming':
    case 'welcome':
      return rising ? 'fc.warmUp' : 'fc.warmDown'
    case 'mellow':
      return 'fc.mellowDown'
    default:
      return rising ? 'fc.mellowUp' : 'fc.quiet'
  }
}

/** Split a translated sentence around a marker so a number can be styled on its own. */
export function splitAround(text: string, marker: string): [string, string] {
  const i = text.indexOf(marker)
  if (i < 0) return [text, '']
  return [text.slice(0, i), text.slice(i + marker.length)]
}

// ---------------------------------------------------------------- heat & flow

/** Tonight's heat samples: the starting heat, then the heat after each finished song. */
export function heatSeries(sung: Pick<SungEntry, 'heatAfter'>[], start = 0.2, max = 8): number[] {
  const s = [start, ...sung.map(e => e.heatAfter)]
  return s.slice(-max)
}

type Presentish = Pick<Member, 'id' | 'likes' | 'generation'>

/** Expected knowing share of a song among the people present (internal estimate only). */
export function expectedKnow(songId: SongId, present: Presentish[]): number {
  const song = SONG_BY_ID[songId]
  if (!song || !present.length) return 0.5
  return present.reduce((a, m) => a + pKnow(m, song), 0) / present.length
}

/** Navi's read of the heat after one more song (the hypothesis drawn as a dotted line). */
export function forecastHeat(heat: number, songId: SongId, present: Presentish[]): number {
  const song = SONG_BY_ID[songId]
  const others = present.filter(m => m.id !== 'me').length
  const claps = others * Math.round(10 + 20 * heat)
  return heatAfter(heat, { energy: song?.energy ?? 0.5, knowShare: expectedKnow(songId, present), claps })
}

/** Forecast for a whole queue, song after song. */
export function forecastQueue(heat: number, songIds: SongId[], present: Presentish[]): number[] {
  const out: number[] = []
  let h = heat
  for (const id of songIds) {
    h = forecastHeat(h, id, present)
    out.push(h)
  }
  return out
}

/**
 * Navi's read of the air after the songs that are coming (NOW + the next two), expressed as the
 * aurora colour the mood word would then have (QA OWNER#7). Uses the same heat model as the flow
 * line and the same word rules as the store, so "a different colour" means the word would really
 * change (the raw heat buckets and the word thresholds differ around 0.45–0.55).
 */
export function forecastMood(heat: number, sungEnergies: number[], upcoming: SongId[], present: Presentish[]): { word: MoodWordId; bucket: AuroraKey; rising: boolean } | null {
  const ids = upcoming.filter(id => SONG_BY_ID[id]).slice(0, 3)
  if (!ids.length) return null
  const hs = forecastQueue(heat, ids, present)
  const h = hs[hs.length - 1]
  const trend: -1 | 0 | 1 = h > heat + 0.02 ? 1 : h < heat - 0.02 ? -1 : 0
  const word = moodWordFor({ heat: h, trend, started: true, recentEnergies: [...sungEnergies, ...ids.map(id => SONG_BY_ID[id]?.energy ?? 0.5)] })
  return { word, bucket: auroraFor(word), rising: trend > 0 }
}

/** A display range around the values (at least 0.3 tall) so small heat changes still read. */
export function heatRange(values: number[], pad = 0.06, minSpan = 0.3): [number, number] {
  if (!values.length) return [0, 1]
  let lo = Math.max(0, Math.min(...values) - pad)
  let hi = Math.min(1, Math.max(...values) + pad)
  if (hi - lo < minSpan) {
    const mid = (hi + lo) / 2
    lo = Math.max(0, mid - minSpan / 2)
    hi = Math.min(1, lo + minSpan)
    lo = Math.max(0, hi - minSpan)
  }
  return [lo, hi]
}

export type Trend = 'up' | 'down' | 'flat'
export function trendOf(from: number, to: number, eps = 0.02): Trend {
  return to > from + eps ? 'up' : to < from - eps ? 'down' : 'flat'
}

/**
 * Smooth path through points (x, y) using a Catmull-Rom → cubic Bézier conversion.
 * Deterministic output with 1-decimal coordinates keeps SVG diffs cheap.
 */
export function smoothPath(pts: { x: number; y: number }[], tension = 0.5): string {
  if (!pts.length) return ''
  const f = (n: number) => (Math.round(n * 10) / 10).toString()
  if (pts.length === 1) return `M${f(pts[0].x)} ${f(pts[0].y)}`
  let d = `M${f(pts[0].x)} ${f(pts[0].y)}`
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)]
    const p1 = pts[i]
    const p2 = pts[i + 1]
    const p3 = pts[Math.min(pts.length - 1, i + 2)]
    const k = tension / 3
    const c1x = p1.x + (p2.x - p0.x) * k
    const c1y = p1.y + (p2.y - p0.y) * k
    const c2x = p2.x - (p3.x - p1.x) * k
    const c2y = p2.y - (p3.y - p1.y) * k
    d += ` C${f(c1x)} ${f(c1y)} ${f(c2x)} ${f(c2y)} ${f(p2.x)} ${f(p2.y)}`
  }
  return d
}

/** Map heat values onto x positions spread across [x0, x1] and y within [top, bottom]. */
export function heatPoints(values: number[], x0: number, x1: number, top: number, bottom: number): { x: number; y: number }[] {
  const n = values.length
  if (!n) return []
  const step = n > 1 ? (x1 - x0) / (n - 1) : 0
  return values.map((v, i) => ({ x: x0 + step * i, y: bottom - clamp(v, 0, 1) * (bottom - top) }))
}

// ---------------------------------------------------------------- shift card

/**
 * Which candidate "rides" the flow and which "changes" it: the one whose energy is closer to
 * the recent songs rides, the other changes. The navi pick is the card's own songId when it is
 * one of the options, otherwise the first option.
 */
export function shiftRoles(options: SongId[], recentEnergies: number[], naviSongId?: SongId): { ride?: SongId; change?: SongId; pick?: SongId } {
  const opts = options.filter(id => SONG_BY_ID[id]).slice(0, 2)
  if (!opts.length) return {}
  const pick = naviSongId && opts.includes(naviSongId) ? naviSongId : opts[0]
  if (opts.length === 1) return { change: opts[0], pick }
  const recent = recentEnergies.length ? recentEnergies.slice(-3).reduce((a, b) => a + b, 0) / Math.min(3, recentEnergies.length) : 0.5
  const d = (id: SongId) => Math.abs((SONG_BY_ID[id]?.energy ?? 0.5) - recent)
  const [a, b] = opts
  const ride = d(a) <= d(b) ? a : b
  const change = ride === a ? b : a
  return { ride, change, pick }
}

// ---------------------------------------------------------------- floor

export type FloorSlot = { id: MemberId; x: number; front: boolean }
/** Floor order left→right (SPEC F-3): Minato · you (front, centre-left) · Saki · Jun. */
export const FLOOR_SLOTS: FloorSlot[] = [
  { id: 'minato', x: 0.1, front: false },
  { id: 'me', x: 0.35, front: true },
  { id: 'saki', x: 0.6, front: false },
  { id: 'jun', x: 0.82, front: false },
]

/** A point just inside the ball rim on the line from the orb to the ball centre. */
export function threadEnd(orb: { x: number; y: number }, ball: { x: number; y: number; r: number }, inset = 0.9): { x: number; y: number } {
  const dx = orb.x - ball.x
  const dy = orb.y - ball.y
  const len = Math.hypot(dx, dy) || 1
  return { x: ball.x + (dx / len) * ball.r * inset, y: ball.y + (dy / len) * ball.r * inset }
}

// ---------------------------------------------------------------- penlight

const PENTA = [0, 2, 4, 7, 9]
/** Penlight step n → a C-major-pentatonic MIDI note climbing from C5 over two octaves. */
export function penlightNote(step: number): number {
  const i = ((step % 10) + 10) % 10
  return 72 + 12 * Math.floor(i / 5) + PENTA[i % 5]
}

// ---------------------------------------------------------------- stylised QR (placeholder art)

/** A deterministic QR-looking module grid with three finder squares. Decorative only. */
export function qrMatrix(seed: string, n = 25): boolean[][] {
  const r = seeded(`qr|${seed}`)
  const m: boolean[][] = Array.from({ length: n }, () => Array.from({ length: n }, () => r() < 0.46))
  const finder = (ox: number, oy: number) => {
    for (let y = -1; y <= 7; y++)
      for (let x = -1; x <= 7; x++) {
        const X = ox + x
        const Y = oy + y
        if (X < 0 || Y < 0 || X >= n || Y >= n) continue
        const edge = x === 0 || x === 6 || y === 0 || y === 6
        const core = x >= 2 && x <= 4 && y >= 2 && y <= 4
        const inside = x >= 0 && x <= 6 && y >= 0 && y <= 6
        m[Y][X] = inside && (edge || core)
      }
  }
  finder(0, 0)
  finder(n - 7, 0)
  finder(0, n - 7)
  // quiet centre for the logo
  const c = Math.floor(n / 2)
  for (let y = c - 2; y <= c + 2; y++) for (let x = c - 2; x <= c + 2; x++) m[y][x] = false
  return m
}

// ---------------------------------------------------------------- tiny local signal bus

type Fn<T> = (v: T) => void
/** Module-local signals (lane ↔ seam choreography). Not the app bus: nothing outside M6 listens. */
export function signal<T>() {
  const subs = new Set<Fn<T>>()
  return {
    emit(v: T) {
      for (const f of [...subs]) {
        try {
          f(v)
        } catch (err) {
          console.warn('[stage signal]', err)
        }
      }
    },
    on(f: Fn<T>) {
      subs.add(f)
      return () => {
        subs.delete(f)
      }
    },
  }
}
