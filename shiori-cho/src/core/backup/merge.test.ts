import { describe, it, expect } from 'vitest';
import type {
  BackupDataV1,
  GoalProgress,
  HintReveal,
  ManifestRecord,
  MergeStats,
  Note,
  PendingCode,
  Redemption,
  SealedOpen,
  Session,
  ShioriManifestV1,
  WorkRecord,
} from '../types';
import { exportBackup, parseBackup } from './format';
import { mergeBackup } from './merge';

const T0 = Date.UTC(2026, 7, 1, 0, 0, 0);
const MIN = 60_000;

/** local work id / incoming work id (same manifest, different devices) */
const L = '11111111-1111-4111-8111-111111111111';
const I = '22222222-2222-4222-8222-222222222222';
const MW = 'demo-hoshiyomi';

const ZERO: MergeStats = { worksAdded: 0, worksUpdated: 0, worksRemapped: 0, progressAdded: 0, sessionsAdded: 0, notesAdded: 0 };

function deepFreeze<T>(v: T): T {
  if (typeof v === 'object' && v !== null) {
    for (const x of Object.values(v)) deepFreeze(x);
    Object.freeze(v);
  }
  return v;
}

function manifest(workId: string, version = '1.0.0'): ShioriManifestV1 {
  return {
    schema: 'shiori/1',
    work: { id: workId, title: '星読みの図書館', kind: 'game', version },
    author: { kind: 'player' },
    checkpoints: [],
    groups: [{ id: 'ach', label: '実績' }],
    goals: [{ id: 'g1', group: 'ach', label: '実績 1', spoiler: 0, hints: [], unlock: { type: 'manual' } }],
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
function mrec(key: string, workId: string, over: Partial<ManifestRecord> = {}): ManifestRecord {
  return { key, workId, manifest: manifest(MW), source: 'file', importedAt: T0, ...over };
}
function prog(workId: string, goalId: string, over: Partial<GoalProgress> = {}): GoalProgress {
  return { workId, goalId, via: 'manual', doneAt: T0, hintTierAtDone: 0, archived: false, ...over };
}
function red(workId: string, goalId: string, over: Partial<Redemption> = {}): Redemption {
  return { workId, goalId, canonical: 'b32:ST4RMAP1X', redeemedAt: T0, ...over };
}
function hint(workId: string, goalId: string, tier: HintReveal['tier'], over: Partial<HintReveal> = {}): HintReveal {
  return { workId, goalId, tier, updatedAt: T0, ...over };
}
function sess(id: string, workId: string, over: Partial<Session> = {}): Session {
  return { id, workId, startedAt: T0, ...over };
}
function note(id: string, workId: string, over: Partial<Note> = {}): Note {
  return { id, workId, text: 'メモ', createdAt: T0, updatedAt: T0, ...over };
}
function pend(id: string, canonical: string, over: Partial<PendingCode> = {}): PendingCode {
  return { id, canonical, receivedAt: T0, ...over };
}
function opened(workId: string, sealedId: string, over: Partial<SealedOpen> = {}): SealedOpen {
  return { workId, sealedId, firstOpenedAt: T0, seen: false, ...over };
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
    settings: {
      discreet: { aliasOnly: true, blurOnHide: true, hideStoreLinks: true, blurExtras: false },
      autoLockSec: 60,
      camouflageText: '',
    },
    ...over,
  };
}

/** A populated data set touching every store. */
function rich(): BackupDataV1 {
  const W2 = '33333333-3333-4333-8333-333333333333';
  return data({
    works: [
      work(L, { manifestKey: 'k1', manifestWorkId: MW, lastPlayedAt: T0 + 90 * MIN, newGoalIds: ['g2'] }),
      work(W2, { title: '雨音と読書の時間', alias: '作品B', kind: 'voice', status: 'backlog', storeCode: 'RJ01234567' }),
    ],
    manifests: [mrec('k1', L), mrec('k0', L, { manifest: manifest(MW, '0.9.0') })],
    progress: [prog(L, 'g1', { via: 'code', hintTierAtDone: 2 }), prog(L, 'old', { archived: true })],
    redemptions: [red(L, 'g1', { master: 'bWFzdGVy', masterSalt: 'c2FsdA' })],
    hints: [hint(L, 'g1', 2)],
    sessions: [sess('s1', L, { endedAt: T0 + 30 * MIN, minutes: 30, whereNote: '第2章の途中' }), sess('s2', W2)],
    notes: [note('n1', L, { goalId: 'g1' }), note('n2', W2, { text: '||ネタバレ||' })],
    pending: [pend('p1', 'kana:ほたるかえでつばめこだますずめ', { manifestWorkIdHint: 'demo-amaoto' })],
    sealedOpens: [opened(L, 'letter', { seen: true })],
    settings: {
      discreet: { aliasOnly: false, blurOnHide: true, hideStoreLinks: false, blurExtras: true },
      autoLockSec: 300,
      camouflageText: '買い物メモ',
    },
  });
}

describe('mergeBackup: basics', () => {
  it('merging nothing into nothing gives nothing', () => {
    expect(mergeBackup(data(), data())).toEqual({ merged: data(), stats: ZERO });
  });

  it('merging into empty local data adds everything but keeps local settings', () => {
    const incoming = rich();
    const { merged, stats } = mergeBackup(data(), incoming);
    expect(merged).toEqual({ ...incoming, redemptions: [red(L, 'g1')], settings: data().settings });
    expect(stats).toEqual({ worksAdded: 2, worksUpdated: 0, worksRemapped: 0, progressAdded: 2, sessionsAdded: 2, notesAdded: 2 });
  });

  it('merging an empty backup changes nothing', () => {
    const local = rich();
    expect(mergeBackup(local, data())).toEqual({ merged: local, stats: ZERO });
  });

  it('is idempotent: merge(x, x) equals x', () => {
    const x = rich();
    const { merged, stats } = mergeBackup(x, rich());
    expect(merged).toEqual(x);
    expect(stats).toEqual(ZERO);
  });

  it('is idempotent on re-import: merging the same backup twice changes nothing the second time', () => {
    const local = rich();
    const incoming = data({
      works: [work(I, { manifestWorkId: MW, updatedAt: T0 + 1, title: '新しい名前' }), work('w-new')],
      progress: [prog(I, 'g1', { doneAt: T0 - 1 }), prog(I, 'g9')],
      sessions: [sess('s1', I, { endedAt: T0 + 40 * MIN }), sess('s9', 'w-new')],
      notes: [note('n9', I)],
      pending: [pend('p9', 'b32:M00NDESKR')],
    });
    const once = mergeBackup(local, incoming).merged;
    const twice = mergeBackup(once, incoming);
    expect(twice.merged).toEqual(once);
    expect(twice.stats).toEqual({ ...ZERO, worksRemapped: 1 });
  });

  it('does not mutate its inputs', () => {
    const local = deepFreeze(rich());
    const incoming = deepFreeze(
      data({
        works: [work(I, { manifestWorkId: MW, updatedAt: T0 + 5 }), work('w-new')],
        progress: [prog(I, 'g1', { doneAt: T0 - 5 })],
        redemptions: [red(I, 'g2', { master: 'bWFzdGVy' })],
        sessions: [sess('s1', I, { endedAt: T0 + 99 * MIN })],
        sealedOpens: [opened(I, 'letter', { firstOpenedAt: T0 - 1 })],
      }),
    );
    const before = JSON.stringify([local, incoming]);
    expect(() => mergeBackup(local, incoming)).not.toThrow();
    expect(JSON.stringify([local, incoming])).toBe(before);
  });

  it('returns data that shares no objects with the inputs', () => {
    const local = rich();
    const incoming = data({ works: [work('w-new')], manifests: [mrec('k9', 'w-new')] });
    const { merged } = mergeBackup(local, incoming);
    expect(merged.works[0]).not.toBe(local.works[0]);
    expect(merged.works[0]!.newGoalIds).not.toBe(local.works[0]!.newGoalIds);
    expect(merged.manifests[0]!.manifest).not.toBe(local.manifests[0]!.manifest);
    expect(merged.works[2]).not.toBe(incoming.works[0]);
    expect(merged.settings).not.toBe(local.settings);
    expect(merged.settings.discreet).not.toBe(local.settings.discreet);
    merged.works[0]!.newGoalIds.push('mutated');
    merged.settings.discreet.aliasOnly = true;
    expect(local.works[0]!.newGoalIds).toEqual(['g2']);
    expect(local.settings.discreet.aliasOnly).toBe(false);
  });

  it('keeps local order and appends new incoming records in their order', () => {
    const local = data({ works: [work('a'), work('b')], notes: [note('n1', 'a'), note('n2', 'b')] });
    const incoming = data({ works: [work('d'), work('b'), work('c')], notes: [note('n4', 'd'), note('n1', 'a'), note('n3', 'c')] });
    const { merged } = mergeBackup(local, incoming);
    expect(merged.works.map((w) => w.id)).toEqual(['a', 'b', 'd', 'c']);
    expect(merged.notes.map((n) => n.id)).toEqual(['n1', 'n2', 'n4', 'n3']);
  });
});

describe('mergeBackup: works', () => {
  it('matches by id; the newer updatedAt wins as a whole (manifestKey too when neither side has its record)', () => {
    const local = data({ works: [work(L, { title: '旧', status: 'playing', manifestKey: 'k1', manifestWorkId: MW, updatedAt: T0 })] });
    const newer = work(L, {
      title: '新',
      alias: '作品Z',
      status: 'completed',
      coverEmoji: '🌟',
      coverColor: 'plum',
      spoilerTolerance: 3,
      manifestKey: 'k2',
      manifestWorkId: MW,
      currentCheckpointId: 'ch3',
      newGoalIds: ['g5'],
      updatedAt: T0 + 1,
    });
    const { merged, stats } = mergeBackup(local, data({ works: [newer] }));
    expect(merged.works).toEqual([newer]);
    expect(stats).toEqual({ ...ZERO, worksUpdated: 1 });
  });

  it('keeps the local work when it is newer or equally new', () => {
    const mine = work(L, { title: '手元', manifestKey: 'k1', updatedAt: T0 + 10 });
    for (const updatedAt of [T0 + 9, T0 + 10]) {
      const { merged, stats } = mergeBackup(data({ works: [mine] }), data({ works: [work(L, { title: '届いた', manifestKey: 'k2', updatedAt })] }));
      expect(merged.works).toEqual([mine]);
      expect(stats).toEqual(ZERO);
    }
  });

  it('keeps the earliest createdAt and the latest lastPlayedAt whichever side wins', () => {
    const local = work(L, { createdAt: T0 + 5, lastPlayedAt: T0 + 100, updatedAt: T0 });
    const incoming = work(L, { createdAt: T0, lastPlayedAt: T0 + 50, updatedAt: T0 + 1, title: '新' });
    const a = mergeBackup(data({ works: [local] }), data({ works: [incoming] })).merged.works[0]!;
    expect(a).toEqual({ ...incoming, createdAt: T0, lastPlayedAt: T0 + 100 });
    const b = mergeBackup(data({ works: [incoming] }), data({ works: [local] })).merged.works[0]!;
    expect(b).toEqual({ ...incoming, createdAt: T0, lastPlayedAt: T0 + 100 });
    // lastPlayedAt only on one side, or on neither
    const c = mergeBackup(data({ works: [work(L, { updatedAt: T0 + 1 })] }), data({ works: [work(L, { lastPlayedAt: T0 + 7 })] }));
    expect(c.merged.works[0]!.lastPlayedAt).toBe(T0 + 7);
    const d = mergeBackup(data({ works: [work(L)] }), data({ works: [work(L, { updatedAt: T0 + 1 })] }));
    expect(d.merged.works[0]).not.toHaveProperty('lastPlayedAt');
  });

  it('adds works that match neither by id nor by manifestWorkId, with their records unchanged', () => {
    const local = data({ works: [work(L, { manifestWorkId: MW })] });
    const incoming = data({
      works: [work('w-other', { manifestWorkId: 'demo-amaoto' }), work('w-plain')],
      progress: [prog('w-other', 'g1')],
      notes: [note('n1', 'w-plain')],
    });
    const { merged, stats } = mergeBackup(local, incoming);
    expect(merged.works.map((w) => w.id)).toEqual([L, 'w-other', 'w-plain']);
    expect(merged.progress).toEqual([prog('w-other', 'g1')]);
    expect(merged.notes).toEqual([note('n1', 'w-plain')]);
    expect(stats).toEqual({ ...ZERO, worksAdded: 2, progressAdded: 1, notesAdded: 1 });
  });

  it('does not remap a work without a manifestWorkId, even if everything else matches', () => {
    const local = data({ works: [work(L)] });
    const { merged, stats } = mergeBackup(local, data({ works: [work(I)] }));
    expect(merged.works.map((w) => w.id)).toEqual([L, I]);
    expect(stats).toEqual({ ...ZERO, worksAdded: 1 });
  });

  it('prefers an id match over a manifestWorkId match', () => {
    const W2 = 'w-second';
    const local = data({ works: [work(L, { manifestWorkId: 'demo-amaoto' }), work(W2, { manifestWorkId: MW })] });
    const incoming = data({ works: [work(L, { manifestWorkId: MW, updatedAt: T0 + 1 })], progress: [prog(L, 'g1')] });
    const { merged, stats } = mergeBackup(local, incoming);
    expect(merged.works.map((w) => w.id)).toEqual([L, W2]);
    expect(merged.progress).toEqual([prog(L, 'g1')]);
    expect(stats).toEqual({ ...ZERO, worksUpdated: 1, progressAdded: 1 });
  });
});

describe('mergeBackup: which manifest a merged work keeps', () => {
  const quick = (id: string): ShioriManifestV1 => manifest(id);
  const creator = (version: string): ShioriManifestV1 => ({
    ...manifest(MW, version),
    author: { kind: 'creator' },
    checkpoints: [{ id: 'ch1', label: '第1章' }],
  });

  it('keeps a manifest update made on the other device even when this device\'s record is newer', () => {
    // Both devices had v1.0 (kA). The other device imported v1.1 (kB) and got a NEW badge; later this device
    // ended a session, which bumped the work's updatedAt.
    const mine = work(L, { title: '手元', manifestKey: 'kA', manifestWorkId: MW, lastPlayedAt: T0 + 100, updatedAt: T0 + 100 });
    const local = data({ works: [mine], manifests: [mrec('kA', L, { manifest: creator('1.0.0') })] });
    const theirs = work(L, { title: '届いた', manifestKey: 'kB', manifestWorkId: MW, newGoalIds: ['ach-new'], updatedAt: T0 + 60 });
    const incoming = data({
      works: [theirs],
      manifests: [mrec('kB', L, { manifest: creator('1.1.0'), importedAt: T0 + 50 })],
    });
    const { merged, stats } = mergeBackup(local, incoming);
    expect(merged.works).toEqual([{ ...mine, manifestKey: 'kB', newGoalIds: ['ach-new'] }]);
    expect(stats.worksUpdated).toBe(1);
    // the other way round the same manifest wins
    const back = mergeBackup(incoming, local).merged.works[0]!;
    expect(back.title).toBe('手元');
    expect(back.manifestKey).toBe('kB');
  });

  it('keeps a file attached on either side over no file at all', () => {
    const recordOnly = work(L, { title: '手元', updatedAt: T0 + 100 });
    const attached = work(L, { manifestKey: 'kQ', manifestWorkId: 'p-quick01', updatedAt: T0 + 1 });
    const records = [mrec('kQ', L, { manifest: quick('p-quick01'), source: 'quick' })];
    const a = mergeBackup(data({ works: [recordOnly] }), data({ works: [attached], manifests: records })).merged.works[0]!;
    expect(a).toMatchObject({ title: '手元', manifestKey: 'kQ', manifestWorkId: 'p-quick01' });
    const b = mergeBackup(data({ works: [attached], manifests: records }), data({ works: [recordOnly] })).merged.works[0]!;
    expect(b).toMatchObject({ title: '手元', manifestKey: 'kQ', manifestWorkId: 'p-quick01' });
  });

  it('prefers the circle\'s file over a player-made one, then the later import', () => {
    const q = work(L, { manifestKey: 'kQ', manifestWorkId: 'p-quick01', updatedAt: T0 + 100 });
    const c = work(L, { manifestKey: 'kC', manifestWorkId: MW, updatedAt: T0 });
    const manifests = [
      mrec('kQ', L, { manifest: quick('p-quick01'), source: 'player-edit', importedAt: T0 + 90 }),
      mrec('kC', L, { manifest: creator('1.0.0'), importedAt: T0 + 10 }),
    ];
    const merged = mergeBackup(data({ works: [q], manifests: [manifests[0]!] }), data({ works: [c], manifests: [manifests[1]!] }));
    expect(merged.merged.works[0]).toMatchObject({ manifestKey: 'kC', manifestWorkId: MW });
    // both player-made: the later import wins, whatever updatedAt says
    const p1 = work(L, { manifestKey: 'kP1', manifestWorkId: 'p-quick01', updatedAt: T0 + 100 });
    const p2 = work(L, { manifestKey: 'kP2', manifestWorkId: 'p-quick01', updatedAt: T0 });
    const both = mergeBackup(
      data({ works: [p1], manifests: [mrec('kP1', L, { manifest: quick('p-quick01'), importedAt: T0 })] }),
      data({ works: [p2], manifests: [mrec('kP2', L, { manifest: { ...quick('p-quick01'), groups: [{ id: 'ach', label: '実績！' }] }, importedAt: T0 + 5 })] }),
    );
    expect(both.merged.works[0]!.manifestKey).toBe('kP2');
  });

  it('keeps the checkpoint only when the chosen manifest has it', () => {
    const mine = work(L, { manifestKey: 'kQ', manifestWorkId: 'p-quick01', currentCheckpointId: 'gone', updatedAt: T0 + 100 });
    const theirs = work(L, { manifestKey: 'kC', manifestWorkId: MW, currentCheckpointId: 'ch1', updatedAt: T0 });
    const { merged } = mergeBackup(
      data({ works: [mine], manifests: [mrec('kQ', L, { manifest: quick('p-quick01') })] }),
      data({ works: [theirs], manifests: [mrec('kC', L, { manifest: creator('1.0.0') })] }),
    );
    expect(merged.works[0]!.currentCheckpointId).toBe('ch1');
    const none = mergeBackup(
      data({ works: [mine], manifests: [mrec('kQ', L, { manifest: quick('p-quick01') })] }),
      data({ works: [{ ...theirs, currentCheckpointId: 'ch9' }], manifests: [mrec('kC', L, { manifest: creator('1.0.0') })] }),
    );
    expect(none.merged.works[0]).not.toHaveProperty('currentCheckpointId');
  });
});

describe('mergeBackup: remapping by manifestWorkId', () => {
  function incomingForI(): BackupDataV1 {
    return data({
      works: [work(I, { title: '別の端末', manifestKey: 'k-inc', manifestWorkId: MW, updatedAt: T0 + 1 })],
      manifests: [mrec('k-inc', I, { manifest: manifest(MW, '1.1.0') })],
      progress: [prog(I, 'g1')],
      redemptions: [red(I, 'g1')],
      hints: [hint(I, 'g1', 1)],
      sessions: [sess('s-inc', I, { endedAt: T0 + MIN })],
      notes: [note('n-inc', I, { goalId: 'g1' })],
      pending: [pend('p-inc', 'b32:M00NDESKR', { manifestWorkIdHint: MW })],
      sealedOpens: [opened(I, 'letter')],
    });
  }

  it('rewrites the work id in every incoming child record', () => {
    const local = data({ works: [work(L, { manifestKey: 'k1', manifestWorkId: MW })], manifests: [mrec('k1', L)] });
    const { merged, stats } = mergeBackup(local, incomingForI());
    expect(merged.works.map((w) => w.id)).toEqual([L]);
    expect(merged.manifests).toEqual([mrec('k1', L), mrec('k-inc', L, { manifest: manifest(MW, '1.1.0') })]);
    expect(merged.progress).toEqual([prog(L, 'g1')]);
    expect(merged.redemptions).toEqual([red(L, 'g1')]);
    expect(merged.hints).toEqual([hint(L, 'g1', 1)]);
    expect(merged.sessions).toEqual([sess('s-inc', L, { endedAt: T0 + MIN })]);
    expect(merged.notes).toEqual([note('n-inc', L, { goalId: 'g1' })]);
    expect(merged.sealedOpens).toEqual([opened(L, 'letter')]);
    // pending codes carry a manifest work id, not a local id
    expect(merged.pending).toEqual([pend('p-inc', 'b32:M00NDESKR', { manifestWorkIdHint: MW })]);
    expect(JSON.stringify(merged)).not.toContain(I);
    expect(stats).toEqual({ worksAdded: 0, worksUpdated: 1, worksRemapped: 1, progressAdded: 1, sessionsAdded: 1, notesAdded: 1 });
  });

  it('takes the newer incoming work (and its manifestKey) under the local id', () => {
    const local = data({ works: [work(L, { manifestKey: 'k1', manifestWorkId: MW, createdAt: T0 - 5 })] });
    const { merged } = mergeBackup(local, incomingForI());
    expect(merged.works).toEqual([{ ...incomingForI().works[0]!, id: L, createdAt: T0 - 5 }]);
    expect(merged.works[0]!.manifestKey).toBe('k-inc');
  });

  it('keeps the newer local work but still unions the remapped children', () => {
    const mine = work(L, { title: '手元', manifestKey: 'k1', manifestWorkId: MW, updatedAt: T0 + 50 });
    const local = data({
      works: [mine],
      // this device imported its file after the other device did
      manifests: [mrec('k1', L, { importedAt: T0 + 40 })],
      progress: [prog(L, 'g1', { doneAt: T0 + 10, via: 'manual', hintTierAtDone: 3 })],
    });
    const incoming = incomingForI();
    incoming.progress = [prog(I, 'g1', { doneAt: T0 + 20, via: 'code', hintTierAtDone: 1 }), prog(I, 'g2')];
    const { merged, stats } = mergeBackup(local, incoming);
    expect(merged.works).toEqual([mine]);
    expect(merged.progress).toEqual([prog(L, 'g1', { doneAt: T0 + 10, via: 'code', hintTierAtDone: 1 }), prog(L, 'g2')]);
    expect(stats).toEqual({ worksAdded: 0, worksUpdated: 0, worksRemapped: 1, progressAdded: 1, sessionsAdded: 1, notesAdded: 1 });
  });

  it('folds an id match and a manifestWorkId match for the same local work together', () => {
    const local = data({ works: [work(L, { manifestWorkId: MW })] });
    const incoming = data({
      works: [work(L, { manifestWorkId: MW, updatedAt: T0 + 1, title: 'A' }), work(I, { manifestWorkId: MW, updatedAt: T0 + 2, title: 'B' })],
      progress: [prog(L, 'g1'), prog(I, 'g2')],
    });
    const { merged, stats } = mergeBackup(local, incoming);
    expect(merged.works).toEqual([work(L, { manifestWorkId: MW, updatedAt: T0 + 2, title: 'B' })]);
    expect(merged.progress).toEqual([prog(L, 'g1'), prog(L, 'g2')]);
    expect(stats).toEqual({ ...ZERO, worksUpdated: 2, worksRemapped: 1, progressAdded: 2 });
  });

  it('leaves children of other incoming works alone', () => {
    const local = data({ works: [work(L, { manifestWorkId: MW })] });
    const incoming = data({ works: [work(I, { manifestWorkId: MW }), work('w-x')], notes: [note('a', I), note('b', 'w-x')] });
    const { merged } = mergeBackup(local, incoming);
    expect(merged.notes.map((n) => [n.id, n.workId])).toEqual([
      ['a', L],
      ['b', 'w-x'],
    ]);
  });
});

describe('mergeBackup: manifests', () => {
  it('unions by key and keeps one record per key', () => {
    const local = data({ manifests: [mrec('k1', L), mrec('k2', L)] });
    const incoming = data({ manifests: [mrec('k2', L, { importedAt: T0 + 9, source: 'paste' }), mrec('k3', L)] });
    const { merged } = mergeBackup(local, incoming);
    expect(merged.manifests).toEqual([mrec('k1', L), mrec('k2', L), mrec('k3', L)]);
  });
});

describe('mergeBackup: progress', () => {
  function mergeOne(a: Partial<GoalProgress>, b: Partial<GoalProgress>): GoalProgress {
    const { merged } = mergeBackup(data({ progress: [prog(L, 'g1', a)] }), data({ progress: [prog(L, 'g1', b)] }));
    expect(merged.progress).toHaveLength(1);
    return merged.progress[0]!;
  }

  it('unions and counts progress the local side did not have', () => {
    const { merged, stats } = mergeBackup(data({ progress: [prog(L, 'g1')] }), data({ progress: [prog(L, 'g1'), prog(L, 'g2'), prog('w2', 'g1')] }));
    expect(merged.progress).toEqual([prog(L, 'g1'), prog(L, 'g2'), prog('w2', 'g1')]);
    expect(stats.progressAdded).toBe(2);
  });

  it('keeps the earliest doneAt', () => {
    expect(mergeOne({ doneAt: T0 + 5 }, { doneAt: T0 + 3 }).doneAt).toBe(T0 + 3);
    expect(mergeOne({ doneAt: T0 + 3 }, { doneAt: T0 + 5 }).doneAt).toBe(T0 + 3);
  });

  it("lets 'code' beat 'manual'", () => {
    expect(mergeOne({ via: 'manual' }, { via: 'code' }).via).toBe('code');
    expect(mergeOne({ via: 'code' }, { via: 'manual' }).via).toBe('code');
    expect(mergeOne({ via: 'manual' }, { via: 'manual' }).via).toBe('manual');
    expect(mergeOne({ via: 'code' }, { via: 'code' }).via).toBe('code');
  });

  it('ANDs archived', () => {
    expect(mergeOne({ archived: true }, { archived: true }).archived).toBe(true);
    expect(mergeOne({ archived: true }, { archived: false }).archived).toBe(false);
    expect(mergeOne({ archived: false }, { archived: true }).archived).toBe(false);
    expect(mergeOne({ archived: false }, { archived: false }).archived).toBe(false);
  });

  it('takes the minimum hintTierAtDone (a ノーヒント clear on either device counts)', () => {
    expect(mergeOne({ hintTierAtDone: 3 }, { hintTierAtDone: 0 }).hintTierAtDone).toBe(0);
    expect(mergeOne({ hintTierAtDone: 1 }, { hintTierAtDone: 2 }).hintTierAtDone).toBe(1);
  });

  it('applies all rules at once, symmetrically', () => {
    const a: Partial<GoalProgress> = { via: 'manual', doneAt: T0 + 1, hintTierAtDone: 2, archived: true };
    const b: Partial<GoalProgress> = { via: 'code', doneAt: T0 + 9, hintTierAtDone: 1, archived: false };
    const expected = prog(L, 'g1', { via: 'code', doneAt: T0 + 1, hintTierAtDone: 1, archived: false });
    expect(mergeOne(a, b)).toEqual(expected);
    expect(mergeOne(b, a)).toEqual(expected);
  });
});

describe('mergeBackup: redemptions', () => {
  it('unions redemptions', () => {
    const { merged } = mergeBackup(data({ redemptions: [red(L, 'g1')] }), data({ redemptions: [red(L, 'g2', { canonical: 'b32:M00NDESKR' })] }));
    expect(merged.redemptions).toEqual([red(L, 'g1'), red(L, 'g2', { canonical: 'b32:M00NDESKR' })]);
  });

  it('keeps the earliest redemption as a whole record', () => {
    const early = red(L, 'g1', { canonical: 'kana:ほたるかえでつばめこだますずめ', redeemedAt: T0 });
    const late = red(L, 'g1', { canonical: 'b32:ST4RMAP1X', redeemedAt: T0 + 5 });
    expect(mergeBackup(data({ redemptions: [late] }), data({ redemptions: [early] })).merged.redemptions).toEqual([early]);
    expect(mergeBackup(data({ redemptions: [early] }), data({ redemptions: [late] })).merged.redemptions).toEqual([early]);
  });

  it('never takes a cached master from the incoming side', () => {
    const incoming = data({ redemptions: [red(L, 'g1', { master: 'bWFzdGVy', masterSalt: 'c2FsdA' })] });
    const { merged } = mergeBackup(data(), incoming);
    expect(merged.redemptions).toEqual([red(L, 'g1')]);
    expect(merged.redemptions[0]).not.toHaveProperty('master');
    expect(merged.redemptions[0]).not.toHaveProperty('masterSalt');
  });

  it('keeps a local cached master when the local redemption is kept', () => {
    const mine = red(L, 'g1', { master: 'bWFzdGVy', masterSalt: 'c2FsdA' });
    const { merged } = mergeBackup(data({ redemptions: [mine] }), data({ redemptions: [red(L, 'g1', { redeemedAt: T0 + 1 })] }));
    expect(merged.redemptions).toEqual([mine]);
  });
});

describe('mergeBackup: hints', () => {
  it('keeps the maximum tier', () => {
    const lo = hint(L, 'g1', 1, { updatedAt: T0 + 9 });
    const hi = hint(L, 'g1', 3, { updatedAt: T0 + 1 });
    expect(mergeBackup(data({ hints: [lo] }), data({ hints: [hi] })).merged.hints).toEqual([hi]);
    expect(mergeBackup(data({ hints: [hi] }), data({ hints: [lo] })).merged.hints).toEqual([hi]);
  });

  it('unions hints and keeps the local record on an equal tier', () => {
    const mine = hint(L, 'g1', 2, { updatedAt: T0 });
    const { merged } = mergeBackup(data({ hints: [mine] }), data({ hints: [hint(L, 'g1', 2, { updatedAt: T0 + 5 }), hint(L, 'g2', 1)] }));
    expect(merged.hints).toEqual([mine, hint(L, 'g2', 1)]);
  });
});

describe('mergeBackup: sessions', () => {
  function mergeOne(a: Session, b: Session): Session {
    const { merged } = mergeBackup(data({ sessions: [a] }), data({ sessions: [b] }));
    expect(merged.sessions).toHaveLength(1);
    return merged.sessions[0]!;
  }

  it('unions by id and counts added sessions', () => {
    const { merged, stats } = mergeBackup(data({ sessions: [sess('s1', L)] }), data({ sessions: [sess('s1', L), sess('s2', L), sess('s3', 'w2')] }));
    expect(merged.sessions.map((s) => s.id)).toEqual(['s1', 's2', 's3']);
    expect(stats.sessionsAdded).toBe(2);
  });

  it('lets the ended session win over an open one with the same id', () => {
    const open = sess('s1', L, { startedAt: T0 + 50 });
    const ended = sess('s1', L, { startedAt: T0, endedAt: T0 + 30 * MIN, minutes: 30, nextTodo: '猫に話しかける' });
    expect(mergeOne(open, ended)).toEqual(ended);
    expect(mergeOne(ended, open)).toEqual(ended);
  });

  it('otherwise keeps the newer one (by endedAt, then startedAt)', () => {
    const a = sess('s1', L, { startedAt: T0, endedAt: T0 + 10 * MIN, minutes: 10 });
    const b = sess('s1', L, { startedAt: T0, endedAt: T0 + 20 * MIN, minutes: 20, whereNote: '編集後' });
    expect(mergeOne(a, b)).toEqual(b);
    expect(mergeOne(b, a)).toEqual(b);
    const openOld = sess('s1', L, { startedAt: T0 });
    const openNew = sess('s1', L, { startedAt: T0 + MIN });
    expect(mergeOne(openOld, openNew)).toEqual(openNew);
    expect(mergeOne(openNew, openOld)).toEqual(openNew);
    const sameEnd = sess('s1', L, { startedAt: T0 + MIN, endedAt: T0 + 20 * MIN });
    expect(mergeOne(b, sameEnd)).toEqual(sameEnd);
  });

  it('keeps the local session on a full tie', () => {
    const mine = sess('s1', L, { endedAt: T0 + MIN, whereNote: '手元' });
    expect(mergeOne(mine, sess('s1', L, { endedAt: T0 + MIN, whereNote: '届いた' }))).toEqual(mine);
  });

  it('leaves at most one session open: this device\'s, the others are closed at their start with 0 minutes', () => {
    const mineOpen = sess('s-phone', L, { startedAt: T0 + 60 * MIN });
    const theirOpen = sess('s-pc', 'w2', { startedAt: T0 + 90 * MIN });
    const ended = sess('s-old', 'w2', { startedAt: T0, endedAt: T0 + 10 * MIN, minutes: 10 });
    const { merged } = mergeBackup(data({ sessions: [mineOpen] }), data({ sessions: [theirOpen, ended] }));
    expect(merged.sessions).toEqual([mineOpen, { ...theirOpen, endedAt: theirOpen.startedAt, minutes: 0 }, ended]);
    expect(merged.sessions.filter((s) => s.endedAt === undefined)).toHaveLength(1);
  });

  it('without an open session here, keeps the latest open one from the file', () => {
    const a = sess('s-a', L, { startedAt: T0 + MIN });
    const b = sess('s-b', 'w2', { startedAt: T0 + 2 * MIN });
    const { merged } = mergeBackup(data(), data({ sessions: [a, b] }));
    expect(merged.sessions).toEqual([{ ...a, endedAt: a.startedAt, minutes: 0 }, b]);
  });
});

describe('mergeBackup: notes', () => {
  it('lets the newer updatedAt win, keeps local on a tie, and counts added notes', () => {
    const mine = note('n1', L, { text: '手元', updatedAt: T0 + 5 });
    const newer = note('n1', L, { text: '届いた', updatedAt: T0 + 6 });
    const same = note('n1', L, { text: '同時刻', updatedAt: T0 + 5 });
    expect(mergeBackup(data({ notes: [mine] }), data({ notes: [newer] })).merged.notes).toEqual([newer]);
    expect(mergeBackup(data({ notes: [newer] }), data({ notes: [mine] })).merged.notes).toEqual([newer]);
    expect(mergeBackup(data({ notes: [mine] }), data({ notes: [same] })).merged.notes).toEqual([mine]);
    const { merged, stats } = mergeBackup(data({ notes: [mine] }), data({ notes: [newer, note('n2', L)] }));
    expect(merged.notes).toEqual([newer, note('n2', L)]);
    expect(stats.notesAdded).toBe(1);
  });
});

describe('mergeBackup: pending codes', () => {
  it('deduplicates by canonical form', () => {
    const local = data({ pending: [pend('p1', 'b32:ST4RMAP1X')] });
    const incoming = data({
      pending: [
        pend('p2', 'b32:ST4RMAP1X', { receivedAt: T0 - 5 }),
        pend('p3', 'b32:M00NDESKR'),
        pend('p4', 'b32:M00NDESKR'),
        pend('p5', 'kana:ほたるかえでつばめこだますずめ', { manifestWorkIdHint: 'demo-amaoto' }),
      ],
    });
    const { merged } = mergeBackup(local, incoming);
    expect(merged.pending).toEqual([
      pend('p1', 'b32:ST4RMAP1X'),
      pend('p3', 'b32:M00NDESKR'),
      pend('p5', 'kana:ほたるかえでつばめこだますずめ', { manifestWorkIdHint: 'demo-amaoto' }),
    ]);
  });

  it('never produces two pending codes with the same id', () => {
    const { merged } = mergeBackup(data({ pending: [pend('p1', 'b32:ST4RMAP1X')] }), data({ pending: [pend('p1', 'b32:M00NDESKR')] }));
    expect(merged.pending).toEqual([pend('p1', 'b32:ST4RMAP1X')]);
  });
});

describe('mergeBackup: sealed opens', () => {
  function mergeOne(a: Partial<SealedOpen>, b: Partial<SealedOpen>): SealedOpen {
    const { merged } = mergeBackup(data({ sealedOpens: [opened(L, 'letter', a)] }), data({ sealedOpens: [opened(L, 'letter', b)] }));
    expect(merged.sealedOpens).toHaveLength(1);
    return merged.sealedOpens[0]!;
  }

  it('keeps the earliest firstOpenedAt', () => {
    expect(mergeOne({ firstOpenedAt: T0 + 5 }, { firstOpenedAt: T0 + 1 }).firstOpenedAt).toBe(T0 + 1);
    expect(mergeOne({ firstOpenedAt: T0 + 1 }, { firstOpenedAt: T0 + 5 }).firstOpenedAt).toBe(T0 + 1);
  });

  it('ORs seen', () => {
    expect(mergeOne({ seen: false }, { seen: false }).seen).toBe(false);
    expect(mergeOne({ seen: true }, { seen: false }).seen).toBe(true);
    expect(mergeOne({ seen: false }, { seen: true }).seen).toBe(true);
    expect(mergeOne({ seen: true }, { seen: true }).seen).toBe(true);
  });

  it('unions different items', () => {
    const { merged } = mergeBackup(data({ sealedOpens: [opened(L, 'letter')] }), data({ sealedOpens: [opened(L, 'afterword'), opened('w2', 'letter')] }));
    expect(merged.sealedOpens).toEqual([opened(L, 'letter'), opened(L, 'afterword'), opened('w2', 'letter')]);
  });
});

describe('mergeBackup: settings', () => {
  it('keeps the local settings', () => {
    const local = data();
    const { merged } = mergeBackup(local, rich());
    expect(merged.settings).toEqual(local.settings);
    const { merged: m2 } = mergeBackup(rich(), data());
    expect(m2.settings).toEqual(rich().settings);
  });
});

describe('mergeBackup: with parsed backups', () => {
  it('merges a decrypted backup from another device', async () => {
    const local = rich();
    const other = data({
      works: [work(I, { manifestWorkId: MW, updatedAt: T0 + 1, title: '別の端末' }), work('44444444-4444-4444-8444-444444444444', { title: '新作' })],
      progress: [prog(I, 'g1', { doneAt: T0 - MIN, via: 'manual', hintTierAtDone: 0 })],
      redemptions: [red(I, 'g1', { redeemedAt: T0 - MIN, master: 'bWFzdGVy' })],
      sessions: [sess('s-other', I, { startedAt: T0 + 100 * MIN, endedAt: T0 + 130 * MIN, minutes: 30 })],
    });
    const text = await exportBackup(other, { appVersion: '0.1.0', now: T0 + 200 * MIN, passphrase: 'ほしあかりのよる', iterations: 1_000 });
    const parsed = await parseBackup(text, 'ほしあかりのよる');
    if (!parsed.ok) throw new Error(parsed.error);
    const { merged, stats } = mergeBackup(local, parsed.data);
    expect(merged.works.map((w) => w.id)).toEqual([L, local.works[1]!.id, '44444444-4444-4444-8444-444444444444']);
    expect(merged.works[0]!.title).toBe('別の端末');
    expect(merged.progress[0]).toEqual(prog(L, 'g1', { doneAt: T0 - MIN, via: 'code', hintTierAtDone: 0 }));
    expect(merged.redemptions[0]).toEqual(red(L, 'g1', { redeemedAt: T0 - MIN }));
    expect(merged.sessions.map((s) => [s.id, s.workId])).toContainEqual(['s-other', L]);
    expect(merged.settings).toEqual(local.settings);
    expect(stats).toEqual({ worksAdded: 1, worksUpdated: 1, worksRemapped: 1, progressAdded: 0, sessionsAdded: 1, notesAdded: 0 });
  });
});
