/**
 * Cross-record consistency of backup data (docs/SPEC.md §5.5, F15). Pure: the input is never mutated (async only
 * for SHA-256).
 *
 * The data schema (schema.ts) checks each record on its own. These are the rules between records that the rest
 * of the app relies on, enforced before data reaches replaceAll() (a restore, and the result of a merge):
 * - Every stored manifest passes validateManifest (a kdf when there are code goals, unique ids, no dangling
 *   references, …). A record that does not is dropped: its work becomes 記録だけ but keeps its manifestWorkId,
 *   so importing the genuine shiori.json again updates that work (bringing its progress back) instead of adding
 *   a second one.
 * - ManifestRecord.key is the key of its manifest (manifestKey). A wrong key is recomputed and the works that used
 *   it follow; otherwise the genuine file would be reported as 「読み込み済みです」 and could never repair it.
 * - A work's manifestKey names a record of that work, and its manifestWorkId is that manifest's work.id; its NEW
 *   badges and checkpoint refer to goals and checkpoints of that manifest.
 * - No two works share a manifestWorkId: a work with a usable manifest keeps it (the earliest added, if several);
 *   the others lose their manifest (their sessions and notes stay).
 * - Only the manifest records that a work uses are kept, and child records of works that do not exist are dropped
 *   (they could never be seen or deleted, yet would travel in every later backup).
 * - Progress is archived exactly for the goals missing from its work's manifest (§5.2 upgradeProgress).
 * - At most one session is open (F13 AC1): the latest start stays open, others are closed at their start with
 *   0 minutes.
 */
import { manifestKey, validateManifest } from '../manifest/validate';
import type { BackupDataV1, GoalProgress, ManifestRecord, Session, WorkRecord } from '../types';

export interface NormalizeReport {
  /** manifest records dropped because they fail validateManifest */
  invalidManifests: number;
  /** manifest records whose key was recomputed */
  rekeyedManifests: number;
  /** works that lost their manifest (record missing or invalid, or manifestWorkId used by another work) */
  detachedWorks: number;
  /** records dropped because no work uses them or their work does not exist */
  droppedRecords: number;
  /** progress records whose archive flag was corrected */
  archiveFlagsFixed: number;
  /** open sessions that were closed */
  closedSessions: number;
}

function byAdded(a: WorkRecord, b: WorkRecord): number {
  return a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

function detach(w: WorkRecord, keepManifestWorkId: boolean): void {
  delete w.manifestKey;
  if (!keepManifestWorkId) delete w.manifestWorkId;
  delete w.currentCheckpointId;
  w.newGoalIds = [];
}

function isOpen(s: Session): boolean {
  return typeof s.endedAt !== 'number';
}

/** Makes backup data consistent (see the module comment). Idempotent. */
export async function normalizeBackupData(input: BackupDataV1): Promise<{ data: BackupDataV1; report: NormalizeReport }> {
  const report: NormalizeReport = {
    invalidManifests: 0,
    rekeyedManifests: 0,
    detachedWorks: 0,
    droppedRecords: 0,
    archiveFlagsFixed: 0,
    closedSessions: 0,
  };
  const works = input.works.map((w) => ({ ...w, newGoalIds: [...w.newGoalIds] }));
  const workIds = new Set(works.map((w) => w.id));

  // Manifest records: valid ones only, under their true key (first record per key wins).
  const keyOf = new Map<string, string>();
  const records = new Map<string, ManifestRecord>();
  for (const rec of input.manifests) {
    if (!workIds.has(rec.workId)) {
      report.droppedRecords++;
      continue;
    }
    const v = validateManifest(rec.manifest);
    if (!v.ok) {
      report.invalidManifests++;
      continue;
    }
    const key = await manifestKey(v.manifest);
    if (key !== rec.key) report.rekeyedManifests++;
    if (!keyOf.has(rec.key)) keyOf.set(rec.key, key);
    if (!records.has(key)) records.set(key, { ...rec, key, manifest: v.manifest });
  }

  // Work → record pointers.
  const manifestOf = new Map<string, ManifestRecord>();
  for (const w of works) {
    if (w.manifestKey === undefined) continue;
    const key = keyOf.get(w.manifestKey);
    const rec = key === undefined ? undefined : records.get(key);
    if (!rec || rec.workId !== w.id) {
      detach(w, true);
      report.detachedWorks++;
      continue;
    }
    w.manifestKey = rec.key;
    w.manifestWorkId = rec.manifest.work.id;
    const goals = new Set(rec.manifest.goals.map((g) => g.id));
    w.newGoalIds = w.newGoalIds.filter((id) => goals.has(id));
    if (w.currentCheckpointId !== undefined && !rec.manifest.checkpoints.some((c) => c.id === w.currentCheckpointId)) {
      delete w.currentCheckpointId;
    }
    manifestOf.set(w.id, rec);
  }

  // One work per manifestWorkId: works with a manifest first, then the earliest added.
  const owner = new Map<string, WorkRecord>();
  const ordered = [...works].sort(byAdded);
  for (const withManifest of [true, false]) {
    for (const w of ordered) {
      if (w.manifestWorkId === undefined || manifestOf.has(w.id) !== withManifest) continue;
      if (!owner.has(w.manifestWorkId)) owner.set(w.manifestWorkId, w);
    }
  }
  for (const w of works) {
    if (w.manifestWorkId === undefined || owner.get(w.manifestWorkId) === w) continue;
    detach(w, false);
    manifestOf.delete(w.id);
    report.detachedWorks++;
  }

  const used = new Set([...manifestOf.values()].map((r) => r.key));
  const manifests = [...records.values()].filter((r) => used.has(r.key) && manifestOf.get(r.workId)?.key === r.key);
  report.droppedRecords += records.size - manifests.length;

  const own = <T extends { workId: string }>(rows: readonly T[]): T[] => {
    const kept = rows.filter((r) => workIds.has(r.workId));
    report.droppedRecords += rows.length - kept.length;
    return kept;
  };

  const progress = own(input.progress).map((p): GoalProgress => {
    const rec = manifestOf.get(p.workId);
    if (!rec) return p;
    const archived = !rec.manifest.goals.some((g) => g.id === p.goalId);
    if (archived === p.archived) return p;
    report.archiveFlagsFixed++;
    return { ...p, archived };
  });

  let sessions = own(input.sessions);
  const open = sessions.filter(isOpen);
  if (open.length > 1) {
    const keep = open.reduce((a, b) => (b.startedAt > a.startedAt || (b.startedAt === a.startedAt && b.id > a.id) ? b : a));
    sessions = sessions.map((s) => {
      if (!isOpen(s) || s === keep) return s;
      report.closedSessions++;
      return { ...s, endedAt: s.startedAt, minutes: 0 };
    });
  }

  const data: BackupDataV1 = {
    works,
    manifests,
    progress,
    redemptions: own(input.redemptions),
    hints: own(input.hints),
    sessions,
    notes: own(input.notes),
    pending: [...input.pending],
    sealedOpens: own(input.sealedOpens),
    settings: input.settings,
  };
  return { data, report };
}
