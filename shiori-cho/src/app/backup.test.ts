import { describe, it, expect, vi } from 'vitest';
import { APP_VERSION, BACKUP_REMINDER_CHANGES } from '../core/constants';
import { isShioriError } from '../core/errors';
import type { BackupDataV1, ManifestRecord, Settings, ShioriManifestV1, WorkRecord } from '../core/types';
import { DEFAULT_SETTINGS } from '../core/types';
import { manifestKey, validateManifest } from '../core/manifest/validate';
import { createMemoryRepo } from '../storage/memoryRepo';
import type { MemoryRepoSeed } from '../storage/memoryRepo';
import type { ShioriRepo } from '../storage/repo';
import hoshiyomiJson from '../demo/hoshiyomi.shiori.json';
import { commitImport, importBundledDemos, previewImport } from './library';
import { addPending, submitCode } from './unlock';
import {
  applyBackup,
  exportBackupFile,
  hasBackupData,
  readBackupFile,
  requestPersistentStorage,
  restoreBackup,
  shouldRemindBackup,
  snoozeBackupReminder,
} from './backup';

const T0 = 1_790_000_000_000; // 2026-09-21 23:13:20 JST
const MIN = 60_000;
const DAY = 86_400_000;
const SALT = 'AAECAwQFBgcICQoLDA0ODw';
const MASTER = 'ouBaEHJT3FhgkrfQBsL-V5QMPvsntSORb0qhmgvlhy6';

function manifest(manifestWorkId: string): ShioriManifestV1 {
  return {
    schema: 'shiori/1',
    work: { id: manifestWorkId, title: 'テスト作品', safeTitle: 'サンプル', kind: 'game', version: '1.0.0' },
    author: { kind: 'player' },
    checkpoints: [{ id: 'ch1', label: '第1章' }],
    groups: [{ id: 'endings', label: 'エンディング' }],
    goals: [
      { id: 'end-1', group: 'endings', label: 'END 1', spoiler: 0, hints: [], unlock: { type: 'manual' } },
      { id: 'end-2', group: 'endings', label: 'END 2', spoiler: 0, hints: [], unlock: { type: 'manual' } },
    ],
    sealed: [],
    changelog: [],
  };
}

function manifestRecord(key: string, workId: string, m: ShioriManifestV1 = manifest('demo-backup')): ManifestRecord {
  return { key, workId, manifest: m, source: 'file', importedAt: T0 };
}

/** The key the app stores a manifest under (restores recompute it, so fixtures must use the real one). */
async function keyOf(m: ShioriManifestV1): Promise<string> {
  const v = validateManifest(m);
  if (!v.ok) throw new Error('invalid fixture manifest');
  return manifestKey(v.manifest);
}

function manifestV2(): ShioriManifestV1 {
  return { ...manifest('demo-backup'), work: { ...manifest('demo-backup').work, version: '1.1.0' } };
}

const MK1 = await keyOf(manifest('demo-backup'));
const MK2 = await keyOf(manifestV2());

