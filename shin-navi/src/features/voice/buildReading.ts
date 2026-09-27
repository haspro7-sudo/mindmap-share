// Pure part of the voice check (SPEC L/M7): quiz answers → the three impression factors,
// a capture or quiz → a VoiceReading with its evidence line and one song to try with a key.
// No store access, no randomness: the same input always gives the same reading.
import type { Locale, SongId, TextRef, VoiceReading, VoiceTypeId } from '../../core/types'
import type { CaptureResult } from '../../lib/pitch'
import { karaokeNote } from '../../lib/pitch'
import { voiceType, songsForVoice, rangeFit } from '../../engine/reading'
import { SONG_BY_ID, type Song } from '../../data/songs'
import { V, type VoiceKey } from './strings'

export type QuizAnswers = { high: 'easy' | 'normal' | 'hard'; chorus: 'belt' | 'soft' | 'between'; style: 'ride' | 'talk' | 'sustain' }
export type QuizKey = keyof QuizAnswers
export type Features = { power: number; care: number; brightness: number; groove: number }

export const QUIZ: { [K in QuizKey]: QuizAnswers[K][] } = {
  high: ['easy', 'normal', 'hard'],
  chorus: ['belt', 'soft', 'between'],
  style: ['ride', 'talk', 'sustain'],
}
export const QUIZ_ORDER: QuizKey[] = ['high', 'chorus', 'style']

export const VOICE_TYPES: VoiceTypeId[] = ['clear', 'power', 'groove', 'emotional']

const clamp01 = (v: number) => (Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0.5)
const r2 = (v: number) => Math.round(v * 100) / 100

/** A comfortable range estimate from the high-note answer (MIDI; C4 = 60). */
const RANGE_OF: Record<QuizAnswers['high'], [number, number]> = { easy: [54, 76], normal: [50, 72], hard: [49, 70] }
/** Used when a hum was too short to read a range. */
export const DEFAULT_RANGE: [number, number] = [50, 71]

/**
 * A 3-second hum only shows the few notes that were hummed, and people hum low and easy. The
 * singing range we fit songs against is therefore widened around it: a little below the lowest
 * hummed note and at least an octave and a half above it.
 */
export function singingRange(hum: [number, number]): [number, number] {
  const lo = Math.round(Math.min(hum[0], hum[1])) - 2
  const hi = Math.max(Math.round(Math.max(hum[0], hum[1])) + 6, lo + 18)
  return [lo, hi]
}

/**
 * Three answers → power (迫力), care (丁寧さ), brightness (明るさ) and groove, plus a range.
 * Every one of the four types is reachable (voice.test.ts walks all 27 combinations).
 */
export function quizToFeatures(q: QuizAnswers): Features & { range: [number, number] } {
  const power = { belt: 0.86, between: 0.5, soft: 0.24 }[q.chorus] + (q.style === 'sustain' ? 0.04 : q.style === 'talk' ? -0.06 : 0)
  const care = { sustain: 0.84, ride: 0.52, talk: 0.3 }[q.style] + (q.chorus === 'soft' ? 0.1 : q.chorus === 'belt' ? -0.06 : 0)
  const brightness = { easy: 0.86, normal: 0.5, hard: 0.26 }[q.high] + (q.chorus === 'belt' ? 0.04 : 0) + (q.style === 'talk' ? -0.05 : 0)
  const groove = { ride: 0.8, talk: 0.4, sustain: 0.3 }[q.style] + (q.chorus === 'between' ? 0.04 : 0)
  return { power: r2(clamp01(power)), care: r2(clamp01(care)), brightness: r2(clamp01(brightness)), groove: r2(clamp01(groove)), range: [...RANGE_OF[q.high]] as [number, number] }
}

/** Features for a partly answered quiz (the pillars preview while answering). */
export function partialFeatures(q: Partial<QuizAnswers>): Features {
  const neutral: QuizAnswers = { high: 'normal', chorus: 'between', style: 'talk' }
  const f = quizToFeatures({ ...neutral, ...q })
  const n = quizToFeatures(neutral)
  // unanswered factors sit low, so each answer visibly lifts its pillar
  return {
    power: q.chorus ? f.power : n.power * 0.35,
    care: q.style ? f.care : n.care * 0.35,
    brightness: q.high ? f.brightness : n.brightness * 0.35,
    groove: f.groove,
  }
}

