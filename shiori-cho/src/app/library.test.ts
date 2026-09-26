import { beforeAll, describe, it, expect } from 'vitest';
import { b64uEncode } from '../core/encoding';
import { ShioriError } from '../core/errors';
import { buildManifest } from '../core/manifest/build';
import { FIXTURE_CODES, fixtureProject } from '../core/manifest/testFixtures';
import { manifestKey } from '../core/manifest/validate';
import type { BuildResult, ImportPreview, ManualGoal, ShioriManifestV1 } from '../core/types';
import amaotoJson from '../demo/amaoto.shiori.json';
import hoshiyomiJson from '../demo/hoshiyomi.shiori.json';
import { createMemoryRepo } from '../storage/memoryRepo';
import type { ShioriRepo } from '../storage/repo';
import {
  commitImport,
  createQuickWork,
  createWork,
  defaultCoverEmoji,
  exportPlayerManifest,
  getWorkManifest,
  importBundledDemos,
  previewImport,
  setGoalDone,
  updatePlayerManifest,
} from './library';
import { addPending, decryptGoalSecrets, readSealed, submitCode } from './unlock';

const T0 = 1_790_000_000_000;
const HOSHIYOMI_TEXT = JSON.stringify(hoshiyomiJson);
const AMAOTO_TEXT = JSON.stringify(amaotoJson);
const STORE_CODE_MSG = '作品コードの形式が違います（例: RJ01234567）';

type ValidPreview = Exclude<ImportPreview, { kind: 'invalid' }>;

async function preview(repo: ShioriRepo, text: string): Promise<ValidPreview> {
  const p = await previewImport(repo, text);
  if (p.kind === 'invalid') throw new Error(`invalid: ${p.errors.map((e) => e.messageJa).join(', ')}`);
  return p;
}

async function importText(repo: ShioriRepo, text: string, now = T0) {
  return commitImport(repo, await preview(repo, text), { source: 'file', now });
}

/** The demo manifest with ach-cat and the 終章 checkpoint removed and a new manual goal added. */
function hoshiyomiV2(): ShioriManifestV1 {
  const m = structuredClone(hoshiyomiJson) as unknown as ShioriManifestV1;
  m.work.version = '1.1.0';
  m.goals = m.goals.filter((g) => g.id !== 'ach-cat');
  const added: ManualGoal = {
    id: 'ach-new',
    group: 'ach',
    label: '新しい書架を見つけた',
    spoiler: 0,
    hints: [],
    unlock: { type: 'manual' },
  };
  m.goals.push(added);
  m.checkpoints = m.checkpoints.filter((c) => c.id !== 'epilogue');
  return m;
}

function expectShioriError(e: unknown, code: string, messageJa?: string): void {
  expect(e).toBeInstanceOf(ShioriError);
  const err = e as ShioriError;
  expect(err.code).toBe(code);
  if (messageJa !== undefined) expect(err.messageJa).toBe(messageJa);
}

async function catchError(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
  } catch (e) {
    return e;
  }
  throw new Error('expected a rejection');
}

