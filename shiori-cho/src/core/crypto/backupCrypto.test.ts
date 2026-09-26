import { describe, it, expect, vi, afterEach } from 'vitest';
import { BACKUP_AAD, BACKUP_ITERATIONS } from '../constants';
import { b64uDecode, b64uEncode, utf8 } from '../encoding';
import { ShioriError } from '../errors';
import type { EncryptedJson } from '../types';
import { decryptJson, encryptJson } from './backupCrypto';
import { aesGcmDecrypt, aesGcmEncrypt, pbkdf2Sha256 } from './primitives';

const FAST = 1_000;
const PASS = 'correct horse battery';

const SAMPLE = {
  works: [{ id: 'a', title: '星読みの図書館', alias: 'サンプルA', tags: ['🌟', 'かな'] }],
  n: 42,
  f: 1.5,
  ok: true,
  none: null,
  nested: { deep: [1, [2, [3]]] },
};

async function caught(p: Promise<unknown>): Promise<unknown> {
  return p.then(
    () => undefined,
    (e: unknown) => e,
  );
}

async function expectCode(p: Promise<unknown>, code: string): Promise<void> {
  const err = await caught(p);
  expect(err).toBeInstanceOf(ShioriError);
  expect((err as ShioriError).code).toBe(code);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('encryptJson / decryptJson', () => {
  it('round-trips JSON values', async () => {
    const enc = await encryptJson(SAMPLE, PASS, { aad: BACKUP_AAD, iterations: FAST });
    expect(await decryptJson(enc, PASS, BACKUP_AAD)).toEqual(SAMPLE);
    for (const v of [null, 0, false, 'テキスト', [], {}]) {
      const e = await encryptJson(v, PASS, { aad: BACKUP_AAD, iterations: FAST });
      expect(await decryptJson(e, PASS, BACKUP_AAD)).toEqual(v);
    }
  });

  it('defaults to 600,000 iterations and produces a well-formed EncryptedJson', async () => {
    const enc = await encryptJson({ a: 1 }, PASS, { aad: BACKUP_AAD });
    expect(BACKUP_ITERATIONS).toBe(600_000);
    expect(enc.kdf.alg).toBe('PBKDF2-SHA256');
    expect(enc.kdf.iterations).toBe(BACKUP_ITERATIONS);
    expect(b64uDecode(enc.kdf.salt).length).toBe(16);
    expect(b64uDecode(enc.iv).length).toBe(12);
    expect(b64uDecode(enc.ct).length).toBe(utf8('{"a":1}').length + 16);
    expect(Object.keys(enc).sort()).toEqual(['ct', 'iv', 'kdf']);
    expect(await decryptJson(enc, PASS, BACKUP_AAD)).toEqual({ a: 1 });
  });

  it('key = PBKDF2(utf8(NFC(passphrase)), salt, iterations, 32); ct = AES-GCM(utf8(JSON), aad)', async () => {
    const enc = await encryptJson(SAMPLE, PASS, { aad: BACKUP_AAD, iterations: FAST });
    const key = await pbkdf2Sha256(utf8(PASS), b64uDecode(enc.kdf.salt), FAST, 32);
    const pt = await aesGcmDecrypt(key, b64uDecode(enc.iv), b64uDecode(enc.ct), utf8(BACKUP_AAD));
    expect(new TextDecoder().decode(pt)).toBe(JSON.stringify(SAMPLE));
  });

  it('uses a fresh salt and iv for every call', async () => {
    const a = await encryptJson(SAMPLE, PASS, { aad: BACKUP_AAD, iterations: FAST });
    const b = await encryptJson(SAMPLE, PASS, { aad: BACKUP_AAD, iterations: FAST });
    expect(a.kdf.salt).not.toBe(b.kdf.salt);
    expect(a.iv).not.toBe(b.iv);
    expect(a.ct).not.toBe(b.ct);
  });

  it('normalizes the passphrase to NFC', async () => {
    const composed = 'がくしゅう帳'; // が = U+304C
    const decomposed = composed.normalize('NFD'); // か + U+3099
    expect(decomposed).not.toBe(composed);
    const enc = await encryptJson(SAMPLE, decomposed, { aad: BACKUP_AAD, iterations: FAST });
    expect(await decryptJson(enc, composed, BACKUP_AAD)).toEqual(SAMPLE);
    const enc2 = await encryptJson(SAMPLE, composed, { aad: BACKUP_AAD, iterations: FAST });
    expect(await decryptJson(enc2, decomposed, BACKUP_AAD)).toEqual(SAMPLE);
  });

  it('wrong passphrase or AAD throws ShioriError("decrypt") with a Japanese message', async () => {
    const enc = await encryptJson(SAMPLE, PASS, { aad: BACKUP_AAD, iterations: FAST });
    const err = await caught(decryptJson(enc, PASS + '!', BACKUP_AAD));
    expect(err).toBeInstanceOf(ShioriError);
    expect((err as ShioriError).code).toBe('decrypt');
    expect((err as ShioriError).messageJa).toMatch(/パスフレーズ/);
    await expectCode(decryptJson(enc, '', BACKUP_AAD), 'decrypt');
    await expectCode(decryptJson(enc, 'Correct horse battery', BACKUP_AAD), 'decrypt');
    await expectCode(decryptJson(enc, PASS, 'shiori-backup/2'), 'decrypt');
    await expectCode(decryptJson(enc, PASS, ''), 'decrypt');
  });

  it('tampering with ct, iv, salt or iterations throws "decrypt"', async () => {
    const enc = await encryptJson(SAMPLE, PASS, { aad: BACKUP_AAD, iterations: FAST });
    const flip = (s: string, i = 0) => {
      const b = b64uDecode(s);
      b[i]! ^= 1;
      return b64uEncode(b);
    };
    await expectCode(decryptJson({ ...enc, ct: flip(enc.ct) }, PASS, BACKUP_AAD), 'decrypt');
    await expectCode(decryptJson({ ...enc, ct: flip(enc.ct, b64uDecode(enc.ct).length - 1) }, PASS, BACKUP_AAD), 'decrypt');
    await expectCode(decryptJson({ ...enc, iv: flip(enc.iv) }, PASS, BACKUP_AAD), 'decrypt');
    await expectCode(decryptJson({ ...enc, kdf: { ...enc.kdf, salt: flip(enc.kdf.salt) } }, PASS, BACKUP_AAD), 'decrypt');
    await expectCode(decryptJson({ ...enc, kdf: { ...enc.kdf, iterations: FAST + 1 } }, PASS, BACKUP_AAD), 'decrypt');
  });

  it('rejects malformed envelopes with "decrypt"', async () => {
    const enc = await encryptJson(SAMPLE, PASS, { aad: BACKUP_AAD, iterations: FAST });
    const bad: unknown[] = [
      null,
      'x',
      {},
      { ...enc, kdf: null },
      { ...enc, kdf: { ...enc.kdf, alg: 'PBKDF2-SHA1' } },
      { ...enc, kdf: { ...enc.kdf, salt: b64uEncode(new Uint8Array(15)) } },
      { ...enc, kdf: { ...enc.kdf, salt: b64uEncode(new Uint8Array(17)) } },
      { ...enc, kdf: { ...enc.kdf, salt: 1 } },
      { ...enc, iv: b64uEncode(new Uint8Array(11)) },
      { ...enc, iv: b64uEncode(new Uint8Array(16)) },
      { ...enc, iv: '+/==' },
      { ...enc, ct: b64uEncode(new Uint8Array(15)) },
      { ...enc, ct: undefined },
      { kdf: enc.kdf, iv: enc.iv },
    ];
    for (const e of bad) {
      await expectCode(decryptJson(e as EncryptedJson, PASS, BACKUP_AAD), 'decrypt');
    }
  });

  it('rejects out-of-range iteration counts before running the KDF (DoS guard)', async () => {
    const enc = await encryptJson(SAMPLE, PASS, { aad: BACKUP_AAD, iterations: FAST });
    const spy = vi.spyOn(globalThis.crypto.subtle, 'deriveBits');
    for (const iterations of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 5_000_001, 1e9, 2 ** 53]) {
      await expectCode(decryptJson({ ...enc, kdf: { ...enc.kdf, iterations } }, PASS, BACKUP_AAD), 'decrypt');
    }
    await expectCode(decryptJson({ ...enc, kdf: { ...enc.kdf, iterations: '1000' as unknown as number } }, PASS, BACKUP_AAD), 'decrypt');
    expect(spy).not.toHaveBeenCalled();
    // Positive control: a valid envelope does reach the KDF through the spied method.
    expect(await decryptJson(enc, PASS, BACKUP_AAD)).toEqual(SAMPLE);
    expect(spy).toHaveBeenCalled();
  });

  it('decrypted bytes that are not JSON are rejected with "decrypt"', async () => {
    // Build a valid envelope around non-JSON plaintext with the same primitives.
    const salt = new Uint8Array(16).fill(1);
    const iv = new Uint8Array(12).fill(2);
    const key = await pbkdf2Sha256(utf8(PASS), salt, FAST, 32);
    for (const pt of [utf8('{not json'), new Uint8Array([0xc3, 0x28])]) {
      const ct = await aesGcmEncrypt(key, iv, pt, utf8(BACKUP_AAD));
      const enc: EncryptedJson = {
        kdf: { alg: 'PBKDF2-SHA256', iterations: FAST, salt: b64uEncode(salt) },
        iv: b64uEncode(iv),
        ct: b64uEncode(ct),
      };
      await expectCode(decryptJson(enc, PASS, BACKUP_AAD), 'decrypt');
    }
  });

  it('encryptJson validates its inputs', async () => {
    await expectCode(encryptJson(SAMPLE, '', { aad: BACKUP_AAD, iterations: FAST }), 'validation');
    for (const iterations of [0, -1, 1.5, 5_000_001]) {
      await expectCode(encryptJson(SAMPLE, PASS, { aad: BACKUP_AAD, iterations }), 'crypto');
    }
    await expectCode(encryptJson(undefined, PASS, { aad: BACKUP_AAD, iterations: FAST }), 'encoding');
    await expectCode(encryptJson(() => 1, PASS, { aad: BACKUP_AAD, iterations: FAST }), 'encoding');
    await expectCode(encryptJson({ big: 1n }, PASS, { aad: BACKUP_AAD, iterations: FAST }), 'encoding');
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    await expectCode(encryptJson(circular, PASS, { aad: BACKUP_AAD, iterations: FAST }), 'encoding');
  });

  it('accepts the lower boundary iteration count 1', async () => {
    const enc = await encryptJson(SAMPLE, PASS, { aad: BACKUP_AAD, iterations: 1 });
    expect(await decryptJson(enc, PASS, BACKUP_AAD)).toEqual(SAMPLE);
  });
});
