// "知ってる" model (SPEC E-2). Pure and seeded: the same person gives the same answer to the
// same song for the whole night, with the same delay, the same silence and the same bubble.
import type { KnowAnswer, Member, Song, TextRef } from '../../core/types'
import { clamp, seeded } from '../../lib/rng'
import { R } from './strings'

type Who = Pick<Member, 'id' | 'likes' | 'generation'>

/** Awareness: knownRate of the member's generation; for Jun ×1.0 with a Korean title, else ×0.5. */
export function awareness(m: Who, s: Song): number {
  let aware = s.knownRate[m.generation] / 100
  if (m.id === 'jun') aware *= s.inboundTitle.ko ? 1 : 0.5
  return aware
}

/**
 * E-2: pKnow = clamp(0.15 + 0.6·taste + 0.35·aware, 0, 0.97), taste = likes[genre] (default 0.2).
 * `chorus` is the unconditional chance of "just the chorus": not knowing the song, times
 * 0.3·aware for songs from 2018 on (short-video effect), 0.1·aware before that.
 */
export function knowProbability(m: Who, s: Song): { know: number; chorus: number } {
  const taste = m.likes[s.genre] ?? 0.2
  const aware = awareness(m, s)
  const know = clamp(0.15 + 0.6 * taste + 0.35 * aware, 0, 0.97)
  const chorusIfNot = (s.year >= 2018 ? 0.3 : 0.1) * aware
  return { know, chorus: (1 - know) * chorusIfNot }
}

export const SILENT_P = 0.15
export const BUBBLE_P = 0.6
export const PONDER_P = 0.06

const KNOW_BUBBLES = ['bubble.know0', 'bubble.know1', 'bubble.know2', 'bubble.know3'] as const
const CHORUS_BUBBLES = ['bubble.chorus0', 'bubble.chorus1'] as const

export type AnswerDraw = {
  /** 15%: never answers (looks exactly like "don't know") */
  silent: boolean
  answer: KnowAnswer
  /** arrival delay in sim ms: 0.6 + 3.4·r² s, +2 s for the 6% who stop to think */
  delayMs: number
  ponder: boolean
  /** a positive bubble (p 0.6), never for 'none' */
  bubble: TextRef | null
}

/** Draw one member's answer for one song. Seed key: `${seed}|know|${member}|${songId}`. */
export function drawAnswer(seed: string, m: Who, s: Song): AnswerDraw {
  const r = seeded(`${seed}|know|${m.id}|${s.id}`)
  const silent = r() < SILENT_P
  const p = knowProbability(m, s)
  const roll = r()
  const answer: KnowAnswer = roll < p.know ? 'know' : roll < p.know + p.chorus ? 'chorus' : 'none'
  const d = r()
  const ponder = r() < PONDER_P
  const delayMs = Math.round((0.6 + 3.4 * d * d) * 1000) + (ponder ? 2000 : 0)
  const talk = r() < BUBBLE_P
  const pick = r()
  let bubble: TextRef | null = null
  if (talk && answer === 'know') bubble = R.ref(KNOW_BUBBLES[Math.floor(pick * KNOW_BUBBLES.length) % KNOW_BUBBLES.length])
  else if (talk && answer === 'chorus') bubble = R.ref(CHORUS_BUBBLES[Math.floor(pick * CHORUS_BUBBLES.length) % CHORUS_BUBBLES.length])
  return { silent, answer, delayMs, ponder, bubble }
}

/** Does this member (really) know the song? Silence is not ignorance, so it is ignored here. */
export function modelKnows(seed: string, m: Who, s: Song): boolean {
  return drawAnswer(seed, m, s).answer === 'know'
}

/** Every bubble key the model can ever produce (tests check none of them is negative). */
export const ANSWER_BUBBLE_KEYS: readonly string[] = [...KNOW_BUBBLES, ...CHORUS_BUBBLES].map(k => `room.${k}`)
