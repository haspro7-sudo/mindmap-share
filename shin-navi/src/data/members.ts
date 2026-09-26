// The three simulated roommates plus "me". Names are fictional demo characters.
import type { Genre, Generation } from './songs'

export type MemberProfile = {
  id: 'me' | 'minato' | 'saki' | 'jun'
  color: string
  locale: 'ja' | 'en' | 'zhHant' | 'zhHans' | 'ko'
  generation: Generation
  likes: Partial<Record<Genre, number>>
  voiceType: 'clear' | 'power' | 'groove' | 'emotional' | null
  /** prefers songs below this energy (Saki) */
  prefersBelowEnergy?: number
}

export const MEMBER_PROFILES: Record<MemberProfile['id'], MemberProfile> = {
  me: { id: 'me', color: '#D8DCE8', locale: 'ja', generation: 20, likes: {}, voiceType: null },
  minato: { id: 'minato', color: '#FF8A3D', locale: 'ja', generation: 20, likes: { ロック: 0.9, 'J-POP': 0.7, アニメ: 0.6, ヒップホップ: 0.5 }, voiceType: 'power' },
  saki: { id: 'saki', color: '#FF6FB1', locale: 'ja', generation: 20, likes: { 'J-POP': 0.9, 'K-POP': 0.5, ボカロ: 0.4 }, voiceType: 'emotional', prefersBelowEnergy: 0.6 },
  jun: { id: 'jun', color: '#3DF5C8', locale: 'ko', generation: 20, likes: { アニメ: 0.9, 'K-POP': 0.9, シティポップ: 0.8, ボカロ: 0.5 }, voiceType: 'groove' },
}

/** Room minute at which Jun joins when not in script mode. */
export const JUN_JOIN_MINUTE = 12
