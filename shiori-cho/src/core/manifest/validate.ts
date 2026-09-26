// STUB (contract) — see docs/SPEC.md §4.2.
import type { ShioriManifestV1, ValidateResult } from '../types';

/** Size check (512 KiB, UTF-8 bytes) → JSON.parse (Japanese error with position) → validateManifest. */
export declare function parseManifestText(text: string): ValidateResult;
/** Structural (zod) + cross-reference + binary-length checks. Unknown keys stripped. Defaults filled. */
export declare function validateManifest(obj: unknown): ValidateResult;
/** b64u(SHA-256(utf8(JSON.stringify(manifest)))) */
export declare function manifestKey(m: ShioriManifestV1): Promise<string>;
