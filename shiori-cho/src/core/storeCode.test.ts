import { describe, it, expect } from 'vitest';
import { buildStoreUrl, parseStoreCode, STORE_CODE_INVALID_JA } from './storeCode';
import type { StoreCode } from './storeCode';
import { ShioriError } from './errors';

describe('parseStoreCode', () => {
  it('normalizes lowercase and full-width input', () => {
    const expected: StoreCode = { prefix: 'RJ', digits: '01667536', code: 'RJ01667536' };
    expect(parseStoreCode('rj01667536')).toEqual(expected);
    expect(parseStoreCode('ＲＪ０１６６７５３６')).toEqual(expected);
    expect(parseStoreCode('ｒｊ０１６６７５３６')).toEqual(expected);
    expect(parseStoreCode('Rj01667536')).toEqual(expected);
    expect(parseStoreCode('RJ01667536')).toEqual(expected);
  });

  it('trims surrounding whitespace, including full-width spaces', () => {
    expect(parseStoreCode('  RJ01667536\n')?.code).toBe('RJ01667536');
    expect(parseStoreCode('　RJ01667536　')?.code).toBe('RJ01667536');
  });

  it('accepts RJ, VJ and BJ with 6 or 8 digits', () => {
    expect(parseStoreCode('RJ123456')).toEqual({ prefix: 'RJ', digits: '123456', code: 'RJ123456' });
    expect(parseStoreCode('vj01234567')).toEqual({ prefix: 'VJ', digits: '01234567', code: 'VJ01234567' });
    expect(parseStoreCode('BJ654321')).toEqual({ prefix: 'BJ', digits: '654321', code: 'BJ654321' });
  });

  it('rejects other lengths', () => {
    expect(parseStoreCode('RJ1234567')).toBeNull(); // 7 digits
    expect(parseStoreCode('RJ12345')).toBeNull();
    expect(parseStoreCode('RJ123456789')).toBeNull();
    expect(parseStoreCode('RJ')).toBeNull();
  });

  it('rejects other prefixes and junk', () => {
    expect(parseStoreCode('')).toBeNull();
    expect(parseStoreCode('   ')).toBeNull();
    expect(parseStoreCode('XJ01234567')).toBeNull();
    expect(parseStoreCode('RE01234567')).toBeNull();
    expect(parseStoreCode('01234567')).toBeNull();
    expect(parseStoreCode('RJ 01234567')).toBeNull();
    expect(parseStoreCode('RJ-01234567')).toBeNull();
    expect(parseStoreCode('RJ0123456a')).toBeNull();
    expect(parseStoreCode('RJ01234567.html')).toBeNull();
    expect(parseStoreCode('https://www.dlsite.com/maniax/work/=/product_id/RJ01234567.html')).toBeNull();
  });

  it('rejects non-ASCII digits that NFKC does not map to 0-9', () => {
    expect(parseStoreCode('RJ٠١٢٣٤٥')).toBeNull(); // Arabic-Indic digits
  });
});

describe('buildStoreUrl', () => {
  it('maps RJ to maniax', () => {
    expect(buildStoreUrl('RJ01667536', { touch: false })).toBe(
      'https://www.dlsite.com/maniax/work/=/product_id/RJ01667536.html',
    );
    expect(buildStoreUrl('RJ01667536', { touch: true })).toBe(
      'https://www.dlsite.com/maniax-touch/work/=/product_id/RJ01667536.html',
    );
  });

  it('maps VJ to pro', () => {
    expect(buildStoreUrl('VJ01234567', { touch: false })).toBe(
      'https://www.dlsite.com/pro/work/=/product_id/VJ01234567.html',
    );
    expect(buildStoreUrl('VJ01234567', { touch: true })).toBe(
      'https://www.dlsite.com/pro-touch/work/=/product_id/VJ01234567.html',
    );
  });

  it('maps BJ to books', () => {
    expect(buildStoreUrl('BJ123456', { touch: false })).toBe('https://www.dlsite.com/books/work/=/product_id/BJ123456.html');
    expect(buildStoreUrl('BJ123456', { touch: true })).toBe(
      'https://www.dlsite.com/books-touch/work/=/product_id/BJ123456.html',
    );
  });

  it('normalizes string input and accepts a parsed StoreCode', () => {
    expect(buildStoreUrl('ｒｊ０１６６７５３６', { touch: false })).toBe(
      'https://www.dlsite.com/maniax/work/=/product_id/RJ01667536.html',
    );
    const parsed = parseStoreCode('vj123456')!;
    expect(buildStoreUrl(parsed, { touch: true })).toBe('https://www.dlsite.com/pro-touch/work/=/product_id/VJ123456.html');
  });

  it('throws a validation ShioriError for invalid codes', () => {
    expect(() => buildStoreUrl('RJ1234567', { touch: false })).toThrow(ShioriError);
    try {
      buildStoreUrl('not a code', { touch: false });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ShioriError);
      expect((e as ShioriError).code).toBe('validation');
      expect((e as ShioriError).messageJa).toBe(STORE_CODE_INVALID_JA);
    }
  });

  it('never trusts a hand-built StoreCode object', () => {
    const forged = { prefix: 'RJ', digits: '123456', code: 'RJ123456/../../evil' } as StoreCode;
    expect(() => buildStoreUrl(forged, { touch: false })).toThrow(ShioriError);
    // the URL is derived from the normalized code, not from the object's other fields
    const mismatched = { prefix: 'BJ', digits: '000000', code: 'rj123456' } as StoreCode;
    expect(buildStoreUrl(mismatched, { touch: false })).toBe('https://www.dlsite.com/maniax/work/=/product_id/RJ123456.html');
  });

  it('only ever produces www.dlsite.com URLs', () => {
    for (const code of ['RJ123456', 'VJ12345678', 'BJ000001']) {
      for (const touch of [false, true]) {
        expect(new URL(buildStoreUrl(code, { touch })).host).toBe('www.dlsite.com');
      }
    }
  });
});
