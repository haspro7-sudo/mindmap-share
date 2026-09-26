// IndexedDB ShioriRepo using `idb` (DB 'shiori', version 1; layout in docs/SPEC.md §5.3).
import type { DBSchema, IDBPDatabase, IDBPTransaction, StoreNames } from 'idb';
import { DB_PLAYER } from '../core/constants';
import type {
  BackupDataV1,
  GoalProgress,
  HintReveal,
  ManifestRecord,
  Note,
  PendingCode,
  Redemption,
  SealedOpen,
  Session,
  Settings,
  WorkRecord,
} from '../core/types';
import { createManagedDb, deleteDatabase, storageFailure } from './idbConnections';
import type { ShioriRepo } from './repo';
import {
  ORDER,
  applySettingsPatch,
  KEY_FIELDS,
  assertBackupKeys,
  assertKeys,
  backupSettingsOf,
  createEmitter,
  isOpenSession,
  normalizeSettings,
  settingsAfterReplace,
  stripRedemption,
  withRedemptionCache,
} from './shared';

export const PLAYER_DB_VERSION = 1;
const SETTINGS_KEY = 'settings';

type PairKey = [string, string];

export interface MetaRecord {
  key: string;
  value: Settings;
}

/** Typed layout of DB 'shiori' (docs/SPEC.md §5.3). */
export interface ShioriDbSchema extends DBSchema {
  works: { key: string; value: WorkRecord; indexes: { manifestWorkId: string } };
  manifests: { key: string; value: ManifestRecord; indexes: { workId: string } };
  progress: { key: PairKey; value: GoalProgress; indexes: { workId: string } };
  redemptions: { key: PairKey; value: Redemption; indexes: { workId: string } };
  hints: { key: PairKey; value: HintReveal };
  sessions: { key: string; value: Session; indexes: { workId: string; startedAt: number } };
  notes: { key: string; value: Note; indexes: { workId: string } };
  pending: { key: string; value: PendingCode };
  sealedOpens: { key: PairKey; value: SealedOpen };
  meta: { key: string; value: MetaRecord };
}

type StoreName = StoreNames<ShioriDbSchema>;
type Tx<Mode extends IDBTransactionMode> = IDBPTransaction<ShioriDbSchema, StoreName[], Mode>;
type ReadTx = Tx<'readonly'> | Tx<'readwrite'>;

/** Every store that holds player data (everything but 'meta'). */
const DATA_STORES = [
  'works',
  'manifests',
  'progress',
  'redemptions',
  'hints',
  'sessions',
  'notes',
  'pending',
  'sealedOpens',
] as const satisfies readonly StoreName[];
const ALL_STORES: StoreName[] = [...DATA_STORES, 'meta'];

/** Schema upgrades: one case per version, falling through; never edit an old case. */
export function upgradeShioriDb(db: IDBPDatabase<ShioriDbSchema>, oldVersion: number): void {
  switch (oldVersion) {
    case 0: {
      const works = db.createObjectStore('works', { keyPath: 'id' });
      works.createIndex('manifestWorkId', 'manifestWorkId');
      const manifests = db.createObjectStore('manifests', { keyPath: 'key' });
      manifests.createIndex('workId', 'workId');
      const progress = db.createObjectStore('progress', { keyPath: ['workId', 'goalId'] });
      progress.createIndex('workId', 'workId');
      const redemptions = db.createObjectStore('redemptions', { keyPath: ['workId', 'goalId'] });
      redemptions.createIndex('workId', 'workId');
      db.createObjectStore('hints', { keyPath: ['workId', 'goalId'] });
      const sessions = db.createObjectStore('sessions', { keyPath: 'id' });
      sessions.createIndex('workId', 'workId');
      sessions.createIndex('startedAt', 'startedAt');
      const notes = db.createObjectStore('notes', { keyPath: 'id' });
      notes.createIndex('workId', 'workId');
      db.createObjectStore('pending', { keyPath: 'id' });
      db.createObjectStore('sealedOpens', { keyPath: ['workId', 'sealedId'] });
      db.createObjectStore('meta', { keyPath: 'key' });
    }
    // Future versions add `case 1:` etc. here.
  }
}

/**
 * All compound keys [workId, x] of one work. Arrays sort after every string in IndexedDB,
 * so [workId] .. [workId, []) covers every second component (a strict superset of
 * [workId, ''] .. [workId, '￿']).
 */
