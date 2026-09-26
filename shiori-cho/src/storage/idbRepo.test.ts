import 'fake-indexeddb/auto';
import { describe, it, expect, vi } from 'vitest';
import { deleteDB, openDB } from 'idb';
import { DB_PLAYER } from '../core/constants';
import { isShioriError } from '../core/errors';
import { DEFAULT_SETTINGS } from '../core/types';
import { PLAYER_DB_VERSION, deleteIdbDatabase, openIdbRepo } from './idbRepo';
import { makeDataset, makeProgress, makeSession, makeWork, runRepoContract } from './repoContract';

let seq = 0;
const uniqueName = () => `shiori-test-${++seq}-${crypto.randomUUID()}`;

runRepoContract('idb', () => openIdbRepo(uniqueName()));

async function databaseNames(): Promise<string[]> {
  return (await indexedDB.databases()).map((d) => d.name ?? '');
}

/** Store → { keyPath, autoIncrement, indexes } as found in the real database. */
async function readLayout(name: string) {
  const db = await openDB(name);
  try {
    const names = [...db.objectStoreNames];
    const tx = db.transaction(names, 'readonly');
    const layout: Record<string, unknown> = {};
    for (const n of names) {
      const store = tx.objectStore(n);
      const indexes: Record<string, unknown> = {};
      for (const i of [...store.indexNames]) {
        const idx = store.index(i);
        indexes[i] = { keyPath: idx.keyPath, unique: idx.unique, multiEntry: idx.multiEntry };
      }
      layout[n] = { keyPath: store.keyPath, autoIncrement: store.autoIncrement, indexes };
    }
    await tx.done;
    return { version: db.version, layout };
  } finally {
    db.close();
  }
}

const idx = (keyPath: string) => ({ keyPath, unique: false, multiEntry: false });

describe('openIdbRepo: database layout (docs/SPEC.md §5.3)', () => {
  it('creates version 1 with exactly the specified stores, key paths and indexes', async () => {
    const name = uniqueName();
    await openIdbRepo(name);
    const { version, layout } = await readLayout(name);
    expect(version).toBe(1);
    expect(PLAYER_DB_VERSION).toBe(1);
    expect(layout).toEqual({
      works: { keyPath: 'id', autoIncrement: false, indexes: { manifestWorkId: idx('manifestWorkId') } },
      manifests: { keyPath: 'key', autoIncrement: false, indexes: { workId: idx('workId') } },
      progress: { keyPath: ['workId', 'goalId'], autoIncrement: false, indexes: { workId: idx('workId') } },
      redemptions: { keyPath: ['workId', 'goalId'], autoIncrement: false, indexes: { workId: idx('workId') } },
      hints: { keyPath: ['workId', 'goalId'], autoIncrement: false, indexes: {} },
      sessions: {
        keyPath: 'id',
        autoIncrement: false,
        indexes: { workId: idx('workId'), startedAt: idx('startedAt') },
      },
      notes: { keyPath: 'id', autoIncrement: false, indexes: { workId: idx('workId') } },
      pending: { keyPath: 'id', autoIncrement: false, indexes: {} },
      sealedOpens: { keyPath: ['workId', 'sealedId'], autoIncrement: false, indexes: {} },
      meta: { keyPath: 'key', autoIncrement: false, indexes: {} },
    });
  });

  it("uses the 'shiori' database by default", async () => {
    expect(DB_PLAYER).toBe('shiori');
    const repo = await openIdbRepo();
    await repo.putWork(makeWork('w1'));
    expect(await databaseNames()).toContain('shiori');
    await deleteIdbDatabase();
    expect(await databaseNames()).not.toContain('shiori');
  });

  it("stores settings as { key: 'settings', value } in meta", async () => {
    const name = uniqueName();
    const repo = await openIdbRepo(name);
    await repo.updateSettings({ ageConfirmedAt: 123 });
    const db = await openDB(name);
    try {
      expect(await db.get('meta', 'settings')).toEqual({
        key: 'settings',
        value: { ...DEFAULT_SETTINGS, ageConfirmedAt: 123 },
      });
    } finally {
      db.close();
    }
  });

  it('merges a partial stored settings record with the defaults', async () => {
    const name = uniqueName();
    const repo = await openIdbRepo(name);
    const db = await openDB(name);
    await db.put('meta', {
      key: 'settings',
      value: { schemaVersion: 1, discreet: { aliasOnly: false }, ageConfirmedAt: 5, changesSinceBackup: 3 },
    });
    db.close();
    expect(await repo.getSettings()).toEqual({
      ...DEFAULT_SETTINGS,
      discreet: { ...DEFAULT_SETTINGS.discreet, aliasOnly: false },
      ageConfirmedAt: 5,
      changesSinceBackup: 3,
    });
    await repo.putWork(makeWork('w1'));
    expect(await repo.getSettings()).toMatchObject({ ageConfirmedAt: 5, changesSinceBackup: 4 });
  });

  it('stores records natively: progress keyed by [workId, goalId]', async () => {
    const name = uniqueName();
    const repo = await openIdbRepo(name);
    await repo.putProgress(makeProgress('w1', 'end-1'));
    const db = await openDB(name);
    try {
      expect(await db.get('progress', ['w1', 'end-1'])).toEqual(makeProgress('w1', 'end-1'));
      expect(await db.getAllFromIndex('progress', 'workId', 'w1')).toHaveLength(1);
    } finally {
      db.close();
    }
  });
});

