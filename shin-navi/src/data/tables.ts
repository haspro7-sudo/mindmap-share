// Operational tables that a real service would edit without code changes.
// Everything here is a demo hypothesis, not measured data.
import type { Locale } from '../i18n'

export type OpenerStep = { kind: 'song'; variant?: 'visa'; songId?: string } | { kind: 'ask'; songId?: string } | { kind: 'gap' }

/** First three cards per viewing language (5-1: per-country content, sample only). */
export const LOCALE_OPENERS: Record<Locale, OpenerStep[]> = {
  ja: [{ kind: 'song' }, { kind: 'ask' }, { kind: 'gap' }],
  en: [
    { kind: 'song', variant: 'visa', songId: 'plastic-love' },
    { kind: 'song', variant: 'visa', songId: 'zankoku' },
    { kind: 'ask', songId: 'mayonaka-no-door' },
  ],
  zhHant: [
    { kind: 'song', variant: 'visa', songId: 'first-love' },
    { kind: 'song', variant: 'visa', songId: 'toki-no-nagare' },
    { kind: 'ask', songId: 'gurenge' },
  ],
  zhHans: [
    { kind: 'song', variant: 'visa', songId: 'senbonzakura' },
    { kind: 'song', variant: 'visa', songId: 'zankoku' },
    { kind: 'ask', songId: 'lemon' },
  ],
  ko: [
    { kind: 'song', variant: 'visa', songId: 'idol' },
    { kind: 'song', variant: 'visa', songId: 'zankoku' },
    { kind: 'ask', songId: 'yoru-ni-kakeru' },
  ],
}

/** Songs "brought from a subscription" in the demo. */
export const IMPORT_DEMO = ['kaiju-hanauta', 'hakujitsu', 'bansanka', 'plastic-love', 'ditto'] as const

/** Safe first songs when the room gives no signal. */
export const OPENER_FALLBACK = ['marigold', 'que-sera', 'gurenge', 'zankoku', 'idol', 'yoru-ni-kakeru', 'we-will-rock-you', 'bbbb', 'love-machine', 'ue-wo-muite'] as const

export type Companion = 'friends' | 'family' | 'work' | 'date' | 'solo'

/** Static, self-declared situation lists used only for the comparison split. */
export const STATIC_LISTS: Record<Companion, string[]> = {
  friends: ['gurenge', 'marigold', 'idol', 'lemon', 'zankoku'],
  family: ['sekai-hana', 'ue-wo-muite', 'koi', 'makenaide', 'let-it-go'],
  work: ['ultra-soul', 'love-machine', 'tenkyu', 'ai-wa-katsu', 'sekai-hana'],
  date: ['uchiage-hanabi', 'first-love', 'marigold', 'dry-flower', 'hanamizuki'],
  solo: ['lemon', 'hakujitsu', 'pretender', 'yoru-ni-kakeru', 'first-love'],
}