describe('previewImport', () => {
  it('reports JSON and schema errors as invalid', async () => {
    const repo = createMemoryRepo();
    const bad = await previewImport(repo, '{"schema": "shiori/1",');
    expect(bad.kind).toBe('invalid');
    if (bad.kind !== 'invalid') return;
    expect(bad.errors[0]?.code).toBe('json');
    expect(bad.errors[0]?.messageJa).toBeTruthy();

    const future = await previewImport(repo, JSON.stringify({ ...hoshiyomiJson, schema: 'shiori/2' }));
    expect(future.kind).toBe('invalid');
    if (future.kind === 'invalid') expect(future.errors[0]?.messageJa).toBe('新しいバージョンのしおり帳が必要です');

    const tooBig = await previewImport(repo, ' '.repeat(512 * 1024 + 1));
    expect(tooBig.kind).toBe('invalid');
    expect(await repo.listWorks()).toEqual([]);
  });

  it('previews a new manifest with its counts', async () => {
    const repo = createMemoryRepo();
    const p = await previewImport(repo, HOSHIYOMI_TEXT);
    expect(p.kind).toBe('new');
    if (p.kind !== 'new') return;
    expect(p.stats).toEqual({ goals: 8, codeGoals: 4, sealed: 3 });
    expect(p.manifest.work.id).toBe('demo-hoshiyomi');
    expect(Array.isArray(p.warnings)).toBe(true);
    const a = await previewImport(repo, AMAOTO_TEXT);
    if (a.kind === 'invalid') throw new Error('invalid');
    expect(a.stats).toEqual({ goals: 8, codeGoals: 2, sealed: 2 });
    // Previewing writes nothing
    expect(await repo.listWorks()).toEqual([]);
    expect(await repo.listManifests()).toEqual([]);
  });

  it('previews an update with the goal diff, and an identical file as already imported', async () => {
    const repo = createMemoryRepo();
    const { workId } = await importText(repo, HOSHIYOMI_TEXT);

    const same = await preview(repo, HOSHIYOMI_TEXT);
    expect(same.kind).toBe('update');
    if (same.kind !== 'update') return;
    expect(same.alreadyImported).toBe(true);
    expect(same.existing.id).toBe(workId);
    expect(same.diff).toMatchObject({ added: [], removed: [], kdfChanged: false });

    // Formatting does not matter: the key is computed from the validated object
    const pretty = await preview(repo, JSON.stringify(hoshiyomiJson, null, 2));
    expect(pretty.kind === 'update' && pretty.alreadyImported).toBe(true);

    const upd = await preview(repo, JSON.stringify(hoshiyomiV2()));
    expect(upd.kind).toBe('update');
    if (upd.kind !== 'update') return;
    expect(upd.alreadyImported).toBe(false);
    expect(upd.diff).toMatchObject({ added: ['ach-new'], removed: ['ach-cat'], kdfChanged: false });
    expect(upd.stats).toEqual({ goals: 8, codeGoals: 4, sealed: 3 });
  });
});