function work(id: string, over: Partial<WorkRecord> = {}): WorkRecord {
  return {
    id,
    title: `星読みの図書館 ${id}`,
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

/** Device A: two works (w1 with a manifest), progress, a redemption with a cached master, and more. */
function seedA(): MemoryRepoSeed {
  return {
    works: [work('w1', { manifestKey: MK1, manifestWorkId: 'demo-backup', lastPlayedAt: T0 }), work('w2', { alias: '作品B' })],
    manifests: [manifestRecord(MK1, 'w1')],
    progress: [{ workId: 'w1', goalId: 'end-1', via: 'code', doneAt: T0, hintTierAtDone: 0, archived: false }],
    redemptions: [
      { workId: 'w1', goalId: 'end-1', canonical: 'b32:K7QM2XRAP', redeemedAt: T0, master: MASTER, masterSalt: SALT },
    ],
    hints: [{ workId: 'w1', goalId: 'end-2', tier: 1, updatedAt: T0 }],
    sessions: [{ id: 's1', workId: 'w1', startedAt: T0 - 30 * MIN, endedAt: T0, minutes: 30, whereNote: '第1章の終わり' }],
    notes: [{ id: 'n1', workId: 'w2', text: 'メモ ||ネタバレ||', createdAt: T0, updatedAt: T0 }],
    pending: [{ id: 'p1', canonical: 'b32:ST4RMAP1X', manifestWorkIdHint: 'demo-hoshiyomi', receivedAt: T0 }],
    sealedOpens: [{ workId: 'w1', sealedId: 'letter', firstOpenedAt: T0, seen: true }],
    settings: {
      discreet: { aliasOnly: false, blurOnHide: true, hideStoreLinks: false, blurExtras: true },
      autoLockSec: 30,
      camouflageText: '買い物リスト',
    },
    fullSettings: { ageConfirmedAt: T0 - DAY, onboardedAt: T0 - DAY, pin: { salt: SALT, iterations: 200_000, hash: MASTER } },
  };
}

function repoA(): ShioriRepo {
  return createMemoryRepo(seedA());
}

/** Device B: a different work and different local settings (its own PIN and age flag). */
function repoB(over: Partial<Settings> = {}): ShioriRepo {
  return createMemoryRepo({
    works: [work('w9', { alias: '作品C', status: 'backlog' })],
    sessions: [{ id: 's9', workId: 'w9', startedAt: T0 - DAY, endedAt: T0 - DAY + 10 * MIN, minutes: 10 }],
    settings: { discreet: { ...DEFAULT_SETTINGS.discreet }, autoLockSec: 300, camouflageText: 'B端末のメモ' },
    fullSettings: {
      ageConfirmedAt: T0 - 2 * DAY,
      pin: { salt: SALT, iterations: 200_000, hash: 'b-device-pin-hash' },
      lastBackupAt: T0 - 3 * DAY,
      ...over,
    },
  });
}

async function exportedData(repo: ShioriRepo, now = T0 + 2 * 60 * MIN): Promise<BackupDataV1> {
  const { text } = await exportBackupFile(repo, { now });
  const parsed = await readBackupFile(text);
  if (!parsed.ok) throw new Error(`parse failed: ${parsed.error}`);
  return parsed.data;
}

function withoutSettings(d: BackupDataV1): Omit<BackupDataV1, 'settings'> {
  const { settings: _settings, ...rest } = d;
  return rest;
}

describe('exportBackupFile', () => {
  it('writes a neutral, local-date file name and a parseable plain backup', async () => {
    const repo = repoA();
    const now = T0 + 2 * 60 * MIN; // 2026-09-22 01:13 JST (still the 21st in UTC)
    const { filename, text } = await exportBackupFile(repo, { now });
    expect(filename).toBe('shiori-backup-20260922.json');
    const file = JSON.parse(text) as Record<string, unknown>;
    expect(file).toMatchObject({ format: 'shiori-backup', version: 1, exportedAt: now, appVersion: APP_VERSION, encrypted: false });

    const parsed = await readBackupFile(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.encrypted).toBe(false);
    expect(parsed.exportedAt).toBe(now);
    expect(parsed.data).toEqual(await repo.exportAll());
  });

  it('never exports the PIN, the age flag or cached masters', async () => {
    const repo = repoA();
    const { text } = await exportBackupFile(repo, { now: T0 });
    expect(text).not.toContain('ageConfirmedAt');
    expect(text).not.toContain('onboardedAt');
    expect(text).not.toContain('"pin"');
    expect(text).not.toContain('masterSalt');
    expect(text).not.toContain(MASTER);
    expect(text).toContain('b32:K7QM2XRAP'); // the redemption itself is kept
  });

  it('records lastBackupAt and resets changesSinceBackup', async () => {
    const repo = repoA();
    await repo.putNote({ id: 'n2', workId: 'w1', text: 'あとで', createdAt: T0, updatedAt: T0 });
    await repo.putHint({ workId: 'w1', goalId: 'end-1', tier: 2, updatedAt: T0 });
    expect((await repo.getSettings()).changesSinceBackup).toBe(2);
    await exportBackupFile(repo, { now: T0 + 5 * MIN });
    const s = await repo.getSettings();
    expect(s.lastBackupAt).toBe(T0 + 5 * MIN);
    expect(s.changesSinceBackup).toBe(0);
    expect(s.pin).toBeDefined();
  });

  it('defaults now to Date.now()', async () => {
    const repo = repoA();
    const before = Date.now();
    await exportBackupFile(repo, {});
    const s = await repo.getSettings();
    expect(s.lastBackupAt).toBeGreaterThanOrEqual(before);
  });

  it('rejects a short passphrase before recording anything', async () => {
    const repo = repoA();
    await repo.putHint({ workId: 'w1', goalId: 'end-1', tier: 2, updatedAt: T0 });
    const e = await exportBackupFile(repo, { passphrase: 'short', now: T0 }).catch((err: unknown) => err);
    expect(isShioriError(e) && e.code).toBe('validation');
    const s = await repo.getSettings();
    expect(s.lastBackupAt).toBeUndefined();
    expect(s.changesSinceBackup).toBe(1);
  });

  it('treats an empty passphrase as a plain backup', async () => {
    const { text } = await exportBackupFile(repoA(), { passphrase: '', now: T0 });
    expect((JSON.parse(text) as { encrypted: boolean }).encrypted).toBe(false);
  });

  it('encrypts with a passphrase; reading needs the right one', async () => {
    const repo = repoA();
    const { text } = await exportBackupFile(repo, { passphrase: 'しおりのあいことば', now: T0 });
    const file = JSON.parse(text) as Record<string, unknown>;
    expect(file.encrypted).toBe(true);
    expect(text).not.toContain('星読みの図書館');
    expect(text).not.toContain('b32:K7QM2XRAP');

    expect(await readBackupFile(text)).toEqual({ ok: false, error: 'passphraseRequired' });
    expect(await readBackupFile(text, 'ちがうあいことばです')).toEqual({ ok: false, error: 'passphrase' });
    const parsed = await readBackupFile(text, 'しおりのあいことば');
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.encrypted).toBe(true);
      expect(parsed.data).toEqual(await repo.exportAll());
    }
  });
});

