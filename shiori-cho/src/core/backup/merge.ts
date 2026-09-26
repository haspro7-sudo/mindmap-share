// Merging a backup into local data (docs/SPEC.md §5.5 merge rules).
// Pure: the inputs are never mutated, and the result shares no objects with them.
//
// Output order: local records keep their order (merged in place) and new incoming records are appended
// in their own order. On a tie, the local record is kept, which makes mergeBackup(x, x) equal x.
import type {
  BackupDataV1,
  GoalProgress,
  HintReveal,
  MergeStats,
  Note,
  PendingCode,
  Redemption,
  SealedOpen,
  Session,
  WorkRecord,
} from '../types';

type HintTier = GoalProgress['hintTierAtDone'];

/** Collision-free key for compound primary keys such as ['workId', 'goalId']. */
function pairKey(a: string, b: string): string {
  return JSON.stringify([a, b]);
}

/**
 * Keyed union. Records of `local` come first (duplicate keys within it are folded with `resolve`), then
 * each incoming record is either folded into the record with its key or appended.
 * `added` counts the distinct incoming keys that local did not have.
 */
function unionBy<T>(
  local: readonly T[],
  incoming: readonly T[],
  keyOf: (r: T) => string,
  resolve: (current: T, candidate: T) => T,
): { records: T[]; added: number } {
  const records: T[] = [];
  const index = new Map<string, number>();
  const fold = (r: T): boolean => {
    const k = keyOf(r);
    const at = index.get(k);
    if (at === undefined) {
      index.set(k, records.length);
      records.push(r);
      return true;
    }
    records[at] = resolve(records[at]!, r);
    return false;
  };
  for (const r of local) fold(r);
  let added = 0;
  for (const r of incoming) if (fold(r)) added++;
  return { records, added };
}

// ───────────────────────── Per-store rules ─────────────────────────

/** works: the newer updatedAt wins as a whole record (including manifestKey); a tie keeps `current`. */
function newerWork(current: WorkRecord, candidate: WorkRecord): { work: WorkRecord; tookCandidate: boolean } {
  const tookCandidate = candidate.updatedAt > current.updatedAt;
  const [winner, other] = tookCandidate ? [candidate, current] : [current, candidate];
  // Derived timestamps stay truthful whichever side wins: sessions are unioned, so the last play is the
  // later of the two, and the work was first added at the earlier of the two.
  const work: WorkRecord = { ...winner, createdAt: Math.min(winner.createdAt, other.createdAt) };
  const lastPlayedAt = maxDefined(winner.lastPlayedAt, other.lastPlayedAt);
  if (lastPlayedAt !== undefined) work.lastPlayedAt = lastPlayedAt;
  return { work, tookCandidate };
}

function maxDefined(a: number | undefined, b: number | undefined): number | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return Math.max(a, b);
}

function minTier(a: HintTier, b: HintTier): HintTier {
  return a <= b ? a : b;
}

/** progress: earliest doneAt, 'code' beats 'manual', archived = AND, hintTierAtDone = minimum. */
function mergeProgress(current: GoalProgress, candidate: GoalProgress): GoalProgress {
  return {
    ...current,
    via: current.via === 'code' || candidate.via === 'code' ? 'code' : 'manual',
    doneAt: Math.min(current.doneAt, candidate.doneAt),
    hintTierAtDone: minTier(current.hintTierAtDone, candidate.hintTierAtDone),
    archived: current.archived && candidate.archived,
  };
}

/** redemptions: the earliest redemption is kept as a whole record. */
function earlierRedemption(current: Redemption, candidate: Redemption): Redemption {
  return candidate.redeemedAt < current.redeemedAt ? candidate : current;
}

/** hints: the highest revealed tier. */
function higherHint(current: HintReveal, candidate: HintReveal): HintReveal {
  return candidate.tier > current.tier ? candidate : current;
}

function isEnded(s: Session): boolean {
  return typeof s.endedAt === 'number';
}

/** sessions (same id): the ended one wins; otherwise the newer one (by endedAt, then startedAt). */
function preferredSession(current: Session, candidate: Session): Session {
  const currentEnded = isEnded(current);
  if (currentEnded !== isEnded(candidate)) return currentEnded ? current : candidate;
  const byEnd = (candidate.endedAt ?? 0) - (current.endedAt ?? 0);
  const newer = byEnd !== 0 ? byEnd > 0 : candidate.startedAt > current.startedAt;
  return newer ? candidate : current;
}

/** notes: the newer updatedAt wins. */
function newerNote(current: Note, candidate: Note): Note {
  return candidate.updatedAt > current.updatedAt ? candidate : current;
}

/** sealedOpens: earliest firstOpenedAt, seen is OR-ed. */
function mergeSealedOpen(current: SealedOpen, candidate: SealedOpen): SealedOpen {
  return {
    ...current,
    firstOpenedAt: Math.min(current.firstOpenedAt, candidate.firstOpenedAt),
    seen: current.seen || candidate.seen,
  };
}

/** pending: an incoming code is added only if neither its canonical form nor its id is already present. */
function mergePending(local: readonly PendingCode[], incoming: readonly PendingCode[]): PendingCode[] {
  const out = [...local];
  const canonicals = new Set(local.map((p) => p.canonical));
  const ids = new Set(local.map((p) => p.id));
  for (const p of incoming) {
    if (canonicals.has(p.canonical) || ids.has(p.id)) continue;
    canonicals.add(p.canonical);
    ids.add(p.id);
    out.push(p);
  }
  return out;
}