function workRange(workId: string): IDBKeyRange {
  return IDBKeyRange.bound([workId], [workId, []], false, true);
}

/** Issues all requests at once; if one throws synchronously, the others' rejections are still handled. */
async function all(requests: Iterable<() => Promise<unknown>>): Promise<void> {
  const pending: Promise<unknown>[] = [];
  try {
    for (const r of requests) pending.push(r());
  } catch (e) {
    for (const p of pending) p.catch(() => undefined);
    throw e;
  }
  await Promise.all(pending);
}

async function readSettings(tx: ReadTx): Promise<Settings> {
  const rec = await tx.objectStore('meta').get(SETTINGS_KEY);
  return normalizeSettings(rec?.value);
}

async function writeSettings(tx: Tx<'readwrite'>, value: Settings): Promise<void> {
  await tx.objectStore('meta').put({ key: SETTINGS_KEY, value });
}

export async function openIdbRepo(dbName: string = DB_PLAYER): Promise<ShioriRepo> {
  const emitter = createEmitter('shiori:idb');
  const managed = createManagedDb<ShioriDbSchema>({
    name: dbName,
    version: PLAYER_DB_VERSION,
    upgrade: (db, oldVersion) => upgradeShioriDb(db, oldVersion),
    onDeleted: () => emitter.emit(),
  });
  // Open eagerly so that a failure (private mode, blocked upgrade, …) surfaces here.
  await managed.get();

  async function read<T>(stores: StoreName[], fn: (tx: Tx<'readonly'>) => Promise<T>): Promise<T> {
    const db = await managed.get();
    const tx = db.transaction(stores, 'readonly');
    tx.done.catch(() => undefined);
    const result = await fn(tx);
    await tx.done;
    return result;
  }

  /**
   * One readwrite transaction. With `bump`, settings.changesSinceBackup is incremented in the
   * same transaction. Listeners fire only after the transaction committed.
   */
  async function write<T>(
    stores: StoreName[],
    bump: boolean,
    fn: (tx: Tx<'readwrite'>) => Promise<T>,
    /** whether listeners should hear about this commit (default: always) */
    notify: (result: T) => boolean = () => true,
  ): Promise<T> {
    const db = await managed.get();
    const names = bump && !stores.includes('meta') ? [...stores, 'meta' as const] : stores;
    const tx = db.transaction(names, 'readwrite');
    tx.done.catch(() => undefined);
    let result: T;
    try {
      result = await fn(tx);
      if (bump) {
        const s = await readSettings(tx);
        s.changesSinceBackup += 1;
        await writeSettings(tx, s);
      }
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
    if (notify(result)) emitter.emit();
    return result;
  }

  /** Deletes everything belonging to one work inside `tx`. */
  async function cascadeDelete(tx: Tx<'readwrite'>, workId: string): Promise<void> {
    const range = workRange(workId);
    const [manifestKeys, sessionKeys, noteKeys] = await Promise.all([
      tx.objectStore('manifests').index('workId').getAllKeys(workId),
      tx.objectStore('sessions').index('workId').getAllKeys(workId),
      tx.objectStore('notes').index('workId').getAllKeys(workId),
    ]);
    await all([
      () => tx.objectStore('works').delete(workId),
      () => tx.objectStore('progress').delete(range),
      () => tx.objectStore('redemptions').delete(range),
      () => tx.objectStore('hints').delete(range),
      () => tx.objectStore('sealedOpens').delete(range),
      ...manifestKeys.map((k) => () => tx.objectStore('manifests').delete(k)),
      ...sessionKeys.map((k) => () => tx.objectStore('sessions').delete(k)),
      ...noteKeys.map((k) => () => tx.objectStore('notes').delete(k)),
    ]);
  }

  const repo: ShioriRepo = {
    subscribe: (listener) => emitter.subscribe(listener),

    // ── settings ──
    getSettings: () => read(['meta'], readSettings),
    updateSettings: (patch) =>
      write(['meta'], false, async (tx) => {
        const next = applySettingsPatch(await readSettings(tx), patch);
        await writeSettings(tx, next);
        return next;
      }),

    // ── works ──
    listWorks: () => read(['works'], async (tx) => (await tx.objectStore('works').getAll()).sort(ORDER.works)),
    getWork: (id) => read(['works'], (tx) => tx.objectStore('works').get(id)),
    findWorkByManifestWorkId: (manifestWorkId) =>
      read(['works'], async (tx) => {
        // Normally unique; if not, the earliest added work wins (same order as listWorks).
        const rows = await tx.objectStore('works').index('manifestWorkId').getAll(manifestWorkId);
        return rows.sort(ORDER.works)[0];
      }),
    putWork: async (w) => {
      assertKeys(w, KEY_FIELDS.works, 'putWork');
      await write(['works'], true, (tx) => tx.objectStore('works').put(w));
    },
    // Pending codes are not work-scoped, so they stay out of the cascade.
    deleteWork: (id) =>
      write(
        DATA_STORES.filter((n) => n !== 'pending'),
        true,
        (tx) => cascadeDelete(tx, id),
      ),

    // ── manifests ──
    getManifest: (key) => read(['manifests'], (tx) => tx.objectStore('manifests').get(key)),
    listManifests: (workId) =>
      read(['manifests'], async (tx) => {
        const store = tx.objectStore('manifests');
        const rows = workId === undefined ? await store.getAll() : await store.index('workId').getAll(workId);
        return rows.sort(ORDER.manifests);
      }),
    putManifest: async (m) => {
      assertKeys(m, KEY_FIELDS.manifests, 'putManifest');
      await write(['manifests'], true, (tx) => tx.objectStore('manifests').put(m));
    },
    deleteManifest: (key) => write(['manifests'], true, (tx) => tx.objectStore('manifests').delete(key)),

    // ── progress ──
    listProgress: (workId) =>
      read(['progress'], async (tx) => (await tx.objectStore('progress').getAll(workRange(workId))).sort(ORDER.progress)),
    putProgress: async (p) => {
      assertKeys(p, KEY_FIELDS.progress, 'putProgress');
      await write(['progress'], true, (tx) => tx.objectStore('progress').put(p));
    },
    deleteProgress: (workId, goalId) =>
      write(['progress'], true, (tx) => tx.objectStore('progress').delete([workId, goalId])),

    // ── redemptions ──
    listRedemptions: (workId) =>
      read(['redemptions'], async (tx) => {
        const store = tx.objectStore('redemptions');
        const rows = workId === undefined ? await store.getAll() : await store.getAll(workRange(workId));
        return rows.sort(ORDER.redemptions);
      }),
    putRedemption: async (r) => {
      assertKeys(r, KEY_FIELDS.redemptions, 'putRedemption');
      await write(['redemptions'], true, (tx) => tx.objectStore('redemptions').put(r));
    },
    putRedemptionCache: async (workId, goalId, canonical, cache) => {
      if (typeof workId !== 'string' || typeof goalId !== 'string') return;
      await write(
        ['redemptions'],
        false,
        async (tx) => {
          const store = tx.objectStore('redemptions');
          const current = await store.get([workId, goalId]);
          if (!current || current.canonical !== canonical) return false;
          const next = withRedemptionCache(current, cache);
          if (next === current) return false;
          await store.put(next);
          return true;
        },
        (changed) => changed,
      );
    },

    // ── hints ──
    listHints: (workId) =>
      read(['hints'], async (tx) => (await tx.objectStore('hints').getAll(workRange(workId))).sort(ORDER.hints)),
    putHint: async (h) => {
      assertKeys(h, KEY_FIELDS.hints, 'putHint');
      await write(['hints'], true, (tx) => tx.objectStore('hints').put(h));
    },
    deleteHint: (workId, goalId) => write(['hints'], true, (tx) => tx.objectStore('hints').delete([workId, goalId])),

    // ── sessions ──
    listSessions: (workId) =>
      read(['sessions'], async (tx) => {
        const store = tx.objectStore('sessions');
        const rows = workId === undefined ? await store.getAll() : await store.index('workId').getAll(workId);
        return rows.sort(ORDER.sessions);
      }),
    putSession: async (s) => {
      assertKeys(s, KEY_FIELDS.sessions, 'putSession');
      await write(['sessions'], true, (tx) => tx.objectStore('sessions').put(s));
    },
    deleteSession: (id) => write(['sessions'], true, (tx) => tx.objectStore('sessions').delete(id)),
    getOpenSession: () =>
      read(['sessions'], async (tx) => {
        // startedAt desc, id desc — the same order as ORDER.sessions.
        let cursor = await tx.objectStore('sessions').index('startedAt').openCursor(null, 'prev');
        while (cursor) {
          if (isOpenSession(cursor.value)) return cursor.value;
          cursor = await cursor.continue();
        }
        return undefined;
      }),

    // ── notes ──
    listNotes: (workId) =>
      read(['notes'], async (tx) => (await tx.objectStore('notes').index('workId').getAll(workId)).sort(ORDER.notes)),
    putNote: async (n) => {
      assertKeys(n, KEY_FIELDS.notes, 'putNote');
      await write(['notes'], true, (tx) => tx.objectStore('notes').put(n));
    },
    deleteNote: (id) => write(['notes'], true, (tx) => tx.objectStore('notes').delete(id)),

    // ── pending (not counted as a change: it is re-created from deep links) ──
    listPending: () => read(['pending'], async (tx) => (await tx.objectStore('pending').getAll()).sort(ORDER.pending)),
    putPending: async (p) => {
      assertKeys(p, KEY_FIELDS.pending, 'putPending');
      await write(['pending'], false, (tx) => tx.objectStore('pending').put(p));
    },
    deletePending: (id) => write(['pending'], false, (tx) => tx.objectStore('pending').delete(id)),

    // ── sealed opens ──
    listSealedOpens: (workId) =>
      read(['sealedOpens'], async (tx) =>
        (await tx.objectStore('sealedOpens').getAll(workRange(workId))).sort(ORDER.sealedOpens),
      ),
    putSealedOpen: async (o) => {
      assertKeys(o, KEY_FIELDS.sealedOpens, 'putSealedOpen');
      await write(['sealedOpens'], true, (tx) => tx.objectStore('sealedOpens').put(o));
    },

    // ── backup ──
    exportAll: () =>
      read(ALL_STORES, async (tx) => {
        const [works, manifests, progress, redemptions, hints, sessions, notes, pending, sealedOpens, settings] =
          await Promise.all([
            tx.objectStore('works').getAll(),
            tx.objectStore('manifests').getAll(),
            tx.objectStore('progress').getAll(),
            tx.objectStore('redemptions').getAll(),
            tx.objectStore('hints').getAll(),
            tx.objectStore('sessions').getAll(),
            tx.objectStore('notes').getAll(),
            tx.objectStore('pending').getAll(),
            tx.objectStore('sealedOpens').getAll(),
            readSettings(tx),
          ]);
        const data: BackupDataV1 = {
          works: works.sort(ORDER.works),
          manifests: manifests.sort(ORDER.manifests),
          progress: progress.sort(ORDER.progress),
          redemptions: redemptions.sort(ORDER.redemptions).map(stripRedemption),
          hints: hints.sort(ORDER.hints),
          sessions: sessions.sort(ORDER.sessions),
          notes: notes.sort(ORDER.notes),
          pending: pending.sort(ORDER.pending),
          sealedOpens: sealedOpens.sort(ORDER.sealedOpens),
          settings: backupSettingsOf(settings),
        };
        return data;
      }),

    replaceAll: async (data) => {
      assertBackupKeys(data);
      await write(ALL_STORES, false, async (tx) => {
        const local = await readSettings(tx);
        await all(DATA_STORES.map((name) => () => tx.objectStore(name).clear()));
        await all([
          ...(data.works ?? []).map((v) => () => tx.objectStore('works').put(v)),
          ...(data.manifests ?? []).map((v) => () => tx.objectStore('manifests').put(v)),
          ...(data.progress ?? []).map((v) => () => tx.objectStore('progress').put(v)),
          ...(data.redemptions ?? []).map((v) => () => tx.objectStore('redemptions').put(v)),
          ...(data.hints ?? []).map((v) => () => tx.objectStore('hints').put(v)),
          ...(data.sessions ?? []).map((v) => () => tx.objectStore('sessions').put(v)),
          ...(data.notes ?? []).map((v) => () => tx.objectStore('notes').put(v)),
          ...(data.pending ?? []).map((v) => () => tx.objectStore('pending').put(v)),
          ...(data.sealedOpens ?? []).map((v) => () => tx.objectStore('sealedOpens').put(v)),
        ]);
        await writeSettings(tx, settingsAfterReplace(local, data.settings));
      });
    },

    clearAll: () =>
      write(ALL_STORES, false, async (tx) => {
        await all(ALL_STORES.map((name) => () => tx.objectStore(name).clear()));
      }),
  };
  return repo;
}

/**
 * Deletes the whole database (used by 全データを消す). Connections opened by this module are closed
 * first; repositories using it reopen an empty database on their next call and their listeners fire.
 */
export async function deleteIdbDatabase(dbName: string = DB_PLAYER): Promise<void> {
  await deleteDatabase(dbName);
}
