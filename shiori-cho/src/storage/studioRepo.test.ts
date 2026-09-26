import 'fake-indexeddb/auto';
import { describe, it, expect, vi } from 'vitest';
import { openDB } from 'idb';
import { DB_PLAYER, DB_STUDIO } from '../core/constants';
import { deleteIdbDatabase, openIdbRepo } from './idbRepo';
import { makeProject, makeWork, runStudioRepoContract } from './repoContract';
import { STUDIO_DB_VERSION, deleteIdbStudioDatabase, openIdbStudioRepo } from './studioRepo';

let seq = 0;
const uniqueName = () => `shiori-studio-test-${++seq}-${crypto.randomUUID()}`;

runStudioRepoContract('idb', () => openIdbStudioRepo(uniqueName()));

async function databaseNames(): Promise<string[]> {
  return (await indexedDB.databases()).map((d) => d.name ?? '');
}

describe('openIdbStudioRepo', () => {
  it("creates version 1 with a single 'projects' store keyed by id", async () => {
    const name = uniqueName();
    await openIdbStudioRepo(name);
    const db = await openDB(name);
    try {
      expect(db.version).toBe(1);
      expect(STUDIO_DB_VERSION).toBe(1);
      expect([...db.objectStoreNames]).toEqual(['projects']);
      const store = db.transaction('projects').store;
      expect(store.keyPath).toBe('id');
      expect(store.autoIncrement).toBe(false);
      expect([...store.indexNames]).toEqual([]);
    } finally {
      db.close();
    }
  });

  it('projects survive reopening the database', async () => {
    const name = uniqueName();
    const first = await openIdbStudioRepo(name);
    await first.put(makeProject('p1'));
    const second = await openIdbStudioRepo(name);
    expect(await second.get('p1')).toEqual(makeProject('p1'));
  });

  it("uses 'shiori-studio' by default, separate from the player database", async () => {
    expect(DB_STUDIO).toBe('shiori-studio');
    const studio = await openIdbStudioRepo();
    const player = await openIdbRepo();
    await studio.put(makeProject('p1'));
    await player.putWork(makeWork('w1'));
    expect(await databaseNames()).toEqual(expect.arrayContaining(['shiori', 'shiori-studio']));

    // 全データを消す without the studio box: the creator's secrets survive.
    await deleteIdbDatabase(DB_PLAYER);
    expect(await databaseNames()).not.toContain('shiori');
    expect(await studio.get('p1')).toEqual(makeProject('p1'));
    await player.clearAll();

    // Clearing player data never touches the studio either.
    expect(await studio.list()).toHaveLength(1);

    await deleteIdbStudioDatabase();
    expect(await databaseNames()).not.toContain('shiori-studio');
    await deleteIdbDatabase();
  });

  it('deleting the studio database closes our connections, notifies listeners and reopens empty', async () => {
    const name = uniqueName();
    const repo = await openIdbStudioRepo(name);
    await repo.put(makeProject('p1'));
    const listener = vi.fn();
    repo.subscribe(listener);
    await deleteIdbStudioDatabase(name);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(await databaseNames()).not.toContain(name);
    expect(await repo.list()).toEqual([]);
    await repo.put(makeProject('p2'));
    expect((await repo.list()).map((p) => p.id)).toEqual(['p2']);
  });

  it('deleteIdbDatabase from idbRepo also closes studio connections', async () => {
    const name = uniqueName();
    const repo = await openIdbStudioRepo(name);
    await repo.put(makeProject('p1'));
    await deleteIdbDatabase(name);
    expect(await repo.get('p1')).toBeUndefined();
  });
});
