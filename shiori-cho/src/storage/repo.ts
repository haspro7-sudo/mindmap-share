/** CONTRACT: repository interfaces (docs/SPEC.md §5.3–5.4). */
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

export interface ShioriRepo {
  /** fired after every committed mutation (including updateSettings) */
  subscribe(listener: () => void): () => void;
  /** returns DEFAULT_SETTINGS merged if absent */
  getSettings(): Promise<Settings>;
  updateSettings(patch: Partial<Settings>): Promise<Settings>;
  listWorks(): Promise<WorkRecord[]>;
  getWork(id: string): Promise<WorkRecord | undefined>;
  findWorkByManifestWorkId(manifestWorkId: string): Promise<WorkRecord | undefined>;
  putWork(w: WorkRecord): Promise<void>;
  /** cascades to all child stores + manifests */
  deleteWork(id: string): Promise<void>;
  getManifest(key: string): Promise<ManifestRecord | undefined>;
  listManifests(workId?: string): Promise<ManifestRecord[]>;
  putManifest(m: ManifestRecord): Promise<void>;
  deleteManifest(key: string): Promise<void>;
  listProgress(workId: string): Promise<GoalProgress[]>;
  putProgress(p: GoalProgress): Promise<void>;
  deleteProgress(workId: string, goalId: string): Promise<void>;
  listRedemptions(workId?: string): Promise<Redemption[]>;
  putRedemption(r: Redemption): Promise<void>;
  /**
   * Cache-only write: sets (or, with `cache` undefined, removes) Redemption.master/masterSalt of the stored
   * redemption [workId, goalId], but only while its canonical code is still `canonical`. Nothing else changes,
   * and nothing is written when the row is gone (so a cache refresh never re-creates a deleted work's code).
   * Not counted in changesSinceBackup: the cache is never exported. Listeners fire only when a row changed.
   */
  putRedemptionCache(
    workId: string,
    goalId: string,
    canonical: string,
    cache: { master: string; masterSalt: string } | undefined,
  ): Promise<void>;
  listHints(workId: string): Promise<HintReveal[]>;
  putHint(h: HintReveal): Promise<void>;
  deleteHint(workId: string, goalId: string): Promise<void>;
  /** sorted startedAt desc */
  listSessions(workId?: string): Promise<Session[]>;
  putSession(s: Session): Promise<void>;
  deleteSession(id: string): Promise<void>;
  getOpenSession(): Promise<Session | undefined>;
  listNotes(workId: string): Promise<Note[]>;
  putNote(n: Note): Promise<void>;
  deleteNote(id: string): Promise<void>;
  listPending(): Promise<PendingCode[]>;
  putPending(p: PendingCode): Promise<void>;
  deletePending(id: string): Promise<void>;
  listSealedOpens(workId: string): Promise<SealedOpen[]>;
  putSealedOpen(o: SealedOpen): Promise<void>;
  /** strips Redemption.master/masterSalt; settings subset only (no pin, ageConfirmedAt, onboardedAt) */
  exportAll(): Promise<BackupDataV1>;
  /** preserves pin, ageConfirmedAt, onboardedAt (and other local-only settings); takes discreet/autoLockSec/camouflageText from data */
  replaceAll(data: BackupDataV1): Promise<void>;
  /** deletes everything including settings */
  clearAll(): Promise<void>;
}

export interface StudioRepo {
  subscribe(listener: () => void): () => void;
  list(): Promise<StudioProject[]>;
  get(id: string): Promise<StudioProject | undefined>;
  put(p: StudioProject): Promise<void>;
  delete(id: string): Promise<void>;
  clearAll(): Promise<void>;
}
