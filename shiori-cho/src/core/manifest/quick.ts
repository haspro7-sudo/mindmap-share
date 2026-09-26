// STUB (contract) — かんたんしおり (docs/SPEC.md F6).
import type { QuickCounts, ShioriManifestV1, WorkKind } from '../types';
import type { Rng } from '../encoding';

export const QUICK_LIMITS: Readonly<QuickCounts> = { endings: 50, cg: 200, achievements: 200, tracks: 100, chapters: 30 };
/** "p-" + 10 lowercase Crockford base32 chars */
export declare function newPlayerWorkId(rng?: Rng): string;
/** Player-authored manifest (author.kind 'player', no kdf). Groups with count 0 are omitted. Throws ShioriError('validation') if all counts are 0 or out of range. */
export declare function buildQuickManifest(args: { title: string; kind: WorkKind; workId: string; counts: QuickCounts; version?: string }): ShioriManifestV1;
