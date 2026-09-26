import { describe, it, expect } from 'vitest';
import { fromHex, toHex, utf8 } from '../encoding';
import { ShioriError } from '../errors';
import { aesGcmDecrypt, aesGcmEncrypt, hkdfSha256, hmacSha256, pbkdf2Sha256 } from './primitives';

async function expectCode(p: Promise<unknown>, code: string): Promise<ShioriError> {
  const err = await p.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(ShioriError);
  expect((err as ShioriError).code).toBe(code);
  return err as ShioriError;
}

function bytes(n: number, f: (i: number) => number = (i) => i): Uint8Array {
  return Uint8Array.from({ length: n }, (_, i) => f(i) & 0xff);
}

describe('pbkdf2Sha256', () => {
  it('matches RFC 7914 §11 (passwd / salt / c=1 / 64 bytes)', async () => {
    const out = await pbkdf2Sha256(utf8('passwd'), utf8('salt'), 1, 64);
    expect(toHex(out)).toBe(
      '55ac046e56e3089fec1691c22544b605f94185216dde0465e68b9d57c20dacbc' +
        '49ca9cccf179b645991664b39d77ef317c71b845b1e30bd509112041d3a19783',
    );
  });

  it('matches the well-known PBKDF2-HMAC-SHA256 vectors (password / salt)', async () => {
    expect(toHex(await pbkdf2Sha256(utf8('password'), utf8('salt'), 1, 32))).toBe(
      '120fb6cffcf8b32c43e7225256c4f837a86548c92ccc35480805987cb70be17b',
    );
    expect(toHex(await pbkdf2Sha256(utf8('password'), utf8('salt'), 2, 32))).toBe(
      'ae4d0c95af6b46d32d0adff928f06dd02a303f8ef3c251dfd6e2d85a95474c43',
    );
    expect(toHex(await pbkdf2Sha256(utf8('password'), utf8('salt'), 4096, 32))).toBe(
      'c5e478d59288c841aa530db6845c4c8d962893a001ce4e11a4963873aa98134a',
    );
  });

  it('returns exactly the requested length', async () => {
    for (const n of [1, 16, 32, 33, 100]) {
      expect((await pbkdf2Sha256(utf8('pw'), utf8('salt'), 2, n)).length).toBe(n);
    }
  });

  it('returns a plain ArrayBuffer-backed Uint8Array', async () => {
    const out = await pbkdf2Sha256(utf8('pw'), utf8('salt'), 1, 32);
    expect(out).toBeInstanceOf(Uint8Array);
    expect(out.buffer).toBeInstanceOf(ArrayBuffer);
  });

  it('rejects invalid iteration counts and lengths with ShioriError("crypto")', async () => {
    for (const it of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      await expectCode(pbkdf2Sha256(utf8('pw'), utf8('salt'), it, 32), 'crypto');
    }
    for (const len of [0, -32, 2.5]) {
      await expectCode(pbkdf2Sha256(utf8('pw'), utf8('salt'), 1, len), 'crypto');
    }
  });

  it('only reads the viewed bytes of a subarray', async () => {
    const big = bytes(64, (i) => i * 7);
    const view = big.subarray(10, 26);
    const a = await pbkdf2Sha256(view, view, 3, 32);
    const b = await pbkdf2Sha256(new Uint8Array(view), new Uint8Array(view), 3, 32);
    expect(toHex(a)).toBe(toHex(b));
  });
});

describe('hmacSha256', () => {
  it('matches RFC 4231 test case 1', async () => {
    const out = await hmacSha256(bytes(20, () => 0x0b), utf8('Hi There'));
    expect(toHex(out)).toBe('b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7');
  });

  it('matches RFC 4231 test case 2', async () => {
    const out = await hmacSha256(utf8('Jefe'), utf8('what do ya want for nothing?'));
    expect(toHex(out)).toBe('5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843');
  });

  it('accepts an empty message but rejects an empty key', async () => {
    expect((await hmacSha256(bytes(32), new Uint8Array(0))).length).toBe(32);
    await expectCode(hmacSha256(new Uint8Array(0), utf8('x')), 'crypto');
  });
});

