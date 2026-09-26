// STUB (contract) — see docs/SPEC.md §4.3.
import type { CodeError, CodeKind, ParsedCode } from '../types';
import type { Rng } from '../encoding';

/** Auto-detects kind (any hiragana/katakana after NFKC → kana, else b32). Never runs a KDF. */
export declare function parseCode(input: string): ParsedCode;
export declare function generateCode(kind: CodeKind, rng?: Rng): { canonical: string; display: string };
/** 'b32:K7QM2XRAP' → 'K7Q-M2X-RAP'; 'kana:ほたる…' → 'ほたる・かえで・…' */
export declare function displayFromCanonical(canonical: string): string;
/** Japanese message for a CodeError (e.g. 「入力ミスがあるようです。1文字違っているかもしれません」). */
export declare function codeErrorMessageJa(e: CodeError): string;
