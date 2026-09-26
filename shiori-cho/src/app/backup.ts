// Backup & restore services (バックアップ). docs/SPEC.md F15, §5.5.
//
// Cached masters: repo.exportAll() strips Redemption.master/masterSalt, so a backup file never carries
// them. After a restore, redemptions that came from the file have no cached master and the unlock
// service re-derives it lazily from Redemption.canonical. As a shortcut, a redemption that this device
// already had with the same work, goal and code, while the work still uses the same stored manifest,
// keeps its local cached master (it is exactly what re-derivation would produce).
//
// A restore runs under the shared repository lock (repoLock.ts), so nothing written by another service can
// slip in between reading the local data and replacing it. The data is made consistent first
// (normalizeBackupData: valid manifests under their true keys, one open session, …), and afterwards the
// restored data is put to use like after an import (§5.2, F5 AC5): pending codes are tried against every
// manifest, and sealed extras that the restored redemptions satisfy are opened.
import { APP_VERSION, BACKUP_REMINDER_CHANGES, BACKUP_REMINDER_DAYS, BACKUP_REMINDER_SNOOZE_DAYS } from '../core/constants';
import { backupFileName, exportBackup, parseBackup } from '../core/backup/format';
import { normalizeBackupData } from '../core/backup/integrity';
import { mergeBackup } from '../core/backup/merge';
import type {
  BackupDataV1,
  MergeStats,
  ParseBackupResult,
  Redemption,
  Settings,
  UnlockOutcome,
  WorkRecord,
} from '../core/types';
import type { ShioriRepo } from '../storage/repo';
import { requestPersist } from './platform';
import { withRepoLock } from './repoLock';
import { evaluateSealedInLock, processPendingInLock } from './unlock';

export { backupErrorMessageJa, isEncryptedBackupText, isValidBackupPassphrase } from '../core/backup/format';

const DAY_MS = 86_400_000;

type BackupData = Extract<ParseBackupResult, { ok: true }>['data'];

/**
 * Serializes everything (encrypted when a passphrase is given; at least 8 characters, otherwise
 * ShioriError('validation') is thrown before anything changes). Then records the backup:
 * settings.lastBackupAt = now and changesSinceBackup = 0.
 * Returns the neutral file name 'shiori-backup-YYYYMMDD.json' (local date) and the file text.
 */
export async function exportBackupFile(
  repo: ShioriRepo,
  opts: { passphrase?: string; now?: number },
): Promise<{ filename: string; text: string }> {
  const now = opts.now ?? Date.now();
  const data = await repo.exportAll();
  const text = await exportBackup(data, { passphrase: opts.passphrase, appVersion: APP_VERSION, now });
  await repo.updateSettings({ lastBackupAt: now, changesSinceBackup: 0 });
  return { filename: backupFileName(now), text };
}

/**
 * Parses (decrypts, migrates, validates) a backup file. Never throws: failures come back as
 * { ok: false, error } ('json' | 'format' | 'version' | 'passphraseRequired' | 'passphrase' | 'schema');
 * backupErrorMessageJa(error) gives the Japanese message.
 */
export async function readBackupFile(text: string, passphrase?: string): Promise<ParseBackupResult> {
  try {
    return await parseBackup(text, passphrase);
  } catch {
    return { ok: false, error: 'json' };
  }
}

function pairKey(workId: string, goalId: string): string {
  return JSON.stringify([workId, goalId]);
}

/**
 * Re-attaches this device's cached masters to `next.redemptions` where the redemption is the same
 * (work, goal, canonical code) and the work still points at the same manifest record as locally
 * (same manifest ⇒ same kdf ⇒ same master). Everything else is left for lazy re-derivation.
 */
function keepCachedMasters(
  next: BackupDataV1,
  localWorks: readonly WorkRecord[],
  localRedemptions: readonly Redemption[],
): BackupDataV1 {
  const cached = new Map<string, Redemption>();
  for (const r of localRedemptions) {
    if (r.master !== undefined && r.masterSalt !== undefined) cached.set(pairKey(r.workId, r.goalId), r);
  }
  if (cached.size === 0) return next;
  const localManifestKey = new Map(localWorks.map((w) => [w.id, w.manifestKey] as const));
  const nextManifestKey = new Map(next.works.map((w) => [w.id, w.manifestKey] as const));

  const redemptions = next.redemptions.map((r): Redemption => {
    if (r.master !== undefined) return r;
    const local = cached.get(pairKey(r.workId, r.goalId));
    if (!local || local.canonical !== r.canonical) return r;
    const key = nextManifestKey.get(r.workId);
    if (key === undefined || key !== localManifestKey.get(r.workId)) return r;
    return { ...r, master: local.master, masterSalt: local.masterSalt };
  });
  return { ...next, redemptions };
}

/** What a restore did, beyond replacing the data (for the toast and the envelope queue). */
export interface RestoreResult {
  /** merge stats ('merge'), or null ('replace') */
  stats: MergeStats | null;
  /** pending codes that matched a manifest after the restore ('unlocked' or 'already'), as processPending returns them */
  pendingOutcomes: UnlockOutcome[];
  /**
   * sealed extras opened after the restore (by those codes, or by redemptions merged from both devices).
   * They are stored with seen: false, so the work's おまけ tab plays them even if nobody queues them.
   */
  openedSealed: { workId: string; sealedId: string }[];
  /** open sessions that were closed because only one session may be open app-wide */
  closedSessionIds: string[];
}

