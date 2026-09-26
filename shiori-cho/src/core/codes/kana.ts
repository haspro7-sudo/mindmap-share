// Kana word 合言葉: 5 words from the frozen 256-word list (docs/SPEC.md §4.3 "Code formats").
import { ShioriError } from '../errors';
import { randomBytes } from '../encoding';
import type { Rng } from '../encoding';
import type { CodeError } from '../types';
import { KANA_WORDS } from './kanaWords';

export const KANA_WORD_COUNT = 5;
export const KANA_WORD_LENGTH = 3;
export const KANA_DISPLAY_SEPARATOR = '・';

const WORD_SET: ReadonlySet<string> = new Set(KANA_WORDS);

/** Small kana → full size, plus the spelling merges ぢ→じ, づ→ず, を→お. */
const KANA_FOLD: Readonly<Record<string, string>> = {
  ぁ: 'あ',
  ぃ: 'い',
  ぅ: 'う',
  ぇ: 'え',
  ぉ: 'お',
  っ: 'つ',
  ゃ: 'や',
  ゅ: 'ゆ',
  ょ: 'よ',
  ゎ: 'わ',
  ゕ: 'か',
  ゖ: 'け',
  ぢ: 'じ',
  づ: 'ず',
  を: 'お',
};

/**
 * Word separators (after normalizeKana): whitespace, 、。・,./- _ and the dash family
 * (‐ ‑ ‒ – — ― − ー and wave dashes). No word contains any of them, so ー is safe to split on.
 */
const KANA_SEPARATORS = /[\s、。・,./\-_‐‑‒–—―−ー〜~]+/u;
/** Invisible format characters (zero-width space, BOM, bidi controls…) that paste can smuggle in. */
const FORMAT_CHARS = /\p{Cf}/gu;

/**
 * Turns spacing dakuten/handakuten (゛ U+309B, ゜ U+309C) into combining marks. Apply BEFORE NFKC:
 * NFKC alone would turn 「か゛」 into 「か」 + space + mark instead of composing 「が」.
 */
export function foldSpacingVoicedMarks(s: string): string {
  return s.replace(/\u309B/g, '\u3099').replace(/\u309C/g, '\u309A');
}

/**
 * NFKC, katakana→hiragana, small kana→full size, ぢ→じ, づ→ず, を→お. Separators are kept.
 * Spacing dakuten/handakuten (゛゜) are composed too (「か゛」 → 「が」), and invisible format
 * characters are removed. Idempotent.
 */
export function normalizeKana(input: string): string {
  const nfkc = foldSpacingVoicedMarks(input).replace(FORMAT_CHARS, '').normalize('NFKC');
  let out = '';
  for (const ch of nfkc) {
    const cp = ch.codePointAt(0)!;
    const hira = cp >= 0x30a1 && cp <= 0x30f6 ? String.fromCodePoint(cp - 0x60) : ch;
    out += KANA_FOLD[hira] ?? hira;
  }
  return out;
}

function chunkWords(chars: readonly string[]): string[] {
  const words: string[] = [];
  for (let i = 0; i < chars.length; i += KANA_WORD_LENGTH) {
    words.push(chars.slice(i, i + KANA_WORD_LENGTH).join(''));
  }
  return words;
}

function wordCountError(got: number): { ok: false; error: CodeError } {
  return { ok: false, error: { kind: 'wordCount', got, expected: KANA_WORD_COUNT } };
}

/**
 * Split a (normalized or raw) kana input into 5 known words; validates against KANA_WORDS.
 *
 * - Without separators (leading/trailing ones are ignored) the input is cut into 3-character
 *   chunks; a length that is not exactly 15 gives `wordCount` with `got = ceil(len / 3)`.
 * - With separators, the tokens are the words (empty tokens dropped) and there must be 5 of them.
 *   A token whose length is a multiple of 3 is also cut into 3-character chunks, so partially
 *   separated input such as 「ほたるかえで つばめ こだま すずめ」 is accepted too.
 * - The word count is checked first, then each word in order (`unknownWord`, 0-based index,
 *   hiragana form).
 */
export function splitKanaWords(input: string): { ok: true; words: string[] } | { ok: false; error: CodeError } {
  const tokens = normalizeKana(input)
    .split(KANA_SEPARATORS)
    .filter((t) => t.length > 0);

  let words: string[];
  if (tokens.length <= 1) {
    const chars = [...(tokens[0] ?? '')];
    if (chars.length !== KANA_WORD_COUNT * KANA_WORD_LENGTH) {
      return wordCountError(Math.ceil(chars.length / KANA_WORD_LENGTH));
    }
    words = chunkWords(chars);
  } else {
    words = [];
    for (const token of tokens) {
      const chars = [...token];
      if (chars.length > KANA_WORD_LENGTH && chars.length % KANA_WORD_LENGTH === 0) {
        words.push(...chunkWords(chars));
      } else {
        words.push(token);
      }
    }
    if (words.length !== KANA_WORD_COUNT) return wordCountError(words.length);
  }

  for (let i = 0; i < words.length; i++) {
    const word = words[i]!;
    if (!WORD_SET.has(word)) return { ok: false, error: { kind: 'unknownWord', index: i, word } };
  }
  return { ok: true, words };
}

/** 5 random words from KANA_WORDS (uniform: one random byte per word). */
export function generateKana(rng: Rng = randomBytes): string[] {
  const bytes = rng(KANA_WORD_COUNT);
  if (bytes.length < KANA_WORD_COUNT) {
    throw new ShioriError('internal', '合言葉を作るための乱数が足りません');
  }
  const words: string[] = [];
  for (let i = 0; i < KANA_WORD_COUNT; i++) words.push(KANA_WORDS[bytes[i]!]!);
  return words;
}

/** words joined with '・' */
export function formatKana(words: readonly string[]): string {
  return words.join(KANA_DISPLAY_SEPARATOR);
}
