import { describe, it, expect } from 'vitest';
import { BACKUP_VERSION, migrateBackup } from './migrate';

function deepFreeze<T>(v: T): T {
  if (typeof v === 'object' && v !== null) {
    for (const x of Object.values(v)) deepFreeze(x);
    Object.freeze(v);
  }
  return v;
}

const V1_PLAIN = {
  format: 'shiori-backup',
  version: 1,
  exportedAt: 1_780_000_000_000,
  appVersion: '0.1.0',
  encrypted: false,
  data: { works: [], manifests: [] },
};

describe('migrateBackup', () => {
  it('writes and reads version 1', () => {
    expect(BACKUP_VERSION).toBe(1);
  });

  it('returns a V1 file as-is (same object, unchanged)', () => {
    const file = deepFreeze(structuredClone(V1_PLAIN));
    const snapshot = JSON.stringify(file);
    expect(migrateBackup(file)).toBe(file);
    expect(JSON.stringify(file)).toBe(snapshot);
  });

  it('returns an encrypted V1 file as-is', () => {
    const file = { ...V1_PLAIN, encrypted: true, enc: { kdf: {}, iv: 'x', ct: 'y' } };
    expect(migrateBackup(file)).toBe(file);
  });

  it('returns newer or unknown versions unchanged, so the caller can report them', () => {
    for (const version of [2, 99, 1.5, 0, -1, '1', null, undefined]) {
      const file = deepFreeze({ ...V1_PLAIN, version });
      expect(migrateBackup(file)).toBe(file);
    }
    const noVersion = deepFreeze({ format: 'shiori-backup' });
    expect(migrateBackup(noVersion)).toBe(noVersion);
  });

  it('returns non-object input unchanged', () => {
    for (const raw of [null, undefined, 42, 'shiori-backup', true]) {
      expect(migrateBackup(raw)).toBe(raw);
    }
    const arr = [V1_PLAIN];
    expect(migrateBackup(arr)).toBe(arr);
  });
});