describe('openIdbRepo: persistence and connections', () => {
  it('data survives reopening the database', async () => {
    const name = uniqueName();
    const first = await openIdbRepo(name);
    const data = makeDataset();
    await first.replaceAll({ ...data, settings: { discreet: DEFAULT_SETTINGS.discreet, autoLockSec: 30, camouflageText: '' } });
    await first.updateSettings({ ageConfirmedAt: 1 });
    const second = await openIdbRepo(name);
    expect(await second.exportAll()).toEqual(await first.exportAll());
    expect(await second.getSettings()).toMatchObject({ ageConfirmedAt: 1, autoLockSec: 30 });
  });

  it('two repos on the same database see each other’s writes', async () => {
    const name = uniqueName();
    const a = await openIdbRepo(name);
    const b = await openIdbRepo(name);
    await a.putWork(makeWork('w1'));
    await b.putSession(makeSession('s1', 'w1', 1, { endedAt: undefined }));
    expect((await b.listWorks()).map((w) => w.id)).toEqual(['w1']);
    expect((await a.getOpenSession())?.id).toBe('s1');
    expect((await a.getSettings()).changesSinceBackup).toBe(2);
  });

  it('databases with different names are independent', async () => {
    const a = await openIdbRepo(uniqueName());
    const b = await openIdbRepo(uniqueName());
    await a.putWork(makeWork('w1'));
    expect(await b.listWorks()).toEqual([]);
  });

  it('deleteIdbDatabase closes our connections, deletes the database and notifies listeners', async () => {
    const name = uniqueName();
    const other = uniqueName();
    const repo = await openIdbRepo(name);
    const second = await openIdbRepo(name);
    const otherRepo = await openIdbRepo(other);
    await repo.putWork(makeWork('w1'));
    await repo.updateSettings({ ageConfirmedAt: 1 });
    await otherRepo.putWork(makeWork('w-other'));
    const listener = vi.fn();
    repo.subscribe(listener);

    await deleteIdbDatabase(name);

    expect(await databaseNames()).not.toContain(name);
    expect(listener).toHaveBeenCalledTimes(1);
    // The repos reopen a fresh, empty database on their next call.
    expect(await repo.listWorks()).toEqual([]);
    expect(await repo.getSettings()).toEqual(DEFAULT_SETTINGS);
    expect(await second.listWorks()).toEqual([]);
    await second.putWork(makeWork('w2'));
    expect((await repo.listWorks()).map((w) => w.id)).toEqual(['w2']);
    // Another database is untouched.
    expect((await otherRepo.listWorks()).map((w) => w.id)).toEqual(['w-other']);
  });

  it('deleteIdbDatabase resolves for a database that does not exist', async () => {
    await expect(deleteIdbDatabase(uniqueName())).resolves.toBeUndefined();
  });

  it('does not block a deletion started elsewhere (e.g. another tab) and recovers afterwards', async () => {
    const name = uniqueName();
    const repo = await openIdbRepo(name);
    await repo.putWork(makeWork('w1'));
    const blocked = vi.fn();
    await deleteDB(name, { blocked });
    expect(blocked).not.toHaveBeenCalled();
    expect(await repo.listWorks()).toEqual([]);
    await repo.putWork(makeWork('w2'));
    expect((await repo.listWorks()).map((w) => w.id)).toEqual(['w2']);
  });

  it('does not block an upgrade started elsewhere (a newer app version in another tab)', async () => {
    const name = uniqueName();
    const repo = await openIdbRepo(name);
    await repo.putWork(makeWork('w1'));
    const blocked = vi.fn();
    const newer = await openDB(name, 2, { blocked });
    expect(blocked).not.toHaveBeenCalled();
    expect(newer.version).toBe(2);
    newer.close();
    // This (older) connection can no longer open the upgraded database.
    await expect(repo.listWorks()).rejects.toMatchObject({
      name: 'ShioriError',
      code: 'io',
      messageJa: '新しいバージョンのしおり帳で保存されたデータです。ページを再読み込みしてください。',
    });
  });

  it('fails to open a database created by a newer version with a Japanese ShioriError', async () => {
    const name = uniqueName();
    (await openDB(name, 5)).close();
    const err = await openIdbRepo(name).then(
      () => null,
      (e: unknown) => e,
    );
    expect(isShioriError(err)).toBe(true);
    expect(err).toMatchObject({ code: 'io', messageJa: expect.stringContaining('新しいバージョン') });
    expect((err as Error).cause).toMatchObject({ name: 'VersionError' });
  });
});