/**
 * Applies a parsed backup (see the module comment), returning what happened.
 * - 'replace': the file's data replaces all local data (repo.replaceAll keeps the PIN, the age flag and other
 *   local-only settings; discreet/autoLockSec/camouflageText come from the file).
 * - 'merge': mergeBackup(local, incoming) per §5.5, then replaceAll(merged) with the LOCAL settings subset.
 *   The backup counter (changesSinceBackup) is kept as it was, since the merged data is in no single backup.
 * The pending codes and sealed extras processed afterwards are derived from the restored data, so they do not
 * count as changes either.
 */
export function restoreBackup(
  repo: ShioriRepo,
  data: BackupData,
  mode: 'replace' | 'merge',
  opts: { now?: number } = {},
): Promise<RestoreResult> {
  if (mode !== 'replace' && mode !== 'merge') return Promise.reject(new TypeError(`applyBackup: unknown mode ${String(mode)}`));
  return withRepoLock(repo, async () => {
    const now = opts.now ?? Date.now();
    const [localWorks, localRedemptions] = await Promise.all([repo.listWorks(), repo.listRedemptions()]);
    const before = await repo.getSettings();
    const incoming = (await normalizeBackupData(data)).data;

    let stats: MergeStats | null = null;
    let next: BackupDataV1;
    let wasOpen: string[];
    if (mode === 'replace') {
      next = incoming;
      wasOpen = data.sessions.filter((x) => typeof x.endedAt !== 'number').map((x) => x.id);
    } else {
      const local = (await normalizeBackupData(await repo.exportAll())).data;
      const merged = mergeBackup(local, incoming);
      stats = merged.stats;
      next = (await normalizeBackupData({ ...merged.merged, settings: local.settings })).data;
      wasOpen = [...local.sessions, ...incoming.sessions].filter((x) => typeof x.endedAt !== 'number').map((x) => x.id);
    }
    const stillOpen = new Set(next.sessions.filter((x) => typeof x.endedAt !== 'number').map((x) => x.id));
    const closedSessionIds = [...new Set(wasOpen)].filter((id) => !stillOpen.has(id) && next.sessions.some((x) => x.id === id));

    await repo.replaceAll(keepCachedMasters(next, localWorks, localRedemptions));
    const counter = mode === 'merge' ? before.changesSinceBackup : 0;

    // Put the restored data to use, as after an import.
    const pendingOutcomes = await processPendingInLock(repo, now);
    const openedSealed: RestoreResult['openedSealed'] = [];
    const seen = new Set<string>();
    const add = (workId: string, sealedId: string) => {
      const k = JSON.stringify([workId, sealedId]);
      if (seen.has(k)) return;
      seen.add(k);
      openedSealed.push({ workId, sealedId });
    };
    for (const o of pendingOutcomes) if (o.workId !== undefined) for (const id of o.openedSealedIds) add(o.workId, id);
    for (const w of await repo.listWorks()) {
      if (!w.manifestKey) continue;
      for (const id of await evaluateSealedInLock(repo, w.id, now)) add(w.id, id);
    }
    if ((await repo.getSettings()).changesSinceBackup !== counter) await repo.updateSettings({ changesSinceBackup: counter });
    return { stats, pendingOutcomes, openedSealed, closedSessionIds };
  });
}

/**
 * Applies a parsed backup and returns the merge stats ('merge') or null ('replace'). Same as restoreBackup,
 * for callers that only need the stats (the sealed extras it opens are listed as unseen on their works).
 */
export async function applyBackup(repo: ShioriRepo, data: BackupData, mode: 'replace' | 'merge'): Promise<MergeStats | null> {
  return (await restoreBackup(repo, data, mode)).stats;
}

/**
 * true when the backup reminder banner should show (F15 AC5):
 * there is data, the reminder is not snoozed (now ≥ backupReminderSnoozedUntil), and either
 * changesSinceBackup ≥ 20 (also when no backup was ever made) or the last backup is more than 30 days old.
 */
export function shouldRemindBackup(settings: Settings, hasData: boolean, now: number): boolean {
  if (!hasData) return false;
  if (now < (settings.backupReminderSnoozedUntil ?? 0)) return false;
  if (settings.changesSinceBackup >= BACKUP_REMINDER_CHANGES) return true;
  if (settings.lastBackupAt === undefined) return false;
  return now - settings.lastBackupAt > BACKUP_REMINDER_DAYS * DAY_MS;
}

/** 「あとで」: hides the reminder for 7 days. */
export async function snoozeBackupReminder(repo: ShioriRepo, now: number = Date.now()): Promise<Settings> {
  return repo.updateSettings({ backupReminderSnoozedUntil: now + BACKUP_REMINDER_SNOOZE_DAYS * DAY_MS });
}

/** Whether there is anything worth backing up (a work or a pending code). */
export async function hasBackupData(repo: ShioriRepo): Promise<boolean> {
  const [works, pending] = await Promise.all([repo.listWorks(), repo.listPending()]);
  return works.length > 0 || pending.length > 0;
}

/**
 * Asks the browser to keep the data (navigator.storage.persist(), F15 AC4) and records the answer in
 * settings.persist = { requestedAt, granted }. Returns whether storage is persistent. Never throws.
 */
export async function requestPersistentStorage(
  repo: ShioriRepo,
  now: number = Date.now(),
  request: () => Promise<boolean> = requestPersist,
): Promise<boolean> {
  let granted = false;
  try {
    granted = await request();
  } catch {
    granted = false;
  }
  try {
    await repo.updateSettings({ persist: { requestedAt: now, granted } });
  } catch {
    // Recording the answer is best-effort; the result is still returned.
  }
  return granted;
}
