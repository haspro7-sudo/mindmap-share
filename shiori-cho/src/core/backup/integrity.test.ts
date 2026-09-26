import { describe, expect, it } from 'vitest';
import { manifestKey, validateManifest } from '../manifest/validate';
import type { BackupDataV1, ManifestRecord, Session, ShioriManifestV1, WorkRecord } from '../types';
import hoshiyomiJson from '../../demo/hoshiyomi.shiori.json';
import { normalizeBackupData } from './integrity';

const T0 = Date.UTC(2026, 7, 1, 0, 0, 0);
const MIN = 60_000;

function hoshiyomi(): ShioriManifestV1 {
  const v = validateManifest(structuredClone(hoshiyomiJson));
  if (!v.ok) throw new Error('demo manifest invalid');
  return v.manifest;
}

function quick(id: string): ShioriManifestV1 {
  return {
    schema: 'shiori/1',
    work: { id, title: 'かんたん', kind: 'game', version: '1.0.0' },
    author: { kind: 'player' },
    checkpoints: [],
    groups: [{ id: 'endings', label: 'エンディング' }],
    goals: [
      { id: 'end-1', group: 'endings', label: 'END 1', spoiler: 0, hints: [], unlock: { type: 'manual' } },
      { id: 'end-2', group: 'endings', label: 'END 2', spoiler: 0, hints: [], unlock: { type: 'manual' } },
    ],
    sealed: [],
    changelog: [],
  };
}

function work(id: string, over: Partial<WorkRecord> = {}): WorkRecord {
  return {
    id,
    title: '星読みの図書館',
    alias: '作品A',
    kind: 'game',
    status: 'playing',
    coverEmoji: '📘',
    coverColor: 'paper',
    spoilerTolerance: 1,
    newGoalIds: [],
    createdAt: T0,
    updatedAt: T0,
    ...over,
  };
}

function rec(key: string, workId: string, manifest: ShioriManifestV1): ManifestRecord {
  return { key, workId, manifest, source: 'file', importedAt: T0 };
}

function data(over: Partial<BackupDataV1> = {}): BackupDataV1 {
  return {
    works: [],
    manifests: [],
    progress: [],
    redemptions: [],
    hints: [],
    sessions: [],
    notes: [],
    pending: [],
    sealedOpens: [],
    settings: { discreet: { aliasOnly: true, blurOnHide: true, hideStoreLinks: true, blurExtras: false }, autoLockSec: 60, camouflageText: '' },
    ...over,
  };
}

function deepFreeze<T>(v: T): T {
  if (typeof v === 'object' && v !== null) {
    for (const x of Object.values(v)) deepFreeze(x);
    Object.freeze(v);
  }
  return v;
}

