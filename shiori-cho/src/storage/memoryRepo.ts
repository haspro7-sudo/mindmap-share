// In-memory ShioriRepo/StudioRepo (used in tests and the studio preview). Deep-copies on read/write.
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
  StudioProject,
  WorkRecord,
} from '../core/types';
import type { ShioriRepo, StudioRepo } from './repo';
import {
  KEY_FIELDS,
  ORDER,
  applySettingsPatch,
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

const clone = <T>(v: T): T => structuredClone(v);

/** Map key for compound primary keys [a, b]. */
const pair = (a: string, b: string): string => JSON.stringify([a, b]);

interface Tables {
  works: Map<string, WorkRecord>;
  manifests: Map<string, ManifestRecord>;
  progress: Map<string, GoalProgress>;
  redemptions: Map<string, Redemption>;
  hints: Map<string, HintReveal>;
  sessions: Map<string, Session>;
  notes: Map<string, Note>;
  pending: Map<string, PendingCode>;
  sealedOpens: Map<string, SealedOpen>;
}

/** Builds tables from backup-shaped rows (deep-copied). Keys must be validated first. */
function buildTables(data: Partial<BackupDataV1>): Tables {
  const index = <T>(rows: T[] | undefined, key: (v: T) => string): Map<string, T> =>
    new Map((rows ?? []).map((v) => [key(v), clone(v)]));
  return {
    works: index(data.works, (w) => w.id),
    manifests: index(data.manifests, (m) => m.key),
    progress: index(data.progress, (p) => pair(p.workId, p.goalId)),
    redemptions: index(data.redemptions, (r) => pair(r.workId, r.goalId)),
    hints: index(data.hints, (h) => pair(h.workId, h.goalId)),
    sessions: index(data.sessions, (s) => s.id),
    notes: index(data.notes, (n) => n.id),
    pending: index(data.pending, (p) => p.id),
    sealedOpens: index(data.sealedOpens, (o) => pair(o.workId, o.sealedId)),
  };
}

/** Deep copies of the matching rows, in the shared list order. */
function rows<T>(table: Map<string, T>, order: (a: T, b: T) => number, filter?: (v: T) => boolean): T[] {
  const out: T[] = [];
  for (const v of table.values()) if (!filter || filter(v)) out.push(clone(v));
  return out.sort(order);
}

function deleteWhere<T>(table: Map<string, T>, pred: (v: T) => boolean): void {
  for (const [k, v] of table) if (pred(v)) table.delete(k);
}

export type MemoryRepoSeed = Partial<BackupDataV1> & { fullSettings?: Partial<Settings> };

/**
 * Creates an in-memory repository. `seed` pre-fills the stores (e.g. the studio preview seeds
 * the built manifest); `seed.settings` sets the backup subset and `seed.fullSettings` any
 * other setting (applied last, with updateSettings semantics). Seeding counts as no change.
 */
export function createMemoryRepo(seed?: MemoryRepoSeed): ShioriRepo {
  if (seed) assertBackupKeys(seed);
  let t: Tables = buildTables(seed ?? {});
  /** undefined = nothing stored (getSettings returns the defaults) */
  let settings: Settings | undefined;
  if (seed?.settings) settings = settingsAfterReplace(normalizeSettings(undefined), seed.settings);
  if (seed?.fullSettings) settings = applySettingsPatch(normalizeSettings(settings), seed.fullSettings);

  const emitter = createEmitter('shiori:memory');

  /**
   * Runs a synchronous mutation atomically: validation happens before `apply` touches anything,
   * the change counter is bumped together with it, and listeners fire once afterwards.
   */
  function mutate(bump: boolean, apply: () => void): void {
    apply();
    if (bump) {
      const s = normalizeSettings(settings);
      s.changesSinceBackup += 1;
      settings = s;
    }
    emitter.emit();
  }

  const repo: ShioriRepo = {
    subscribe: (listener) => emitter.subscribe(listener),

    // ── settings ──
    getSettings: async () => normalizeSettings(settings),
    updateSettings: async (patch) => {
      const next = applySettingsPatch(normalizeSettings(settings), patch);
      mutate(false, () => {
        settings = next;
      });
      return clone(next);
    },

    // ── works ──
    listWorks: async () => rows(t.works, ORDER.works),
    getWork: async (id) => clone(t.works.get(id)),
    findWorkByManifestWorkId: async (manifestWorkId) =>
      rows(t.works, ORDER.works, (w) => w.manifestWorkId === manifestWorkId)[0],
    putWork: async (w) => {
      assertKeys(w, KEY_FIELDS.works, 'putWork');
      const v = clone(w);
      mutate(true, () => t.works.set(v.id, v));
    },
    deleteWork: async (id) => {
      mutate(true, () => {
        t.works.delete(id);
        const mine = (v: { workId: string }) => v.workId === id;
        deleteWhere(t.manifests, mine);
        deleteWhere(t.progress, mine);
        deleteWhere(t.redemptions, mine);
        deleteWhere(t.hints, mine);
        deleteWhere(t.sessions, mine);
        deleteWhere(t.notes, mine);
        deleteWhere(t.sealedOpens, mine);
      });
    },

    // ── manifests ──
    getManifest: async (key) => clone(t.manifests.get(key)),
    listManifests: async (workId) =>
      rows(t.manifests, ORDER.manifests, workId === undefined ? undefined : (m) => m.workId === workId),
    putManifest: async (m) => {
      assertKeys(m, KEY_FIELDS.manifests, 'putManifest');
      const v = clone(m);
      mutate(true, () => t.manifests.set(v.key, v));
    },
    deleteManifest: async (key) => {
      mutate(true, () => t.manifests.delete(key));
    },

    // ── progress ──
    listProgress: async (workId) => rows(t.progress, ORDER.progress, (p) => p.workId === workId),
    putProgress: async (p) => {
      assertKeys(p, KEY_FIELDS.progress, 'putProgress');
      const v = clone(p);
      mutate(true, () => t.progress.set(pair(v.workId, v.goalId), v));
    },
    deleteProgress: async (workId, goalId) => {
      mutate(true, () => t.progress.delete(pair(workId, goalId)));
    },

    // ── redemptions ──
    listRedemptions: async (workId) =>
      rows(t.redemptions, ORDER.redemptions, workId === undefined ? undefined : (r) => r.workId === workId),
    putRedemption: async (r) => {
      assertKeys(r, KEY_FIELDS.redemptions, 'putRedemption');
      const v = clone(r);
      mutate(true, () => t.redemptions.set(pair(v.workId, v.goalId), v));
    },
    putRedemptionCache: async (workId, goalId, canonical, cache) => {
      if (typeof workId !== 'string' || typeof goalId !== 'string') return;
      const k = pair(workId, goalId);
      const current = t.redemptions.get(k);
      if (!current || current.canonical !== canonical) return;
      const next = withRedemptionCache(current, cache);
      if (next === current) return;
      mutate(false, () => t.redemptions.set(k, next));
    },

    // ── hints ──
    listHints: async (workId) => rows(t.hints, ORDER.hints, (h) => h.workId === workId),
    putHint: async (h) => {
      assertKeys(h, KEY_FIELDS.hints, 'putHint');
      const v = clone(h);
      mutate(true, () => t.hints.set(pair(v.workId, v.goalId), v));
    },
    deleteHint: async (workId, goalId) => {
      mutate(true, () => t.hints.delete(pair(workId, goalId)));
    },

    // ── sessions ──
    listSessions: async (workId) =>
      rows(t.sessions, ORDER.sessions, workId === undefined ? undefined : (s) => s.workId === workId),
    putSession: async (s) => {
      assertKeys(s, KEY_FIELDS.sessions, 'putSession');
      const v = clone(s);
      mutate(true, () => t.sessions.set(v.id, v));
    },
    deleteSession: async (id) => {
      mutate(true, () => t.sessions.delete(id));
    },
    getOpenSession: async () => rows(t.sessions, ORDER.sessions, isOpenSession)[0],

    // ── notes ──
    listNotes: async (workId) => rows(t.notes, ORDER.notes, (n) => n.workId === workId),
    putNote: async (n) => {
      assertKeys(n, KEY_FIELDS.notes, 'putNote');
      const v = clone(n);
      mutate(true, () => t.notes.set(v.id, v));
    },
    deleteNote: async (id) => {
      mutate(true, () => t.notes.delete(id));
    },

    // ── pending (not counted as a change) ──
    listPending: async () => rows(t.pending, ORDER.pending),
    putPending: async (p) => {
      assertKeys(p, KEY_FIELDS.pending, 'putPending');
      const v = clone(p);
      mutate(false, () => t.pending.set(v.id, v));
    },
    deletePending: async (id) => {
      mutate(false, () => t.pending.delete(id));
    },

    // ── sealed opens ──
    listSealedOpens: async (workId) => rows(t.sealedOpens, ORDER.sealedOpens, (o) => o.workId === workId),
    putSealedOpen: async (o) => {
      assertKeys(o, KEY_FIELDS.sealedOpens, 'putSealedOpen');
      const v = clone(o);
      mutate(true, () => t.sealedOpens.set(pair(v.workId, v.sealedId), v));
    },

    // ── backup ──
    exportAll: async () => ({
      works: rows(t.works, ORDER.works),
      manifests: rows(t.manifests, ORDER.manifests),
      progress: rows(t.progress, ORDER.progress),
      redemptions: rows(t.redemptions, ORDER.redemptions).map(stripRedemption),
      hints: rows(t.hints, ORDER.hints),
      sessions: rows(t.sessions, ORDER.sessions),
      notes: rows(t.notes, ORDER.notes),
      pending: rows(t.pending, ORDER.pending),
      sealedOpens: rows(t.sealedOpens, ORDER.sealedOpens),
      settings: backupSettingsOf(normalizeSettings(settings)),
    }),
    replaceAll: async (data) => {
      assertBackupKeys(data);
      const nextTables = buildTables(data);
      const nextSettings = settingsAfterReplace(normalizeSettings(settings), data.settings);
      mutate(false, () => {
        t = nextTables;
        settings = nextSettings;
      });
    },
    clearAll: async () => {
      mutate(false, () => {
        t = buildTables({});
        settings = undefined;
      });
    },
  };
  return repo;
}

/** In-memory StudioRepo (projects keyed by id, listed updatedAt desc). */
export function createMemoryStudioRepo(): StudioRepo {
  let projects = new Map<string, StudioProject>();
  const emitter = createEmitter('shiori:memory-studio');

  const mutate = (apply: () => void) => {
    apply();
    emitter.emit();
  };

  return {
    subscribe: (listener) => emitter.subscribe(listener),
    list: async () => rows(projects, ORDER.projects),
    get: async (id) => clone(projects.get(id)),
    put: async (p) => {
      assertKeys(p, ['id'], 'put');
      const v = clone(p);
      mutate(() => projects.set(v.id, v));
    },
    delete: async (id) => {
      mutate(() => projects.delete(id));
    },
    clearAll: async () => {
      mutate(() => {
        projects = new Map();
      });
    },
  };
}
