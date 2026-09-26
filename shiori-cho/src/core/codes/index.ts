// 合言葉 parsing, generation and messages (docs/SPEC.md §4.3 "Code formats", F10 AC1–AC2).
import type { CodeError, CodeKind, ParsedCode } from '../types';
import type { Rng } from '../encoding';
import { B32_CODE_LENGTH, CROCKFORD_ALPHABET, formatB32, generateB32, normalizeB32 } from './crockford';
import {
  KANA_WORD_COUNT,
  KANA_WORD_LENGTH,
  foldSpacingVoicedMarks,
  formatKana,
  generateKana,
  splitKanaWords,
} from './kana';

export {
  B32_CODE_LENGTH,
  CROCKFORD_ALPHABET,
  formatB32,
  generateB32,
  luhn32Check,
  luhn32Valid,
  normalizeB32,
} from './crockford';
export { KANA_WORD_COUNT, formatKana, generateKana, normalizeKana, splitKanaWords } from './kana';
export { KANA_WORDS } from './kanaWords';

export const B32_PREFIX = 'b32:';
export const KANA_PREFIX = 'kana:';

/**
 * Letters that make an input a kana code: hiragana and katakana (after NFKC, so half-width
 * katakana count too). The punctuation in the same Unicode blocks (・ U+30FB, ー U+30FC, ゠, and
 * the voiced sound marks) is deliberately left out: ・ and ー are separators in both formats, so
 * 「K7Q・M2X・RAP」 is still a Base32 code.
 */
const KANA_LETTER = /[\u3041-\u3096\u309D-\u309F\u30A1-\u30FA\u30FD-\u30FF]/u;
const ASCII_ALNUM = /[A-Za-z0-9]/;
const CANONICAL_PREFIX = /^(b32|kana):/i;
const CANONICAL_B32 = new RegExp(`^[${CROCKFORD_ALPHABET}]{${B32_CODE_LENGTH}}$`);
const CANONICAL_KANA = new RegExp(`^[\\u3041-\\u3096]{${KANA_WORD_COUNT * KANA_WORD_LENGTH}}$`, 'u');

/** NFKC (composing spacing ゛゜ first) and trim. */
function nfkc(input: string): string {
  return foldSpacingVoicedMarks(input).normalize('NFKC').trim();
}

/** 'kana' if the NFKC form contains any hiragana/katakana letter, 'b32' otherwise, null if blank. */
export function detectCodeKind(input: string): CodeKind | null {
  const s = nfkc(input);
  if (s.length === 0) return null;
  const prefix = CANONICAL_PREFIX.exec(s);
  if (prefix) return prefix[1]!.toLowerCase() === 'kana' ? 'kana' : 'b32';
  return KANA_LETTER.test(s) ? 'kana' : 'b32';
}

function parseB32(s: string): ParsedCode {
  const r = normalizeB32(s);
  if (!r.ok) return { ok: false, kind: 'b32', error: r.error };
  return { ok: true, kind: 'b32', canonical: B32_PREFIX + r.value, display: formatB32(r.value) };
}

function parseKana(s: string): ParsedCode {
  if (ASCII_ALNUM.test(s)) return { ok: false, kind: 'kana', error: { kind: 'mixed' } };
  const r = splitKanaWords(s);
  if (!r.ok) return { ok: false, kind: 'kana', error: r.error };
  return { ok: true, kind: 'kana', canonical: KANA_PREFIX + r.words.join(''), display: formatKana(r.words) };
}

/**
 * Auto-detects kind (any hiragana/katakana after NFKC → kana, else b32). Never runs a KDF.
 *
 * Accepts display forms in any width, case or separators, and also canonical forms
 * (`b32:K7QM2XRAP`, `kana:ほたる…`, prefix case-insensitive) such as those stored for pending codes
 * or carried by deep links. Kana input that also contains ASCII letters or digits is `mixed`.
 */
