// STUB (contract) — the no-spoil guard (docs/SPEC.md F16 AC4).
import type { StudioProject } from '../types';

/** All secret strings of a project that must never appear in the public JSON (codes in display+canonical forms, secret titles unless equal to the public label, descriptions, unlock messages, payload titles/bodies/from, return codes). Empty/very short strings (< 2 chars) are skipped. */
export declare function collectSecrets(project: StudioProject): string[];
/** Returns the secrets that occur in `json` (also checks JSON-escaped forms). */
export declare function findLeaks(json: string, secrets: readonly string[]): string[];
