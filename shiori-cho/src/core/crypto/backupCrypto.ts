// STUB (contract) — passphrase encryption: PBKDF2-SHA256 (default 600k) → AES-GCM-256, random 16B salt / 12B iv.
import type { EncryptedJson } from '../types';

export declare function encryptJson(value: unknown, passphrase: string, opts: { aad: string; iterations?: number }): Promise<EncryptedJson>;
/** throws ShioriError('decrypt') on wrong passphrase / tamper */
export declare function decryptJson(enc: EncryptedJson, passphrase: string, aad: string): Promise<unknown>;