export function parseCode(input: string): ParsedCode {
  if (typeof input !== 'string') return { ok: false, error: { kind: 'empty' } };
  const s = nfkc(input);
  if (s.length === 0) return { ok: false, error: { kind: 'empty' } };

  const prefix = CANONICAL_PREFIX.exec(s);
  if (prefix) {
    const kind: CodeKind = prefix[1]!.toLowerCase() === 'kana' ? 'kana' : 'b32';
    const rest = s.slice(prefix[0].length);
    if (rest.trim().length === 0) return { ok: false, kind, error: { kind: 'empty' } };
    return kind === 'kana' ? parseKana(rest) : parseB32(rest);
  }
  return KANA_LETTER.test(s) ? parseKana(s) : parseB32(s);
}

export function generateCode(kind: CodeKind, rng?: Rng): { canonical: string; display: string } {
  if (kind === 'kana') {
    const words = generateKana(rng);
    return { canonical: KANA_PREFIX + words.join(''), display: formatKana(words) };
  }
  const value = generateB32(rng);
  return { canonical: B32_PREFIX + value, display: formatB32(value) };
}

/**
 * 'b32:K7QM2XRAP' → 'K7Q-M2X-RAP'; 'kana:ほたる…' → 'ほたる・かえで・…'.
 * Anything else is parsed leniently; if it still is not a code it is returned unchanged.
 */
export function displayFromCanonical(canonical: string): string {
  if (canonical.startsWith(B32_PREFIX)) {
    const rest = canonical.slice(B32_PREFIX.length);
    if (CANONICAL_B32.test(rest)) return formatB32(rest);
  } else if (canonical.startsWith(KANA_PREFIX)) {
    const rest = canonical.slice(KANA_PREFIX.length);
    if (CANONICAL_KANA.test(rest)) {
      const chars = [...rest];
      const words: string[] = [];
      for (let i = 0; i < chars.length; i += KANA_WORD_LENGTH) {
        words.push(chars.slice(i, i + KANA_WORD_LENGTH).join(''));
      }
      return formatKana(words);
    }
  }
  const parsed = parseCode(canonical);
  return parsed.ok ? parsed.display : canonical;
}

const INVISIBLE_OR_COMBINING = /^[\p{C}\p{Z}\p{M}]/u;
const MAX_WORD_SHOWN = 12;

/** Shows a character the user can see; invisible, space or combining ones as U+XXXX. */
function showChar(ch: string): string {
  if (!INVISIBLE_OR_COMBINING.test(ch)) return ch;
  return 'U+' + ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0');
}

function showWord(word: string): string {
  const chars = [...word];
  return chars.length > MAX_WORD_SHOWN ? chars.slice(0, MAX_WORD_SHOWN).join('') + '…' : word;
}

/** Japanese message for a CodeError (e.g. 「入力ミスがあるようです。1文字違っているかもしれません」). */
export function codeErrorMessageJa(e: CodeError): string {
  switch (e.kind) {
    case 'empty':
      return '合言葉を入力してください';
    case 'charset':
      return e.char ? `使えない文字が含まれています（${showChar(e.char)}）` : '使えない文字が含まれています';
    case 'mixed':
      return '英数字とひらがなが混ざっています';
    case 'length':
      return `英数字の合言葉は${e.expected}文字です（いま ${e.got}文字）`;
    case 'checksum':
      return '入力ミスがあるようです。1文字違っているかもしれません';
    case 'wordCount':
      // e.g. 14 characters without separators: rounds up to 5 "words", so say what is wrong instead.
      if (e.got === e.expected) {
        return `ひらがなの合言葉は${e.expected}語（${e.expected * KANA_WORD_LENGTH}文字）です。文字数を確かめてください`;
      }
      return `ひらがなの合言葉は${e.expected}語です（いま ${e.got}語）`;
    case 'unknownWord':
      return `${e.index + 1}語目『${showWord(e.word)}』が見つかりません`;
    default: {
      const unreachable: never = e;
      void unreachable;
      return '合言葉を確かめてください';
    }
  }
}
