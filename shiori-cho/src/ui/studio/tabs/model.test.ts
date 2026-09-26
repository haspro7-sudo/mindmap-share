import { describe, expect, it } from 'vitest';
import { fixtureProject } from '../../../core/manifest/testFixtures';
import type { StudioProject } from '../../../core/types';
import { studioProjectSchema } from '../../../core/manifest/schema';
import { reconcileWithStored, sanitizeFieldText, sanitizeHint, storedChanged, tabForPath, withBookkeeping } from './model';

const T0 = 1_790_000_000_000;
const SALT_A = 'AAECAwQFBgcICQoLDA0ODw';
const SALT_B = 'AQEBAQEBAQEBAQEBAQEBAQ';

function base(patch: Partial<StudioProject> = {}): StudioProject {
  const p = fixtureProject({ updatedAt: T0, ...patch });
  delete p.kdfSalt;
  if (patch.kdfSalt !== undefined) p.kdfSalt = patch.kdfSalt;
  return p;
}

describe('sanitizeHint', () => {
  it('turns line breaks and tabs into spaces (hints are single-line)', () => {
    expect(sanitizeHint('天文台へ行く\n望遠鏡を3回調べる')).toBe('天文台へ行く 望遠鏡を3回調べる');
    expect(sanitizeHint('a\r\n\tb')).toBe('a b');
    expect(sanitizeHint('そのまま')).toBe('そのまま');
  });
});

describe('sanitizeFieldText', () => {
  it('keeps ordinary text and line breaks of multi-line fields', () => {
    expect(sanitizeFieldText('星図の果て', false)).toBe('星図の果て');
    expect(sanitizeFieldText('一行目\n二行目', true)).toBe('一行目\n二行目');
    expect(sanitizeFieldText('一行目\r\n二行目\r三行目', true)).toBe('一行目\n二行目\n三行目');
  });

  it('replaces control characters with a space and drops bidi controls', () => {
    expect(sanitizeFieldText('END\t1', false)).toBe('END 1');
    expect(sanitizeFieldText('a\n\nb', false)).toBe('a b');
    expect(sanitizeFieldText('a\tb\u0007c', true)).toBe('a b c');
    expect(sanitizeFieldText('a\u202Eb\u2066c', false)).toBe('abc');
  });

  it('whatever is pasted, the project file still restores (F16 AC7)', () => {
    const nasty = 'x\t\u0000\u001B\u0085\u202A\u2069\r\ny';
    const p = fixtureProject();
    p.goals[0]!.label = sanitizeFieldText(nasty, false);
    p.goals[0]!.secret = { title: sanitizeFieldText(nasty, false), description: sanitizeFieldText(nasty, true) };
    p.sealed[0]!.payload.body = sanitizeFieldText(nasty, true);
    p.work.circle = sanitizeFieldText(nasty, false);
    expect(studioProjectSchema.safeParse(JSON.parse(JSON.stringify(p))).success).toBe(true);
  });
});

describe('tabForPath', () => {
  it('links every checked path to its tab', () => {
    expect(tabForPath('goals[0].hints[1]')).toBe('goals');
    expect(tabForPath('sealed[2].payload.title')).toBe('extras');
    expect(tabForPath('checkpoints[0].label')).toBe('structure');
    expect(tabForPath('authorName')).toBe('work');
    expect(tabForPath('kdfSalt')).toBe('work');
    expect(tabForPath('changelog[0].date')).toBe('work');
    expect(tabForPath('')).toBeNull();
  });
});

describe('reconcileWithStored (the same project open in two tabs)', () => {
  it('saves the snapshot when nothing changed elsewhere', () => {
    const b = base();
    const snapshot = { ...b, updatedAt: T0 + 5, work: { ...b.work, title: '新しい題' } };
    expect(storedChanged(b, structuredClone(b))).toBe(false);
    expect(reconcileWithStored(b, structuredClone(b), snapshot)).toBe(snapshot);
  });

  it('merges bookkeeping saved elsewhere (export time, first salt) instead of reverting it', () => {
    const b = base();
    const stored = { ...b, kdfSalt: SALT_A, lastExportedAt: T0 + 100 };
    const snapshot = { ...b, updatedAt: T0 + 5, work: { ...b.work, title: '新しい題' } };
    const merged = reconcileWithStored(b, stored, snapshot);
    expect(merged).toEqual({ ...snapshot, kdfSalt: SALT_A, lastExportedAt: T0 + 100 });
    // the later export time wins
    const both = reconcileWithStored(b, stored, { ...snapshot, lastExportedAt: T0 + 50 });
    expect(both !== 'conflict' && both.lastExportedAt).toBe(T0 + 100);
  });

  it('keeps a salt change made here when only the export time changed elsewhere', () => {
    const b = base({ kdfSalt: SALT_A });
    const stored = { ...b, lastExportedAt: T0 + 100 };
    const snapshot = withBookkeeping({ ...b, updatedAt: T0 + 5 }, {});
    const merged = reconcileWithStored(b, stored, snapshot);
    expect(merged !== 'conflict' && merged.kdfSalt).toBeUndefined();
    expect(merged !== 'conflict' && merged.lastExportedAt).toBe(T0 + 100);
  });

  it('refuses to overwrite an edit, a deletion or a different salt made elsewhere', () => {
    const b = base();
    const snapshot = { ...b, updatedAt: T0 + 5 };
    expect(reconcileWithStored(b, { ...b, updatedAt: T0 + 3 }, snapshot)).toBe('conflict');
    expect(reconcileWithStored(b, undefined, snapshot)).toBe('conflict');
    expect(reconcileWithStored(b, { ...b, kdfSalt: SALT_A }, { ...snapshot, kdfSalt: SALT_B })).toBe('conflict');
    expect(storedChanged(b, undefined)).toBe(true);
  });

  it('withBookkeeping drops undefined keys and keeps updatedAt', () => {
    const p = withBookkeeping(base({ kdfSalt: SALT_A, lastExportedAt: T0 }), { kdfSalt: undefined, lastExportedAt: T0 + 1 });
    expect('kdfSalt' in p).toBe(false);
    expect(p.lastExportedAt).toBe(T0 + 1);
    expect(p.updatedAt).toBe(T0);
  });
});