describe('readBackupFile', () => {
  it('reports errors instead of throwing', async () => {
    expect(await readBackupFile('{ not json')).toEqual({ ok: false, error: 'json' });
    expect(await readBackupFile(JSON.stringify(manifest('demo-backup')))).toEqual({ ok: false, error: 'format' });
    expect(await readBackupFile(JSON.stringify({ format: 'shiori-backup', version: 2 }))).toEqual({
      ok: false,
      error: 'version',
    });
  });
});

describe('applyBackup: replace', () => {
  it('restores the file into another device and keeps that device\'s local-only settings', async () => {
    const a = repoA();
    const data = await exportedData(a);
    const b = repoB();
    expect(await applyBackup(b, data, 'replace')).toBeNull();

    expect(withoutSettings(await b.exportAll())).toEqual(withoutSettings(await a.exportAll()));
    expect(await b.getWork('w9')).toBeUndefined();
    const s = await b.getSettings();
    // taken from the file
    expect(s.discreet).toEqual({ aliasOnly: false, blurOnHide: true, hideStoreLinks: false, blurExtras: true });
    expect(s.autoLockSec).toBe(30);
    expect(s.camouflageText).toBe('買い物リスト');
    // kept from the device
    expect(s.pin?.hash).toBe('b-device-pin-hash');
    expect(s.ageConfirmedAt).toBe(T0 - 2 * DAY);
    expect(s.lastBackupAt).toBe(T0 - 3 * DAY);
    expect(s.changesSinceBackup).toBe(0);
  });

  it('leaves restored redemptions without masters on a new device (re-derived lazily)', async () => {
    const data = await exportedData(repoA());
    const b = repoB();
    await applyBackup(b, data, 'replace');
    const [r] = await b.listRedemptions();
    expect(r).toEqual({ workId: 'w1', goalId: 'end-1', canonical: 'b32:K7QM2XRAP', redeemedAt: T0 });
  });

  it('keeps this device\'s cached master for the same redemption and manifest', async () => {
    const a = repoA();
    const data = await exportedData(a);
    await applyBackup(a, data, 'replace');
    const [r] = await a.listRedemptions();
    expect(r?.master).toBe(MASTER);
    expect(r?.masterSalt).toBe(SALT);
  });

  it('drops the cached master when the work now points at another manifest or the code differs', async () => {
    const a = repoA();
    const data = await exportedData(a);
    const otherManifest: BackupDataV1 = {
      ...data,
      works: data.works.map((w) => (w.id === 'w1' ? { ...w, manifestKey: MK2 } : w)),
      manifests: [manifestRecord(MK2, 'w1', manifestV2())],
    };
    await applyBackup(a, otherManifest, 'replace');
    expect((await a.listRedemptions())[0]?.master).toBeUndefined();

    const a2 = repoA();
    const otherCode: BackupDataV1 = {
      ...data,
      redemptions: data.redemptions.map((r) => ({ ...r, canonical: 'b32:ST4RMAP1X' })),
    };
    await applyBackup(a2, otherCode, 'replace');
    expect((await a2.listRedemptions())[0]?.master).toBeUndefined();
  });
});

