// STUB (contract) — owner replaces `declare` with implementations. See docs/SPEC.md §4.3.
import type { CodeError } from '../types';
import type { Rng } from '../encoding';

export const CROCKFORD_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
/** Luhn mod 32 check symbol for `data` (alphabet chars, uppercase). */
export declare function luhn32Check(data: string): string;
/** True if the last symbol is a valid Luhn mod 32 check over the preceding ones. */
export declare function luhn32Valid(code: string): boolean;
/** NFKC → upper → strip separators → O→0, I/L→1 → 9 chars → Luhn check. value = 9 canonical chars (no prefix). */
export declare function normalizeB32(input: string): { ok: true; value: string } | { ok: false; error: CodeError };
/** 8 random symbols + check symbol (9 chars, no prefix, no dashes). */
export declare function generateB32(rng?: Rng): string;
/** 'K7QM2XRAP' → 'K7Q-M2X-RAP' */
export declare function formatB32(nine: string): string;