describe('commitImport', () => {
  it('creates a work from a new manifest', async () => {
    const repo = createMemoryRepo();
    const { workId, pendingOutcomes } = await importText(repo, HOSHIYOMI_TEXT, T0);
    expect(pendingOutcomes).toEqual([]);
    const work = await repo.getWork(workId);
    const key = await manifestKey((await preview(createMemoryRepo(), HOSHIYOMI_TEXT)).manifest);
    expect(work).toEqual({
      id: workId,
      title: '星読みの図書館',
      alias: 'サンプルA',
      kind: 'game',
      status: 'backlog',
      coverEmoji: '📘',
      coverColor: 'paper',
      spoilerTolerance: 1,
      manifestKey: key,
      manifestWorkId: 'demo-hoshiyomi',
      newGoalIds: [],
      createdAt: T0,
      updatedAt: T0,
    });
    expect(workId).toMatch(/^[0-9a-f-]{36}$/);
    const record = await repo.getManifest(key);
    expect(record).toMatchObject({ key, workId, source: 'file', importedAt: T0 });
    expect(await getWorkManifest(repo, workId)).toEqual(record?.manifest);
  });

  it('uses nextAlias when the manifest has no safeTitle, and a kind-based cover', async () => {
    const repo = createMemoryRepo();
    await createWork(repo, { title: '記録だけ', kind: 'game' }, T0); // takes 作品A
    const m = structuredClone(amaotoJson) as unknown as ShioriManifestV1;
    delete m.work.safeTitle;
    m.work.storeCode = 'RJ01234567';
    const { workId } = await importText(repo, JSON.stringify(m), T0 + 1);
    const work = await repo.getWork(workId);
    expect(work?.alias).toBe('作品B');
    expect(work?.coverEmoji).toBe('🎧');
    expect(work?.storeCode).toBe('RJ01234567');
    expect(work?.title).toBe('雨音と読書の時間');
    expect(defaultCoverEmoji('cg')).toBe('🖼️');
    expect(defaultCoverEmoji('comic')).toBe('🖼️');
    expect(defaultCoverEmoji('other')).toBe('📘');
  });

  it('is idempotent: an already-imported file and a doubled commit change nothing', async () => {
    const repo = createMemoryRepo();
    const p = await preview(repo, HOSHIYOMI_TEXT);
    const [a, b] = await Promise.all([
      commitImport(repo, p, { source: 'file', now: T0 }),
      commitImport(repo, p, { source: 'paste', now: T0 + 1 }),
    ]);
    expect(b.workId).toBe(a.workId);
    expect(await repo.listWorks()).toHaveLength(1);
    const changes = (await repo.getSettings()).changesSinceBackup;

    const again = await importText(repo, HOSHIYOMI_TEXT, T0 + 2);
    expect(again).toEqual({ workId: a.workId, pendingOutcomes: [] });
    expect((await repo.getSettings()).changesSinceBackup).toBe(changes);
    const records = await repo.listManifests(a.workId);
    expect(records).toHaveLength(1);
    expect(records[0]?.source).toBe('file');
  });

  it('updates: archives removed goals, marks added goals NEW, and restores them when they come back', async () => {
    const repo = createMemoryRepo();
    const { workId } = await importText(repo, HOSHIYOMI_TEXT, T0);
    const before = await repo.getWork(workId);
    await repo.putWork({ ...before!, alias: '私の呼び名', title: '自分で付けた題', currentCheckpointId: 'epilogue' });
    await setGoalDone(repo, workId, 'ach-cat', true, T0 + 1);
    await setGoalDone(repo, workId, 'ach-shelves', true, T0 + 2);

    const upd = await preview(repo, JSON.stringify(hoshiyomiV2()));
    const res = await commitImport(repo, upd, { source: 'file', now: T0 + 10 });
    expect(res.workId).toBe(workId);

    const work = await repo.getWork(workId);
    expect(work?.newGoalIds).toEqual(['ach-new']);
    expect(work?.alias).toBe('私の呼び名');
    expect(work?.title).toBe('自分で付けた題');
    expect(work?.currentCheckpointId).toBeUndefined();
    expect(work?.updatedAt).toBe(T0 + 10);
    expect(work?.manifestKey).toBe(await manifestKey(upd.manifest));

    const progress = new Map((await repo.listProgress(workId)).map((p) => [p.goalId, p]));
    expect(progress.get('ach-cat')).toMatchObject({ archived: true, doneAt: T0 + 1, via: 'manual' });
    expect(progress.get('ach-shelves')).toMatchObject({ archived: false, doneAt: T0 + 2 });

    // Only the current manifest record is kept
    const records = await repo.listManifests(workId);
    expect(records.map((r) => r.key)).toEqual([work?.manifestKey]);
    expect(records[0]?.importedAt).toBe(T0 + 10);

    // Back to the original: ach-cat is un-archived (and NEW again), ach-new's badge goes away
    const back = await preview(repo, HOSHIYOMI_TEXT);
    expect(back.kind === 'update' && back.diff.added).toEqual(['ach-cat']);
    await commitImport(repo, back, { source: 'file', now: T0 + 20 });
    const work2 = await repo.getWork(workId);
    expect(work2?.newGoalIds).toEqual(['ach-cat']);
    const cat = (await repo.listProgress(workId)).find((p) => p.goalId === 'ach-cat');
    expect(cat).toMatchObject({ archived: false, doneAt: T0 + 1 });
    expect(await repo.listManifests(workId)).toHaveLength(1);
  });

  it('tries pending codes after the import and returns their outcomes', async () => {
    const repo = createMemoryRepo();
    await addPending(repo, 'ほたる・かえで・つばめ・こだま・すずめ', 'demo-amaoto', T0);
    const { workId, pendingOutcomes } = await importText(repo, AMAOTO_TEXT, T0 + 1);
    expect(pendingOutcomes).toHaveLength(1);
    expect(pendingOutcomes[0]).toMatchObject({ status: 'unlocked', workId, goalId: 'bonus-talk', openedSealedIds: ['after-talk'] });
    expect(await repo.listPending()).toEqual([]);
  });

  it('re-attaches a manifest when the work\'s record is missing', async () => {
    const repo = createMemoryRepo();
    const { workId } = await importText(repo, HOSHIYOMI_TEXT, T0);
    const work = await repo.getWork(workId);
    await repo.deleteManifest(work!.manifestKey!);
    expect(await getWorkManifest(repo, workId)).toBeUndefined();

    const p = await preview(repo, HOSHIYOMI_TEXT);
    expect(p.kind).toBe('update');
    if (p.kind !== 'update') return;
    expect(p.alreadyImported).toBe(false);
    expect(p.diff.added).toHaveLength(8);
    await commitImport(repo, p, { source: 'file', now: T0 + 1 });
    expect((await getWorkManifest(repo, workId))?.work.id).toBe('demo-hoshiyomi');
    expect((await repo.getWork(workId))?.newGoalIds).toEqual([]);
    expect(await repo.listWorks()).toHaveLength(1);
  });

  it('rejects a preview whose manifest has been tampered with', async () => {
    const repo = createMemoryRepo();
    const p = await preview(repo, HOSHIYOMI_TEXT);
    const broken = { ...p, manifest: { ...p.manifest, groups: [] } } as ValidPreview;
    const e = await catchError(commitImport(repo, broken, { source: 'file', now: T0 }));
    expectShioriError(e, 'validation');
    expect(await repo.listWorks()).toEqual([]);
  });
});