describe('applyBackup: merge', () => {
  it('unions both sides, keeps local settings and returns stats', async () => {
    const data = await exportedData(repoA());
    const b = repoB();
    await b.putNote({ id: 'nb', workId: 'w9', text: 'B端末で書いた', createdAt: T0, updatedAt: T0 });
    const bSettingsBefore = await b.getSettings();
    expect(bSettingsBefore.changesSinceBackup).toBe(1);

    const stats = await applyBackup(b, data, 'merge');
    expect(stats).toMatchObject({ worksAdded: 2, worksUpdated: 0, worksRemapped: 0, progressAdded: 1, sessionsAdded: 1, notesAdded: 1 });

    const works = (await b.listWorks()).map((w) => w.id).sort();
    expect(works).toEqual(['w1', 'w2', 'w9']);
    expect((await b.listSessions()).map((s) => s.id).sort()).toEqual(['s1', 's9']);
    expect(await b.listNotes('w9')).toHaveLength(1);
    expect(await b.listPending()).toHaveLength(1);
    expect(await b.listManifests()).toHaveLength(1);

    const s = await b.getSettings();
    expect(s.discreet).toEqual(bSettingsBefore.discreet);
    expect(s.autoLockSec).toBe(300);
    expect(s.camouflageText).toBe('B端末のメモ');
    expect(s.pin?.hash).toBe('b-device-pin-hash');
    // the merged data is in no single backup: the counter is kept
    expect(s.changesSinceBackup).toBe(1);
    expect(s.lastBackupAt).toBe(T0 - 3 * DAY);
  });

  it('is idempotent', async () => {
    const data = await exportedData(repoA());
    const b = repoB();
    await applyBackup(b, data, 'merge');
    const once = await b.exportAll();
    const stats = await applyBackup(b, data, 'merge');
    expect(stats).toEqual({ worksAdded: 0, worksUpdated: 0, worksRemapped: 0, progressAdded: 0, sessionsAdded: 0, notesAdded: 0 });
    expect(await b.exportAll()).toEqual(once);
  });

  it('remaps a work by manifestWorkId and moves its records to the local id', async () => {
    const data = await exportedData(repoA());
    const b = createMemoryRepo({
      works: [work('local-w', { manifestKey: MK1, manifestWorkId: 'demo-backup', updatedAt: T0 - DAY })],
      manifests: [manifestRecord(MK1, 'local-w')],
    });
    const stats = await applyBackup(b, data, 'merge');
    expect(stats?.worksRemapped).toBe(1);
    expect(await b.getWork('w1')).toBeUndefined();
    expect(await b.listProgress('local-w')).toHaveLength(1);
    expect((await b.listSessions('local-w')).map((s) => s.id)).toEqual(['s1']);
  });

  it('keeps this device\'s cached masters', async () => {
    const a = repoA();
    const data = await exportedData(a);
    await applyBackup(a, data, 'merge');
    const [r] = await a.listRedemptions();
    expect(r?.master).toBe(MASTER);
  });

  it('merges a backup into an empty device like a restore (without masters)', async () => {
    const a = repoA();
    const data = await exportedData(a);
    const empty = createMemoryRepo();
    const stats = await applyBackup(empty, data, 'merge');
    expect(stats?.worksAdded).toBe(2);
    expect(withoutSettings(await empty.exportAll())).toEqual(withoutSettings(await a.exportAll()));
    expect((await empty.getSettings()).discreet).toEqual(DEFAULT_SETTINGS.discreet);
    expect((await empty.listRedemptions())[0]?.master).toBeUndefined();
  });
});

