/**
 * Helpers shared by the memory and IndexedDB repositories so that both implementations
 * behave identically (settings merging, backup subsets, list ordering, change listeners).
 */
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
  StudioProject,
  WorkRecord,
} from '../core/types';

// ───────────────────────── Settings ─────────────────────────

/** Keys that must always be present on a Settings object (undefined in a patch keeps the current value). */
const REQUIRED_SETTINGS_KEYS: ReadonlySet<string> = new Set([
  'schemaVersion',
  'discreet',
  'camouflageText',
  'autoLockSec',
  'pinFailures',
  'changesSinceBackup',
  'completionPromptedWorkIds',
]);

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Copies an object without the keys whose value is `undefined`. */
function withoutUndefined(o: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined) out[k] = v;
  return out;
}

/**
 * DEFAULT_SETTINGS deep-merged with a stored (possibly partial or absent) record.
 * `discreet` is merged key-wise; `completionPromptedWorkIds` defaults to [].
 * Always returns a fresh object that shares nothing with the input or DEFAULT_SETTINGS.
 */
export function normalizeSettings(stored?: unknown): Settings {
  const s = isRecord(stored) ? withoutUndefined(structuredClone(stored)) : {};
  const discreet: DiscreetSettings = {
    ...DEFAULT_SETTINGS.discreet,
    ...(isRecord(s.discreet) ? (withoutUndefined(s.discreet) as Partial<DiscreetSettings>) : {}),
  };
  const prompted = Array.isArray(s.completionPromptedWorkIds)
    ? (s.completionPromptedWorkIds as string[])
    : [...DEFAULT_SETTINGS.completionPromptedWorkIds];
  return {
    ...DEFAULT_SETTINGS,
    ...(s as Partial<Settings>),
    discreet,
    completionPromptedWorkIds: prompted,
  };
}

/**
 * Applies an updateSettings patch: shallow merge, `discreet` merged key-wise.
 * An explicit `undefined` removes an optional key (e.g. `{ pin: undefined }` clears the PIN);
 * for required keys it keeps the current value.
 */
export function applySettingsPatch(current: Settings, patch: Partial<Settings>): Settings {
  const next: Record<string, unknown> = { ...current };
  for (const [k, v] of Object.entries(patch)) {
    if (k === 'discreet') {
      if (isRecord(v)) next.discreet = { ...current.discreet, ...withoutUndefined(v) };
      continue;
    }
    if (v === undefined) {
      if (!REQUIRED_SETTINGS_KEYS.has(k)) delete next[k];
      continue;
    }
    next[k] = v;
  }
  return normalizeSettings(next);
}

/** The settings subset that goes into a backup (never the PIN, age flag or other local state). */
export function backupSettingsOf(s: Settings): BackupDataV1['settings'] {
  return {
    discreet: { ...s.discreet },
    autoLockSec: s.autoLockSec,
    camouflageText: s.camouflageText,
  };
}

/**
 * Settings after replaceAll: everything local is kept (pin, ageConfirmedAt, onboardedAt, pinFailures,
 * pinCooldownUntil, persist, lastBackupAt, …), discreet/autoLockSec/camouflageText come from the backup,
 * and changesSinceBackup restarts at 0.
 */
export function settingsAfterReplace(local: Settings, incoming: BackupDataV1['settings'] | undefined): Settings {
  const next: Record<string, unknown> = { ...local, changesSinceBackup: 0 };
  if (isRecord(incoming)) {
    // Missing discreet keys fall back to the defaults (not to the local values): the backup wins.
    if (isRecord(incoming.discreet)) next.discreet = withoutUndefined(incoming.discreet);
    if (incoming.autoLockSec !== undefined) next.autoLockSec = incoming.autoLockSec;
    if (incoming.camouflageText !== undefined) next.camouflageText = incoming.camouflageText;
  }
  return normalizeSettings(next);
}

// ───────────────────────── Records ─────────────────────────

/** A copy of a redemption without the cached master key (never exported). */
export function stripRedemption(r: Redemption): Redemption {
  const { master: _master, masterSalt: _masterSalt, ...rest } = r;
  return structuredClone(rest);
}

/**
 * The redemption with its cached master set to `cache` (or removed when undefined). Returns `r` itself when
 * nothing would change, so callers can skip the write. Never touches the other fields.
 */
export function withRedemptionCache(
  r: Redemption,
  cache: { master: string; masterSalt: string } | undefined,
): Redemption {
  if (cache === undefined) {
    if (r.master === undefined && r.masterSalt === undefined) return r;
    const { master: _master, masterSalt: _masterSalt, ...rest } = r;
    return rest;
  }
  if (r.master === cache.master && r.masterSalt === cache.masterSalt) return r;
  return { ...r, master: cache.master, masterSalt: cache.masterSalt };
}