describe('commitImport — kdf change', () => {
  const salt = (n: number) => b64uEncode(new Uint8Array(16).fill(n));
  let v1: BuildResult;
  let v2: BuildResult;
  let v3: BuildResult;

  beforeAll(async () => {
    v1 = await buildManifest(fixtureProject());
    v2 = await buildManifest(
      fixtureProject({ kdfSalt: salt(2), work: { ...fixtureProject().work, version: '1.1.0' } }),
    );
    const p3 = fixtureProject({ kdfSalt: salt(3), work: { ...fixtureProject().work, version: '1.2.0' } });
    p3.goals = p3.goals.map((g) => (g.id === 'end-b' ? { ...g, code: 'NEK-0T0-M0E' } : g));
    v3 = await buildManifest(p3);
  });

  it('opens a sealed item added by an update when existing redemptions satisfy it', async () => {
    const repo = createMemoryRepo();
    const p0 = fixtureProject({ work: { ...fixtureProject().work, version: '0.9.0' } });
    p0.sealed = p0.sealed.filter((s) => s.id !== 'door');
    const v0 = await buildManifest(p0);
    const { workId } = await importText(repo, v0.json, T0);
    expect((await submitCode(repo, FIXTURE_CODES['end-b'], { workId, now: T0 + 1 })).openedSealedIds).toEqual(['letter']);

    const p1 = await preview(repo, v1.json);
    expect(p1.kind === 'update' && p1.diff.kdfChanged).toBe(false);
    await commitImport(repo, p1, { source: 'file', now: T0 + 2 });
    const door = (await repo.listSealedOpens(workId)).find((o) => o.sealedId === 'door');
    expect(door).toEqual({ workId, sealedId: 'door', firstOpenedAt: T0 + 2, seen: false });
    expect((await readSealed(repo, workId, 'door'))?.title).toBe('図書館の扉');
  });

  it('re-derives cached masters for the new salt and drops the ones whose code no longer matches', async () => {
    const repo = createMemoryRepo();
    const { workId } = await importText(repo, v1.json, T0);
    expect((await submitCode(repo, FIXTURE_CODES['end-a'], { workId, now: T0 + 1 })).openedSealedIds).toEqual(['letter']);
    expect((await submitCode(repo, FIXTURE_CODES['end-b'], { workId, now: T0 + 2 })).openedSealedIds).toEqual(['door']);
    const oldMasters = new Map((await repo.listRedemptions(workId)).map((r) => [r.goalId, r.master]));

    // v2: same codes, new salt → every master is re-derived and still valid
    const p2 = await preview(repo, v2.json);
    expect(p2.kind === 'update' && p2.diff).toMatchObject({ added: [], removed: [], kdfChanged: true });
    await commitImport(repo, p2, { source: 'file', now: T0 + 10 });
    const r2 = await repo.listRedemptions(workId);
    expect(r2).toHaveLength(2);
    for (const r of r2) {
      expect(r.masterSalt).toBe(salt(2));
      expect(r.master).toBeTruthy();
      expect(r.master).not.toBe(oldMasters.get(r.goalId));
    }
    expect(Object.keys(await decryptGoalSecrets(repo, workId)).sort()).toEqual(['end-a', 'end-b']);
    expect((await decryptGoalSecrets(repo, workId))['end-a']?.title).toBe('星図の果て');
    expect((await readSealed(repo, workId, 'door'))?.returnCode?.code).toBe('ほしあかり');

    // v3: end-b's code changed → its master is dropped, its canonical and progress stay
    await importText(repo, v3.json, T0 + 20);
    const r3 = new Map((await repo.listRedemptions(workId)).map((r) => [r.goalId, r]));
    expect(r3.get('end-a')?.masterSalt).toBe(salt(3));
    expect(r3.get('end-b')).toEqual({ workId, goalId: 'end-b', canonical: 'b32:ST4RMAP1X', redeemedAt: T0 + 2 });
    expect(Object.keys(await decryptGoalSecrets(repo, workId))).toEqual(['end-a']);
    expect(await readSealed(repo, workId, 'door')).toBeNull();
    expect((await readSealed(repo, workId, 'letter'))?.title).toBe('感謝をこめて');
    expect((await repo.listProgress(workId)).find((p) => p.goalId === 'end-b')).toMatchObject({ via: 'code', archived: false });

    // The new code for end-b replaces the stale redemption
    const out = await submitCode(repo, 'NEK-0T0-M0E', { workId, now: T0 + 30 });
    expect(out).toMatchObject({ status: 'unlocked', goalId: 'end-b' });
    expect(Object.keys(await decryptGoalSecrets(repo, workId)).sort()).toEqual(['end-a', 'end-b']);
  });
});

