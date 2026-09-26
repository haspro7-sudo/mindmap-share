import { describe, it, expect, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../core/types';
import type { DiscreetSettings, Session, Settings } from '../core/types';
import { makeDataset, makeRedemption, makeWork } from './repoContract';
import {
  ORDER,
  applySettingsPatch,
  assertBackupKeys,
  assertKeys,
  backupSettingsOf,
  cmpStr,
  createEmitter,
  isOpenSession,
  normalizeSettings,
  settingsAfterReplace,
  stripRedemption,
} from './shared';

describe('normalizeSettings', () => {
  it('returns a fresh copy of the defaults for missing or corrupt input', () => {
    for (const input of [undefined, null, 42, 'x', [], { discreet: 'x', completionPromptedWorkIds: 'x' }]) {
      const s = normalizeSettings(input);
      expect(s).toEqual(DEFAULT_SETTINGS);
      expect(s.discreet).not.toBe(DEFAULT_SETTINGS.discreet);
      expect(s.completionPromptedWorkIds).not.toBe(DEFAULT_SETTINGS.completionPromptedWorkIds);
    }
  });

  it('merges discreet key-wise and keeps stored values', () => {
    expect(normalizeSettings({ discreet: { blurExtras: true }, pinFailures: 3, lastBackupAt: 9 })).toEqual({
      ...DEFAULT_SETTINGS,
      discreet: { ...DEFAULT_SETTINGS.discreet, blurExtras: true },
      pinFailures: 3,
      lastBackupAt: 9,
    });
  });

  it('drops undefined values instead of overriding defaults with them', () => {
    const s = normalizeSettings({ camouflageText: undefined, pin: undefined, discreet: { aliasOnly: undefined } });
    expect(s).toEqual(DEFAULT_SETTINGS);
    expect('pin' in s).toBe(false);
  });

  it('does not share references with its input', () => {
    const stored = { ...DEFAULT_SETTINGS, completionPromptedWorkIds: ['w1'], persist: { requestedAt: 1, granted: true } };
    const s = normalizeSettings(stored);
    s.completionPromptedWorkIds.push('w2');
    s.persist!.granted = false;
    expect(stored.completionPromptedWorkIds).toEqual(['w1']);
    expect(stored.persist.granted).toBe(true);
  });
});

describe('applySettingsPatch', () => {
  const base: Settings = { ...normalizeSettings(undefined), ageConfirmedAt: 1, pin: { salt: 's', iterations: 1, hash: 'h' } };

  it('shallow-merges and deep-merges discreet', () => {
    const next = applySettingsPatch(base, { autoLockSec: 0, discreet: { hideStoreLinks: false } as DiscreetSettings });
    expect(next).toEqual({ ...base, autoLockSec: 0, discreet: { ...base.discreet, hideStoreLinks: false } });
  });

  it('removes optional keys set to undefined but keeps required ones', () => {
    const next = applySettingsPatch(base, { pin: undefined, pinFailures: undefined, discreet: undefined });
    expect('pin' in next).toBe(false);
    expect(next.pinFailures).toBe(0);
    expect(next.discreet).toEqual(base.discreet);
    expect(next.ageConfirmedAt).toBe(1);
  });

  it('does not modify its arguments', () => {
    const current = normalizeSettings(undefined);
    const patch = { discreet: { aliasOnly: false } as DiscreetSettings };
    applySettingsPatch(current, patch);
    expect(current).toEqual(DEFAULT_SETTINGS);
    expect(patch).toEqual({ discreet: { aliasOnly: false } });
  });
});

describe('backup settings', () => {
  it('backupSettingsOf keeps only discreet, autoLockSec and camouflageText', () => {
    const s: Settings = { ...normalizeSettings(undefined), ageConfirmedAt: 1, camouflageText: 'x', autoLockSec: 30 };
    const out = backupSettingsOf(s);
    expect(out).toEqual({ discreet: DEFAULT_SETTINGS.discreet, autoLockSec: 30, camouflageText: 'x' });
    expect(out.discreet).not.toBe(s.discreet);
  });

  it('settingsAfterReplace keeps local state, takes the backup subset and resets the counter', () => {
    const local: Settings = {
      ...normalizeSettings(undefined),
      ageConfirmedAt: 1,
      onboardedAt: 2,
      pin: { salt: 's', iterations: 1, hash: 'h' },
      pinFailures: 4,
      pinCooldownUntil: 5,
      persist: { requestedAt: 6, granted: false },
      lastBackupAt: 7,
      backupReminderSnoozedUntil: 8,
      completionPromptedWorkIds: ['w1'],
      changesSinceBackup: 30,
      discreet: { aliasOnly: true, blurOnHide: true, hideStoreLinks: true, blurExtras: true },
    };
    const next = settingsAfterReplace(local, {
      discreet: { aliasOnly: false } as DiscreetSettings,
      autoLockSec: 300,
      camouflageText: '新しいメモ',
    });
    expect(next).toEqual({
      ...local,
      // missing discreet keys fall back to the defaults: the backup wins, not the local values
      discreet: { ...DEFAULT_SETTINGS.discreet, aliasOnly: false },
      autoLockSec: 300,
      camouflageText: '新しいメモ',
      changesSinceBackup: 0,
    });
  });

  it('settingsAfterReplace keeps the local subset when the backup has none', () => {
    const local: Settings = { ...normalizeSettings(undefined), camouflageText: 'x', changesSinceBackup: 3 };
    expect(settingsAfterReplace(local, undefined)).toEqual({ ...local, changesSinceBackup: 0 });
  });
});

describe('records', () => {
  it('stripRedemption removes the cached master without touching the input', () => {
    const r = makeRedemption('w1', 'g1');
    const out = stripRedemption(r);
    expect(out).toEqual({ workId: 'w1', goalId: 'g1', canonical: r.canonical, redeemedAt: r.redeemedAt });
    expect('master' in out).toBe(false);
    expect('masterSalt' in out).toBe(false);
    expect(r.master).toBeDefined();
  });

  it('assertKeys accepts string keys and rejects anything else', () => {
    expect(() => assertKeys({ id: '' }, ['id'], 't')).not.toThrow();
    expect(() => assertKeys({ id: 1 }, ['id'], 't')).toThrow(TypeError);
    expect(() => assertKeys({}, ['id'], 't')).toThrow(TypeError);
    expect(() => assertKeys(null, ['id'], 't')).toThrow(TypeError);
    expect(() => assertKeys({ workId: 'w' }, ['workId', 'goalId'], 't')).toThrow(/goalId/);
  });

  it('assertBackupKeys validates every store and the array shape', () => {
    expect(() => assertBackupKeys(makeDataset())).not.toThrow();
    expect(() => assertBackupKeys({})).not.toThrow();
    expect(() => assertBackupKeys({ works: 'x' as never })).toThrow(/works/);
    expect(() => assertBackupKeys({ notes: [{ id: 'n' } as never] })).toThrow(/notes\[0\].*workId/);
    expect(() => assertBackupKeys({ works: [makeWork('a'), { ...makeWork('b'), id: 3 } as never] })).toThrow(/works\[1\]/);
  });
});

describe('ordering', () => {
  it('cmpStr compares by UTF-16 code units like IndexedDB', () => {
    expect(['b', 'B', 'a', 'あ', '10', '9'].sort(cmpStr)).toEqual(['10', '9', 'B', 'a', 'b', 'あ']);
    expect(cmpStr('x', 'x')).toBe(0);
  });

  it('sessions: startedAt desc, then id desc', () => {
    const s = (id: string, startedAt: number): Session => ({ id, workId: 'w', startedAt });
    expect([s('a', 1), s('c', 2), s('b', 2), s('d', 0)].sort(ORDER.sessions).map((x) => x.id)).toEqual([
      'c',
      'b',
      'a',
      'd',
    ]);
  });

  it('isOpenSession: only sessions without endedAt are open', () => {
    expect(isOpenSession({ id: 's', workId: 'w', startedAt: 1 })).toBe(true);
    expect(isOpenSession({ id: 's', workId: 'w', startedAt: 1, endedAt: undefined })).toBe(true);
    expect(isOpenSession({ id: 's', workId: 'w', startedAt: 1, endedAt: 0 })).toBe(false);
  });
});

describe('createEmitter', () => {
  it('calls every listener once per emit, in subscription order', () => {
    const e = createEmitter('t');
    const calls: number[] = [];
    e.subscribe(() => calls.push(1));
    e.subscribe(() => calls.push(2));
    e.emit();
    e.emit();
    expect(calls).toEqual([1, 2, 1, 2]);
  });

  it('isolates listener errors and logs them', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const e = createEmitter('t');
      const after = vi.fn();
      e.subscribe(() => {
        throw new Error('boom');
      });
      e.subscribe(after);
      expect(() => e.emit()).not.toThrow();
      expect(after).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });

  it('skips listeners removed earlier in the same round and does not call listeners added during it', () => {
    const e = createEmitter('t');
    const late = vi.fn();
    const second = vi.fn();
    let offSecond = () => {};
    e.subscribe(() => {
      offSecond();
      e.subscribe(late);
    });
    offSecond = e.subscribe(second);
    e.emit();
    expect(second).not.toHaveBeenCalled();
    expect(late).not.toHaveBeenCalled();
  });
});