/** Loudness variation of the voiced frames (coefficient of variation of RMS), 0..~1.5. */
export function dynamicsOf(c: CaptureResult | null): number {
  if (!c) return 0
  const v = c.frames.filter(f => f.hz != null).map(f => f.rms)
  if (v.length < 6) return 0
  const mean = v.reduce((a, b) => a + b, 0) / v.length
  if (mean <= 0) return 0
  const sd = Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / v.length)
  return sd / mean
}

type Rule = { key: VoiceKey; when: () => boolean }

/** The one evidence line: the most telling trait of this reading that agrees with its type. */
export function evidenceFor(type: VoiceTypeId, f: Features, src: { capture: CaptureResult | null; quiz?: QuizAnswers }): TextRef {
  const cap = src.capture
  if (cap) {
    const dyn = dynamicsOf(cap)
    const wide = cap.range ? cap.range[1] - cap.range[0] >= 7 : false
    const R: Record<string, Rule> = {
      dynamics: { key: 'ev.dynamics', when: () => dyn >= 0.42 },
      steady: { key: 'ev.steady', when: () => f.care >= 0.62 },
      core: { key: 'ev.core', when: () => f.power >= 0.55 },
      bright: { key: 'ev.bright', when: () => f.brightness >= 0.5 },
      rhythm: { key: 'ev.rhythm', when: () => f.groove >= 0.55 },
      wide: { key: 'ev.wide', when: () => wide },
    }
    const order: Record<VoiceTypeId, string[]> = {
      clear: ['steady', 'bright', 'wide'],
      power: ['core', 'dynamics', 'bright'],
      groove: ['rhythm', 'core', 'dynamics'],
      emotional: ['dynamics', 'wide', 'core'],
    }
    const hit = order[type].map(k => R[k]).find(r => r.when())
    const fallback: Record<VoiceTypeId, VoiceKey> = { clear: 'ev.steady', power: 'ev.core', groove: 'ev.rhythm', emotional: 'ev.soft' }
    return V.ref(hit?.key ?? fallback[type])
  }
  const q = src.quiz
  if (!q) return V.ref('ev.q.mix')
  const R: Rule[] = {
    clear: [
      { key: 'ev.q.sustain', when: () => q.style === 'sustain' },
      { key: 'ev.q.highEasy', when: () => q.high === 'easy' },
      { key: 'ev.q.soft', when: () => q.chorus === 'soft' },
    ],
    power: [
      { key: 'ev.q.belt', when: () => q.chorus === 'belt' },
      { key: 'ev.q.highEasy', when: () => q.high === 'easy' },
    ],
    groove: [
      { key: 'ev.q.ride', when: () => q.style === 'ride' },
      { key: 'ev.q.between', when: () => q.chorus === 'between' },
    ],
    emotional: [
      { key: 'ev.q.talk', when: () => q.style === 'talk' },
      { key: 'ev.q.highHard', when: () => q.high === 'hard' },
      { key: 'ev.q.soft', when: () => q.chorus === 'soft' },
      { key: 'ev.q.between', when: () => q.chorus === 'between' },
    ],
  }[type] as Rule[]
  return V.ref(R.find(r => r.when())?.key ?? 'ev.q.mix')
}

export type Suggestion = { songId: SongId; keyShift: number; fit: number }


/**
 * Songs to try with this voice (engine songsForVoice), each with the key shift from rangeFit.
 * Reservable songs only, nothing already queued, and big key jumps sink to the back so the
 * first pick is one you could actually sing tonight.
 */
