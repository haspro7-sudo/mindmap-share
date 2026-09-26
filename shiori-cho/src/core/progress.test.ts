import { describe, it, expect } from 'vitest';
import { computeProgress, isNoHint, isVisible, missableAlerts, percent } from './progress';
import type { Goal, GoalProgress, ShioriManifestV1, SpoilerLevel } from './types';

function manual(id: string, group: string, extra: Partial<Goal> = {}): Goal {
  return { id, group, label: id.toUpperCase(), spoiler: 0, hints: [], unlock: { type: 'manual' }, ...extra } as Goal;
}

function codeGoal(id: string, group: string): Goal {
  return {
    id,
    group,
    label: '？？？',
    spoiler: 1,
    hints: ['ヒント'],
    unlock: { type: 'code', codeKind: 'b32', tag: 'AAAAAAAAAAAAAAAAAAAAAA' },
    secret: { iv: 'AAAAAAAAAAAAAAAA', ct: 'AAAAAAAAAAAAAAAAAAAAAA' },
  };
}

function manifest(partial: Partial<ShioriManifestV1> = {}): ShioriManifestV1 {
  return {
    schema: 'shiori/1',
    work: { id: 'demo-test', title: 'テスト作品', kind: 'game', version: '1.0.0' },
    author: { kind: 'player' },
    checkpoints: [],
    groups: [],
    goals: [],
    sealed: [],
    changelog: [],
    ...partial,
  };
}

function done(goalId: string, extra: Partial<GoalProgress> = {}): GoalProgress {
  return { workId: 'w1', goalId, via: 'manual', doneAt: 1_000, hintTierAtDone: 0, archived: false, ...extra };
}

const groupsManifest = manifest({
  groups: [
    { id: 'endings', label: 'エンディング' },
    { id: 'ach', label: '実績' },
    { id: 'empty', label: '空のグループ' },
  ],
  goals: [
    codeGoal('end-a', 'endings'),
    codeGoal('end-b', 'endings'),
    codeGoal('end-c', 'endings'),
    manual('ach-1', 'ach'),
    manual('ach-2', 'ach'),
    manual('ach-3', 'ach'),
    manual('ach-4', 'ach'),
  ],
});

describe('percent', () => {
  it('floors and never returns NaN', () => {
    expect(percent(0, 0)).toBe(0);
    expect(percent(1, 3)).toBe(33);
    expect(percent(2, 3)).toBe(66);
    expect(percent(3, 3)).toBe(100);
    expect(percent(199, 200)).toBe(99);
    expect(percent(29, 100)).toBe(29);
    expect(percent(57, 100)).toBe(57);
  });

  it('floors exactly for every done/total up to 500', () => {
    for (let total = 1; total <= 500; total++) {
      for (let d = 0; d <= total; d++) {
        const pct = percent(d, total);
        expect(pct * total <= 100 * d && (pct + 1) * total > 100 * d).toBe(true);
      }
    }
  });
});

describe('computeProgress', () => {
  it('counts overall and per-group values in manifest group order', () => {
    const summary = computeProgress(groupsManifest, [done('end-a', { via: 'code' }), done('ach-1'), done('ach-2')]);
    expect(summary.total).toBe(7);
    expect(summary.done).toBe(3);
    expect(summary.pct).toBe(42); // floor(300/7) = 42
    expect(summary.byGroup).toEqual([
      { groupId: 'endings', label: 'エンディング', total: 3, done: 1, pct: 33 },
      { groupId: 'ach', label: '実績', total: 4, done: 2, pct: 50 },
      { groupId: 'empty', label: '空のグループ', total: 0, done: 0, pct: 0 },
    ]);
  });

  it('excludes archived progress', () => {
    const summary = computeProgress(groupsManifest, [done('end-a', { archived: true }), done('ach-1')]);
    expect(summary.done).toBe(1);
    expect(summary.byGroup[0]!.done).toBe(0);
    expect(summary.byGroup[1]!.done).toBe(1);
  });

  it('ignores progress for goals that are not in the manifest', () => {
    const summary = computeProgress(groupsManifest, [done('removed-goal'), done('ach-1'), done('ach-1')]);
    expect(summary.total).toBe(7);
    expect(summary.done).toBe(1);
  });

  it('counts a goal once even with duplicate progress records', () => {
    const summary = computeProgress(groupsManifest, [done('ach-1'), done('ach-1', { via: 'code' })]);
    expect(summary.done).toBe(1);
    expect(summary.byGroup[1]!.done).toBe(1);
  });

  it('gives 0% (never NaN) for an empty manifest', () => {
    const summary = computeProgress(manifest({ groups: [{ id: 'g', label: 'グループ' }] }), [done('x')]);
    expect(summary).toEqual({
      total: 0,
      done: 0,
      pct: 0,
      byGroup: [{ groupId: 'g', label: 'グループ', total: 0, done: 0, pct: 0 }],
    });
    expect(Number.isNaN(summary.pct)).toBe(false);
  });

  it('reaches 100% when every goal is done', () => {
    const all = groupsManifest.goals.map((g) => done(g.id));
    const summary = computeProgress(groupsManifest, all);
    expect(summary.pct).toBe(100);
    expect(summary.byGroup.map((g) => g.pct)).toEqual([100, 100, 0]);
  });

  it('still counts goals whose group is missing in the overall total', () => {
    const m = manifest({ groups: [{ id: 'a', label: 'A' }], goals: [manual('x', 'a'), manual('y', 'ghost')] });
    const summary = computeProgress(m, [done('y')]);
    expect(summary.total).toBe(2);
    expect(summary.done).toBe(1);
    expect(summary.byGroup).toEqual([{ groupId: 'a', label: 'A', total: 1, done: 0, pct: 0 }]);
  });
});

