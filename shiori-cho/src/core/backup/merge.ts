// STUB (contract) — merge rules in docs/SPEC.md §5.5.
import type { BackupDataV1, MergeStats } from '../types';

export declare function mergeBackup(local: BackupDataV1, incoming: BackupDataV1): { merged: BackupDataV1; stats: MergeStats };
