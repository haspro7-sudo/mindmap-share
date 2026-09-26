/**
 * Shared contract tests for ShioriRepo / StudioRepo implementations (docs/SPEC.md §5.3, §5.4, §8).
 * Run from a `*.test.ts` file: `runRepoContract('memory', () => createMemoryRepo())`.
 * The factory must return a fresh, empty repository on every call.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../core/types';
import type {
  BackupDataV1,
  DiscreetSettings,
  GoalProgress,
  HintReveal,
  ManifestRecord,
  Note,
  PendingCode,
  Redemption,
  SealedOpen,
  Session,
  Settings,
  ShioriManifestV1,
  StudioProject,
  WorkRecord,
} from '../core/types';
import type { ShioriRepo, StudioRepo } from './repo';

export type RepoFactory = () => ShioriRepo | Promise<ShioriRepo>;
export type StudioRepoFactory = () => StudioRepo | Promise<StudioRepo>;

// ───────────────────────── Fixtures ─────────────────────────

const T0 = 1_760_000_000_000;

export function makeWork(id: string, over: Partial<WorkRecord> = {}): WorkRecord {
  return {
    id,
    title: `星読みの図書館 ${id}`,
    alias: '作品A',
    kind: 'game',
    status: 'backlog',
    coverEmoji: '📘',
    coverColor: 'paper',
    spoilerTolerance: 1,
    newGoalIds: [],
    createdAt: T0,
    updatedAt: T0,
    ...over,
  };
}

export function makeManifest(manifestWorkId = 'demo-contract'): ShioriManifestV1 {
  return {
    schema: 'shiori/1',
    work: { id: manifestWorkId, title: 'テスト作品', safeTitle: 'サンプル', kind: 'game', version: '1.0.0' },
    author: { kind: 'player' },
    checkpoints: [
      { id: 'ch1', label: '第1章' },
      { id: 'ch2', label: '第2章' },
    ],
    groups: [{ id: 'endings', label: 'エンディング' }],
    goals: [
      {
        id: 'end-1',
        group: 'endings',
        label: 'END 1',
        spoiler: 0,
        hints: ['夜の図書館を調べる'],
        missable: { before: 'ch2', warn: '先に進む前にもう一度見て回ろう' },
        unlock: { type: 'manual' },
      },
    ],
    sealed: [],
    changelog: [{ version: '1.0.0', date: '2026-10-01', notes: '初版' }],
  };
}

export function makeManifestRecord(key: string, workId: string, over: Partial<ManifestRecord> = {}): ManifestRecord {
  return { key, workId, manifest: makeManifest(), source: 'file', importedAt: T0, ...over };
}

export function makeProgress(workId: string, goalId: string, over: Partial<GoalProgress> = {}): GoalProgress {
  return { workId, goalId, via: 'manual', doneAt: T0, hintTierAtDone: 0, archived: false, ...over };
}

export function makeRedemption(workId: string, goalId: string, over: Partial<Redemption> = {}): Redemption {
  return {
    workId,
    goalId,
    canonical: 'b32:K7QM2XRAP',
    redeemedAt: T0,
    master: 'ouBaEHJT3FhgkrfQBsL-V5QMPvsntSORb0qhmgvlhy6',
    masterSalt: 'AAECAwQFBgcICQoLDA0ODw',
    ...over,
  };
}

export function makeHint(workId: string, goalId: string, tier: 1 | 2 | 3 = 1): HintReveal {
  return { workId, goalId, tier, updatedAt: T0 };
}

export function makeSession(id: string, workId: string, startedAt: number, over: Partial<Session> = {}): Session {
  return { id, workId, startedAt, endedAt: startedAt + 60_000, minutes: 1, ...over };
}

export function makeNote(id: string, workId: string, over: Partial<Note> = {}): Note {
  return { id, workId, text: 'メモ ||ネタバレ||', createdAt: T0, updatedAt: T0, ...over };
}

export function makePending(id: string, over: Partial<PendingCode> = {}): PendingCode {
  return { id, canonical: 'b32:ST4RMAP1X', manifestWorkIdHint: 'demo-hoshiyomi', receivedAt: T0, ...over };
}

export function makeSealedOpen(workId: string, sealedId: string, over: Partial<SealedOpen> = {}): SealedOpen {
  return { workId, sealedId, firstOpenedAt: T0, seen: false, ...over };
}

export function makeProject(id: string, over: Partial<StudioProject> = {}): StudioProject {
  return {
    format: 'shiori-studio-project',
    version: 1,
    id,
    createdAt: T0,
    updatedAt: T0,
    appUrl: 'https://example.com/shiori/',
    work: { id: 'w-abcdefghjk', title: '星読みの図書館', kind: 'game', version: '1.0.0' },
    authorName: 'サンプル工房（架空）',
    kdfIterations: 200_000,
    checkpoints: [{ id: 'ch1', label: '第1章' }],
    groups: [{ id: 'endings', label: 'エンディング' }],
    goals: [
      {
        id: 'end-a',
        group: 'endings',
        label: 'END 1',
        spoiler: 0,
        hints: [],
        unlockType: 'code',
        codeKind: 'b32',
        code: 'K7Q-M2X-RAP',
        secret: { title: '星図の果て', unlockMessage: 'おめでとうございます' },
      },
    ],
    sealed: [
      {
        id: 'afterword',
        label: 'あとがき',
        kind: 'afterword',
        mode: 'allOf',
        goals: ['end-a'],
        payload: { title: 'あとがき', body: '遊んでくださってありがとうございました。\n次回作もよろしくお願いします。' },
      },
    ],
    changelog: [],
    ...over,
  };
}

/** A realistic data set spread over two works (w1, w2) plus pending codes. */
export function makeDataset(): Omit<BackupDataV1, 'settings'> {
  return {
    works: [
      makeWork('w1', { manifestKey: 'm1', manifestWorkId: 'demo-one', createdAt: T0 }),
      makeWork('w2', { manifestKey: 'm2', manifestWorkId: 'demo-two', alias: '作品B', createdAt: T0 + 1 }),
    ],
    manifests: [
      makeManifestRecord('m1', 'w1', { manifest: makeManifest('demo-one') }),
      makeManifestRecord('m1-old', 'w1', { manifest: makeManifest('demo-one'), importedAt: T0 - 1000 }),
      makeManifestRecord('m2', 'w2', { manifest: makeManifest('demo-two') }),
    ],
    progress: [
      makeProgress('w1', 'end-1', { via: 'code' }),
      makeProgress('w1', 'ach-cat'),
      makeProgress('w2', 'end-1'),
    ],
    redemptions: [makeRedemption('w1', 'end-1'), makeRedemption('w2', 'end-1', { canonical: 'b32:M00NDESKR' })],
    hints: [makeHint('w1', 'end-1', 2), makeHint('w2', 'end-1', 1)],
    sessions: [
      makeSession('s1', 'w1', T0 + 10_000),
      makeSession('s2', 'w1', T0 + 20_000, { checkpointId: 'ch1', whereNote: '第1章の途中', nextTodo: '屋上へ' }),
      makeSession('s3', 'w2', T0 + 15_000),
    ],
    notes: [makeNote('n1', 'w1'), makeNote('n2', 'w1', { goalId: 'end-1', updatedAt: T0 + 5 }), makeNote('n3', 'w2')],
    pending: [makePending('p1'), makePending('p2', { canonical: 'kana:ほたるかえでつばめこだますずめ', receivedAt: T0 + 1 })],
    sealedOpens: [makeSealedOpen('w1', 'letter', { seen: true }), makeSealedOpen('w2', 'afterword')],
  };
}