/** Throws a TypeError unless every named field is a string (usable as an IndexedDB key part). */
export function assertKeys(value: unknown, fields: readonly string[], what: string): void {
  if (!isRecord(value)) throw new TypeError(`${what}: record must be an object`);
  for (const f of fields) {
    if (typeof value[f] !== 'string') throw new TypeError(`${what}: "${f}" must be a string key`);
  }
}

type DataStoreName = Exclude<keyof BackupDataV1, 'settings'>;

/** Fields that must be string keys, per store (primary key parts plus the workId used for cascades). */
export const KEY_FIELDS: { readonly [K in DataStoreName]: readonly string[] } = {
  works: ['id'],
  manifests: ['key', 'workId'],
  progress: ['workId', 'goalId'],
  redemptions: ['workId', 'goalId'],
  hints: ['workId', 'goalId'],
  sessions: ['id', 'workId'],
  notes: ['id', 'workId'],
  pending: ['id'],
  sealedOpens: ['workId', 'sealedId'],
};

/** Validates the keys of every record before anything is written (replaceAll / seeding stay atomic). */
export function assertBackupKeys(data: Partial<BackupDataV1>): void {
  for (const name of Object.keys(KEY_FIELDS) as DataStoreName[]) {
    const rows: unknown = data[name];
    if (rows === undefined) continue;
    if (!Array.isArray(rows)) throw new TypeError(`${name}: must be an array`);
    rows.forEach((row, i) => assertKeys(row, KEY_FIELDS[name], `${name}[${i}]`));
  }
}

// ───────────────────────── Ordering (identical in every implementation) ─────────────────────────

/** Code-unit string comparison (the order IndexedDB uses for string keys). */
export function cmpStr(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function cmpNum(a: number | undefined, b: number | undefined): number {
  return (a ?? 0) - (b ?? 0);
}

export const ORDER = {
  /** createdAt asc (追加順), then id */
  works: (a: WorkRecord, b: WorkRecord) => cmpNum(a.createdAt, b.createdAt) || cmpStr(a.id, b.id),
  /** importedAt asc, then key */
  manifests: (a: ManifestRecord, b: ManifestRecord) =>
    cmpNum(a.importedAt, b.importedAt) || cmpStr(a.key, b.key),
  /** primary key order: workId, goalId */
  progress: (a: GoalProgress, b: GoalProgress) => cmpStr(a.workId, b.workId) || cmpStr(a.goalId, b.goalId),
  redemptions: (a: Redemption, b: Redemption) => cmpStr(a.workId, b.workId) || cmpStr(a.goalId, b.goalId),
  hints: (a: HintReveal, b: HintReveal) => cmpStr(a.workId, b.workId) || cmpStr(a.goalId, b.goalId),
  /** startedAt desc, then id desc (the order of a 'prev' cursor on the startedAt index) */
  sessions: (a: Session, b: Session) => cmpNum(b.startedAt, a.startedAt) || cmpStr(b.id, a.id),
  /** most recently edited first, then id */
  notes: (a: Note, b: Note) => cmpNum(b.updatedAt, a.updatedAt) || cmpStr(a.id, b.id),
  /** oldest first (processing order), then id */
  pending: (a: PendingCode, b: PendingCode) => cmpNum(a.receivedAt, b.receivedAt) || cmpStr(a.id, b.id),
  /** primary key order: workId, sealedId */
  sealedOpens: (a: SealedOpen, b: SealedOpen) => cmpStr(a.workId, b.workId) || cmpStr(a.sealedId, b.sealedId),
  /** updatedAt desc, then id */
  projects: (a: StudioProject, b: StudioProject) => cmpNum(b.updatedAt, a.updatedAt) || cmpStr(a.id, b.id),
} as const;

/** Sessions without endedAt are open; the latest one (in list order) wins. */
export function isOpenSession(s: Session): boolean {
  return s.endedAt === undefined || s.endedAt === null;
}

// ───────────────────────── Change listeners ─────────────────────────

export interface Emitter {
  subscribe(listener: () => void): () => void;
  /** Calls every current listener; a throwing listener is logged and never breaks the caller. */
  emit(): void;
}

export function createEmitter(label: string): Emitter {
  // One entry per subscription, so the same function subscribed twice is called twice
  // and each unsubscribe removes only its own subscription.
  const entries = new Set<{ listener: () => void }>();
  return {
    subscribe(listener) {
      const entry = { listener };
      entries.add(entry);
      return () => {
        entries.delete(entry);
      };
    },
    emit() {
      for (const entry of [...entries]) {
        // Skip listeners removed by an earlier listener during this round.
        if (!entries.has(entry)) continue;
        try {
          entry.listener();
        } catch (e) {
          console.error(`[${label}] change listener failed`, e);
        }
      }
    },
  };
}