describe('restoreBackup: after the data is in place', () => {
  it('opens sealed extras whose codes were entered on different devices (merge)', async () => {
    // This device entered END 1; the other device (its own copy of the demo) entered END 2–4.
    const here = createMemoryRepo();
    const [hoshiHere] = await importBundledDemos(here, T0);
    await submitCode(here, 'ST4-RMA-P1X', { workId: hoshiHere, now: T0 + 1 });
    const there = createMemoryRepo();
    const [hoshiThere] = await importBundledDemos(there, T0);
    for (const code of ['M00-NDE-SKR', 'NEK-0T0-M0E', 'SK1-ES0-NGM']) await submitCode(there, code, { workId: hoshiThere, now: T0 + 2 });
    expect((await here.listSealedOpens(hoshiHere!)).map((o) => o.sealedId)).toEqual(['letter-mina']);
    await here.updateSettings({ changesSinceBackup: 3 });

    const result = await restoreBackup(here, await exportedData(there), 'merge', { now: T0 + 10 });
    expect((await here.listRedemptions(hoshiHere)).map((r) => r.goalId).sort()).toEqual(['end-a', 'end-b', 'end-c', 'end-true']);
    const opens = await here.listSealedOpens(hoshiHere!);
    expect(opens.map((o) => o.sealedId).sort()).toEqual(['afterword', 'door-code', 'letter-mina']);
    expect(opens.find((o) => o.sealedId === 'afterword')).toMatchObject({ seen: false, firstOpenedAt: T0 + 10 });
    expect(result.openedSealed).toEqual([{ workId: hoshiHere, sealedId: 'afterword' }]);
    // derived from the merged data: not counted as changes
    expect((await here.getSettings()).changesSinceBackup).toBe(3);
  });

  it('redeems a pending code once a merge brings its manifest in', async () => {
    const here = createMemoryRepo();
    await addPending(here, 'b32:ST4RMAP1X', 'demo-hoshiyomi', T0);
    const there = createMemoryRepo();
    const [hoshiThere] = await importBundledDemos(there, T0);

    const result = await restoreBackup(here, await exportedData(there), 'merge', { now: T0 + 5 });
    expect(await here.listPending()).toEqual([]);
    expect(result.pendingOutcomes).toHaveLength(1);
    expect(result.pendingOutcomes[0]).toMatchObject({ status: 'unlocked', goalId: 'end-a', workId: hoshiThere });
    expect(result.openedSealed).toEqual([{ workId: hoshiThere, sealedId: 'letter-mina' }]);
    expect((await here.listProgress(hoshiThere!)).find((p) => p.goalId === 'end-a')).toMatchObject({ via: 'code' });
  });

  it('keeps only one session open after a merge and reports the one it closed', async () => {
    const a = repoA();
    await a.putSession({ id: 's-phone', workId: 'w1', startedAt: T0 + 60 * MIN });
    const b = repoB();
    await b.putSession({ id: 's-pc', workId: 'w9', startedAt: T0 - 60 * MIN });

    const result = await restoreBackup(a, await exportedData(b), 'merge', { now: T0 + 70 * MIN });
    expect(result.closedSessionIds).toEqual(['s-pc']);
    expect((await a.getOpenSession())?.id).toBe('s-phone');
    const closed = (await a.listSessions('w9')).find((x) => x.id === 's-pc');
    expect(closed).toMatchObject({ endedAt: T0 - 60 * MIN, minutes: 0 });
  });

  it('runs under the shared lock: a merge waits for a locked service and the next one waits for it', async () => {
    const { withRepoLock } = await import('./repoLock');
    const a = repoA();
    const data = await exportedData(repoB());
    const order: string[] = [];
    let release: () => void = () => undefined;
    const held = withRepoLock(a, () => new Promise<void>((r) => (release = r)).then(() => void order.push('held')));
    const merging = restoreBackup(a, data, 'merge').then(() => void order.push('merge'));
    const after = withRepoLock(a, async () => void order.push('after'));
    await Promise.resolve();
    release();
    await Promise.all([held, merging, after]);
    expect(order).toEqual(['held', 'merge', 'after']);
  });
});