async function populate(repo: ShioriRepo, data = makeDataset()): Promise<void> {
  for (const w of data.works) await repo.putWork(w);
  for (const m of data.manifests) await repo.putManifest(m);
  for (const p of data.progress) await repo.putProgress(p);
  for (const r of data.redemptions) await repo.putRedemption(r);
  for (const h of data.hints) await repo.putHint(h);
  for (const s of data.sessions) await repo.putSession(s);
  for (const n of data.notes) await repo.putNote(n);
  for (const p of data.pending) await repo.putPending(p);
  for (const o of data.sealedOpens) await repo.putSealedOpen(o);
}

/** Everything the repo holds for one work (plus pending), for before/after comparisons. */
async function snapshotWork(repo: ShioriRepo, workId: string) {
  return {
    work: await repo.getWork(workId),
    manifests: await repo.listManifests(workId),
    progress: await repo.listProgress(workId),
    redemptions: await repo.listRedemptions(workId),
    hints: await repo.listHints(workId),
    sessions: await repo.listSessions(workId),
    notes: await repo.listNotes(workId),
    sealedOpens: await repo.listSealedOpens(workId),
    pending: await repo.listPending(),
  };
}

const PIN = { salt: 'c2FsdHNhbHRzYWx0c2FsdA', iterations: 200_000, hash: 'aGFzaGhhc2hoYXNoaGFzaGhhc2hoYXNoaGFzaGhhc2g' };

/** Settings that must never leave the device through a backup. */
const LOCAL_ONLY: Partial<Settings> = {
  ageConfirmedAt: T0 - 5000,
  onboardedAt: T0 - 4000,
  pin: PIN,
  pinFailures: 2,
  pinCooldownUntil: T0 + 30_000,
  persist: { requestedAt: T0 - 3000, granted: true },
  lastBackupAt: T0 - 2000,
};

type Mutation = readonly [label: string, run: (repo: ShioriRepo) => Promise<unknown>];

/** Mutations that must increment settings.changesSinceBackup by exactly one. */
const COUNTED_MUTATIONS: readonly Mutation[] = [
  ['putWork', (r) => r.putWork(makeWork('w9'))],
  ['deleteWork', (r) => r.deleteWork('w1')],
  ['putManifest', (r) => r.putManifest(makeManifestRecord('m9', 'w1'))],
  ['deleteManifest', (r) => r.deleteManifest('m1')],
  ['putProgress', (r) => r.putProgress(makeProgress('w1', 'new-goal'))],
  ['deleteProgress', (r) => r.deleteProgress('w1', 'end-1')],
  ['putRedemption', (r) => r.putRedemption(makeRedemption('w1', 'end-9'))],
  ['putHint', (r) => r.putHint(makeHint('w1', 'end-1', 3))],
  ['putSession', (r) => r.putSession(makeSession('s9', 'w1', T0 + 99_000, { endedAt: undefined }))],
  ['deleteSession', (r) => r.deleteSession('s1')],
  ['putNote', (r) => r.putNote(makeNote('n9', 'w1'))],
  ['deleteNote', (r) => r.deleteNote('n1')],
  ['putSealedOpen', (r) => r.putSealedOpen(makeSealedOpen('w1', 'afterword'))],
];

/** Mutations that must NOT touch changesSinceBackup. */
const UNCOUNTED_MUTATIONS: readonly Mutation[] = [
  ['updateSettings', (r) => r.updateSettings({ camouflageText: '牛乳を買う' })],
  ['putPending', (r) => r.putPending(makePending('p9'))],
  ['deletePending', (r) => r.deletePending('p1')],
];

const ALL_MUTATIONS: readonly Mutation[] = [
  ...COUNTED_MUTATIONS,
  ...UNCOUNTED_MUTATIONS,
  ['replaceAll', async (r) => r.replaceAll(await r.exportAll())],
  ['clearAll', (r) => r.clearAll()],
];

const READS: readonly Mutation[] = [
  ['getSettings', (r) => r.getSettings()],
  ['listWorks', (r) => r.listWorks()],
  ['getWork', (r) => r.getWork('w1')],
  ['findWorkByManifestWorkId', (r) => r.findWorkByManifestWorkId('demo-one')],
  ['getManifest', (r) => r.getManifest('m1')],
  ['listManifests', (r) => r.listManifests()],
  ['listProgress', (r) => r.listProgress('w1')],
  ['listRedemptions', (r) => r.listRedemptions()],
  ['listHints', (r) => r.listHints('w1')],
  ['listSessions', (r) => r.listSessions()],
  ['getOpenSession', (r) => r.getOpenSession()],
  ['listNotes', (r) => r.listNotes('w1')],
  ['listPending', (r) => r.listPending()],
  ['listSealedOpens', (r) => r.listSealedOpens('w1')],
  ['exportAll', (r) => r.exportAll()],
];

/** Records without a usable key: every put must reject them without writing anything. */
const INVALID_PUTS: readonly Mutation[] = [
  ['putWork', (r) => r.putWork({ ...makeWork('x'), id: undefined } as unknown as WorkRecord)],
  ['putManifest', (r) => r.putManifest({ ...makeManifestRecord('k', 'w1'), key: undefined } as unknown as ManifestRecord)],
  ['putProgress', (r) => r.putProgress({ ...makeProgress('w1', 'g'), goalId: undefined } as unknown as GoalProgress)],
  ['putRedemption', (r) => r.putRedemption({ ...makeRedemption('w1', 'g'), workId: 7 } as unknown as Redemption)],
  ['putHint', (r) => r.putHint({ ...makeHint('w1', 'g'), goalId: null } as unknown as HintReveal)],
  ['putSession', (r) => r.putSession({ ...makeSession('s', 'w1', T0), id: undefined } as unknown as Session)],
  ['putNote', (r) => r.putNote({ ...makeNote('n', 'w1'), id: undefined } as unknown as Note)],
  ['putPending', (r) => r.putPending({ ...makePending('p'), id: undefined } as unknown as PendingCode)],
  ['putSealedOpen', (r) => r.putSealedOpen({ ...makeSealedOpen('w1', 's'), sealedId: undefined } as unknown as SealedOpen)],
];

function counter(repo: ShioriRepo): { count: () => number; off: () => void } {
  let n = 0;
  const off = repo.subscribe(() => {
    n++;
  });
  return { count: () => n, off };
}

// ───────────────────────── ShioriRepo contract ─────────────────────────