describe('missableAlerts', () => {
  const m = manifest({
    checkpoints: [
      { id: 'ch1', label: '第1章' },
      { id: 'ch2', label: '第2章' },
      { id: 'ch3', label: '第3章' },
      { id: 'ch4', label: '第4章' },
    ],
    groups: [{ id: 'ach', label: '実績' }],
    goals: [
      manual('stars', 'ach', { spoiler: 2, missable: { before: 'ch3', warn: '星図を集めておこう' } }),
      manual('cat', 'ach', { missable: { before: 'ch1', warn: '猫に話しかけよう' } }),
      manual('last', 'ach', { spoiler: 1, missable: { before: 'ch4', warn: '書架を見て回ろう' } }),
      manual('plain', 'ach'),
    ],
  });

  it('with the current checkpoint unset, c = -1', () => {
    expect(missableAlerts(m, [])).toEqual([
      { goalId: 'stars', level: 'ahead', beforeCheckpointId: 'ch3', warn: '星図を集めておこう', spoiler: 2 },
      { goalId: 'cat', level: 'soon', beforeCheckpointId: 'ch1', warn: '猫に話しかけよう', spoiler: 0 },
      { goalId: 'last', level: 'ahead', beforeCheckpointId: 'ch4', warn: '書架を見て回ろう', spoiler: 1 },
    ]);
  });

  it('treats an unknown current checkpoint like unset', () => {
    expect(missableAlerts(m, [], 'ch-unknown')).toEqual(missableAlerts(m, []));
  });

  it("is 'soon' exactly one checkpoint before and 'ahead' further away", () => {
    const alerts = missableAlerts(m, [], 'ch2');
    expect(alerts.map((a) => [a.goalId, a.level])).toEqual([
      ['stars', 'soon'],
      ['last', 'ahead'],
    ]);
  });

  it('emits nothing once the current checkpoint is at or past missable.before', () => {
    expect(missableAlerts(m, [], 'ch3').map((a) => [a.goalId, a.level])).toEqual([['last', 'soon']]);
    expect(missableAlerts(m, [], 'ch4')).toEqual([]);
  });

  it('emits nothing for done goals', () => {
    expect(missableAlerts(m, [done('stars'), done('cat'), done('last')])).toEqual([]);
  });

  it('treats archived progress as not done', () => {
    const alerts = missableAlerts(m, [done('stars', { archived: true })], 'ch2');
    expect(alerts.map((a) => a.goalId)).toEqual(['stars', 'last']);
  });

  it('skips a missable whose checkpoint is unknown', () => {
    const broken = manifest({
      checkpoints: [{ id: 'ch1', label: '第1章' }],
      groups: [{ id: 'g', label: 'G' }],
      goals: [manual('x', 'g', { missable: { before: 'nowhere', warn: '注意' } })],
    });
    expect(missableAlerts(broken, [])).toEqual([]);
  });

  it('returns nothing when the manifest has no checkpoints', () => {
    expect(missableAlerts(manifest({ goals: [manual('x', 'g')] }), [], 'ch1')).toEqual([]);
  });
});

describe('isNoHint', () => {
  it('is true only for non-archived progress completed at hint tier 0', () => {
    expect(isNoHint(done('a'))).toBe(true);
    expect(isNoHint(done('a', { via: 'code' }))).toBe(true);
    expect(isNoHint(done('a', { hintTierAtDone: 1 }))).toBe(false);
    expect(isNoHint(done('a', { hintTierAtDone: 3 }))).toBe(false);
    expect(isNoHint(done('a', { archived: true }))).toBe(false);
    expect(isNoHint(undefined)).toBe(false);
  });
});

describe('isVisible', () => {
  it('shows text iff spoiler <= tolerance', () => {
    const levels: SpoilerLevel[] = [0, 1, 2, 3];
    for (const spoiler of levels) {
      for (const tolerance of levels) {
        expect(isVisible(spoiler, tolerance)).toBe(spoiler <= tolerance);
      }
    }
    expect(isVisible(2, 1)).toBe(false);
    expect(isVisible(1, 1)).toBe(true);
  });
});