describe('hkdfSha256', () => {
  const ikm = bytes(22, () => 0x0b);

  it('matches RFC 5869 test case 1', async () => {
    const out = await hkdfSha256(ikm, fromHex('000102030405060708090a0b0c'), fromHex('f0f1f2f3f4f5f6f7f8f9'), 42);
    expect(toHex(out)).toBe(
      '3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf34007208d5b887185865',
    );
  });

  it('matches RFC 5869 test case 3 (empty salt and info)', async () => {
    const out = await hkdfSha256(ikm, new Uint8Array(0), new Uint8Array(0), 42);
    expect(toHex(out)).toBe(
      '8da4e775a563c18f715f802a063c5a31b8a11f5c5ee1879ec3454e5f3c738d2d9d201395faa4b61a96c8',
    );
  });

  it('defaults to 32 bytes (a prefix of the longer output)', async () => {
    const salt = fromHex('000102030405060708090a0b0c');
    const info = fromHex('f0f1f2f3f4f5f6f7f8f9');
    const out = await hkdfSha256(ikm, salt, info);
    expect(out.length).toBe(32);
    expect(toHex(out)).toBe('3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf');
  });

  it('depends on the info string (domain separation)', async () => {
    const a = await hkdfSha256(ikm, bytes(16), utf8('shiori/1|goal|a'));
    const b = await hkdfSha256(ikm, bytes(16), utf8('shiori/1|goal|b'));
    expect(toHex(a)).not.toBe(toHex(b));
  });

  it('rejects lengths outside 1..8160', async () => {
    await expectCode(hkdfSha256(ikm, bytes(16), bytes(1), 0), 'crypto');
    await expectCode(hkdfSha256(ikm, bytes(16), bytes(1), 255 * 32 + 1), 'crypto');
    expect((await hkdfSha256(ikm, bytes(16), bytes(1), 255 * 32)).length).toBe(255 * 32);
  });
});