export function runRepoContract(name: string, factory: RepoFactory): void {
  describe(`ShioriRepo contract: ${name}`, () => {
    let repo: ShioriRepo;

    beforeEach(async () => {
      repo = await factory();
    });

    describe('settings', () => {
      it('returns DEFAULT_SETTINGS when nothing is stored', async () => {
        const s = await repo.getSettings();
        expect(s).toEqual(DEFAULT_SETTINGS);
        expect(s).not.toBe(DEFAULT_SETTINGS);
        expect(s.discreet).not.toBe(DEFAULT_SETTINGS.discreet);
        expect(s.completionPromptedWorkIds).not.toBe(DEFAULT_SETTINGS.completionPromptedWorkIds);
      });

      it('mutating returned settings changes neither the store nor DEFAULT_SETTINGS', async () => {
        const s = await repo.getSettings();
        s.discreet.aliasOnly = false;
        s.completionPromptedWorkIds.push('w1');
        s.camouflageText = '変更';
        expect(await repo.getSettings()).toEqual(DEFAULT_SETTINGS);
        expect(DEFAULT_SETTINGS.discreet.aliasOnly).toBe(true);
        expect(DEFAULT_SETTINGS.completionPromptedWorkIds).toEqual([]);
      });

      it('updateSettings shallow-merges the patch and returns the new settings', async () => {
        const first = await repo.updateSettings({ ageConfirmedAt: T0, camouflageText: '買い物メモ', autoLockSec: 30 });
        expect(first).toEqual({ ...DEFAULT_SETTINGS, ageConfirmedAt: T0, camouflageText: '買い物メモ', autoLockSec: 30 });
        const second = await repo.updateSettings({ onboardedAt: T0 + 1, pin: PIN });
        expect(second).toEqual({ ...first, onboardedAt: T0 + 1, pin: PIN });
        expect(await repo.getSettings()).toEqual(second);
      });

      it('updateSettings merges discreet key-wise', async () => {
        await repo.updateSettings({ discreet: { blurExtras: true } as DiscreetSettings });
        expect((await repo.getSettings()).discreet).toEqual({
          aliasOnly: true,
          blurOnHide: true,
          hideStoreLinks: true,
          blurExtras: true,
        });
        const s = await repo.updateSettings({ discreet: { aliasOnly: false } as DiscreetSettings });
        expect(s.discreet).toEqual({ aliasOnly: false, blurOnHide: true, hideStoreLinks: true, blurExtras: true });
      });

      it('replaces arrays instead of concatenating them', async () => {
        await repo.updateSettings({ completionPromptedWorkIds: ['w1'] });
        const s = await repo.updateSettings({ completionPromptedWorkIds: ['w2'] });
        expect(s.completionPromptedWorkIds).toEqual(['w2']);
        expect((await repo.getSettings()).completionPromptedWorkIds).toEqual(['w2']);
      });

      it('an explicit undefined removes an optional setting but never a required one', async () => {
        await repo.updateSettings({ ...LOCAL_ONLY, camouflageText: 'メモ' });
        const s = await repo.updateSettings({ pin: undefined, ageConfirmedAt: undefined, camouflageText: undefined });
        expect('pin' in s).toBe(false);
        expect('ageConfirmedAt' in s).toBe(false);
        expect(s.camouflageText).toBe('メモ');
        const stored = await repo.getSettings();
        expect(stored.pin).toBeUndefined();
        expect(stored.ageConfirmedAt).toBeUndefined();
        expect(stored.onboardedAt).toBe(LOCAL_ONLY.onboardedAt);
      });

      it('updateSettings can reset changesSinceBackup and record lastBackupAt', async () => {
        await repo.putWork(makeWork('w1'));
        await repo.putWork(makeWork('w2'));
        expect((await repo.getSettings()).changesSinceBackup).toBe(2);
        const s = await repo.updateSettings({ changesSinceBackup: 0, lastBackupAt: T0 });
        expect(s.changesSinceBackup).toBe(0);
        expect((await repo.getSettings()).lastBackupAt).toBe(T0);
      });

      it('the object returned by updateSettings is a copy', async () => {
        const s = await repo.updateSettings({ completionPromptedWorkIds: ['w1'] });
        s.discreet.aliasOnly = false;
        s.completionPromptedWorkIds.push('w2');
        const stored = await repo.getSettings();
        expect(stored.discreet.aliasOnly).toBe(true);
        expect(stored.completionPromptedWorkIds).toEqual(['w1']);
      });

      it('mutating the patch after updateSettings does not change the store', async () => {
        const patch = { discreet: { ...DEFAULT_SETTINGS.discreet }, completionPromptedWorkIds: ['w1'] };
        await repo.updateSettings(patch);
        patch.discreet.hideStoreLinks = false;
        patch.completionPromptedWorkIds.push('w2');
        const stored = await repo.getSettings();
        expect(stored.discreet.hideStoreLinks).toBe(true);
        expect(stored.completionPromptedWorkIds).toEqual(['w1']);
      });
    });

    describe('works', () => {
      it('put / get / list / delete round trip', async () => {
        const w = makeWork('w1', { storeCode: 'RJ01234567', manifestWorkId: 'demo-one', lastPlayedAt: T0 + 9 });
        await repo.putWork(w);
        expect(await repo.getWork('w1')).toEqual(w);
        expect(await repo.listWorks()).toEqual([w]);
        await repo.deleteWork('w1');
        expect(await repo.getWork('w1')).toBeUndefined();
        expect(await repo.listWorks()).toEqual([]);
      });

      it('getWork returns undefined for an unknown id', async () => {
        expect(await repo.getWork('nope')).toBeUndefined();
      });

      it('putWork replaces the record with the same id', async () => {
        await repo.putWork(makeWork('w1', { manifestWorkId: 'demo-one', currentCheckpointId: 'ch1' }));
        const updated = makeWork('w1', { status: 'playing', newGoalIds: ['end-2'], updatedAt: T0 + 1 });
        await repo.putWork(updated);
        expect(await repo.listWorks()).toEqual([updated]);
        // Fields absent from the new record are gone (put replaces, it does not merge).
        expect(await repo.findWorkByManifestWorkId('demo-one')).toBeUndefined();
      });

      it('listWorks is ordered by createdAt, then id', async () => {
        await repo.putWork(makeWork('w3', { createdAt: T0 + 2 }));
        await repo.putWork(makeWork('w2', { createdAt: T0 + 1 }));
        await repo.putWork(makeWork('w1', { createdAt: T0 + 1 }));
        await repo.putWork(makeWork('w0', { createdAt: T0 + 3 }));
        expect((await repo.listWorks()).map((w) => w.id)).toEqual(['w1', 'w2', 'w3', 'w0']);
      });

      it('findWorkByManifestWorkId finds the matching work only', async () => {
        await repo.putWork(makeWork('w1', { manifestWorkId: 'demo-one' }));
        await repo.putWork(makeWork('w2', { manifestWorkId: 'demo-two' }));
        await repo.putWork(makeWork('w3'));
        expect((await repo.findWorkByManifestWorkId('demo-two'))?.id).toBe('w2');
        expect((await repo.findWorkByManifestWorkId('demo-one'))?.id).toBe('w1');
        expect(await repo.findWorkByManifestWorkId('demo-none')).toBeUndefined();
      });

      it('findWorkByManifestWorkId prefers the earliest added work if several match', async () => {
        await repo.putWork(makeWork('w-b', { manifestWorkId: 'demo-one', createdAt: T0 + 1 }));
        await repo.putWork(makeWork('w-c', { manifestWorkId: 'demo-one', createdAt: T0 }));
        await repo.putWork(makeWork('w-a', { manifestWorkId: 'demo-one', createdAt: T0 + 1 }));
        expect((await repo.findWorkByManifestWorkId('demo-one'))?.id).toBe('w-c');
      });

      it('keeps optional fields that are absent absent', async () => {
        const w = makeWork('w1');
        await repo.putWork(w);
        const got = await repo.getWork('w1');
        expect(got).toEqual(w);
        expect(got && 'manifestKey' in got).toBe(false);
      });
    });

    describe('manifests', () => {
      it('put / get / list / delete round trip', async () => {
        const m1 = makeManifestRecord('m1', 'w1', { manifest: makeManifest('demo-one') });
        const m2 = makeManifestRecord('m2', 'w2', { source: 'quick', importedAt: T0 + 1 });
        await repo.putManifest(m1);
        await repo.putManifest(m2);
        expect(await repo.getManifest('m1')).toEqual(m1);
        expect(await repo.getManifest('nope')).toBeUndefined();
        expect(await repo.listManifests()).toEqual([m1, m2]);
        expect(await repo.listManifests('w2')).toEqual([m2]);
        expect(await repo.listManifests('w9')).toEqual([]);
        await repo.deleteManifest('m1');
        expect(await repo.getManifest('m1')).toBeUndefined();
        expect(await repo.listManifests()).toEqual([m2]);
      });

      it('listManifests is ordered by importedAt, then key', async () => {
        await repo.putManifest(makeManifestRecord('b', 'w1', { importedAt: T0 + 5 }));
        await repo.putManifest(makeManifestRecord('c', 'w1', { importedAt: T0 }));
        await repo.putManifest(makeManifestRecord('a', 'w1', { importedAt: T0 + 5 }));
        expect((await repo.listManifests('w1')).map((m) => m.key)).toEqual(['c', 'a', 'b']);
      });

      it('putManifest replaces the record with the same key', async () => {
        await repo.putManifest(makeManifestRecord('m1', 'w1'));
        const replaced = makeManifestRecord('m1', 'w1', { source: 'player-edit', importedAt: T0 + 7 });
        await repo.putManifest(replaced);
        expect(await repo.listManifests()).toEqual([replaced]);
      });
    });

    describe('progress', () => {
      it('put / list / delete, scoped by work and ordered by goalId', async () => {
        const a = makeProgress('w1', 'end-2', { via: 'code', hintTierAtDone: 2 });
        const b = makeProgress('w1', 'end-1');
        const other = makeProgress('w2', 'end-1');
        await repo.putProgress(a);
        await repo.putProgress(b);
        await repo.putProgress(other);
        expect(await repo.listProgress('w1')).toEqual([b, a]);
        expect(await repo.listProgress('w2')).toEqual([other]);
        await repo.deleteProgress('w1', 'end-2');
        expect(await repo.listProgress('w1')).toEqual([b]);
        expect(await repo.listProgress('w2')).toEqual([other]);
      });

      it('putProgress replaces the record for the same [workId, goalId]', async () => {
        await repo.putProgress(makeProgress('w1', 'end-1'));
        const archived = makeProgress('w1', 'end-1', { archived: true, doneAt: T0 + 3 });
        await repo.putProgress(archived);
        expect(await repo.listProgress('w1')).toEqual([archived]);
      });

      it('does not mix works whose ids share a prefix', async () => {
        for (const workId of ['w', 'w1', 'w10', 'w1-x']) {
          await repo.putProgress(makeProgress(workId, 'g'));
          await repo.putHint(makeHint(workId, 'g'));
          await repo.putSealedOpen(makeSealedOpen(workId, 's'));
          await repo.putRedemption(makeRedemption(workId, 'g'));
        }
        for (const workId of ['w', 'w1', 'w10', 'w1-x']) {
          expect((await repo.listProgress(workId)).map((p) => p.workId)).toEqual([workId]);
          expect((await repo.listHints(workId)).map((p) => p.workId)).toEqual([workId]);
          expect((await repo.listSealedOpens(workId)).map((p) => p.workId)).toEqual([workId]);
          expect((await repo.listRedemptions(workId)).map((p) => p.workId)).toEqual([workId]);
        }
      });
    });

    describe('redemptions', () => {
      it('lists all redemptions or those of one work; keeps cached masters locally', async () => {
        const a = makeRedemption('w2', 'end-1');
        const b = makeRedemption('w1', 'end-2', { master: undefined, masterSalt: undefined });
        const c = makeRedemption('w1', 'end-1');
        await repo.putRedemption(a);
        await repo.putRedemption(b);
        await repo.putRedemption(c);
        expect(await repo.listRedemptions()).toEqual([c, b, a]);
        expect(await repo.listRedemptions(undefined)).toEqual([c, b, a]);
        expect(await repo.listRedemptions('w1')).toEqual([c, b]);
        expect(await repo.listRedemptions('w9')).toEqual([]);
        expect((await repo.listRedemptions('w2'))[0]?.master).toBe(a.master);
      });

      it('putRedemption replaces the record for the same [workId, goalId]', async () => {
        await repo.putRedemption(makeRedemption('w1', 'end-1'));
        const stale = makeRedemption('w1', 'end-1', { master: undefined, masterSalt: undefined, redeemedAt: T0 + 1 });
        await repo.putRedemption(stale);
        const list = await repo.listRedemptions('w1');
        expect(list).toEqual([stale]);
        expect(list[0]?.master).toBeUndefined();
      });
    });

    describe('hints', () => {
      it('put / list per work, and a new tier replaces the old one', async () => {
        await repo.putHint(makeHint('w1', 'end-2', 1));
        await repo.putHint(makeHint('w1', 'end-1', 1));
        await repo.putHint(makeHint('w2', 'end-1', 3));
        const upgraded = { ...makeHint('w1', 'end-1', 2), updatedAt: T0 + 10 };
        await repo.putHint(upgraded);
        expect(await repo.listHints('w1')).toEqual([upgraded, makeHint('w1', 'end-2', 1)]);
        expect(await repo.listHints('w2')).toEqual([makeHint('w2', 'end-1', 3)]);
        expect(await repo.listHints('w9')).toEqual([]);
      });
    });

    describe('sessions', () => {
      it('listSessions is sorted by startedAt desc, across works or for one work', async () => {
        await repo.putSession(makeSession('a', 'w1', T0 + 10));
        await repo.putSession(makeSession('b', 'w2', T0 + 30));
        await repo.putSession(makeSession('c', 'w1', T0 + 20));
        await repo.putSession(makeSession('d', 'w1', T0 + 5));
        expect((await repo.listSessions()).map((s) => s.id)).toEqual(['b', 'c', 'a', 'd']);
        expect((await repo.listSessions('w1')).map((s) => s.id)).toEqual(['c', 'a', 'd']);
        expect(await repo.listSessions('w9')).toEqual([]);
      });

      it('sessions with the same startedAt are ordered by id desc', async () => {
        await repo.putSession(makeSession('s-a', 'w1', T0));
        await repo.putSession(makeSession('s-c', 'w1', T0));
        await repo.putSession(makeSession('s-b', 'w1', T0));
        expect((await repo.listSessions()).map((s) => s.id)).toEqual(['s-c', 's-b', 's-a']);
        expect((await repo.listSessions('w1')).map((s) => s.id)).toEqual(['s-c', 's-b', 's-a']);
      });

      it('putSession replaces (e.g. ending a session) and deleteSession removes', async () => {
        const open: Session = { id: 's1', workId: 'w1', startedAt: T0 };
        await repo.putSession(open);
        expect(await repo.listSessions()).toEqual([open]);
        const ended: Session = { ...open, endedAt: T0 + 60_000, minutes: 1, checkpointId: 'ch1', nextTodo: '屋上へ' };
        await repo.putSession(ended);
        expect(await repo.listSessions()).toEqual([ended]);
        await repo.deleteSession('s1');
        expect(await repo.listSessions()).toEqual([]);
      });

      it('getOpenSession returns undefined when there is no open session', async () => {
        expect(await repo.getOpenSession()).toBeUndefined();
        await repo.putSession(makeSession('s1', 'w1', T0));
        await repo.putSession(makeSession('s2', 'w2', T0 + 100));
        expect(await repo.getOpenSession()).toBeUndefined();
      });

      it('getOpenSession returns the open session even when newer sessions have ended', async () => {
        const open: Session = { id: 's-open', workId: 'w1', startedAt: T0 };
        await repo.putSession(open);
        await repo.putSession(makeSession('s-later', 'w2', T0 + 500));
        expect(await repo.getOpenSession()).toEqual(open);
      });

      it('getOpenSession prefers the latest startedAt among open sessions', async () => {
        await repo.putSession({ id: 's1', workId: 'w1', startedAt: T0 });
        await repo.putSession({ id: 's2', workId: 'w2', startedAt: T0 + 200 });
        await repo.putSession({ id: 's3', workId: 'w1', startedAt: T0 + 100 });
        expect((await repo.getOpenSession())?.id).toBe('s2');
      });

      it('treats an explicit endedAt: undefined as open', async () => {
        await repo.putSession({ id: 's1', workId: 'w1', startedAt: T0, endedAt: undefined });
        expect((await repo.getOpenSession())?.id).toBe('s1');
        await repo.putSession({ id: 's1', workId: 'w1', startedAt: T0, endedAt: T0 + 1 });
        expect(await repo.getOpenSession()).toBeUndefined();
      });
    });

    describe('notes', () => {
      it('put / list / delete, scoped by work, most recently edited first', async () => {
        const n1 = makeNote('n1', 'w1', { updatedAt: T0 + 1 });
        const n2 = makeNote('n2', 'w1', { goalId: 'end-1', text: '猫は屋上にいる', updatedAt: T0 + 9 });
        const n3 = makeNote('n3', 'w2');
        await repo.putNote(n1);
        await repo.putNote(n2);
        await repo.putNote(n3);
        expect(await repo.listNotes('w1')).toEqual([n2, n1]);
        expect(await repo.listNotes('w2')).toEqual([n3]);
        const edited = { ...n1, text: '書き直した', updatedAt: T0 + 20 };
        await repo.putNote(edited);
        expect(await repo.listNotes('w1')).toEqual([edited, n2]);
        await repo.deleteNote('n2');
        expect(await repo.listNotes('w1')).toEqual([edited]);
        expect(await repo.listNotes('w9')).toEqual([]);
      });
    });

    describe('pending', () => {
      it('put / list / delete, oldest first', async () => {
        const later = makePending('p2', { receivedAt: T0 + 5, manifestWorkIdHint: undefined });
        const earlier = makePending('p1', { receivedAt: T0 });
        await repo.putPending(later);
        await repo.putPending(earlier);
        expect(await repo.listPending()).toEqual([earlier, later]);
        await repo.deletePending('p1');
        expect(await repo.listPending()).toEqual([later]);
      });
    });

    describe('sealedOpens', () => {
      it('put / list per work; putting again updates seen', async () => {
        await repo.putSealedOpen(makeSealedOpen('w1', 'letter'));
        await repo.putSealedOpen(makeSealedOpen('w1', 'afterword'));
        await repo.putSealedOpen(makeSealedOpen('w2', 'letter'));
        expect((await repo.listSealedOpens('w1')).map((o) => o.sealedId)).toEqual(['afterword', 'letter']);
        const seen = makeSealedOpen('w1', 'letter', { seen: true });
        await repo.putSealedOpen(seen);
        expect(await repo.listSealedOpens('w1')).toEqual([makeSealedOpen('w1', 'afterword'), seen]);
        expect(await repo.listSealedOpens('w2')).toEqual([makeSealedOpen('w2', 'letter')]);
        expect(await repo.listSealedOpens('w9')).toEqual([]);
      });
    });

    describe('deleteWork cascade', () => {
      it('removes the work and every record of it, and nothing else', async () => {
        await populate(repo);
        const w2Before = await snapshotWork(repo, 'w2');
        await repo.deleteWork('w1');
        const w1After = await snapshotWork(repo, 'w1');
        expect(w1After.work).toBeUndefined();
        expect(w1After.manifests).toEqual([]);
        expect(w1After.progress).toEqual([]);
        expect(w1After.redemptions).toEqual([]);
        expect(w1After.hints).toEqual([]);
        expect(w1After.sessions).toEqual([]);
        expect(w1After.notes).toEqual([]);
        expect(w1After.sealedOpens).toEqual([]);
        expect(await repo.getManifest('m1')).toBeUndefined();
        expect(await repo.getManifest('m1-old')).toBeUndefined();
        // The other work and the (not work-scoped) pending codes are untouched.
        expect(await snapshotWork(repo, 'w2')).toEqual(w2Before);
        expect(await repo.listPending()).toHaveLength(2);
        expect((await repo.listWorks()).map((w) => w.id)).toEqual(['w2']);
        expect((await repo.listManifests()).map((m) => m.key)).toEqual(['m2']);
        expect((await repo.listRedemptions()).map((r) => r.workId)).toEqual(['w2']);
        expect((await repo.listSessions()).map((s) => s.id)).toEqual(['s3']);
      });

      it('also removes the open session of the deleted work', async () => {
        await repo.putWork(makeWork('w1'));
        await repo.putSession({ id: 's-open', workId: 'w1', startedAt: T0 });
        await repo.deleteWork('w1');
        expect(await repo.getOpenSession()).toBeUndefined();
      });

      it('deleting an unknown work is harmless', async () => {
        await populate(repo);
        const before = await repo.exportAll();
        await repo.deleteWork('nope');
        expect(await repo.exportAll()).toEqual(before);
      });
    });

    describe('exportAll / replaceAll', () => {
      it('exports an empty repo as empty arrays plus the default settings subset', async () => {
        expect(await repo.exportAll()).toEqual({
          works: [],
          manifests: [],
          progress: [],
          redemptions: [],
          hints: [],
          sessions: [],
          notes: [],
          pending: [],
          sealedOpens: [],
          settings: { discreet: DEFAULT_SETTINGS.discreet, autoLockSec: 60, camouflageText: '' },
        });
      });

      it('exports every store and strips cached masters', async () => {
        const data = makeDataset();
        await populate(repo, data);
        const out = await repo.exportAll();
        expect(out.works).toEqual(data.works);
        expect(out.manifests.map((m) => m.key)).toEqual(['m1-old', 'm1', 'm2']);
        expect(out.progress).toHaveLength(3);
        expect(out.hints).toHaveLength(2);
        expect(out.sessions.map((s) => s.id)).toEqual(['s2', 's3', 's1']);
        expect(out.notes).toHaveLength(3);
        expect(out.pending.map((p) => p.id)).toEqual(['p1', 'p2']);
        expect(out.sealedOpens).toHaveLength(2);
        expect(out.redemptions).toHaveLength(2);
        for (const r of out.redemptions) {
          expect('master' in r).toBe(false);
          expect('masterSalt' in r).toBe(false);
          expect(r.canonical).toMatch(/^b32:/);
        }
        // The local cache is untouched by the export.
        expect((await repo.listRedemptions('w1'))[0]?.master).toBe(makeRedemption('w1', 'end-1').master);
      });

      it('exports only discreet, autoLockSec and camouflageText from the settings', async () => {
        await populate(repo);
        await repo.updateSettings({
          ...LOCAL_ONLY,
          autoLockSec: 300,
          camouflageText: '牛乳、卵',
          discreet: { ...DEFAULT_SETTINGS.discreet, blurExtras: true },
          completionPromptedWorkIds: ['w1'],
          backupReminderSnoozedUntil: T0 + 1,
        });
        const out = await repo.exportAll();
        expect(out.settings).toEqual({
          discreet: { ...DEFAULT_SETTINGS.discreet, blurExtras: true },
          autoLockSec: 300,
          camouflageText: '牛乳、卵',
        });
        expect(Object.keys(out.settings).sort()).toEqual(['autoLockSec', 'camouflageText', 'discreet']);
        const json = JSON.stringify(out);
        expect(json).not.toContain(PIN.hash);
        expect(json).not.toContain(PIN.salt);
        expect(json).not.toContain('ageConfirmedAt');
        expect(json).not.toContain(makeRedemption('w1', 'x').master!);
      });

      it('round-trips through replaceAll into another repo, keeping its local-only settings', async () => {
        await populate(repo);
        await repo.updateSettings({
          ageConfirmedAt: 1,
          pin: { salt: 'b3RoZXI', iterations: 1, hash: 'b3RoZXI' },
          autoLockSec: 0,
          camouflageText: '元の端末のメモ',
          discreet: { aliasOnly: false, blurOnHide: false, hideStoreLinks: false, blurExtras: true },
        });
        const exported = await repo.exportAll();

        const target = await factory();
        await target.putWork(makeWork('old-work'));
        await target.putPending(makePending('old-pending'));
        await target.updateSettings({ ...LOCAL_ONLY, completionPromptedWorkIds: ['old-work'], autoLockSec: 30 });

        await target.replaceAll(exported);

        expect(await target.exportAll()).toEqual(exported);
        expect(await target.getWork('old-work')).toBeUndefined();
        expect((await target.listPending()).map((p) => p.id)).toEqual(['p1', 'p2']);
        const s = await target.getSettings();
        expect(s).toEqual({
          ...DEFAULT_SETTINGS,
          ...LOCAL_ONLY,
          completionPromptedWorkIds: ['old-work'],
          autoLockSec: 0,
          camouflageText: '元の端末のメモ',
          discreet: { aliasOnly: false, blurOnHide: false, hideStoreLinks: false, blurExtras: true },
          changesSinceBackup: 0,
        });
        // Redemptions arrive without masters (they are re-derived lazily).
        for (const r of await target.listRedemptions()) expect(r.master).toBeUndefined();
      });

      it('replaceAll replaces rather than merges', async () => {
        await populate(repo);
        await repo.replaceAll({
          works: [makeWork('w9')],
          manifests: [],
          progress: [makeProgress('w9', 'g')],
          redemptions: [],
          hints: [],
          sessions: [],
          notes: [],
          pending: [],
          sealedOpens: [],
          settings: { discreet: DEFAULT_SETTINGS.discreet, autoLockSec: 60, camouflageText: '' },
        });
        const out = await repo.exportAll();
        expect(out.works.map((w) => w.id)).toEqual(['w9']);
        expect(out.progress).toEqual([makeProgress('w9', 'g')]);
        expect(out.manifests).toEqual([]);
        expect(out.redemptions).toEqual([]);
        expect(out.hints).toEqual([]);
        expect(out.sessions).toEqual([]);
        expect(out.notes).toEqual([]);
        expect(out.pending).toEqual([]);
        expect(out.sealedOpens).toEqual([]);
        expect(await repo.getOpenSession()).toBeUndefined();
      });

      it('replaceAll stores redemption masters when the data carries them', async () => {
        await repo.replaceAll({ ...(await repo.exportAll()), redemptions: [makeRedemption('w1', 'end-1')] });
        expect(await repo.listRedemptions()).toEqual([makeRedemption('w1', 'end-1')]);
      });

      it('replaceAll is atomic: an invalid record leaves everything unchanged', async () => {
        await populate(repo);
        await repo.updateSettings({ camouflageText: '元のまま' });
        const before = await repo.exportAll();
        const settingsBefore = await repo.getSettings();
        const c = counter(repo);
        const bad = {
          ...makeDataset(),
          works: [makeWork('ok'), { ...makeWork('bad'), id: undefined } as unknown as WorkRecord],
          settings: { discreet: DEFAULT_SETTINGS.discreet, autoLockSec: 0 as const, camouflageText: '上書き' },
        };
        await expect(repo.replaceAll(bad)).rejects.toThrow();
        expect(await repo.exportAll()).toEqual(before);
        expect(await repo.getSettings()).toEqual(settingsBefore);
        expect(c.count()).toBe(0);
      });

      it('exported data and replaceAll input are copies', async () => {
        await populate(repo);
        const out = await repo.exportAll();
        out.works[0]!.title = '改ざん';
        out.settings.discreet.aliasOnly = false;
        expect((await repo.getWork('w1'))?.title).toBe(makeWork('w1').title);
        expect((await repo.getSettings()).discreet.aliasOnly).toBe(true);

        const data = await repo.exportAll();
        await repo.replaceAll(data);
        data.works[0]!.newGoalIds.push('end-9');
        data.sessions.length = 0;
        expect((await repo.getWork('w1'))?.newGoalIds).toEqual([]);
        expect(await repo.listSessions()).toHaveLength(3);
      });
    });

    describe('changesSinceBackup', () => {
      for (const [label, run] of COUNTED_MUTATIONS) {
        it(`${label} increments it by exactly one`, async () => {
          await populate(repo);
          await repo.updateSettings({ changesSinceBackup: 5 });
          await run(repo);
          expect((await repo.getSettings()).changesSinceBackup).toBe(6);
        });
      }

      for (const [label, run] of UNCOUNTED_MUTATIONS) {
        it(`${label} does not change it`, async () => {
          await populate(repo);
          await repo.updateSettings({ changesSinceBackup: 5 });
          await run(repo);
          expect((await repo.getSettings()).changesSinceBackup).toBe(5);
        });
      }

      it('starts at 0 and counts every change (pending codes excluded)', async () => {
        expect((await repo.getSettings()).changesSinceBackup).toBe(0);
        // 2 works + 3 manifests + 3 progress + 2 redemptions + 2 hints + 3 sessions + 3 notes
        // + 2 sealed opens are counted; the 2 pending codes are not.
        await populate(repo);
        expect((await repo.getSettings()).changesSinceBackup).toBe(20);
      });

      it('keeps the other settings when incrementing', async () => {
        await repo.updateSettings({ ...LOCAL_ONLY, camouflageText: 'メモ' });
        await repo.putWork(makeWork('w1'));
        expect(await repo.getSettings()).toEqual({
          ...DEFAULT_SETTINGS,
          ...LOCAL_ONLY,
          camouflageText: 'メモ',
          changesSinceBackup: 1,
        });
      });

      it('concurrent mutations are all counted', async () => {
        await Promise.all([
          ...Array.from({ length: 12 }, (_, i) => repo.putWork(makeWork(`w${i}`))),
          ...Array.from({ length: 8 }, (_, i) => repo.putProgress(makeProgress('w1', `g${i}`))),
          repo.putPending(makePending('p1')),
        ]);
        expect(await repo.listWorks()).toHaveLength(12);
        expect(await repo.listProgress('w1')).toHaveLength(8);
        expect((await repo.getSettings()).changesSinceBackup).toBe(20);
      });

      it('replaceAll and clearAll reset it to 0', async () => {
        await populate(repo);
        await repo.replaceAll(await repo.exportAll());
        expect((await repo.getSettings()).changesSinceBackup).toBe(0);
        await repo.putWork(makeWork('w9'));
        expect((await repo.getSettings()).changesSinceBackup).toBe(1);
        await repo.clearAll();
        expect((await repo.getSettings()).changesSinceBackup).toBe(0);
      });
    });

    describe('subscribe', () => {
      for (const [label, run] of ALL_MUTATIONS) {
        it(`fires exactly once after ${label}`, async () => {
          await populate(repo);
          const c = counter(repo);
          await run(repo);
          expect(c.count()).toBe(1);
        });
      }

      it('does not fire for reads', async () => {
        await populate(repo);
        const c = counter(repo);
        for (const [, run] of READS) await run(repo);
        expect(c.count()).toBe(0);
      });

      it('fires after the change is committed (including the change counter)', async () => {
        const seen: Promise<[WorkRecord | undefined, Settings]>[] = [];
        repo.subscribe(() => {
          seen.push(Promise.all([repo.getWork('w1'), repo.getSettings()]));
        });
        await repo.putWork(makeWork('w1'));
        expect(seen).toHaveLength(1);
        const [work, settings] = await seen[0]!;
        expect(work?.id).toBe('w1');
        expect(settings.changesSinceBackup).toBe(1);
      });

      it('unsubscribe stops notifications, is idempotent and leaves other listeners alone', async () => {
        const a = counter(repo);
        const b = counter(repo);
        await repo.putWork(makeWork('w1'));
        a.off();
        a.off();
        await repo.putWork(makeWork('w2'));
        expect(a.count()).toBe(1);
        expect(b.count()).toBe(2);
      });

      it('the same function subscribed twice is called twice and unsubscribed separately', async () => {
        const listener = vi.fn();
        const off1 = repo.subscribe(listener);
        repo.subscribe(listener);
        await repo.putPending(makePending('p1'));
        expect(listener).toHaveBeenCalledTimes(2);
        off1();
        await repo.putPending(makePending('p2'));
        expect(listener).toHaveBeenCalledTimes(3);
      });

      it('a listener may unsubscribe itself while being notified', async () => {
        const calls: string[] = [];
        const off = repo.subscribe(() => {
          calls.push('self');
          off();
        });
        repo.subscribe(() => calls.push('other'));
        await repo.putWork(makeWork('w1'));
        await repo.putWork(makeWork('w2'));
        expect(calls).toEqual(['self', 'other', 'other']);
      });

      it('a throwing listener breaks neither the mutation nor other listeners', async () => {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        try {
          repo.subscribe(() => {
            throw new Error('listener failure');
          });
          const c = counter(repo);
          await expect(repo.putWork(makeWork('w1'))).resolves.toBeUndefined();
          await expect(repo.updateSettings({ camouflageText: 'x' })).resolves.toMatchObject({ camouflageText: 'x' });
          expect(c.count()).toBe(2);
          expect(await repo.getWork('w1')).toBeDefined();
          expect(errorSpy).toHaveBeenCalled();
        } finally {
          errorSpy.mockRestore();
        }
      });
    });

    describe('clearAll', () => {
      it('deletes every record and resets the settings to the defaults', async () => {
        await populate(repo);
        await repo.updateSettings({ ...LOCAL_ONLY, camouflageText: 'メモ' });
        await repo.clearAll();
        expect(await repo.getSettings()).toEqual(DEFAULT_SETTINGS);
        expect(await repo.exportAll()).toEqual({
          works: [],
          manifests: [],
          progress: [],
          redemptions: [],
          hints: [],
          sessions: [],
          notes: [],
          pending: [],
          sealedOpens: [],
          settings: { discreet: DEFAULT_SETTINGS.discreet, autoLockSec: 60, camouflageText: '' },
        });
        expect(await repo.listRedemptions()).toEqual([]);
        expect(await repo.getOpenSession()).toBeUndefined();
      });

      it('the repo keeps working afterwards', async () => {
        await populate(repo);
        await repo.clearAll();
        await repo.putWork(makeWork('w1'));
        expect((await repo.listWorks()).map((w) => w.id)).toEqual(['w1']);
        expect((await repo.getSettings()).changesSinceBackup).toBe(1);
      });
    });

    describe('isolation (no shared references)', () => {
      it('mutating an object after putting it does not change the stored copy', async () => {
        const w = makeWork('w1', { newGoalIds: ['a'] });
        const m = makeManifestRecord('m1', 'w1');
        const s: Session = { id: 's1', workId: 'w1', startedAt: T0 };
        const n = makeNote('n1', 'w1');
        await repo.putWork(w);
        await repo.putManifest(m);
        await repo.putSession(s);
        await repo.putNote(n);
        w.newGoalIds.push('b');
        w.title = '改ざん';
        m.manifest.goals[0]!.label = '改ざん';
        m.manifest.groups.push({ id: 'x', label: 'x' });
        s.endedAt = T0 + 1;
        n.text = '改ざん';
        expect(await repo.getWork('w1')).toEqual(makeWork('w1', { newGoalIds: ['a'] }));
        expect(await repo.getManifest('m1')).toEqual(makeManifestRecord('m1', 'w1'));
        expect(await repo.getOpenSession()).toEqual({ id: 's1', workId: 'w1', startedAt: T0 });
        expect(await repo.listNotes('w1')).toEqual([makeNote('n1', 'w1')]);
      });

      it('mutating returned objects does not change the stored copy', async () => {
        await populate(repo);
        await repo.putSession({ id: 's-open', workId: 'w1', startedAt: T0 + 50_000 });
        const before = await repo.exportAll();
        const beforeRedemptions = await repo.listRedemptions();

        (await repo.getWork('w1'))!.newGoalIds.push('x');
        (await repo.listWorks())[0]!.alias = 'x';
        (await repo.findWorkByManifestWorkId('demo-two'))!.title = 'x';
        (await repo.getManifest('m1'))!.manifest.goals.length = 0;
        (await repo.listManifests('w1'))[0]!.manifest.work.title = 'x';
        (await repo.listProgress('w1'))[0]!.archived = true;
        (await repo.listRedemptions())[0]!.master = 'x';
        (await repo.listHints('w1'))[0]!.tier = 3;
        (await repo.listSessions())[0]!.endedAt = 1;
        (await repo.getOpenSession())!.endedAt = 1;
        (await repo.listNotes('w1'))[0]!.text = 'x';
        (await repo.listPending())[0]!.canonical = 'x';
        (await repo.listSealedOpens('w1'))[0]!.seen = false;

        expect(await repo.exportAll()).toEqual(before);
        expect(await repo.listRedemptions()).toEqual(beforeRedemptions);
        expect((await repo.getOpenSession())?.id).toBe('s-open');
      });
    });

    describe('invalid input', () => {
      for (const [label, run] of INVALID_PUTS) {
        it(`${label} rejects a record without a valid key and changes nothing`, async () => {
          await populate(repo);
          const before = await repo.exportAll();
          const settingsBefore = await repo.getSettings();
          const c = counter(repo);
          await expect(run(repo)).rejects.toThrow();
          expect(await repo.exportAll()).toEqual(before);
          expect(await repo.getSettings()).toEqual(settingsBefore);
          expect(c.count()).toBe(0);
        });
      }

      it('rejects a record that cannot be cloned and changes nothing', async () => {
        await populate(repo);
        const before = await repo.exportAll();
        const settingsBefore = await repo.getSettings();
        const c = counter(repo);
        const bad = { ...makeWork('w-bad'), extra: () => 'not cloneable' } as unknown as WorkRecord;
        await expect(repo.putWork(bad)).rejects.toThrow();
        await expect(repo.putManifest({ ...makeManifestRecord('m-bad', 'w1'), extra: Symbol('x') } as unknown as ManifestRecord)).rejects.toThrow();
        expect(await repo.exportAll()).toEqual(before);
        expect(await repo.getSettings()).toEqual(settingsBefore);
        expect(c.count()).toBe(0);
      });

      it('deleting unknown keys resolves', async () => {
        await expect(repo.deleteManifest('nope')).resolves.toBeUndefined();
        await expect(repo.deleteProgress('nope', 'nope')).resolves.toBeUndefined();
        await expect(repo.deleteSession('nope')).resolves.toBeUndefined();
        await expect(repo.deleteNote('nope')).resolves.toBeUndefined();
        await expect(repo.deletePending('nope')).resolves.toBeUndefined();
        await expect(repo.deleteWork('nope')).resolves.toBeUndefined();
      });

      it('stores Japanese text, emoji and newlines unchanged', async () => {
        const w = makeWork('w1', { title: '雨音と読書の時間 🌧️', coverEmoji: '🌙', alias: 'サンプルB' });
        const n = makeNote('n1', 'w1', { text: '一行目\n二行目 ||ひみつ|| 😺' });
        await repo.putWork(w);
        await repo.putNote(n);
        expect(await repo.getWork('w1')).toEqual(w);
        expect(await repo.listNotes('w1')).toEqual([n]);
      });
    });
  });
}