describe('restoreBackup: broken manifests in the file', () => {
  const HOSHI_TEXT = JSON.stringify(hoshiyomiJson);

  async function deviceWithDemo(): Promise<{ repo: ShioriRepo; workId: string }> {
    const repo = createMemoryRepo();
    const p = await previewImport(repo, HOSHI_TEXT);
    if (p.kind === 'invalid') throw new Error('demo invalid');
    const { workId } = await commitImport(repo, p, { source: 'file', now: T0 });
    await repo.putProgress({ workId, goalId: 'ach-cat', via: 'manual', doneAt: T0, hintTierAtDone: 0, archived: false });
    return { repo, workId };
  }

  it('drops a manifest that fails validation; importing the genuine file repairs the work and its progress', async () => {
    const { repo: source, workId } = await deviceWithDemo();
    const data = await exportedData(source);
    const broken = structuredClone(data);
    delete (broken.manifests[0]!.manifest as Partial<ShioriManifestV1>).kdf; // code goals without a kdf

    const target = createMemoryRepo();
    await applyBackup(target, broken, 'replace');
    expect(await target.listManifests()).toEqual([]);
    expect(await target.getWork(workId)).toMatchObject({ manifestWorkId: 'demo-hoshiyomi' });
    expect((await target.getWork(workId))?.manifestKey).toBeUndefined();

    const again = await previewImport(target, HOSHI_TEXT);
    expect(again).toMatchObject({ kind: 'update', alreadyImported: false });
    if (again.kind === 'invalid') return;
    const { workId: repaired } = await commitImport(target, again, { source: 'file', now: T0 + 1 });
    expect(repaired).toBe(workId);
    expect(await target.listWorks()).toHaveLength(1);
    expect((await target.listProgress(workId)).find((p) => p.goalId === 'ach-cat')).toMatchObject({ archived: false });
  });

  it('re-keys an edited manifest, so the genuine file is not reported as already imported', async () => {
    const { repo: source, workId } = await deviceWithDemo();
    const data = await exportedData(source);
    const genuineKey = data.manifests[0]!.key;
    const edited = structuredClone(data);
    edited.manifests[0]!.manifest.goals[5]!.label = '書き換えられた名前';

    const target = createMemoryRepo();
    await applyBackup(target, edited, 'replace');
    const stored = await target.getWork(workId);
    expect(stored?.manifestKey).toBeDefined();
    expect(stored?.manifestKey).not.toBe(genuineKey);

    const again = await previewImport(target, HOSHI_TEXT);
    expect(again).toMatchObject({ kind: 'update', alreadyImported: false });
    if (again.kind === 'invalid') return;
    await commitImport(target, again, { source: 'file', now: T0 + 1 });
    const record = await target.getManifest((await target.getWork(workId))!.manifestKey!);
    expect(record?.key).toBe(genuineKey);
    expect(record?.manifest.goals[5]!.label).toBe(hoshiyomiJson.goals[5]!.label);
  });
});

