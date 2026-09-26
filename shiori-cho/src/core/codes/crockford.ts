// Crockford Base32 合言葉 with a Luhn mod 32 check symbol (docs/SPEC.md §4.3 "Code formats").
import { ShioriError } from '../errors';
import { randomBytes } from '../encoding';
import type { Rng } from '../encoding';
import type { CodeError } from '../types';

export const CROCKFORD_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
/** Data symbols (8 × 5 bits = 40 random bits) + 1 check symbol. */
export const B32_DATA_LENGTH = 8;
export const B32_CODE_LENGTH = 9;
const RANDOM_BYTES = 5;

const RADIX = 32;
const SYMBOL_VALUE: ReadonlyMap<string, number> = new Map(
  [...CROCKFORD_ALPHABET].map((c, i) => [c, i] as const),
);

/**
 * Removed before validation: whitespace, invisible format characters (zero-width space, BOM…)
 * and `- ‐ ‑ ‒ – — ― ー ｰ − _ ・ .`. Runs after NFKC, which already folds full-width variants
 * such as `－ ＿ ． ･` into the characters listed here.
 */
const B32_SEPARATORS = /[\s\p{Cf}\-‐‑‒–—―ーｰ−_・.]/gu;
/** Crockford's decoding aliases for letters that are not in the alphabet. */
const ALIASES: Readonly<Record<string, string>> = { O: '0', I: '1', L: '1' };

function luhnAddend(value: number, factor: number): number {
  const p = factor * value;
  return Math.floor(p / RADIX) + (p % RADIX);
}

/**
 * Luhn mod 32 check symbol for `data` (alphabet chars, uppercase).
 * Walks the data right to left with factors 2, 1, 2, 1… and returns the symbol for
 * `(32 - sum % 32) % 32`. Throws ShioriError('validation') on a character outside the alphabet.
 */
export function luhn32Check(data: string): string {
  let factor = 2;
  let sum = 0;
  for (let i = data.length - 1; i >= 0; i--) {
    const ch = data[i]!;
    const v = SYMBOL_VALUE.get(ch);
    if (v === undefined) {
      throw new ShioriError('validation', `合言葉に使えない文字です（${ch}）`);
    }
    sum += luhnAddend(v, factor);
    factor = factor === 2 ? 1 : 2;
  }
  return CROCKFORD_ALPHABET[(RADIX - (sum % RADIX)) % RADIX]!;
}

/** True if the last symbol is a valid Luhn mod 32 check over the preceding ones. */
export function luhn32Valid(code: string): boolean {
  if (code.length < 2) return false;
  let factor = 1;
  let sum = 0;
  for (let i = code.length - 1; i >= 0; i--) {
    const v = SYMBOL_VALUE.get(code[i]!);
    if (v === undefined) return false;
    sum += luhnAddend(v, factor);
    factor = factor === 2 ? 1 : 2;
  }
  return sum % RADIX === 0;
}

/** Uppercases ASCII letters only (so e.g. 'ß' stays one character and is reported as-is). */
function asciiUpper(s: string): string {
  return s.replace(/[a-z]/g, (c) => c.toUpperCase());
}

/**
 * NFKC → upper → strip separators → O→0, I/L→1 → 9 chars → Luhn check.
 * value = 9 canonical chars (no prefix).
 *
 * Errors, in the order they are checked: `empty` (nothing left after stripping separators),
 * `charset` (first character outside the alphabet, e.g. 'U'), `length` (not 9 characters),
 * `checksum` (Luhn mod 32 failed). Never runs a KDF.
 */
export function normalizeB32(input: string): { ok: true; value: string } | { ok: false; error: CodeError } {
  const stripped = asciiUpper(input.normalize('NFKC')).replace(B32_SEPARATORS, '');
  if (stripped.length === 0) return { ok: false, error: { kind: 'empty' } };

  let value = '';
  for (const raw of stripped) {
    const ch = ALIASES[raw] ?? raw;
    if (!SYMBOL_VALUE.has(ch)) return { ok: false, error: { kind: 'charset', char: raw } };
    value += ch;
  }
  if (value.length !== B32_CODE_LENGTH) {
    return { ok: false, error: { kind: 'length', got: value.length, expected: B32_CODE_LENGTH } };
  }
  if (!luhn32Valid(value)) return { ok: false, error: { kind: 'checksum' } };
  return { ok: true, value };
}

/**
 * 8 random symbols + check symbol (9 chars, no prefix, no dashes).
 * Takes 5 random bytes (40 bits) and splits them into eight 5-bit symbols, most significant first.
 */
export function generateB32(rng: Rng = randomBytes): string {
  const bytes = rng(RANDOM_BYTES);
  if (bytes.length < RANDOM_BYTES) {
    throw new ShioriError('internal', '合言葉を作るための乱数が足りません');
  }
  let data = '';
  let acc = 0;
  let bits = 0;
  for (let i = 0; i < RANDOM_BYTES; i++) {
    acc = (acc << 8) | bytes[i]!;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      data += CROCKFORD_ALPHABET[(acc >> bits) & 31]!;
    }
    acc &= (1 << bits) - 1;
  }
  return data + luhn32Check(data);
}

/** 'K7QM2XRAP' → 'K7Q-M2X-RAP' (groups of 3 joined with '-'). */
export function formatB32(nine: string): string {
  const groups: string[] = [];
  for (let i = 0; i < nine.length; i += 3) groups.push(nine.slice(i, i + 3));
  return groups.join('-');
}