describe('normalizeBackupData', () => {
  it('leaves consistent data as it is', async () => {
    const m = hoshiyomi();
    const key = await manifestKey(m);
    const d = data({
      works: [work('w1', { manifestKey: key, manifestWorkId: 'demo-hoshiyomi', newGoalIds: ['ach-cat'], currentCheckpointId: 'ch1' })],
      manifests: [rec(key, 'w1', m)],
      progress: [{ workId: 'w1', goalId: 'ach-cat', via: 'manual', doneAt: T0, hintTierAtDone: 0, archived: false }],
      sessions: [{ id: 's1', workId: 'w1', startedAt: T0 }],
    });
    const { data: out, report } = await normalizeBackupData(deepFreeze(d));
    expect(out).toEqual(d);
    expect(report).toEqual({
      invalidManifests: 0,
      rekeyedManifests: 0,
      detachedWorks: 0,
      droppedRecords: 0,
      archiveFlagsFixed: 0,
      closedSessions: 0,
    });
  });

  it('recomputes a wrong key, so the genuine file is no longer "already imported"', async () => {
    const edited = hoshiyomi();
    edited.goals[4]!.label = '書き換えられた名前';
    const staleKey = await manifestKey(hoshiyomi()); // the genuine file's key, kept by hand
    const d = data({ works: [work('w1', { manifestKey: staleKey, manifestWorkId: 'demo-hoshiyomi' })], manifests: [rec(staleKey, 'w1', edited)] });
    const { data: out, report } = await normalizeBackupData(d);
    const trueKey = await manifestKey(edited);
    expect(out.manifests.map((r) => r.key)).toEqual([trueKey]);
    expect(out.works[0]!.manifestKey).toBe(trueKey);
    expect(trueKey).not.toBe(staleKey);
    expect(report.rekeyedManifests).toBe(1);
  });

  it('drops a manifest that fails the cross-checks; its work keeps manifestWorkId (and progress) for a re-import', async () => {
    const noKdf = hoshiyomi();
    delete noKdf.kdf;
    const dupGoal = quick('p-dup00001');
    dupGoal.goals.push({ ...dupGoal.goals[0]! });
    const k1 = await manifestKey(hoshiyomi());
    const d = data({
      works: [
        work('w1', { manifestKey: k1, manifestWorkId: 'demo-hoshiyomi', newGoalIds: ['ach-cat'], currentCheckpointId: 'ch1' }),
        work('w2', { manifestKey: 'k-dup', manifestWorkId: 'p-dup00001', createdAt: T0 + 1 }),
      ],
      manifests: [rec(k1, 'w1', noKdf), rec('k-dup', 'w2', dupGoal)],
      progress: [{ workId: 'w1', goalId: 'ach-cat', via: 'manual', doneAt: T0, hintTierAtDone: 0, archived: false }],
    });
    const { data: out, report } = await normalizeBackupData(d);
    expect(out.manifests).toEqual([]);
    expect(out.works[0]).toEqual(work('w1', { manifestWorkId: 'demo-hoshiyomi' }));
    expect(out.works[1]).toEqual(work('w2', { manifestWorkId: 'p-dup00001', createdAt: T0 + 1 }));
    expect(out.progress).toEqual(d.progress);
    expect(report).toMatchObject({ invalidManifests: 2, detachedWorks: 2 });
  });

  it('points manifestWorkId, NEW badges and the checkpoint at the manifest the work uses', async () => {
    const m = quick('p-real0001');
    const key = await manifestKey(m);
    const d = data({
      works: [work('w1', { manifestKey: key, manifestWorkId: 'p-wrong001', newGoalIds: ['end-2', 'gone'], currentCheckpointId: 'ch9' })],
      manifests: [rec(key, 'w1', m)],
    });
    const out = (await normalizeBackupData(d)).data;
    expect(out.works[0]).toEqual(work('w1', { manifestKey: key, manifestWorkId: 'p-real0001', newGoalIds: ['end-2'] }));
  });

  it('keeps one work per manifestWorkId and only the manifest records works use', async () => {
    const m = quick('p-same0001');
    const other = quick('p-other001');
    const key = await manifestKey(m);
    const otherKey = await manifestKey(other);
    const d = data({
      works: [
        work('late', { manifestKey: key, manifestWorkId: 'p-same0001', createdAt: T0 + 5 }),
        work('early', { manifestWorkId: 'p-same0001', createdAt: T0 }),
        work('w3', { createdAt: T0 + 9 }),
      ],
      manifests: [rec(key, 'late', m), rec(otherKey, 'w3', other), rec('k-orphan', 'no-such-work', quick('p-orph0001'))],
    });
    const { data: out } = await normalizeBackupData(d);
    // the work that has the manifest keeps it; the record-only duplicate loses the id
    expect(out.works.map((w) => [w.id, w.manifestKey, w.manifestWorkId])).toEqual([
      ['late', key, 'p-same0001'],
      ['early', undefined, undefined],
      ['w3', undefined, undefined],
    ]);
    expect(out.manifests.map((r) => r.key)).toEqual([key]);
  });

  it('drops child records of works that do not exist', async () => {
    const d = data({
      works: [work('w1')],
      progress: [
        { workId: 'w1', goalId: 'g', via: 'manual', doneAt: T0, hintTierAtDone: 0, archived: false },
        { workId: 'gone', goalId: 'g', via: 'manual', doneAt: T0, hintTierAtDone: 0, archived: false },
      ],
      redemptions: [{ workId: 'gone', goalId: 'end-a', canonical: 'b32:ST4RMAP1X', redeemedAt: T0 }],
      hints: [{ workId: 'gone', goalId: 'g', tier: 1, updatedAt: T0 }],
      sessions: [{ id: 's-gone', workId: 'gone', startedAt: T0, endedAt: T0 + MIN, minutes: 1 }],
      notes: [{ id: 'n-gone', workId: 'gone', text: 'x', createdAt: T0, updatedAt: T0 }],
      sealedOpens: [{ workId: 'gone', sealedId: 'letter', firstOpenedAt: T0, seen: true }],
      pending: [{ id: 'p1', canonical: 'b32:ST4RMAP1X', receivedAt: T0 }],
    });
    const { data: out, report } = await normalizeBackupData(d);
    expect(out.progress.map((p) => p.workId)).toEqual(['w1']);
    expect([out.redemptions, out.hints, out.sessions, out.notes, out.sealedOpens].every((rows) => rows.length === 0)).toBe(true);
    expect(out.pending).toEqual(d.pending);
    expect(report.droppedRecords).toBe(6);
  });

  it('archives progress exactly for the goals missing from the work\'s manifest', async () => {
    const m = quick('p-arch0001');
    const key = await manifestKey(m);
    const d = data({
      works: [work('w1', { manifestKey: key, manifestWorkId: 'p-arch0001' }), work('w2')],
      manifests: [rec(key, 'w1', m)],
      progress: [
        { workId: 'w1', goalId: 'end-1', via: 'manual', doneAt: T0, hintTierAtDone: 0, archived: true },
        { workId: 'w1', goalId: 'my-9', via: 'manual', doneAt: T0, hintTierAtDone: 0, archived: false },
        { workId: 'w2', goalId: 'x', via: 'manual', doneAt: T0, hintTierAtDone: 0, archived: true },
      ],
    });
    const { data: out, report } = await normalizeBackupData(d);
    expect(out.progress.map((p) => [p.goalId, p.archived])).toEqual([
      ['end-1', false],
      ['my-9', true],
      ['x', true],
    ]);
    expect(report.archiveFlagsFixed).toBe(2);
  });

  it('leaves at most one session open (the latest start)', async () => {
    const sessions: Session[] = [
      { id: 'a', workId: 'w1', startedAt: T0 },
      { id: 'b', workId: 'w1', startedAt: T0 + 2 * MIN },
      { id: 'c', workId: 'w1', startedAt: T0 - MIN, endedAt: T0, minutes: 1 },
    ];
    const { data: out, report } = await normalizeBackupData(data({ works: [work('w1')], sessions }));
    expect(out.sessions).toEqual([{ id: 'a', workId: 'w1', startedAt: T0, endedAt: T0, minutes: 0 }, sessions[1], sessions[2]]);
    expect(report.closedSessions).toBe(1);
  });

  it('is idempotent and never mutates its input', async () => {
    const edited = hoshiyomi();
    const d = deepFreeze(
      data({
        works: [work('w1', { manifestKey: 'stale', manifestWorkId: 'demo-hoshiyomi', newGoalIds: ['nope'] })],
        manifests: [rec('stale', 'w1', edited)],
        sessions: [
          { id: 'a', workId: 'w1', startedAt: T0 },
          { id: 'b', workId: 'w1', startedAt: T0 + 1 },
        ],
      }),
    );
    const before = JSON.stringify(d);
    const once = (await normalizeBackupData(d)).data;
    expect(JSON.stringify(d)).toBe(before);
    const twice = await normalizeBackupData(once);
    expect(twice.data).toEqual(once);
    expect(Object.values(twice.report).every((n) => n === 0)).toBe(true);
  });
});
