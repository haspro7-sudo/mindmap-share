// IndexedDB StudioRepo (DB 'shiori-studio', version 1, store 'projects' keyPath 'id').
// Kept separate from the player DB so that wiping one never destroys the other.
import type { DBSchema, IDBPDatabase, IDBPObjectStore } from 'idb';
import { DB_STUDIO } from '../core/constants';
import type { StudioProject } from '../core/types';
import { createManagedDb, deleteDatabase, storageFailure } from './idbConnections';
import type { StudioRepo } from './repo';
import { ORDER, assertKeys, createEmitter } from './shared';

export const STUDIO_DB_VERSION = 1;

type ProjectsStore = IDBPObjectStore<StudioDbSchema, ['projects'], 'projects', 'readwrite'>;

export interface StudioDbSchema extends DBSchema {
  projects: { key: string; value: StudioProject };
}

/** Schema upgrades: one case per version, falling through; never edit an old case. */
export function upgradeStudioDb(db: IDBPDatabase<StudioDbSchema>, oldVersion: number): void {
  switch (oldVersion) {
    case 0: {
      db.createObjectStore('projects', { keyPath: 'id' });
    }
    // Future versions add `case 1:` etc. here.
  }
}

export async function openIdbStudioRepo(dbName: string = DB_STUDIO): Promise<StudioRepo> {
  const emitter = createEmitter('shiori:idb-studio');
  const managed = createManagedDb<StudioDbSchema>({
    name: dbName,
    version: STUDIO_DB_VERSION,
    upgrade: (db, oldVersion) => upgradeStudioDb(db, oldVersion),
    onDeleted: () => emitter.emit(),
  });
  await managed.get();

  /** One readwrite transaction on 'projects'; listeners fire after it committed. */
  async function write(fn: (store: ProjectsStore) => Promise<unknown>): Promise<void> {
    const db = await managed.get();
    const tx = db.transaction('projects', 'readwrite');
    tx.done.catch(() => undefined);
    try {
      await fn(tx.store);
    } catch (e) {
      try {
        tx.abort();
      } catch {
        // already finished or aborted
      }
      throw storageFailure(e);
    }
    try {
      await tx.done;
    } catch (e) {
      throw storageFailure(e);
    }
    emitter.emit();
  }

  return {
    subscribe: (listener) => emitter.subscribe(listener),
    list: async () => (await (await managed.get()).getAll('projects')).sort(ORDER.projects),
    get: async (id) => (await managed.get()).get('projects', id),
    put: async (p) => {
      assertKeys(p, ['id'], 'put');
      await write((store) => store.put(p));
    },
    delete: (id) => write((store) => store.delete(id)),
    clearAll: () => write((store) => store.clear()),
  };
}

/** Deletes the whole creator database (closing this module's connections first). */
export async function deleteIdbStudioDatabase(dbName: string = DB_STUDIO): Promise<void> {
  await deleteDatabase(dbName);
}
