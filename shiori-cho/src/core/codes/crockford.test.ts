import { describe, it, expect, vi } from 'vitest';
import {
  B32_CODE_LENGTH,
  CROCKFORD_ALPHABET,
  formatB32,
  generateB32,
  luhn32Check,
  luhn32Valid,
  normalizeB32,
} from './crockford';
import { ShioriError } from '../errors';
import type { Bytes } from '../types';

const DEMO_CODES = ['ST4-RMA-P1X', 'M00-NDE-SKR', 'NEK-0T0-M0E', 'SK1-ES0-NGM', 'AMA-0T0-N1J'];

/** Deterministic xorshift32 byte source so failures are reproducible. */
function seededRng(seed: number): (n: number) => Bytes {
  let x = seed >>> 0 || 1;
  return (n: number) => {
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      x ^= x << 13;
      x >>>= 0;
      x ^= x >>> 17;
      x ^= x << 5;
      x >>>= 0;
      out[i] = x & 0xff;
    }
    return out as Bytes;
  };
}

function fixedRng(bytes: number[]): (n: number) => Bytes {
  return (n: number) => new Uint8Array(bytes.slice(0, n)) as Bytes;
}

function ok(input: string): string {
  const r = normalizeB32(input);
  if (!r.ok) throw new Error(`expected ${JSON.stringify(input)} to normalize, got ${JSON.stringify(r.error)}`);
  return r.value;
}

describe('CROCKFORD_ALPHABET', () => {
  it('has 32 unique symbols without I, L, O, U', () => {
    expect(CROCKFORD_ALPHABET).toHaveLength(32);
    expect(new Set(CROCKFORD_ALPHABET).size).toBe(32);
    for (const c of 'ILOU') expect(CROCKFORD_ALPHABET).not.toContain(c);
  });
});

describe('luhn32Check', () => {
  it('matches the spec vectors', () => {
    expect(luhn32Check('K7QM2XRA')).toBe('P');
    expect(luhn32Check('00000000')).toBe('0');
    expect(luhn32Check('ZZZZZZZZ')).toBe('8');
  });

  it('produces the check symbol of every demo code (§4.6)', () => {
    for (const code of DEMO_CODES) {
      const nine = code.replace(/-/g, '');
      expect(luhn32Check(nine.slice(0, 8)), code).toBe(nine[8]);
    }
  });

  it('matches a straightforward reference implementation', () => {
    const rng = seededRng(7);
    for (let n = 0; n < 200; n++) {
      const data = [...rng(8)].map((b) => CROCKFORD_ALPHABET[b & 31]).join('');
      let sum = 0;
      [...data].reverse().forEach((c, i) => {
        const p = (i % 2 === 0 ? 2 : 1) * CROCKFORD_ALPHABET.indexOf(c);
        sum += Math.floor(p / 32) + (p % 32);
      });
      expect(luhn32Check(data)).toBe(CROCKFORD_ALPHABET[(32 - (sum % 32)) % 32]);
    }
  });

  it('throws a ShioriError for characters outside the alphabet', () => {
    expect(() => luhn32Check('K7QM2XRU')).toThrow(ShioriError);
    expect(() => luhn32Check('k7qm2xra')).toThrow(ShioriError);
  });
});

