import { describe, it, expect } from 'vitest';
import { b64uEncode } from '../encoding';
import type { GoalProgress, KdfParams, ShioriManifestV1 } from '../types';
import { diffManifests, upgradeProgress } from './upgrade';

const kdf = (fill = 1, iterations = 200_000): KdfParams => ({
  alg: 'PBKDF2-SHA256',
  iterations,
  salt: b64uEncode(new Uint8Array(16).fill(fill)),
});

function manifest(goalIds: string[], k?: KdfParams): ShioriManifestV1 {
  return {
    schema: 'shiori/1',
    work: { id: 'demo-upgrade', title: 'アップデートのテスト', kind: 'game', version: '1.0.0' },
    author: { kind: 'creator' },
    ...(k ? { kdf: k } : {}),
    checkpoints: [],
    groups: [{ id: 'main', label: '本編' }],
    goals: goalIds.map((id) => ({ id, group: 'main', label: id, spoiler: 0, hints: [], unlock: { type: 'manual' } })),
    sealed: [],
    changelog: [],
  };
}

const done = (goalId: string, extra: Partial<GoalProgress> = {}): GoalProgress => ({
  workId: 'local-1',
  goalId,
  via: 'manual',
  doneAt: 1_700_000_000_000,
  hintTierAtDone: 0,
  archived: false,
  ...extra,
});

function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object') {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
}

describe('diffManifests', () => {
  it('lists added, removed and kept goals', () => {
    const d = diffManifests(manifest(['a', 'b', 'c', 'd']), manifest(['e', 'c', 'a', 'f']));
    expect(d.added).toEqual(['e', 'f']);
    expect(d.removed).toEqual(['b', 'd']);
    expect(d.kept).toEqual(['c', 'a']);
    expect(d.kdfChanged).toBe(false);
  });

  it('is empty for identical manifests', () => {
    const m = manifest(['a', 'b'], kdf());
    expect(diffManifests(m, structuredClone(m))).toEqual({ added: [], removed: [], kept: ['a', 'b'], kdfChanged: false });
  });

  it('handles empty goal lists', () => {
    expect(diffManifests(manifest([]), manifest(['a']))).toEqual({ added: ['a'], removed: [], kept: [], kdfChanged: false });
    expect(diffManifests(manifest(['a']), manifest([]))).toEqual({ added: [], removed: ['a'], kept: [], kdfChanged: false });
  });

  it('flags kdf changes: salt, iterations and presence', () => {
    const ids = ['a'];
    expect(diffManifests(manifest(ids, kdf(1)), manifest(ids, kdf(1))).kdfChanged).toBe(false);
    expect(diffManifests(manifest(ids, kdf(1)), manifest(ids, kdf(2))).kdfChanged).toBe(true);
    expect(diffManifests(manifest(ids, kdf(1, 200_000)), manifest(ids, kdf(1, 300_000))).kdfChanged).toBe(true);
    expect(diffManifests(manifest(ids), manifest(ids, kdf())).kdfChanged).toBe(true);
    expect(diffManifests(manifest(ids, kdf()), manifest(ids)).kdfChanged).toBe(true);
    expect(diffManifests(manifest(ids), manifest(ids)).kdfChanged).toBe(false);
  });
});

describe('upgradeProgress', () => {
  it('archives progress of removed goals and preserves the rest', () => {
    const oldM = manifest(['a', 'b', 'c']);
    const newM = manifest(['a', 'c', 'd']);
    const progress = [
      done('a', { via: 'code', hintTierAtDone: 2, doneAt: 1 }),
      done('b', { doneAt: 2 }),
      done('c', { doneAt: 3, hintTierAtDone: 3 }),
    ];
    const r = upgradeProgress(oldM, newM, progress);
    expect(r.progress).toEqual([
      done('a', { via: 'code', hintTierAtDone: 2, doneAt: 1 }),
      done('b', { doneAt: 2, archived: true }),
      done('c', { doneAt: 3, hintTierAtDone: 3 }),
    ]);
    expect(r.newGoalIds).toEqual(['d']);
    expect(r.archivedGoalIds).toEqual(['b']);
  });

  it('un-archives goals that reappear', () => {
    const oldM = manifest(['a']);
    const newM = manifest(['a', 'b']);
    const r = upgradeProgress(oldM, newM, [done('a'), done('b', { archived: true })]);
    expect(r.progress.map((p) => [p.goalId, p.archived])).toEqual([
      ['a', false],
      ['b', false],
    ]);
    expect(r.newGoalIds).toEqual(['b']);
    expect(r.archivedGoalIds).toEqual([]);
  });

  it('keeps already archived progress archived while the goal stays gone', () => {
    const r = upgradeProgress(manifest(['a']), manifest(['a']), [done('zombie', { archived: true }), done('a')]);
    expect(r.progress.map((p) => [p.goalId, p.archived])).toEqual([
      ['zombie', true],
      ['a', false],
    ]);
    expect(r.archivedGoalIds).toEqual(['zombie']);
    expect(r.newGoalIds).toEqual([]);
  });

  it('handles empty progress and a round trip (remove, then restore)', () => {
    expect(upgradeProgress(manifest(['a']), manifest(['b']), [])).toEqual({
      progress: [],
      newGoalIds: ['b'],
      archivedGoalIds: [],
    });
    const v1 = manifest(['a', 'b']);
    const v2 = manifest(['a']);
    const step1 = upgradeProgress(v1, v2, [done('a'), done('b')]);
    expect(step1.archivedGoalIds).toEqual(['b']);
    const step2 = upgradeProgress(v2, v1, step1.progress);
    expect(step2.progress).toEqual([done('a'), done('b')]);
    expect(step2.newGoalIds).toEqual(['b']);
  });

  it('does not depend on the kdf (masters are re-derived by the service)', () => {
    const r = upgradeProgress(manifest(['a'], kdf(1)), manifest(['a'], kdf(2)), [done('a', { via: 'code' })]);
    expect(r.progress).toEqual([done('a', { via: 'code' })]);
  });

  it('is pure: inputs are not mutated and outputs are new objects', () => {
    const oldM = deepFreeze(manifest(['a', 'b']));
    const newM = deepFreeze(manifest(['b', 'c']));
    const progress = deepFreeze([done('a'), done('b', { archived: true })]);
    const r = upgradeProgress(oldM, newM, progress);
    expect(r.progress).not.toBe(progress);
    expect(r.progress[0]).not.toBe(progress[0]);
    expect(r.progress.map((p) => p.archived)).toEqual([true, false]);
    expect(progress.map((p) => p.archived)).toEqual([false, true]);
    // results are mutable copies
    r.progress[0]!.doneAt = 5;
    expect(progress[0]!.doneAt).toBe(1_700_000_000_000);
  });
});
