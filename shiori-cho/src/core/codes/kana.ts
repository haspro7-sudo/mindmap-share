// STUB (contract) — see docs/SPEC.md §4.3 (Kana codes).
import type { CodeError } from '../types';
import type { Rng } from '../encoding';

/** NFKC, katakana→hiragana, small kana→full size, ぢ→じ, づ→ず, を→お. Separators are kept. */
export declare function normalizeKana(input: string): string;
/** Split a (normalized or raw) kana input into 5 known words; validates against KANA_WORDS. */
export declare function splitKanaWords(input: string): { ok: true; words: string[] } | { ok: false; error: CodeError };
/** 5 random words from KANA_WORDS (uniform: one random byte per word). */
export declare function generateKana(rng?: Rng): string[];
/** words joined with '・' */
export declare function formatKana(words: readonly string[]): string;
