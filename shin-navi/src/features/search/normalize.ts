// Text normalisation for search in any script (SPEC L/M8, G-4 "検索はすべての表記に当たる").
// normalize(): NFKC → lower case → katakana→hiragana → drop spaces, symbols and long-vowel
// marks. The helpers below give extra keys so a query typed one way still meets a title stored
// another way: kana → Hepburn romaji, a "loose" romaji key (shi/si, tsu/tu, ou/oo/o …) and
// Hangul jamo (so a syllable still being composed by the IME already matches).

const LONG_VOWEL = /[ー〜～]/g
/** Anything that is not a letter or a number (spaces, punctuation, symbols, emoji). */
const NON_WORD = /[^\p{L}\p{N}]/gu
/** Latin letters with diacritics (é, ü, ō …). */
const ACCENTED = /[À-ɏḀ-ỿ]/g

function kataToHira(s: string): string {
  return s.replace(/[ァ-ヶ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60))
}

/** NFKC, lower case, katakana → hiragana, strip spaces / symbols / long-vowel marks. */
export function normalize(s: string): string {
  if (!s) return ''
  return kataToHira(
    s
      .normalize('NFKC')
      .toLowerCase()
      .replace(ACCENTED, ch => ch.normalize('NFD').replace(/\p{M}/gu, '')),
  )
    .replace(LONG_VOWEL, '')
    .replace(NON_WORD, '')
}

/** Normalises one word at a time and records where each word starts (for word-prefix hits). */
export function normalizeWords(s: string): { n: string; starts: number[] } {
  const starts: number[] = []
  let n = ''
  for (const w of s.split(/[\s\p{P}\p{S}]+/u)) {
    const nw = normalize(w)
    if (!nw) continue
    starts.push(n.length)
    n += nw
  }
  return { n, starts }
}

/**
 * Normalised text plus, for each normalised character, the index of the source character it
 * came from. Used only to highlight the matched part of a title.
 */
export function normalizeMapped(s: string): { n: string; map: number[] } {
  let n = ''
  const map: number[] = []
  let i = 0
  for (const ch of s) {
    const out = normalize(ch)
    for (let k = 0; k < out.length; k++) {
      n += out[k]
      map.push(i)
    }
    i += ch.length
  }
  return { n, map }
}

export const hasKana = (s: string): boolean => /[ぁ-ゖ]/.test(s)
export const hasHangul = (s: string): boolean => /[가-힣ᄀ-ᇿ㄰-㆏]/.test(s)
export const isLatin = (s: string): boolean => /^[a-z0-9]+$/.test(s)

// ---------------------------------------------------------------- kana → romaji (Hepburn)

const MONO: Record<string, string> = {
  あ: 'a', い: 'i', う: 'u', え: 'e', お: 'o',
  か: 'ka', き: 'ki', く: 'ku', け: 'ke', こ: 'ko',
  さ: 'sa', し: 'shi', す: 'su', せ: 'se', そ: 'so',
  た: 'ta', ち: 'chi', つ: 'tsu', て: 'te', と: 'to',
  な: 'na', に: 'ni', ぬ: 'nu', ね: 'ne', の: 'no',
  は: 'ha', ひ: 'hi', ふ: 'fu', へ: 'he', ほ: 'ho',
  ま: 'ma', み: 'mi', む: 'mu', め: 'me', も: 'mo',
  や: 'ya', ゆ: 'yu', よ: 'yo',
  ら: 'ra', り: 'ri', る: 'ru', れ: 're', ろ: 'ro',
  わ: 'wa', ゐ: 'i', ゑ: 'e', を: 'o', ん: 'n',
  が: 'ga', ぎ: 'gi', ぐ: 'gu', げ: 'ge', ご: 'go',
  ざ: 'za', じ: 'ji', ず: 'zu', ぜ: 'ze', ぞ: 'zo',
  だ: 'da', ぢ: 'ji', づ: 'zu', で: 'de', ど: 'do',
  ば: 'ba', び: 'bi', ぶ: 'bu', べ: 'be', ぼ: 'bo',
  ぱ: 'pa', ぴ: 'pi', ぷ: 'pu', ぺ: 'pe', ぽ: 'po',
  ゔ: 'vu',
  ぁ: 'a', ぃ: 'i', ぅ: 'u', ぇ: 'e', ぉ: 'o', ゃ: 'ya', ゅ: 'yu', ょ: 'yo', ゎ: 'wa', ゕ: 'ka', ゖ: 'ke',
}