describe('luhn32Valid', () => {
  it('accepts the spec vectors and demo codes', () => {
    expect(luhn32Valid('K7QM2XRAP')).toBe(true);
    expect(luhn32Valid('000000000')).toBe(true);
    expect(luhn32Valid('ZZZZZZZZ8')).toBe(true);
    for (const code of DEMO_CODES) expect(luhn32Valid(code.replace(/-/g, '')), code).toBe(true);
  });

  it('rejects wrong check symbols, invalid characters and too-short input', () => {
    expect(luhn32Valid('K7QM2XRAQ')).toBe(false);
    expect(luhn32Valid('K7QM2XRAU')).toBe(false);
    expect(luhn32Valid('k7qm2xrap')).toBe(false);
    expect(luhn32Valid('K7Q-M2X-RAP')).toBe(false);
    expect(luhn32Valid('')).toBe(false);
    expect(luhn32Valid('0')).toBe(false);
  });

  it('detects every single-symbol substitution (200 random codes × 9 positions × 31 symbols)', () => {
    const rng = seededRng(2024);
    let checked = 0;
    for (let n = 0; n < 200; n++) {
      const code = generateB32(rng);
      expect(luhn32Valid(code)).toBe(true);
      for (let pos = 0; pos < B32_CODE_LENGTH; pos++) {
        for (const sym of CROCKFORD_ALPHABET) {
          if (sym === code[pos]) continue;
          const mutated = code.slice(0, pos) + sym + code.slice(pos + 1);
          if (luhn32Valid(mutated)) throw new Error(`undetected substitution ${code} → ${mutated}`);
          checked++;
        }
      }
    }
    expect(checked).toBe(200 * 9 * 31);
  });

  it('reports a checksum error (not a KDF) for a substituted code', () => {
    const code = 'K7QM2XRAP';
    for (let pos = 0; pos < 9; pos++) {
      const sym = code[pos] === 'Z' ? 'Y' : 'Z';
      const mutated = code.slice(0, pos) + sym + code.slice(pos + 1);
      expect(normalizeB32(mutated)).toEqual({ ok: false, error: { kind: 'checksum' } });
    }
  });

  it('detects at least 99% of adjacent transpositions of random codes', () => {
    const rng = seededRng(99);
    let total = 0;
    let detected = 0;
    for (let n = 0; n < 2000; n++) {
      const code = generateB32(rng);
      for (let pos = 0; pos < B32_CODE_LENGTH - 1; pos++) {
        const a = code[pos]!;
        const b = code[pos + 1]!;
        if (a === b) continue;
        total++;
        const swapped = code.slice(0, pos) + b + a + code.slice(pos + 2);
        if (!luhn32Valid(swapped)) detected++;
      }
    }
    expect(total).toBeGreaterThan(10_000);
    expect(detected / total).toBeGreaterThanOrEqual(0.99);
  });

  it('misses only the 0↔Z transposition (≈99.8% of distinct adjacent pairs)', () => {
    const base = 'K7QM2XRA';
    const missed = new Set<string>();
    let total = 0;
    let detected = 0;
    for (let pos = 0; pos < 7; pos++) {
      for (const a of CROCKFORD_ALPHABET) {
        for (const b of CROCKFORD_ALPHABET) {
          if (a === b) continue;
          const data = base.slice(0, pos) + a + b + base.slice(pos + 2);
          const code = data + luhn32Check(data);
          const swapped = code.slice(0, pos) + b + a + code.slice(pos + 2);
          total++;
          if (luhn32Valid(swapped)) missed.add([a, b].sort().join(''));
          else detected++;
        }
      }
    }
    expect([...missed]).toEqual(['0Z']);
    expect(detected / total).toBeCloseTo(990 / 992, 6);
  });
});

describe('normalizeB32', () => {
  it('normalizes width, case and separators to the canonical 9 characters', () => {
    for (const input of [
      'ｋ７ｑｍ－２ｘｒａ－ｐ',
      'k7q m2x rap',
      'K7Q‐M2X—RAP',
      'K7Q-M2X-RAP',
      'K7QM2XRAP',
      '  k7qm2xrap\n',
      'K7Q\u3000M2X\tRAP',
      'K7Q・M2X・RAP',
      'K7Q･M2X･RAP',
      'K7Q_M2X.RAP',
      'K7Qー M2X ｰ RAP',
      'K7Q−M2X―RAP',
      'K7Q‑M2X‒RAP–',
      'K7Q\u200BM2X\uFEFFRAP',
    ]) {
      expect(ok(input), JSON.stringify(input)).toBe('K7QM2XRAP');
    }
  });

  it('maps O to 0 and I, L to 1', () => {
    expect(ok('MOO-NDE-SKR')).toBe('M00NDESKR');
    expect(ok('moo-nde-skr')).toBe('M00NDESKR');
    expect(ok('SKI-ESO-NGM')).toBe('SK1ES0NGM');
    expect(ok('SKL-ES0-NGM')).toBe('SK1ES0NGM');
    expect(ok('ski-es0-ngm')).toBe('SK1ES0NGM');
    expect(ok('AMA-OTO-NIJ')).toBe('AMA0T0N1J');
    expect(ok('ama-oto-nlj')).toBe('AMA0T0N1J');
  });

  it('accepts every demo code (§4.6)', () => {
    for (const code of DEMO_CODES) expect(ok(code)).toBe(code.replace(/-/g, ''));
  });

  it('rejects U (not in the alphabet) with a charset error naming it', () => {
    expect(normalizeB32('K7Q-M2X-RAU')).toEqual({ ok: false, error: { kind: 'charset', char: 'U' } });
    expect(normalizeB32('k7q-m2x-rau')).toEqual({ ok: false, error: { kind: 'charset', char: 'U' } });
    expect(normalizeB32('ｕ')).toEqual({ ok: false, error: { kind: 'charset', char: 'U' } });
  });

  it('reports the first unsupported character, whole code points included', () => {
    expect(normalizeB32('K7Q#M2XRAP')).toEqual({ ok: false, error: { kind: 'charset', char: '#' } });
    expect(normalizeB32('K7Q😀M2XRAP')).toEqual({ ok: false, error: { kind: 'charset', char: '😀' } });
    expect(normalizeB32('合言葉')).toEqual({ ok: false, error: { kind: 'charset', char: '合' } });
    expect(normalizeB32('straße')).toEqual({ ok: false, error: { kind: 'charset', char: 'ß' } });
  });

  it('checks the charset before the length', () => {
    expect(normalizeB32('K7QM2XRAPU')).toEqual({ ok: false, error: { kind: 'charset', char: 'U' } });
  });

  it('gives a length error for 8 or 10 characters', () => {
    expect(normalizeB32('K7Q-M2X-RA')).toEqual({ ok: false, error: { kind: 'length', got: 8, expected: 9 } });
    expect(normalizeB32('K7Q-M2X-RAP0')).toEqual({ ok: false, error: { kind: 'length', got: 10, expected: 9 } });
    expect(normalizeB32('K')).toEqual({ ok: false, error: { kind: 'length', got: 1, expected: 9 } });
  });

  it('gives an empty error when nothing is left after removing separators', () => {
    for (const input of ['', '   ', '\u3000', '---', '・ー・', '\u200B']) {
      expect(normalizeB32(input), JSON.stringify(input)).toEqual({ ok: false, error: { kind: 'empty' } });
    }
  });

  it('gives a checksum error for a well-formed code with a wrong check symbol', () => {
    expect(normalizeB32('K7Q-M2X-RAQ')).toEqual({ ok: false, error: { kind: 'checksum' } });
    expect(normalizeB32('ST4-RMA-P1Y')).toEqual({ ok: false, error: { kind: 'checksum' } });
  });
});

