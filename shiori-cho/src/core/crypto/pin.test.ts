import { describe, it, expect } from 'vitest';
import { PIN_ITERATIONS } from '../constants';
import { b64uDecode, b64uEncode, utf8 } from '../encoding';
import { ShioriError } from '../errors';
import type { PinRecord } from '../types';
import { hashPin, isValidPinFormat, verifyPin } from './pin';
import { pbkdf2Sha256 } from './primitives';

const FAST = 1_000;

async function expectCode(p: Promise<unknown>, code: string): Promise<void> {
  const err = await p.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(ShioriError);
  expect((err as ShioriError).code).toBe(code);
}

describe('isValidPinFormat', () => {
  it('accepts 4–8 ASCII digits', () => {
    for (const p of ['0000', '1234', '12345', '123456', '1234567', '12345678', '00000000']) {
      expect(isValidPinFormat(p)).toBe(true);
    }
  });

  it('rejects everything else', () => {
    for (const p of [
      '', '1', '123', '123456789', '12a4', 'abcd', '12 34', ' 1234', '1234 ', '1234\n', '-123', '12.3', '+1234',
      '１２３４', // full-width digits
      '٣٣٣٣', // Arabic-Indic digits
      '१२३४', // Devanagari digits
    ]) {
      expect(isValidPinFormat(p)).toBe(false);
    }
    expect(isValidPinFormat(1234 as unknown as string)).toBe(false);
  });
});

describe('hashPin', () => {
  it('defaults to PBKDF2-SHA256 with 200,000 iterations, a 16-byte salt and a 32-byte hash (F3 AC1)', async () => {
    const rec = await hashPin('2468');
    expect(PIN_ITERATIONS).toBe(200_000);
    expect(rec.iterations).toBe(PIN_ITERATIONS);
    expect(b64uDecode(rec.salt).length).toBe(16);
    expect(b64uDecode(rec.hash).length).toBe(32);
    expect(Object.keys(rec).sort()).toEqual(['hash', 'iterations', 'salt']);
    expect(await verifyPin('2468', rec)).toBe(true);
    expect(await verifyPin('2469', rec)).toBe(false);
  });

  it('hash = b64u(PBKDF2(utf8(pin), salt, iterations, 32))', async () => {
    const salt = Uint8Array.from({ length: 16 }, (_, i) => i);
    const rec = await hashPin('13579', { iterations: FAST, salt });
    expect(rec.salt).toBe(b64uEncode(salt));
    expect(rec.iterations).toBe(FAST);
    expect(rec.hash).toBe(b64uEncode(await pbkdf2Sha256(utf8('13579'), salt, FAST, 32)));
  });

  it('uses a fresh random salt each time', async () => {
    const a = await hashPin('1111', { iterations: FAST });
    const b = await hashPin('1111', { iterations: FAST });
    expect(a.salt).not.toBe(b.salt);
    expect(a.hash).not.toBe(b.hash);
  });

  it('does not keep a reference to the caller salt', async () => {
    const salt = new Uint8Array(16).fill(7);
    const rec = await hashPin('1111', { iterations: FAST, salt });
    salt.fill(0);
    expect(rec.salt).toBe(b64uEncode(new Uint8Array(16).fill(7)));
    expect(await verifyPin('1111', rec)).toBe(true);
  });

  it('rejects invalid PINs with ShioriError("validation")', async () => {
    for (const p of ['123', '123456789', 'abcd', '１２３４', '']) {
      await expectCode(hashPin(p, { iterations: FAST }), 'validation');
    }
  });

  it('rejects bad salt lengths and iteration counts', async () => {
    await expectCode(hashPin('1234', { iterations: FAST, salt: new Uint8Array(15) }), 'crypto');
    await expectCode(hashPin('1234', { iterations: FAST, salt: new Uint8Array(32) }), 'crypto');
    for (const it of [0, -1, 1.5, Number.NaN, 10_000_000]) {
      await expectCode(hashPin('1234', { iterations: it }), 'crypto');
    }
  });
});

describe('verifyPin', () => {
  it('round-trips every length and distinguishes leading zeros', async () => {
    for (const pin of ['0000', '01234', '001234', '0001234', '98765432']) {
      const rec = await hashPin(pin, { iterations: FAST });
      expect(await verifyPin(pin, rec)).toBe(true);
    }
    const rec = await hashPin('0000', { iterations: FAST });
    expect(await verifyPin('00000', rec)).toBe(false);
    expect(await verifyPin('000', rec)).toBe(false);
  });

  it('uses the stored iteration count', async () => {
    const rec = await hashPin('4321', { iterations: 1 });
    expect(await verifyPin('4321', rec)).toBe(true);
    expect(await verifyPin('4321', { ...rec, iterations: 2 })).toBe(false);
  });

  it('returns false for invalid PIN input without throwing', async () => {
    const rec = await hashPin('1234', { iterations: FAST });
    for (const p of ['', '123', '１２３４', '1234 ', 'abcd']) {
      expect(await verifyPin(p, rec)).toBe(false);
    }
  });

  it('returns false (never throws) for malformed stored records', async () => {
    const rec = await hashPin('1234', { iterations: FAST });
    const bad: unknown[] = [
      null,
      undefined,
      'string',
      {},
      { ...rec, salt: '***' },
      { ...rec, salt: b64uEncode(new Uint8Array(15)) },
      { ...rec, hash: '' },
      { ...rec, hash: b64uEncode(new Uint8Array(31)) },
      { ...rec, hash: rec.hash + 'A' },
      { ...rec, iterations: 0 },
      { ...rec, iterations: -5 },
      { ...rec, iterations: 1.5 },
      { ...rec, iterations: Number.NaN },
      { ...rec, iterations: '1000' },
      { ...rec, iterations: 1e12 },
      { ...rec, salt: 42 },
      { salt: rec.salt, iterations: rec.iterations },
    ];
    for (const stored of bad) {
      await expect(verifyPin('1234', stored as PinRecord)).resolves.toBe(false);
    }
  });

  it('rejects a tampered hash or salt', async () => {
    const rec = await hashPin('5555', { iterations: FAST });
    const h = b64uDecode(rec.hash);
    h[31]! ^= 1;
    expect(await verifyPin('5555', { ...rec, hash: b64uEncode(h) })).toBe(false);
    const s = b64uDecode(rec.salt);
    s[0]! ^= 1;
    expect(await verifyPin('5555', { ...rec, salt: b64uEncode(s) })).toBe(false);
  });
});
