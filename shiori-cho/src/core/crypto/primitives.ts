// WebCrypto-only primitives (globalThis.crypto.subtle). docs/SPEC.md §4.3.
//
// Every input is copied into a fresh Uint8Array<ArrayBuffer> before it reaches SubtleCrypto. This
// avoids SharedArrayBuffer / cross-realm typing issues and guarantees that callers passing views
// into larger buffers (subarray) never leak neighbouring bytes.
import { ShioriError } from '../errors';
import type { Bytes } from '../types';

/** AES-GCM IV length used everywhere in しおり帳 (bytes). */
export const GCM_IV_BYTES = 12;
/** AES-GCM tag length (bytes); ciphertexts are ciphertext||tag. */
export const GCM_TAG_BYTES = 16;
/** HKDF-SHA256 can output at most 255 * HashLen bytes (RFC 5869 §2.3). */
const HKDF_MAX_BYTES = 255 * 32;

const MSG_UNAVAILABLE = 'この環境では暗号機能を利用できません';
const MSG_PARAMS = '暗号処理の設定が正しくありません';
const MSG_FAILED = '暗号処理に失敗しました';
export const DECRYPT_MESSAGE_JA = '復号できませんでした';

function subtle(): SubtleCrypto {
  const s = globalThis.crypto?.subtle;
  if (!s) throw new ShioriError('crypto', MSG_UNAVAILABLE);
  return s;
}

/** Fresh copy backed by a plain ArrayBuffer (never shares memory with the caller). */
function copy(b: Uint8Array): Bytes {
  return new Uint8Array(b) as Bytes;
}

function assertBytes(b: unknown, what: string): asserts b is Uint8Array {
  if (!(b instanceof Uint8Array)) throw new ShioriError('crypto', MSG_PARAMS, { cause: new TypeError(`${what} must be a Uint8Array`) });
}

function assertPositiveInt(n: number, max: number, what: string): void {
  if (!Number.isSafeInteger(n) || n < 1 || n > max) {
    throw new ShioriError('crypto', MSG_PARAMS, { cause: new RangeError(`${what} out of range: ${String(n)}`) });
  }
}

function isAesKeyLength(n: number): boolean {
  return n === 16 || n === 24 || n === 32;
}

async function run<T>(op: () => Promise<T>): Promise<T> {
  try {
    return await op();
  } catch (cause) {
    if (cause instanceof ShioriError) throw cause;
    throw new ShioriError('crypto', MSG_FAILED, { cause });
  }
}

/** PBKDF2-HMAC-SHA256. */
export async function pbkdf2Sha256(password: Uint8Array, salt: Uint8Array, iterations: number, lengthBytes: number): Promise<Bytes> {
  assertBytes(password, 'password');
  assertBytes(salt, 'salt');
  assertPositiveInt(iterations, Number.MAX_SAFE_INTEGER, 'iterations');
  assertPositiveInt(lengthBytes, 1 << 20, 'lengthBytes');
  const s = subtle();
  return run(async () => {
    const key = await s.importKey('raw', copy(password), 'PBKDF2', false, ['deriveBits']);
    const bits = await s.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: copy(salt), iterations }, key, lengthBytes * 8);
    return new Uint8Array(bits) as Bytes;
  });
}

/** HMAC-SHA256 → 32 bytes. The key must be non-empty. */
export async function hmacSha256(key: Uint8Array, msg: Uint8Array): Promise<Bytes> {
  assertBytes(key, 'key');
  assertBytes(msg, 'msg');
  if (key.length === 0) throw new ShioriError('crypto', MSG_PARAMS, { cause: new RangeError('empty HMAC key') });
  const s = subtle();
  return run(async () => {
    const k = await s.importKey('raw', copy(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    return new Uint8Array(await s.sign('HMAC', k, copy(msg))) as Bytes;
  });
}

/** HKDF-SHA256 (RFC 5869) extract-and-expand; default output 32 bytes. */
export async function hkdfSha256(ikm: Uint8Array, salt: Uint8Array, info: Uint8Array, lengthBytes = 32): Promise<Bytes> {
  assertBytes(ikm, 'ikm');
  assertBytes(salt, 'salt');
  assertBytes(info, 'info');
  assertPositiveInt(lengthBytes, HKDF_MAX_BYTES, 'lengthBytes');
  const s = subtle();
  return run(async () => {
    const key = await s.importKey('raw', copy(ikm), 'HKDF', false, ['deriveBits']);
    const bits = await s.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: copy(salt), info: copy(info) }, key, lengthBytes * 8);
    return new Uint8Array(bits) as Bytes;
  });
}

function gcmParams(iv: Uint8Array, aad: Uint8Array | undefined): AesGcmParams {
  const params: AesGcmParams = { name: 'AES-GCM', iv: copy(iv), tagLength: GCM_TAG_BYTES * 8 };
  if (aad !== undefined) params.additionalData = copy(aad);
  return params;
}

/**
 * AES-GCM (128-bit tag) with a 16/24/32-byte key and a 12-byte IV.
 * Returns ciphertext||tag. Throws ShioriError('crypto') on bad parameters.
 */
export async function aesGcmEncrypt(key: Uint8Array, iv: Uint8Array, plaintext: Uint8Array, aad?: Uint8Array): Promise<Bytes> {
  assertBytes(key, 'key');
  assertBytes(iv, 'iv');
  assertBytes(plaintext, 'plaintext');
  if (aad !== undefined) assertBytes(aad, 'aad');
  if (!isAesKeyLength(key.length)) throw new ShioriError('crypto', MSG_PARAMS, { cause: new RangeError('bad AES key length') });
  if (iv.length !== GCM_IV_BYTES) throw new ShioriError('crypto', MSG_PARAMS, { cause: new RangeError('bad AES-GCM iv length') });
  const s = subtle();
  return run(async () => {
    const k = await s.importKey('raw', copy(key), 'AES-GCM', false, ['encrypt']);
    return new Uint8Array(await s.encrypt(gcmParams(iv, aad), k, copy(plaintext))) as Bytes;
  });
}

/**
 * Inverse of aesGcmEncrypt. Any failure (wrong key/iv/aad, tampering, malformed input)
 * throws ShioriError('decrypt', '復号できませんでした').
 */
export async function aesGcmDecrypt(key: Uint8Array, iv: Uint8Array, ciphertext: Uint8Array, aad?: Uint8Array): Promise<Bytes> {
  try {
    assertBytes(key, 'key');
    assertBytes(iv, 'iv');
    assertBytes(ciphertext, 'ciphertext');
    if (aad !== undefined) assertBytes(aad, 'aad');
    if (!isAesKeyLength(key.length)) throw new RangeError('bad AES key length');
    if (iv.length !== GCM_IV_BYTES) throw new RangeError('bad AES-GCM iv length');
    if (ciphertext.length < GCM_TAG_BYTES) throw new RangeError('ciphertext shorter than the tag');
    const s = subtle();
    const k = await s.importKey('raw', copy(key), 'AES-GCM', false, ['decrypt']);
    return new Uint8Array(await s.decrypt(gcmParams(iv, aad), k, copy(ciphertext))) as Bytes;
  } catch (cause) {
    throw new ShioriError('decrypt', DECRYPT_MESSAGE_JA, { cause });
  }
}