describe('createWork', () => {
  it('creates a record-only work with defaults and nextAlias', async () => {
    const repo = createMemoryRepo();
    const a = await createWork(repo, { title: '  夜の散歩道  ', kind: 'game' }, T0);
    expect(a).toEqual({
      id: a.id,
      title: '夜の散歩道',
      alias: '作品A',
      kind: 'game',
      status: 'backlog',
      coverEmoji: '📘',
      coverColor: 'paper',
      spoilerTolerance: 1,
      newGoalIds: [],
      createdAt: T0,
      updatedAt: T0,
    });
    expect(await repo.getWork(a.id)).toEqual(a);
    const b = await createWork(repo, { title: '朗読集', kind: 'voice', storeCode: 'ＲＪ０１６６７５３６', coverColor: 'sky' }, T0 + 1);
    expect(b).toMatchObject({ alias: '作品B', storeCode: 'RJ01667536', coverEmoji: '🎧', coverColor: 'sky' });
    const c = await createWork(repo, { title: '画集', alias: ' マイ画集 ', kind: 'cg', storeCode: 'bj123456', coverEmoji: '🌙' }, T0 + 2);
    expect(c).toMatchObject({ alias: 'マイ画集', storeCode: 'BJ123456', coverEmoji: '🌙' });
    const d = await createWork(repo, { title: '空欄の呼び名', alias: '   ', storeCode: '  ', kind: 'comic' }, T0 + 3);
    expect(d.alias).toBe('作品C');
    expect(d.storeCode).toBeUndefined();
    expect(d.manifestKey).toBeUndefined();
    expect(await getWorkManifest(repo, d.id)).toBeUndefined();
  });

  it('validates title, alias, store code, kind and color', async () => {
    const repo = createMemoryRepo();
    expectShioriError(await catchError(createWork(repo, { title: '   ', kind: 'game' })), 'validation', 'タイトルを入力してください');
    expectShioriError(
      await catchError(createWork(repo, { title: 'あ'.repeat(101), kind: 'game' })),
      'validation',
      'タイトルは100文字以内にしてください',
    );
    await expect(createWork(repo, { title: 'あ'.repeat(100), kind: 'game' })).resolves.toMatchObject({ title: 'あ'.repeat(100) });
    expectShioriError(
      await catchError(createWork(repo, { title: 'x', alias: 'a'.repeat(41), kind: 'game' })),
      'validation',
      '表示名は40文字以内にしてください',
    );
    for (const storeCode of ['RJ0123456', 'XJ01234567', 'RJ-01234567', 'RJ012345678']) {
      expectShioriError(await catchError(createWork(repo, { title: 'x', storeCode, kind: 'game' })), 'validation', STORE_CODE_MSG);
    }
    expectShioriError(
      await catchError(createWork(repo, { title: 'x', kind: 'novel' as unknown as 'game' })),
      'validation',
      '作品の種類を選んでください',
    );
    expectShioriError(
      await catchError(createWork(repo, { title: 'x', kind: 'game', coverColor: 'neon' as unknown as 'sky' })),
      'validation',
    );
    expect(await repo.listWorks()).toHaveLength(1);
  });
});

