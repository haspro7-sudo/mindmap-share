/**
 * Connection management shared by the player and studio IndexedDB repositories.
 *
 * Every connection opened through `createManagedDb` is registered by database name, so that
 * `deleteDatabase(name)` can close them before deleting (otherwise the delete request would be
 * blocked by our own open connections). A managed connection reopens lazily on the next call
 * after it was closed, so a repository keeps working (on a fresh, empty database) after
 * 全データを消す, and it steps aside when another tab upgrades or deletes the database.
 */
import { deleteDB, openDB } from 'idb';
import type { DBSchema, IDBPDatabase, IDBPTransaction, StoreNames } from 'idb';
import { ShioriError, isShioriError } from '../core/errors';

export type UpgradeFn<T extends DBSchema> = (
  db: IDBPDatabase<T>,
  oldVersion: number,
  newVersion: number | null,
  tx: IDBPTransaction<T, StoreNames<T>[], 'versionchange'>,
) => void;

export interface ManagedDb<T extends DBSchema> {
  readonly name: string;
  /** The open connection (opened on first use, reopened after a close). */
  get(): Promise<IDBPDatabase<T>>;
}

function errorName(e: unknown): string {
  return typeof e === 'object' && e !== null && 'name' in e && typeof e.name === 'string' ? e.name : '';
}

/** Why a database could not be opened, as a ShioriError('io') with a Japanese message. */
export function openFailure(e: unknown): ShioriError {
  if (isShioriError(e)) return e;
  if (errorName(e) === 'VersionError') {
    return new ShioriError(
      'io',
      '新しいバージョンのしおり帳で保存されたデータです。ページを再読み込みしてください。',
      { cause: e },
    );
  }
  return new ShioriError(
    'io',
    'データの保存場所を開けませんでした。プライベートブラウズを解除するか、別のブラウザでお試しください。',
    { cause: e },
  );
}

/** Maps a full disk to ShioriError('io'); other errors pass through unchanged. */
export function storageFailure(e: unknown): unknown {
  if (errorName(e) === 'QuotaExceededError') {
    return new ShioriError('io', '端末の空き容量が足りないため保存できませんでした。', { cause: e });
  }
  return e;
}

interface Registration {
  close(): void;
  deleted(): void;
}

const registry = new Map<string, Set<Registration>>();

export function createManagedDb<T extends DBSchema>(opts: {
  name: string;
  version: number;
  upgrade: UpgradeFn<T>;
  /** called after the database was deleted through deleteDatabase() */
  onDeleted?: () => void;
}): ManagedDb<T> {
  let current: Promise<IDBPDatabase<T>> | null = null;

  const forget = (p: Promise<IDBPDatabase<T>>) => {
    if (current === p) current = null;
  };

  const registration: Registration = {
    close() {
      const p = current;
      current = null;
      if (p) {
        p.then(
          (db) => db.close(),
          () => undefined,
        );
      }
    },
    deleted() {
      opts.onDeleted?.();
    },
  };
  let set = registry.get(opts.name);
  if (!set) {
    set = new Set();
    registry.set(opts.name, set);
  }
  set.add(registration);

  return {
    name: opts.name,
    get() {
      if (current) return current;
      const p: Promise<IDBPDatabase<T>> = openDB<T>(opts.name, opts.version, {
        upgrade: (db, oldVersion, newVersion, tx) => opts.upgrade(db, oldVersion, newVersion, tx),
        // Another connection (another tab, or deleteDB) wants a version change: step aside.
        blocking: () => {
          forget(p);
          void p.then((db) => db.close());
        },
        terminated: () => forget(p),
      }).catch((e: unknown) => {
        throw openFailure(e);
      });
      current = p;
      p.catch(() => forget(p));
      return p;
    },
  };
}

/** Closes every connection this module opened for `name` (they reopen lazily on next use). */
export function closeConnections(name: string): void {
  for (const r of registry.get(name) ?? []) r.close();
}

/** Closes our connections to `name`, deletes the database, then notifies the repositories using it. */
export async function deleteDatabase(name: string): Promise<void> {
  closeConnections(name);
  await deleteDB(name);
  for (const r of [...(registry.get(name) ?? [])]) {
    try {
      r.deleted();
    } catch (e) {
      console.error('[shiori] database deletion listener failed', e);
    }
  }
}