describe('aesGcm', () => {
  it('matches the GCM spec test cases 13/14 (AES-256, zero key and iv)', async () => {
    const key = new Uint8Array(32);
    const iv = new Uint8Array(12);
    expect(toHex(await aesGcmEncrypt(key, iv, new Uint8Array(0)))).toBe('530f8afbc74536b9a963b4f1c4cb738b');
    expect(toHex(await aesGcmEncrypt(key, iv, new Uint8Array(16)))).toBe(
      'cea7403d4d606b6e074ec5d3baf39d18' + 'd0d1c8a799996bf0265b98b5d48ab919',
    );
  });

  it('matches the GCM spec test case 2 (AES-128)', async () => {
    const out = await aesGcmEncrypt(new Uint8Array(16), new Uint8Array(12), new Uint8Array(16));
    expect(toHex(out)).toBe('0388dace60b6a392f328c2b971b2fe78' + 'ab6e47d42cec13bdf53a67b21257bddf');
  });

  const key = bytes(32, (i) => i * 3 + 1);
  const iv = bytes(12, (i) => 100 + i);
  const aad = utf8('shiori/1|w|sealed|x');
  const pt = utf8('星図の果て — 🌟 hello');

  it('round-trips with and without AAD; output is ciphertext||16-byte tag', async () => {
    const ct = await aesGcmEncrypt(key, iv, pt, aad);
    expect(ct.length).toBe(pt.length + 16);
    expect(toHex(await aesGcmDecrypt(key, iv, ct, aad))).toBe(toHex(pt));

    const ct2 = await aesGcmEncrypt(key, iv, pt);
    expect(toHex(await aesGcmDecrypt(key, iv, ct2))).toBe(toHex(pt));
    // An absent AAD is the same as an empty AAD.
    expect(toHex(await aesGcmDecrypt(key, iv, ct2, new Uint8Array(0)))).toBe(toHex(pt));
  });

  it('round-trips an empty plaintext', async () => {
    const ct = await aesGcmEncrypt(key, iv, new Uint8Array(0), aad);
    expect(ct.length).toBe(16);
    expect((await aesGcmDecrypt(key, iv, ct, aad)).length).toBe(0);
  });

  it('throws ShioriError("decrypt") with a Japanese message when any ciphertext or tag bit flips', async () => {
    const ct = await aesGcmEncrypt(key, iv, pt, aad);
    for (const pos of [0, 5, ct.length - 17, ct.length - 16, ct.length - 1]) {
      for (const bit of [0x01, 0x80]) {
        const bad = new Uint8Array(ct);
        bad[pos]! ^= bit;
        const err = await expectCode(aesGcmDecrypt(key, iv, bad, aad), 'decrypt');
        expect(err.messageJa).toBe('復号できませんでした');
      }
    }
  });

  it('throws on wrong / missing AAD, wrong key and wrong iv', async () => {
    const ct = await aesGcmEncrypt(key, iv, pt, aad);
    await expectCode(aesGcmDecrypt(key, iv, ct, utf8('shiori/1|w|sealed|y')), 'decrypt');
    await expectCode(aesGcmDecrypt(key, iv, ct), 'decrypt');
    const key2 = new Uint8Array(key);
    key2[0]! ^= 1;
    await expectCode(aesGcmDecrypt(key2, iv, ct, aad), 'decrypt');
    const iv2 = new Uint8Array(iv);
    iv2[11]! ^= 1;
    await expectCode(aesGcmDecrypt(key, iv2, ct, aad), 'decrypt');
  });

  it('throws "decrypt" for truncated ciphertext and malformed key / iv', async () => {
    const ct = await aesGcmEncrypt(key, iv, pt, aad);
    await expectCode(aesGcmDecrypt(key, iv, ct.subarray(0, ct.length - 1), aad), 'decrypt');
    await expectCode(aesGcmDecrypt(key, iv, ct.subarray(0, 15), aad), 'decrypt');
    await expectCode(aesGcmDecrypt(key, iv, new Uint8Array(0), aad), 'decrypt');
    await expectCode(aesGcmDecrypt(key, iv.subarray(0, 11), ct, aad), 'decrypt');
    await expectCode(aesGcmDecrypt(key.subarray(0, 31), iv, ct, aad), 'decrypt');
    await expectCode(aesGcmDecrypt('nope' as unknown as Uint8Array, iv, ct, aad), 'decrypt');
  });

  it('rejects bad key or iv lengths on encrypt with ShioriError("crypto")', async () => {
    await expectCode(aesGcmEncrypt(bytes(31), iv, pt), 'crypto');
    await expectCode(aesGcmEncrypt(bytes(0), iv, pt), 'crypto');
    await expectCode(aesGcmEncrypt(key, bytes(11), pt), 'crypto');
    await expectCode(aesGcmEncrypt(key, bytes(16), pt), 'crypto');
  });

  it('supports 128/192/256-bit keys', async () => {
    for (const n of [16, 24, 32]) {
      const k = bytes(n, (i) => i + n);
      const ct = await aesGcmEncrypt(k, iv, pt, aad);
      expect(toHex(await aesGcmDecrypt(k, iv, ct, aad))).toBe(toHex(pt));
    }
  });

  it('does not mutate inputs and handles subarray views', async () => {
    const buf = bytes(80, (i) => i);
    const k = buf.subarray(8, 40);
    const v = buf.subarray(40, 52);
    const snapshot = toHex(buf);
    const a = await aesGcmEncrypt(k, v, pt, aad);
    const b = await aesGcmEncrypt(new Uint8Array(k), new Uint8Array(v), pt, aad);
    expect(toHex(a)).toBe(toHex(b));
    expect(toHex(await aesGcmDecrypt(k, v, a, aad))).toBe(toHex(pt));
    expect(toHex(buf)).toBe(snapshot);
  });
});