// ───────────────────────── StudioRepo contract ─────────────────────────

export function runStudioRepoContract(name: string, factory: StudioRepoFactory): void {
  describe(`StudioRepo contract: ${name}`, () => {
    let repo: StudioRepo;

    beforeEach(async () => {
      repo = await factory();
    });

    function studioCounter(): { count: () => number; off: () => void } {
      let n = 0;
      const off = repo.subscribe(() => {
        n++;
      });
      return { count: () => n, off };
    }

    it('starts empty', async () => {
      expect(await repo.list()).toEqual([]);
      expect(await repo.get('nope')).toBeUndefined();
    });

    it('put / get / delete round trip preserves the whole project', async () => {
      const p = makeProject('p1', { kdfSalt: 'AAECAwQFBgcICQoLDA0ODw', lastExportedAt: T0 + 3 });
      await repo.put(p);
      expect(await repo.get('p1')).toEqual(p);
      expect(await repo.list()).toEqual([p]);
      await repo.delete('p1');
      expect(await repo.get('p1')).toBeUndefined();
      expect(await repo.list()).toEqual([]);
    });

    it('list is ordered by updatedAt desc, then id', async () => {
      await repo.put(makeProject('b', { updatedAt: T0 + 1 }));
      await repo.put(makeProject('c', { updatedAt: T0 + 5 }));
      await repo.put(makeProject('a', { updatedAt: T0 + 1 }));
      await repo.put(makeProject('d', { updatedAt: T0 }));
      expect((await repo.list()).map((p) => p.id)).toEqual(['c', 'a', 'b', 'd']);
    });

    it('put replaces the project with the same id', async () => {
      await repo.put(makeProject('p1'));
      const edited = makeProject('p1', { updatedAt: T0 + 9, goals: [], authorName: undefined });
      await repo.put(edited);
      expect(await repo.list()).toEqual([edited]);
    });

    it('clearAll removes every project', async () => {
      await repo.put(makeProject('p1'));
      await repo.put(makeProject('p2'));
      await repo.clearAll();
      expect(await repo.list()).toEqual([]);
      await repo.put(makeProject('p3'));
      expect((await repo.list()).map((p) => p.id)).toEqual(['p3']);
    });

    it('deleting an unknown project resolves', async () => {
      await expect(repo.delete('nope')).resolves.toBeUndefined();
    });

    it('subscribe fires once per put / delete / clearAll and never for reads', async () => {
      const c = studioCounter();
      await repo.put(makeProject('p1'));
      expect(c.count()).toBe(1);
      await repo.list();
      await repo.get('p1');
      expect(c.count()).toBe(1);
      await repo.delete('p1');
      expect(c.count()).toBe(2);
      await repo.clearAll();
      expect(c.count()).toBe(3);
      c.off();
      c.off();
      await repo.put(makeProject('p2'));
      expect(c.count()).toBe(3);
    });

    it('listeners see the committed data', async () => {
      const seen: Promise<StudioProject | undefined>[] = [];
      repo.subscribe(() => {
        seen.push(repo.get('p1'));
      });
      await repo.put(makeProject('p1'));
      expect(seen).toHaveLength(1);
      expect((await seen[0]!)?.id).toBe('p1');
    });

    it('a throwing listener breaks neither the mutation nor other listeners', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      try {
        repo.subscribe(() => {
          throw new Error('listener failure');
        });
        const c = studioCounter();
        await expect(repo.put(makeProject('p1'))).resolves.toBeUndefined();
        expect(c.count()).toBe(1);
        expect(await repo.get('p1')).toBeDefined();
        expect(errorSpy).toHaveBeenCalled();
      } finally {
        errorSpy.mockRestore();
      }
    });

    it('put rejects a project without an id and notifies nobody', async () => {
      const c = studioCounter();
      await expect(repo.put({ ...makeProject('x'), id: undefined } as unknown as StudioProject)).rejects.toThrow();
      expect(await repo.list()).toEqual([]);
      expect(c.count()).toBe(0);
    });

    it('stored projects are isolated from the caller’s objects', async () => {
      const p = makeProject('p1');
      await repo.put(p);
      p.goals[0]!.secret!.title = '改ざん';
      p.sealed.length = 0;
      expect(await repo.get('p1')).toEqual(makeProject('p1'));

      const got = (await repo.get('p1'))!;
      got.work.title = '改ざん';
      (await repo.list())[0]!.goals.length = 0;
      expect(await repo.get('p1')).toEqual(makeProject('p1'));
    });
  });
}
