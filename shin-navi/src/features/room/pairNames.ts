// Voice-match names (SPEC E-8). Ten unordered pairs; a name only, never a rating.
// The five-language names live in the shared vocab (`vocab.pair.<a>_<b>`, sorted ids), so a
// {pair} variable inside reason.duet and this TextRef always agree.
import type { TextRef, VoiceTypeId } from '../../core/types'

export const VOICE_TYPES: readonly VoiceTypeId[] = ['clear', 'power', 'groove', 'emotional']

/** Canonical key of an unordered pair: ids sorted alphabetically. */
export function pairKey(a: VoiceTypeId, b: VoiceTypeId): string {
  const [x, y] = [a, b].sort()
  return `${x}_${y}`
}

export function pairName(a: VoiceTypeId, b: VoiceTypeId): TextRef {
  return { key: `vocab.pair.${pairKey(a, b)}` }
}

/** All ten unordered pairs (for tests and the presenter). */
export function allPairs(): [VoiceTypeId, VoiceTypeId][] {
  const out: [VoiceTypeId, VoiceTypeId][] = []
  VOICE_TYPES.forEach((a, i) => VOICE_TYPES.slice(i).forEach(b => out.push([a, b])))
  return out
}

/** The voice colour of a type (tokens.css --v-*). */
export const VOICE_COLOR: Record<VoiceTypeId, string> = {
  clear: '#7FE7FF',
  power: '#FF5A36',
  groove: '#C6FF3D',
  emotional: '#C77DFF',
}