describe('createQuickWork', () => {
  it('creates a work with a player-authored quick manifest', async () => {
    const repo = createMemoryRepo();
    const counts = { endings: 3, cg: 2, achievements: 0, tracks: 0, chapters: 2 };
    const work = await createQuickWork(repo, { title: '森の小屋', kind: 'game', storeCode: 'vj012345', counts }, T0);
    expect(work).toMatchObject({ title: '森の小屋', alias: '作品A', storeCode: 'VJ012345', status: 'backlog', createdAt: T0 });
    expect(work.manifestWorkId).toMatch(/^p-[0-9a-z]{10}$/);
    const m = await getWorkManifest(repo, work.id);
    expect(m?.author.kind).toBe('player');
    expect(m?.kdf).toBeUndefined();
    expect(m?.work.id).toBe(work.manifestWorkId);
    expect(m?.goals.map((g) => g.label)).toEqual(['END 1', 'END 2', 'END 3', 'CG 1', 'CG 2']);
    expect(m?.checkpoints.map((c) => c.label)).toEqual(['第1章', '第2章']);
    const [record] = await repo.listManifests(work.id);
    expect(record).toMatchObject({ key: work.manifestKey, source: 'quick', importedAt: T0 });
  });

  it('rejects all-zero counts and invalid fields without creating anything', async () => {
    const repo = createMemoryRepo();
    const zero = { endings: 0, cg: 0, achievements: 0, tracks: 0, chapters: 3 };
    expectShioriError(await catchError(createQuickWork(repo, { title: 'x', kind: 'game', counts: zero })), 'validation');
    const ok = { endings: 1, cg: 0, achievements: 0, tracks: 0, chapters: 0 };
    expectShioriError(
      await catchError(createQuickWork(repo, { title: 'x', kind: 'game', storeCode: 'RJ1', counts: ok })),
      'validation',
      STORE_CODE_MSG,
    );
    expectShioriError(await catchError(createQuickWork(repo, { title: '', kind: 'game', counts: ok })), 'validation');
    expect(await repo.listWorks()).toEqual([]);
    expect(await repo.listManifests()).toEqual([]);
  });
});

