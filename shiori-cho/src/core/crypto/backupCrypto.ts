// Passphrase encryption for backups (docs/SPEC.md §5.5, F15 AC1):
// PBKDF2-SHA256 (default 600k) over utf8(NFC(passphrase)) → AES-GCM-256, random 16B salt / 12B iv.
import { BACKUP_ITERATIONS } from '../constants';
import { b64uDecode, b64uEncode, fromUtf8, randomBytes, utf8 } from '../encoding';
import { ShioriError } from '../errors';
import type { Bytes, EncryptedJson } from '../types';
import { GCM_IV_BYTES, GCM_TAG_BYTES, aesGcmDecrypt, aesGcmEncrypt, pbkdf2Sha256 } from './primitives';

export const BACKUP_SALT_BYTES = 16;
const KEY_BYTES = 32;
/** Files asking for more iterations are rejected before any KDF runs (DoS guard). */
export const BACKUP_ITERATIONS_MAX = 5_000_000;

const MSG_DECRYPT = 'パスフレーズが違うか、データが壊れています';

function validIterations(n: unknown): n is number {
  return typeof n === 'number' && Number.isSafeInteger(n) && n >= 1 && n <= BACKUP_ITERATIONS_MAX;
}

function deriveKey(passphrase: string, salt: Uint8Array, iterations: number): Promise<Bytes> {
  return pbkdf2Sha256(utf8(passphrase.normalize('NFC')), salt, iterations, KEY_BYTES);
}

export async function encryptJson(value: unknown, passphrase: string, opts: { aad: string; iterations?: number }): Promise<EncryptedJson> {
  if (typeof passphrase !== 'string' || passphrase.length === 0) {
    throw new ShioriError('validation', 'パスフレーズを入力してください');
  }
  const iterations = opts.iterations ?? BACKUP_ITERATIONS;
  if (!validIterations(iterations)) throw new ShioriError('crypto', '暗号化の設定が正しくありません');
  let json: string | undefined;
  try {
    json = JSON.stringify(value);
  } catch (cause) {
    throw new ShioriError('encoding', 'データを保存用の形式に変換できませんでした', { cause });
  }
  if (typeof json !== 'string') throw new ShioriError('encoding', 'データを保存用の形式に変換できませんでした');

  const salt = randomBytes(BACKUP_SALT_BYTES);
  const iv = randomBytes(GCM_IV_BYTES);
  const key = await deriveKey(passphrase, salt, iterations);
  const ct = await aesGcmEncrypt(key, iv, utf8(json), utf8(opts.aad));
  return {
    kdf: { alg: 'PBKDF2-SHA256', iterations, salt: b64uEncode(salt) },
    iv: b64uEncode(iv),
    ct: b64uEncode(ct),
  };
}

/** throws ShioriError('decrypt') on wrong passphrase / tamper */
export async function decryptJson(enc: EncryptedJson, passphrase: string, aad: string): Promise<unknown> {
  try {
    if (typeof enc !== 'object' || enc === null) throw new TypeError('enc is not an object');
    const { kdf } = enc;
    if (typeof kdf !== 'object' || kdf === null || kdf.alg !== 'PBKDF2-SHA256') throw new TypeError('unsupported kdf');
    if (!validIterations(kdf.iterations)) throw new RangeError('iterations out of range');
    if (typeof kdf.salt !== 'string' || typeof enc.iv !== 'string' || typeof enc.ct !== 'string') {
      throw new TypeError('salt/iv/ct must be strings');
    }
    if (typeof passphrase !== 'string' || typeof aad !== 'string') throw new TypeError('bad arguments');
    const salt = b64uDecode(kdf.salt);
    const iv = b64uDecode(enc.iv);
    const ct = b64uDecode(enc.ct);
    if (salt.length !== BACKUP_SALT_BYTES || iv.length !== GCM_IV_BYTES || ct.length < GCM_TAG_BYTES) {
      throw new RangeError('bad salt/iv/ct length');
    }
    const key = await deriveKey(passphrase, salt, kdf.iterations);
    const pt = await aesGcmDecrypt(key, iv, ct, utf8(aad));
    return JSON.parse(fromUtf8(pt)) as unknown;
  } catch (cause) {
    throw new ShioriError('decrypt', MSG_DECRYPT, { cause });
  }
}