describe('generateB32', () => {
  it('produces 1000 valid, correctly formatted codes', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      const code = generateB32();
      expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{9}$/);
      expect(luhn32Valid(code)).toBe(true);
      const display = formatB32(code);
      expect(display).toMatch(/^[0-9A-HJKMNP-TV-Z]{3}-[0-9A-HJKMNP-TV-Z]{3}-[0-9A-HJKMNP-TV-Z]{3}$/);
      expect(normalizeB32(display)).toEqual({ ok: true, value: code });
      seen.add(code);
    }
    expect(seen.size).toBeGreaterThan(990);
  });

  it('maps 5 random bytes to 8 symbols of 5 bits, most significant first', () => {
    expect(generateB32(fixedRng([0, 0, 0, 0, 0]))).toBe('000000000');
    expect(generateB32(fixedRng([0xff, 0xff, 0xff, 0xff, 0xff]))).toBe('ZZZZZZZZ8');
    // 00001 × 8 = 0000 1000 0100 0010 0001 0000 1000 0100 0010 0001
    const ones = generateB32(fixedRng([0x08, 0x42, 0x10, 0x84, 0x21]));
    expect(ones.slice(0, 8)).toBe('11111111');
    expect(ones[8]).toBe(luhn32Check('11111111'));
    // 0 1 2 … 7 = 00000 00001 00010 00011 00100 00101 00110 00111
    expect(generateB32(fixedRng([0x00, 0x44, 0x32, 0x14, 0xc7])).slice(0, 8)).toBe('01234567');
  });

  it('asks the rng for exactly 5 bytes and uses randomBytes by default', () => {
    const rng = vi.fn(fixedRng([1, 2, 3, 4, 5]));
    generateB32(rng);
    expect(rng).toHaveBeenCalledTimes(1);
    expect(rng).toHaveBeenCalledWith(5);

    const spy = vi.spyOn(globalThis.crypto, 'getRandomValues');
    try {
      generateB32();
      expect(spy).toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it('throws when the rng returns too few bytes', () => {
    expect(() => generateB32(fixedRng([1, 2, 3]))).toThrow(ShioriError);
  });

  it('uses every symbol in every data position over many codes', () => {
    const rng = seededRng(12345);
    const perPosition = Array.from({ length: 8 }, () => new Set<string>());
    for (let i = 0; i < 3000; i++) {
      const code = generateB32(rng);
      for (let p = 0; p < 8; p++) perPosition[p]!.add(code[p]!);
    }
    for (const s of perPosition) expect(s.size).toBe(32);
  });
});

describe('formatB32', () => {
  it('groups the 9 characters as XXX-XXX-XXX', () => {
    expect(formatB32('K7QM2XRAP')).toBe('K7Q-M2X-RAP');
    expect(formatB32('ST4RMAP1X')).toBe('ST4-RMA-P1X');
  });

  it('round-trips through normalizeB32', () => {
    for (const code of DEMO_CODES) expect(formatB32(ok(code))).toBe(code);
  });
});
