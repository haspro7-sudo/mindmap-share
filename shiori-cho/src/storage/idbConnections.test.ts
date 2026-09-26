import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { ShioriError } from '../core/errors';
import { openFailure, storageFailure } from './idbConnections';

describe('openFailure', () => {
  it('explains a VersionError (data from a newer app version)', () => {
    const cause = new DOMException('newer', 'VersionError');
    const e = openFailure(cause);
    expect(e).toBeInstanceOf(ShioriError);
    expect(e.code).toBe('io');
    expect(e.messageJa).toBe('新しいバージョンのしおり帳で保存されたデータです。ページを再読み込みしてください。');
    expect(e.cause).toBe(cause);
  });

  it('gives a generic message for anything else (e.g. storage unavailable)', () => {
    for (const cause of [new DOMException('x', 'InvalidStateError'), new ReferenceError('indexedDB is not defined'), 'x']) {
      const e = openFailure(cause);
      expect(e.code).toBe('io');
      expect(e.messageJa).toContain('データの保存場所を開けませんでした');
    }
  });

  it('passes a ShioriError through unchanged', () => {
    const original = new ShioriError('io', 'テスト');
    expect(openFailure(original)).toBe(original);
  });
});

describe('storageFailure', () => {
  it('maps QuotaExceededError to a Japanese ShioriError', () => {
    const cause = new DOMException('full', 'QuotaExceededError');
    const e = storageFailure(cause);
    expect(e).toBeInstanceOf(ShioriError);
    expect(e).toMatchObject({ code: 'io', messageJa: '端末の空き容量が足りないため保存できませんでした。', cause });
  });

  it('passes other errors through unchanged', () => {
    const other = new TypeError('x');
    expect(storageFailure(other)).toBe(other);
    expect(storageFailure(undefined)).toBeUndefined();
  });
});