describe('importBundledDemos', () => {
  it('imports both demos once, as bundled, with their safe titles', async () => {
    const repo = createMemoryRepo();
    const ids = await importBundledDemos(repo, T0);
    expect(ids).toHaveLength(2);
    // listWorks() is ordered by (random UUID) key, like IndexedDB — sort for a stable comparison.
    const works = (await repo.listWorks()).sort((a, b) => a.alias.localeCompare(b.alias));
    expect(works.map((w) => [w.alias, w.manifestWorkId, w.coverEmoji])).toEqual([
      ['サンプルA', 'demo-hoshiyomi', '📘'],
      ['サンプルB', 'demo-amaoto', '🎧'],
    ]);
    expect(works.every((w) => w.storeCode === undefined)).toBe(true);
    const records = await repo.listManifests();
    expect(records.map((r) => r.source)).toEqual(['bundled', 'bundled']);

    expect(await importBundledDemos(repo, T0 + 1)).toEqual(ids);
    expect(await repo.listWorks()).toHaveLength(2);
    expect(await repo.listManifests()).toHaveLength(2);
  });

  it('keeps an existing demo work and imports only the missing one', async () => {
    const repo = createMemoryRepo();
    const { workId } = await importText(repo, AMAOTO_TEXT, T0);
    const ids = await importBundledDemos(repo, T0 + 1);
    expect(ids[1]).toBe(workId);
    expect(await repo.listWorks()).toHaveLength(2);
    expect((await repo.listManifests(workId))[0]?.source).toBe('file');
  });
});

describe('player manifests', () => {
  async function quick(repo: ShioriRepo) {
    const counts = { endings: 3, cg: 0, achievements: 0, tracks: 0, chapters: 0 };
    return createQuickWork(repo, { title: '森の小屋', kind: 'game', counts }, T0);
  }

  it('updatePlayerManifest renames, removes goals (archiving their progress) and stores a new record', async () => {
    const repo = createMemoryRepo();
    const work = await quick(repo);
    await setGoalDone(repo, work.id, 'end-1', true, T0 + 1);
    await setGoalDone(repo, work.id, 'end-3', true, T0 + 2);

    await updatePlayerManifest(
      repo,
      work.id,
      (m) => ({
        ...m,
        goals: m.goals.filter((g) => g.id !== 'end-3').map((g) => (g.id === 'end-1' ? { ...g, label: '夜明けの結末' } : g)),
      }),
      T0 + 10,
    );
    const updated = await repo.getWork(work.id);
    expect(updated?.manifestKey).not.toBe(work.manifestKey);
    expect(updated?.newGoalIds).toEqual([]);
    const records = await repo.listManifests(work.id);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ key: updated?.manifestKey, source: 'player-edit', importedAt: T0 + 10 });
    const m = await getWorkManifest(repo, work.id);
    expect(m?.goals.map((g) => g.label)).toEqual(['夜明けの結末', 'END 2']);
    const progress = new Map((await repo.listProgress(work.id)).map((p) => [p.goalId, p]));
    expect(progress.get('end-1')?.archived).toBe(false);
    expect(progress.get('end-3')?.archived).toBe(true);

    // In-place mutation without a return value also works; an unchanged result is a no-op
    await updatePlayerManifest(repo, work.id, (mm) => {
      mm.goals.push({ id: 'end-3', group: 'endings', label: 'END 3', spoiler: 0, hints: [], unlock: { type: 'manual' } });
      return undefined as unknown as ShioriManifestV1;
    }, T0 + 20);
    expect((await repo.listProgress(work.id)).find((p) => p.goalId === 'end-3')?.archived).toBe(false);
    const key = (await repo.getWork(work.id))?.manifestKey;
    await updatePlayerManifest(repo, work.id, (mm) => mm, T0 + 30);
    expect((await repo.getWork(work.id))?.manifestKey).toBe(key);
  });

  it('updatePlayerManifest rejects invalid results, id changes and creator manifests', async () => {
    const repo = createMemoryRepo();
    const work = await quick(repo);
    const e1 = await catchError(
      updatePlayerManifest(repo, work.id, (m) => ({ ...m, goals: m.goals.map((g) => ({ ...g, label: '' })) })),
    );
    expectShioriError(e1, 'validation');
    expect((e1 as ShioriError).messageJa).toContain('goals[0].label');
    expect((await repo.getWork(work.id))?.manifestKey).toBe(work.manifestKey);

    expectShioriError(
      await catchError(updatePlayerManifest(repo, work.id, (m) => ({ ...m, work: { ...m.work, id: 'p-other00000' } }))),
      'conflict',
      'しおりのIDは変更できません',
    );
    expectShioriError(
      await catchError(updatePlayerManifest(repo, work.id, (m) => ({ ...m, author: { kind: 'creator' } }))),
      'conflict',
    );

    const [demoId] = await importBundledDemos(repo, T0);
    expectShioriError(
      await catchError(updatePlayerManifest(repo, demoId!, (m) => m)),
      'conflict',
      'プレイヤーが作ったしおりだけ編集できます',
    );
    const plain = await createWork(repo, { title: '記録だけ', kind: 'game' });
    expectShioriError(await catchError(updatePlayerManifest(repo, plain.id, (m) => m)), 'notFound');
  });

  it('exportPlayerManifest returns pretty JSON that imports back as the same manifest', async () => {
    const repo = createMemoryRepo();
    const work = await quick(repo);
    const text = await exportPlayerManifest(repo, work.id);
    const m = await getWorkManifest(repo, work.id);
    expect(text).toBe(JSON.stringify(m, null, 2));

    const other = createMemoryRepo();
    const p = await preview(other, text);
    expect(p.kind).toBe('new');
    expect(await manifestKey(p.manifest)).toBe(work.manifestKey);
    // Re-importing on the same device is recognized
    const same = await preview(repo, text);
    expect(same.kind === 'update' && same.alreadyImported).toBe(true);

    const [demoId] = await importBundledDemos(repo, T0);
    expectShioriError(await catchError(exportPlayerManifest(repo, demoId!)), 'conflict');
  });
});

