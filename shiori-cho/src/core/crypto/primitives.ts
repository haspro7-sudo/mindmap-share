// STUB (contract) — WebCrypto only (globalThis.crypto.subtle).
import type { Bytes } from '../types';

export declare function pbkdf2Sha256(password: Uint8Array, salt: Uint8Array, iterations: number, lengthBytes: number): Promise<Bytes>;
export declare function hmacSha256(key: Uint8Array, msg: Uint8Array): Promise<Bytes>;
export declare function hkdfSha256(ikm: Uint8Array, salt: Uint8Array, info: Uint8Array, lengthBytes?: number): Promise<Bytes>;
/** returns ciphertext||tag */
export declare function aesGcmEncrypt(key: Uint8Array, iv: Uint8Array, plaintext: Uint8Array, aad?: Uint8Array): Promise<Bytes>;
/** throws ShioriError('decrypt') on auth failure */
export declare function aesGcmDecrypt(key: Uint8Array, iv: Uint8Array, ciphertext: Uint8Array, aad?: Uint8Array): Promise<Bytes>;