// ───────────────────────── Works and id remapping ─────────────────────────

interface WorksMerge {
  works: WorkRecord[];
  /** incoming work id → local work id, for works matched by manifestWorkId */
  idMap: Map<string, string>;
  worksAdded: number;
  worksUpdated: number;
  worksRemapped: number;
}

/**
 * works: matched by id. With no id match, an incoming work whose manifestWorkId equals a local work's is
 * merged into that local work, and its id is remapped to the local id.
 */
function mergeWorks(local: readonly WorkRecord[], incoming: readonly WorkRecord[]): WorksMerge {
  const works: WorkRecord[] = [];
  const byId = new Map<string, number>();
  const byManifestWorkId = new Map<string, number>();
  for (const w of local) {
    const at = byId.get(w.id);
    if (at !== undefined) {
      works[at] = newerWork(works[at]!, w).work;
      continue;
    }
    byId.set(w.id, works.length);
    if (w.manifestWorkId !== undefined && !byManifestWorkId.has(w.manifestWorkId)) {
      byManifestWorkId.set(w.manifestWorkId, works.length);
    }
    works.push(w);
  }
  const localCount = works.length;

  const idMap = new Map<string, string>();
  let worksAdded = 0;
  let worksUpdated = 0;
  let worksRemapped = 0;
  for (const w of incoming) {
    let at = byId.get(w.id);
    if (at === undefined && w.manifestWorkId !== undefined) {
      at = byManifestWorkId.get(w.manifestWorkId);
      if (at !== undefined) {
        idMap.set(w.id, works[at]!.id);
        worksRemapped++;
      }
    }
    if (at === undefined) {
      byId.set(w.id, works.length);
      works.push(w);
      worksAdded++;
      continue;
    }
    const current = works[at]!;
    const { work, tookCandidate } = newerWork(current, { ...w, id: current.id });
    works[at] = work;
    if (tookCandidate && at < localCount) worksUpdated++;
  }
  return { works, idMap, worksAdded, worksUpdated, worksRemapped };
}

function remapWorkIds<T extends { workId: string }>(records: readonly T[], idMap: ReadonlyMap<string, string>): T[] {
  if (idMap.size === 0) return [...records];
  return records.map((r) => {
    const to = idMap.get(r.workId);
    return to === undefined ? r : { ...r, workId: to };
  });
}

function withoutMaster(r: Redemption): Redemption {
  const { master: _master, masterSalt: _masterSalt, ...rest } = r;
  return rest;
}

// ───────────────────────── Entry point ─────────────────────────

/**
 * Merges `incoming` (a parsed backup) into `local` (the device's data) following docs/SPEC.md §5.5.
 * Settings are kept local. Incoming redemptions never carry cached masters.
 *
 * Stats: `worksAdded` counts incoming works that became new works; `worksRemapped` counts incoming works
 * matched to a local work by manifestWorkId; `worksUpdated` counts matched works (by id or remapped) whose
 * incoming record was newer and replaced the local fields. `progressAdded`, `sessionsAdded` and
 * `notesAdded` count incoming records whose key local did not have.
 */
export function mergeBackup(local: BackupDataV1, incoming: BackupDataV1): { merged: BackupDataV1; stats: MergeStats } {
  const w = mergeWorks(local.works, incoming.works);
  const remap = <T extends { workId: string }>(records: readonly T[]): T[] => remapWorkIds(records, w.idMap);

  const manifests = unionBy(local.manifests, remap(incoming.manifests), (m) => m.key, (current) => current);
  const progress = unionBy(local.progress, remap(incoming.progress), (p) => pairKey(p.workId, p.goalId), mergeProgress);
  const redemptions = unionBy(
    local.redemptions,
    remap(incoming.redemptions).map(withoutMaster),
    (r) => pairKey(r.workId, r.goalId),
    earlierRedemption,
  );
  const hints = unionBy(local.hints, remap(incoming.hints), (h) => pairKey(h.workId, h.goalId), higherHint);
  const sessions = unionBy(local.sessions, remap(incoming.sessions), (s) => s.id, preferredSession);
  const notes = unionBy(local.notes, remap(incoming.notes), (n) => n.id, newerNote);
  const sealedOpens = unionBy(
    local.sealedOpens,
    remap(incoming.sealedOpens),
    (o) => pairKey(o.workId, o.sealedId),
    mergeSealedOpen,
  );

  const merged: BackupDataV1 = structuredClone({
    works: w.works,
    manifests: manifests.records,
    progress: progress.records,
    redemptions: redemptions.records,
    hints: hints.records,
    sessions: sessions.records,
    notes: notes.records,
    pending: mergePending(local.pending, incoming.pending),
    sealedOpens: sealedOpens.records,
    settings: local.settings,
  });
  const stats: MergeStats = {
    worksAdded: w.worksAdded,
    worksUpdated: w.worksUpdated,
    worksRemapped: w.worksRemapped,
    progressAdded: progress.added,
    sessionsAdded: sessions.added,
    notesAdded: notes.added,
  };
  return { merged, stats };
}
