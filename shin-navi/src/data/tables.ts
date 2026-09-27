// Operational tables that a real service would edit without code changes.
// Everything here is a demo hypothesis, not measured data.
import type { Locale } from '../i18n'
import { SONG_BY_ID } from './songs'

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

// ---------------------------------------------------------------- the rehearsed demo (SPEC N)

/**
 * Songs the 3-minute demo (`?view=dual&script=1&seed=demo`) deals, asks about, reserves or plays,
 * measured on the rehearsed run (with the seeded past nights below): the opener 青と夏 and its
 * link options (恋 / SUN / ケセラセラ), the first ask (ライラック), Minato's pick, the shift pair,
 * my turn, the gap previews, the finale options. Re-measure with qa/fix-core-app/demopath.mjs
 * when the dealer changes.
 */
export const DEMO_SONGS = [
  'ao-to-natsu',
  'koi',
  'sun',
  'que-sera',
  'lilac',
  'pretender',
  'aiuta',
  'kurenai',
  'kiseki',
  'chiisana-koi',
  'sekai-hana',
  'makenaide',
  'hanataba',
  'hanamizuki',
  'ihoujin',
  'ue-wo-muite',
  'ruby-no-yubiwa',
  'qingtian',
  'yueliang',
] as const

/** Hard-coded picks elsewhere: Saki's slow pair and the sim's fallbacks (room), the voice demo's picks. */
export const SCRIPTED_SONGS = ['lemon', 'dry-flower', 'marigold', 'pretender', 'hakujitsu', 'subtitle', 'kanade', 'cha-la'] as const

/**
 * Everything the demo path can light up tonight. Past nights loaded for a pitch (seedPastNights)
 * must never pre-light these, or beats 4 and 7 add nothing to the collection (QA DEMO#3).
 */
export const DEMO_PATH: ReadonlySet<string> = new Set<string>([
  ...Object.values(LOCALE_OPENERS).flatMap(rows => rows.flatMap(r => ('songId' in r && r.songId ? [r.songId] : []))),
  ...OPENER_FALLBACK,
  ...IMPORT_DEMO,
  ...SCRIPTED_SONGS,
  ...DEMO_SONGS,
  // the J-4 "一緒に選ばれている" rows of the demo's songs (link cards, visa picks)
  ...DEMO_SONGS.flatMap(id => SONG_BY_ID[id]?.coOccurrence ?? []),
])

/**
 * The past two nights a pitch loads ("過去の夜を読み込む（デモ用）"): 30 songs across genres and
 * eras, all outside DEMO_PATH. Reserved or sung back then (neon / mirror / prism), never merely
 * kept: a kept face would pull the dealer's "知ってる？" and request picks into the past.
 */
export const SEED_NIGHT_SONGS = [
  'gunjou',
  'kanden',
  'kimi-rock',
  'usseewa',
  'odoriko',
  'automatic',
  'can-you-celebrate',
  'sekai-ga-owaru',
  'specialz',
  'homura',
  'kaikai-kitan',
  'unravel',
  'kimi-shiranai',
  'watashi-saikyo',
  'hanabi-mrchildren',
  'cherry',
  'robinson',
  'marunouchi',
  'charles',
  'kawaikute-gomen',
  'otonoke',
  'dynamite',
  'butter',
  'tt',
  'love-dive',
  'super-shy',
  'let-it-go',
  'uptown-funk',
  'take-on-me',
  'bohemian',
] as const