export function suggestionsFor(type: VoiceTypeId, range: [number, number], exclude: Iterable<SongId>, n = 3): Suggestion[] {
  const ex = new Set(exclude)
  const pool = songsForVoice(type, range, 18).filter(s => s.reservable && !ex.has(s.id))
  const scored = pool.map((s, i) => {
    const fit = rangeFit(s, range)
    const cost = i * 0.07 + Math.max(0, Math.abs(fit.shift) - 3) * 0.35 + (1 - fit.fit) * 0.8
    return { songId: s.id, keyShift: fit.shift, fit: fit.fit, cost }
  })
  scored.sort((a, b) => a.cost - b.cost)
  return scored.slice(0, n).map(({ songId, keyShift, fit }) => ({ songId, keyShift, fit }))
}

/**
 * Build tonight's reading from a hum (capture) or three answers (quiz).
 * The mic path wins when a capture exists; a hum too short for a range still reads its
 * features, with a neutral range for the key. Nothing of the audio is kept: only the four
 * factor values and a note range end up in the reading.
 */
export function buildReading(src: { capture: CaptureResult | null; quiz?: QuizAnswers }, ctx: { nightId: string; now: number; exclude: SongId[] }): VoiceReading {
  const q = src.quiz ? quizToFeatures(src.quiz) : null
  const cap = src.capture
  const f: Features = cap
    ? { power: r2(clamp01(cap.features.power)), care: r2(clamp01(cap.features.care)), brightness: r2(clamp01(cap.features.brightness)), groove: r2(clamp01(cap.features.groove)) }
    : q ?? { power: 0.5, care: 0.5, brightness: 0.5, groove: 0.5 }
  // reading.range is the singing range every key suggestion in the app fits against (card back,
  // face detail): a hum is widened around the hummed notes, the quiz range is used as is.
  const measured: [number, number] | null = cap ? (cap.range ? singingRange(cap.range) : null) : q ? q.range : null
  const type = voiceType(f)
  const pick = suggestionsFor(type, measured ?? DEFAULT_RANGE, ctx.exclude, 1)[0]
  return {
    nightId: ctx.nightId,
    at: ctx.now,
    type,
    power: f.power,
    care: f.care,
    brightness: f.brightness,
    groove: f.groove,
    range: measured,
    method: cap ? 'mic' : 'quiz',
    evidence: evidenceFor(type, f, src),
    suggest: pick ? { songId: pick.songId, keyShift: pick.keyShift } : undefined,
  }
}

// ---------------------------------------------------------------- small presentation helpers

const MINUS = String.fromCharCode(0x2212)
const FLAT = String.fromCharCode(0x266d)
const SHARP = String.fromCharCode(0x266f)

/** "−2" / "+1" for buttons ("−2で予約"). */
export function shiftText(k: number): string {
  return k < 0 ? `${MINUS}${-k}` : `+${k}`
}
/** "♭2" / "♯1" for the key badge (the face mark shows the same). */
export function keyBadge(k: number): string {
  return k < 0 ? `${FLAT}${-k}` : k > 0 ? `${SHARP}${k}` : ''
}
/** The key advice line as a TextRef. */
export function keyAdvice(k: number): TextRef {
  return k < 0 ? V.ref('key.down', { n: -k }) : k > 0 ? V.ref('key.up', { n: k }) : V.ref('key.orig')
}
/** The primary label for a key-attached reserve. */
export function reserveLabel(k: number): TextRef {
  return k === 0 ? V.ref('reserveOriginal') : V.ref('reserveKey', { k: shiftText(k) })
}

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
/** Note name in the reader's convention: karaoke notation in Japanese, scientific pitch elsewhere. */
export function noteName(midi: number, l: Locale): string {
  const m = Math.round(midi)
  if (l === 'ja') return karaokeNote(m)
  return `${NAMES[((m % 12) + 12) % 12]}${Math.floor(m / 12) - 1}`
}

/** The colour of a voice type (tokens --v-*). */
export const TYPE_COLOR: Record<VoiceTypeId, string> = { clear: '#7FE7FF', power: '#FF5A36', groove: '#C6FF3D', emotional: '#C77DFF' }
export const FACTOR_COLOR = { power: '#FF4D4D', care: '#4D8BFF', bright: '#FFD84D' } as const

export function songOf(id: SongId | undefined): Song | undefined {
  return id ? SONG_BY_ID[id] : undefined
}
