// STUB (contract) — docs/SPEC.md F15.
import type { MergeStats, ParseBackupResult } from '../core/types';
import type { ShioriRepo } from '../storage/repo';

/** Returns { filename, text }; updates lastBackupAt and resets changesSinceBackup. */
export declare function exportBackupFile(repo: ShioriRepo, opts: { passphrase?: string; now?: number }): Promise<{ filename: string; text: string }>;
export declare function readBackupFile(text: string, passphrase?: string): Promise<ParseBackupResult>;
/** Applies a parsed backup: 'replace' → replaceAll; 'merge' → mergeBackup(local, incoming) then replaceAll(merged) keeping local settings. Re-derives nothing (masters are re-derived lazily). */
export declare function applyBackup(repo: ShioriRepo, data: Extract<ParseBackupResult, { ok: true }>['data'], mode: 'replace' | 'merge'): Promise<MergeStats | null>;
/** true when a backup reminder banner should show */
export declare function shouldRemindBackup(settings: import('../core/types').Settings, hasData: boolean, now: number): boolean;
