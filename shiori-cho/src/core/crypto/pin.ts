// Screen-lock PIN (F3 AC1): PBKDF2-SHA256, 200k iterations, 16-byte salt, 32-byte hash.
import { PIN_ITERATIONS } from '../constants';
import { b64uDecode, b64uEncode, bytesEqual, randomBytes, utf8 } from '../encoding';
import { ShioriError } from '../errors';
import type { Bytes, PinRecord } from '../types';
import { pbkdf2Sha256 } from './primitives';

export const PIN_SALT_BYTES = 16;
export const PIN_HASH_BYTES = 32;
/** Upper bound accepted from a stored record (guards against a corrupted/hostile value locking the UI). */
export const PIN_ITERATIONS_MAX = 5_000_000;

const PIN_RE = /^\d{4,8}$/;

/** 4–8 ASCII digits */
export function isValidPinFormat(pin: string): boolean {
  return typeof pin === 'string' && PIN_RE.test(pin);
}

function validIterations(n: unknown): n is number {
  return typeof n === 'number' && Number.isSafeInteger(n) && n >= 1 && n <= PIN_ITERATIONS_MAX;
}

export async function hashPin(pin: string, opts?: { iterations?: number; salt?: Uint8Array }): Promise<PinRecord> {
  if (!isValidPinFormat(pin)) throw new ShioriError('validation', 'PINは4〜8桁の数字で入力してください');
  const iterations = opts?.iterations ?? PIN_ITERATIONS;
  if (!validIterations(iterations)) throw new ShioriError('crypto', 'PINの設定が正しくありません');
  const salt: Bytes = opts?.salt ? (new Uint8Array(opts.salt) as Bytes) : randomBytes(PIN_SALT_BYTES);
  if (salt.length !== PIN_SALT_BYTES) throw new ShioriError('crypto', 'PINの設定が正しくありません');
  const hash = await pbkdf2Sha256(utf8(pin), salt, iterations, PIN_HASH_BYTES);
  return { salt: b64uEncode(salt), iterations, hash: b64uEncode(hash) };
}

/**
 * Recomputes the hash with the stored parameters and compares in constant time.
 * Returns false (never throws) for a wrong PIN or a malformed stored record.
 */
export async function verifyPin(pin: string, stored: PinRecord): Promise<boolean> {
  if (!isValidPinFormat(pin)) return false;
  try {
    if (typeof stored !== 'object' || stored === null) return false;
    const { iterations } = stored;
    if (!validIterations(iterations)) return false;
    if (typeof stored.salt !== 'string' || typeof stored.hash !== 'string') return false;
    const salt = b64uDecode(stored.salt);
    const expected = b64uDecode(stored.hash);
    if (salt.length !== PIN_SALT_BYTES || expected.length !== PIN_HASH_BYTES) return false;
    const actual = await pbkdf2Sha256(utf8(pin), salt, iterations, PIN_HASH_BYTES);
    return bytesEqual(actual, expected);
  } catch {
    return false;
  }
}