describe('shouldRemindBackup', () => {
  const now = T0;
  const s = (over: Partial<Settings>): Settings => ({ ...DEFAULT_SETTINGS, ...over });

  it.each([
    ['no data', s({ changesSinceBackup: 50 }), false, false],
    ['fresh install, few changes', s({ changesSinceBackup: 3 }), true, false],
    ['never backed up, 19 changes', s({ changesSinceBackup: BACKUP_REMINDER_CHANGES - 1 }), true, false],
    ['never backed up, 20 changes', s({ changesSinceBackup: BACKUP_REMINDER_CHANGES }), true, true],
    ['recent backup, 20 changes', s({ changesSinceBackup: 20, lastBackupAt: now - DAY }), true, true],
    ['recent backup, few changes', s({ changesSinceBackup: 5, lastBackupAt: now - DAY }), true, false],
    ['backup 29 days ago', s({ changesSinceBackup: 0, lastBackupAt: now - 29 * DAY }), true, false],
    ['backup exactly 30 days ago', s({ changesSinceBackup: 0, lastBackupAt: now - 30 * DAY }), true, false],
    ['backup 30 days + 1 ms ago', s({ changesSinceBackup: 0, lastBackupAt: now - 30 * DAY - 1 }), true, true],
    ['backup 31 days ago', s({ changesSinceBackup: 0, lastBackupAt: now - 31 * DAY }), true, true],
    ['old backup but no data', s({ changesSinceBackup: 0, lastBackupAt: now - 90 * DAY }), false, false],
    ['snoozed (changes)', s({ changesSinceBackup: 40, backupReminderSnoozedUntil: now + 1 }), true, false],
    ['snoozed (old backup)', s({ lastBackupAt: now - 90 * DAY, backupReminderSnoozedUntil: now + DAY }), true, false],
    ['snooze ends now', s({ changesSinceBackup: 40, backupReminderSnoozedUntil: now }), true, true],
    ['snooze expired', s({ lastBackupAt: now - 90 * DAY, backupReminderSnoozedUntil: now - 1 }), true, true],
  ] as const)('%s', (_name, settings, hasData, expected) => {
    expect(shouldRemindBackup(settings, hasData, now)).toBe(expected);
  });
});

describe('snoozeBackupReminder', () => {
  it('hides the reminder for 7 days', async () => {
    const repo = repoA();
    await repo.updateSettings({ changesSinceBackup: 30 });
    const settings = await snoozeBackupReminder(repo, T0);
    expect(settings.backupReminderSnoozedUntil).toBe(T0 + 7 * DAY);
    expect(shouldRemindBackup(settings, true, T0 + 6 * DAY)).toBe(false);
    expect(shouldRemindBackup(settings, true, T0 + 7 * DAY)).toBe(true);
  });
});

describe('hasBackupData', () => {
  it('is true with a work or a pending code', async () => {
    expect(await hasBackupData(createMemoryRepo())).toBe(false);
    expect(await hasBackupData(createMemoryRepo({ pending: [{ id: 'p', canonical: 'b32:ST4RMAP1X', receivedAt: T0 }] }))).toBe(
      true,
    );
    expect(await hasBackupData(repoA())).toBe(true);
  });
});

describe('requestPersistentStorage', () => {
  it('records the answer in settings.persist', async () => {
    const repo = createMemoryRepo();
    const request = vi.fn(async () => true);
    expect(await requestPersistentStorage(repo, T0, request)).toBe(true);
    expect(request).toHaveBeenCalledOnce();
    expect((await repo.getSettings()).persist).toEqual({ requestedAt: T0, granted: true });
  });

  it('treats a failing request as not granted', async () => {
    const repo = createMemoryRepo();
    const request = vi.fn(async (): Promise<boolean> => {
      throw new Error('blocked');
    });
    expect(await requestPersistentStorage(repo, T0, request)).toBe(false);
    expect((await repo.getSettings()).persist).toEqual({ requestedAt: T0, granted: false });
  });

  it('returns false without navigator.storage (node)', async () => {
    const repo = createMemoryRepo();
    expect(await requestPersistentStorage(repo, T0)).toBe(false);
  });
});