describe('setGoalDone', () => {
  it('toggles manual progress with the hint tier at completion', async () => {
    const repo = createMemoryRepo();
    const [workId] = await importBundledDemos(repo, T0);
    const id = workId!;
    await repo.putHint({ workId: id, goalId: 'ach-cat', tier: 1, updatedAt: T0 });

    await setGoalDone(repo, id, 'ach-cat', true, T0 + 1);
    expect(await repo.listProgress(id)).toEqual([
      { workId: id, goalId: 'ach-cat', via: 'manual', doneAt: T0 + 1, hintTierAtDone: 1, archived: false },
    ]);
    await setGoalDone(repo, id, 'ach-cat', true, T0 + 2);
    expect((await repo.listProgress(id))[0]?.doneAt).toBe(T0 + 1);

    await setGoalDone(repo, id, 'ach-shelves', true, T0 + 3);
    expect((await repo.listProgress(id)).find((p) => p.goalId === 'ach-shelves')?.hintTierAtDone).toBe(0);

    await setGoalDone(repo, id, 'ach-cat', false, T0 + 4);
    expect((await repo.listProgress(id)).map((p) => p.goalId)).toEqual(['ach-shelves']);
    await setGoalDone(repo, id, 'ach-cat', false, T0 + 5); // already undone: no-op
  });

  it('refuses to undo progress earned with a code, and unknown goals', async () => {
    const repo = createMemoryRepo();
    const [workId] = await importBundledDemos(repo, T0);
    const id = workId!;
    await repo.putProgress({ workId: id, goalId: 'end-a', via: 'code', doneAt: T0, hintTierAtDone: 0, archived: false });
    expectShioriError(
      await catchError(setGoalDone(repo, id, 'end-a', false)),
      'conflict',
      '合言葉で達成した項目は取り消せません',
    );
    expect(await repo.listProgress(id)).toHaveLength(1);

    // A code goal can be marked done by hand (same as 合言葉なしで達成にする) and undone again
    await setGoalDone(repo, id, 'end-b', true, T0 + 1);
    expect((await repo.listProgress(id)).find((p) => p.goalId === 'end-b')?.via).toBe('manual');
    await setGoalDone(repo, id, 'end-b', false, T0 + 2);

    expectShioriError(await catchError(setGoalDone(repo, id, 'no-such-goal', true)), 'notFound', '項目が見つかりません');
    expectShioriError(await catchError(setGoalDone(repo, 'no-such-work', 'end-a', true)), 'notFound', '作品が見つかりません');
  });
});
