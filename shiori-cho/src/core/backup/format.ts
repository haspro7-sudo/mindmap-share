// STUB (contract) — docs/SPEC.md §5.5.
import type { BackupDataV1, ParseBackupError, ParseBackupResult } from '../types';

export declare function exportBackup(data: BackupDataV1, opts: { passphrase?: string; appVersion: string; now: number; iterations?: number }): Promise<string>;
/** Parses (and decrypts, migrates, validates) a backup file. */
export declare function parseBackup(text: string, passphrase?: string): Promise<ParseBackupResult>;
export declare function isEncryptedBackupText(text: string): boolean;
/** 'shiori-backup-YYYYMMDD.json' (local date) */
export declare function backupFileName(now: number): string;
export declare function backupErrorMessageJa(e: ParseBackupError): string;
