// STUB (contract) — PBKDF2-SHA256, 200k iterations, 16-byte salt.
import type { PinRecord } from '../types';

/** 4–8 ASCII digits */
export declare function isValidPinFormat(pin: string): boolean;
export declare function hashPin(pin: string, opts?: { iterations?: number; salt?: Uint8Array }): Promise<PinRecord>;
/** constant-time compare */
export declare function verifyPin(pin: string, stored: PinRecord): Promise<boolean>;