/** Two-kana syllables (yōon and the extended katakana sounds). */
const DI: Record<string, string> = {
  きゃ: 'kya', きゅ: 'kyu', きょ: 'kyo', しゃ: 'sha', しゅ: 'shu', しょ: 'sho', ちゃ: 'cha', ちゅ: 'chu', ちょ: 'cho',
  にゃ: 'nya', にゅ: 'nyu', にょ: 'nyo', ひゃ: 'hya', ひゅ: 'hyu', ひょ: 'hyo', みゃ: 'mya', みゅ: 'myu', みょ: 'myo',
  りゃ: 'rya', りゅ: 'ryu', りょ: 'ryo', ぎゃ: 'gya', ぎゅ: 'gyu', ぎょ: 'gyo', じゃ: 'ja', じゅ: 'ju', じょ: 'jo',
  ぢゃ: 'ja', ぢゅ: 'ju', ぢょ: 'jo', びゃ: 'bya', びゅ: 'byu', びょ: 'byo', ぴゃ: 'pya', ぴゅ: 'pyu', ぴょ: 'pyo',
  しぇ: 'she', じぇ: 'je', ちぇ: 'che', いぇ: 'ye', てぃ: 'ti', でぃ: 'di', とぅ: 'tu', どぅ: 'du', でゅ: 'dyu',
  ふぁ: 'fa', ふぃ: 'fi', ふぇ: 'fe', ふぉ: 'fo', ふゅ: 'fyu', うぃ: 'wi', うぇ: 'we', うぉ: 'wo',
  ゔぁ: 'va', ゔぃ: 'vi', ゔぇ: 've', ゔぉ: 'vo', つぁ: 'tsa', つぃ: 'tsi', つぇ: 'tse', つぉ: 'tso', くぁ: 'kwa',
}

/** Converts every hiragana run in a normalised string to Hepburn romaji (other letters stay). */
export function kanaToRomaji(s: string): string {
  let out = ''
  let gem = false // っ: double the next consonant
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (c === 'っ') {
      gem = true
      continue
    }
    let r = DI[c + (s[i + 1] ?? '')]
    if (r) i++
    else r = MONO[c]
    if (r == null) {
      out += c
      gem = false
      continue
    }
    if (gem) {
      out += r.startsWith('ch') ? 't' : /^[a-z]/.test(r) && !/^[aiueon]/.test(r) ? r[0] : ''
      gem = false
    }
    out += r
  }
  return out
}

/**
 * Loose romaji key: folds the usual spelling variants together (shi/si, chi/ti, tsu/tu, ji/zi,
 * fu/hu, wo/o, long vowels ou/oo/uu/ee, doubled consonants, n/m before b·p·m). Applied to both
 * sides, so it only ever widens a match; loose hits score below exact ones.
 */
export function looseLatin(s: string): string {
  return s
    .replace(/m(?=[bpm])/g, 'n')
    .replace(/tch/g, 'ch')
    .replace(/sh/g, 's')
    .replace(/ch/g, 't')
    .replace(/ts/g, 't')
    .replace(/dz/g, 'z')
    .replace(/j/g, 'z')
    .replace(/([szt])y(?=[aiueo])/g, '$1')
    .replace(/fu/g, 'hu')
    .replace(/wo/g, 'o')
    .replace(/(.)\1+/g, '$1')
    .replace(/ou/g, 'o')
    .replace(/ei/g, 'e')
}

/** Hangul syllables decomposed into jamo (a half-typed syllable is then a prefix). */
export function jamo(s: string): string {
  return s.normalize('NFD')
}

/** Levenshtein distance, giving up (returning max + 1) once it exceeds `max`. */
export function editDistance(a: string, b: string, max = 2): number {
  if (Math.abs(a.length - b.length) > max) return max + 1
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    let best = i
    for (let j = 1; j <= b.length; j++) {
      const v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
      cur.push(v)
      if (v < best) best = v
    }
    if (best > max) return max + 1
    prev = cur
  }
  return prev[b.length]
}
