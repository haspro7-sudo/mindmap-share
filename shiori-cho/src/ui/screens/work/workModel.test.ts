import { describe, expect, it } from 'vitest';
import type { GoalSecret, ShioriManifestV1, WorkRecord } from '../../../core/types';
import { goalIdsWithRecords, goalSecret, goalViews, hintTierName, isAnswerTier, newGoalId } from './workModel';
import type { WorkData } from './workModel';

const T0 = 1_790_000_000_000;

function manifest(goals: ShioriManifestV1['goals']): ShioriManifestV1 {
  return {
    schema: 'shiori/1',
    work: { id: 'p-model001', title: 'テスト', kind: 'game', version: '1.0.0' },
    author: { kind: 'player' },
    checkpoints: [],
    groups: [{ id: 'endings', label: 'エンディング' }],
    goals,
    sealed: [],
    changelog: [],
  };
}

function manual(id: string): ShioriManifestV1['goals'][number] {
  return { id, group: 'endings', label: id, spoiler: 0, hints: [], unlock: { type: 'manual' } };
}

const WORK: WorkRecord = {
  id: 'w1',
  title: 'テスト',
  alias: '作品A',
  kind: 'game',
  status: 'playing',
  coverEmoji: '📘',
  coverColor: 'paper',
  spoilerTolerance: 1,
  newGoalIds: [],
  createdAt: T0,
  updatedAt: T0,
};

function data(m: ShioriManifestV1, over: Partial<WorkData> = {}): WorkData {
  return { work: WORK, manifest: m, progress: [], hints: [], redeemedGoalIds: [], sealedOpens: [], sessions: [], notes: [], ...over };
}

describe('goalViews / goalSecret', () => {
  it('a code goal named "constructor" stays locked until its secret really is decrypted', () => {
    const m = manifest([
      {
        id: 'constructor',
        group: 'endings',
        label: 'END 1',
        spoiler: 2,
        hints: [],
        unlock: { type: 'code', codeKind: 'b32', tag: 'AAAAAAAAAAAAAAAAAAAAAA' },
        secret: { iv: 'AAAAAAAAAAAAAAAA', ct: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' },
      },
    ]);
    const empty = Object.create(null) as Record<string, GoalSecret>;
    expect(goalViews(data(m), empty)[0]?.secret).toBeUndefined();
    // even a plain object (with a prototype) is read by own keys only
    expect(goalViews(data(m), {})[0]?.secret).toBeUndefined();
    expect(goalSecret({}, 'toString')).toBeUndefined();

    const secrets = Object.create(null) as Record<string, GoalSecret>;
    secrets['constructor'] = { title: '本当のタイトル' };
    expect(goalViews(data(m), secrets)[0]?.secret).toEqual({ title: '本当のタイトル' });
  });
});

describe('hint tiers', () => {
  it('are named by position like the studio fields: 示唆, 方向, 答え', () => {
    expect([1, 2, 3].map((i) => hintTierName(i))).toEqual(['示唆', '方向', '答え']);
  });

  it('only the third tier is the answer that asks for a confirmation (a lone hint is a 示唆)', () => {
    expect([1, 2, 3].map((i) => isAnswerTier(i))).toEqual([false, false, true]);
  });
});

describe('newGoalId', () => {
  it('never reuses the id of a deleted item that still has records', () => {
    // かんたんしおり with two endings; the player added my-3, completed it, then deleted it
    const m = manifest([manual('end-1'), manual('end-2')]);
    const d = data(m, {
      progress: [{ workId: 'w1', goalId: 'my-3', via: 'manual', doneAt: T0, hintTierAtDone: 0, archived: true }],
      hints: [{ workId: 'w1', goalId: 'my-5', tier: 1, updatedAt: T0 }],
      notes: [{ id: 'n1', workId: 'w1', goalId: 'my-4', text: 'メモ', createdAt: T0, updatedAt: T0 }],
    });
    expect([...goalIdsWithRecords(d)].sort()).toEqual(['my-3', 'my-4', 'my-5']);
    expect(newGoalId(m, goalIdsWithRecords(d))).toBe('my-6');
    // without any record, the next number after the goals
    expect(newGoalId(m)).toBe('my-3');
  });

  it('counts on from the highest my-<n> in the manifest', () => {
    const m = manifest([manual('end-1'), manual('my-7')]);
    expect(newGoalId(m)).toBe('my-8');
    expect(newGoalId(m, ['my-12'])).toBe('my-13');
  });
});
