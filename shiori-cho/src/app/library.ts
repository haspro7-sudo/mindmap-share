// STUB (contract) — library services (no React). docs/SPEC.md F4–F7.
import type { CoverColor, ImportPreview, ManifestSource, QuickCounts, ShioriManifestV1, UnlockOutcome, WorkKind, WorkRecord } from '../core/types';
import type { ShioriRepo } from '../storage/repo';

export declare function previewImport(repo: ShioriRepo, text: string): Promise<ImportPreview>;
/**
 * New: creates WorkRecord (alias = manifest.work.safeTitle ?? nextAlias), stores ManifestRecord.
 * Update: stores new ManifestRecord, upgradeProgress (archive/unarchive), re-derives masters if kdf changed, sets newGoalIds, deletes the old ManifestRecord.
 * Then processPending + sealed evaluation. Returns the local work id and pending outcomes.
 */
export declare function commitImport(
  repo: ShioriRepo,
  preview: Exclude<ImportPreview, { kind: 'invalid' }>,
  opts: { source: ManifestSource; now?: number },
): Promise<{ workId: string; pendingOutcomes: UnlockOutcome[] }>;
export declare function createWork(
  repo: ShioriRepo,
  input: { title: string; alias?: string; storeCode?: string; kind: WorkKind; coverEmoji?: string; coverColor?: CoverColor },
  now?: number,
): Promise<WorkRecord>;
export declare function createQuickWork(
  repo: ShioriRepo,
  input: { title: string; alias?: string; storeCode?: string; kind: WorkKind; counts: QuickCounts },
  now?: number,
): Promise<WorkRecord>;
/** Imports both bundled SFW demos (idempotent: existing demo works are kept). Returns local work ids. */
export declare function importBundledDemos(repo: ShioriRepo, now?: number): Promise<string[]>;
/** For player-owned manifests (author.kind 'player'): apply a mutation, validate, store as source 'player-edit'. */
export declare function updatePlayerManifest(repo: ShioriRepo, workId: string, mutate: (m: ShioriManifestV1) => ShioriManifestV1, now?: number): Promise<void>;
export declare function exportPlayerManifest(repo: ShioriRepo, workId: string): Promise<string>;
/** Manual toggle; records hintTierAtDone from the current hint reveal. */
export declare function setGoalDone(repo: ShioriRepo, workId: string, goalId: string, done: boolean, now?: number): Promise<void>;
/** Loads the ManifestRecord for a work (or undefined). */
export declare function getWorkManifest(repo: ShioriRepo, workId: string): Promise<ShioriManifestV1 | undefined>;
