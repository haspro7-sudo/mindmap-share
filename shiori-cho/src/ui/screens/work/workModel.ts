// Data loading and pure view helpers for the work page (#/w/<id>) and 作品設定.
// Everything is read through the repository in context (IdbRepo in the app, MemoryRepo in the studio preview).
import { useEffect, useState } from 'react';
import { withRepoLock } from '../../../app/repoLock';
import { decryptGoalSecrets, evaluateSealed, isCodeGoal } from '../../../app/unlock';
import { SESSION_MAX_MINUTES } from '../../../core/constants';
import { isShioriError } from '../../../core/errors';
import type {
  Goal,
  GoalProgress,
  GoalSecret,
  HintReveal,
  ManifestSource,
  Note,
  SealedItem,
  SealedOpen,
  Session,
  ShioriManifestV1,
  SpoilerLevel,
  WorkRecord,
} from '../../../core/types';
import type { ShioriRepo } from '../../../storage/repo';
import { useRepo, useRepoQuery } from '../../context';
import type { RepoQuery } from '../../context';

export interface WorkData {
  work: WorkRecord;
  manifest?: ShioriManifestV1;
  source?: ManifestSource;
  /** all progress records of the work (archived ones included) */
  progress: GoalProgress[];
  hints: HintReveal[];
  /** goal ids that have a Redemption (entered with a code) */
  redeemedGoalIds: string[];
  sealedOpens: SealedOpen[];
  /** this work's sessions, startedAt desc */
  sessions: Session[];
  /** the app-wide open session (may belong to another work) */
  openSession?: Session;
  notes: Note[];
}

/** Loads everything the work page needs; `null` when the work does not exist. */
export async function loadWorkData(repo: ShioriRepo, workId: string): Promise<WorkData | null> {
  const work = await repo.getWork(workId);
  if (!work) return null;
  const [record, progress, hints, redemptions, sealedOpens, sessions, openSession, notes] = await Promise.all([
    work.manifestKey ? repo.getManifest(work.manifestKey) : Promise.resolve(undefined),
    repo.listProgress(workId),
    repo.listHints(workId),
    repo.listRedemptions(workId),
    repo.listSealedOpens(workId),
    repo.listSessions(workId),
    repo.getOpenSession(),
    repo.listNotes(workId),
  ]);
  const data: WorkData = {
    work,
    progress,
    hints,
    redeemedGoalIds: redemptions.map((r) => r.goalId),
    sealedOpens,
    sessions,
    notes,
  };
  if (record) {
    data.manifest = record.manifest;
    data.source = record.source;
  }
  if (openSession) data.openSession = openSession;
  return data;
}

export function useWorkData(workId: string): RepoQuery<WorkData | null> {
  return useRepoQuery((repo) => loadWorkData(repo, workId), [workId]);
}

/**
 * goalId → decrypted GoalSecret for redeemed code goals. Never persisted; a failure yields an empty map.
 * The maps have no prototype (goal ids such as 'constructor' are valid), and readers use goalSecret().
 */
export function useGoalSecrets(workId: string): Record<string, GoalSecret> {
  const q = useRepoQuery(
    async (repo) => {
      try {
        return await decryptGoalSecrets(repo, workId);
      } catch {
        return Object.create(null) as Record<string, GoalSecret>;
      }
    },
    [workId],
  );
  return q.data ?? EMPTY_SECRETS;
}
const EMPTY_SECRETS: Record<string, GoalSecret> = Object.freeze(Object.create(null)) as Record<string, GoalSecret>;

/**
 * Safety net for the sealed evaluation of §5.2: opening the work page opens the sealed extras that the work's
 * redemptions already satisfy but that were never opened (e.g. data merged by an older version of the app).
 * They are stored unseen, so the おまけ tab plays their envelopes. Failures are ignored (nothing is shown).
 */
export function useSealedEvaluation(workId: string): void {
  const repo = useRepo();
  useEffect(() => {
    evaluateSealed(repo, workId).catch(() => undefined);
  }, [repo, workId]);
}

/** The decrypted secret of one goal: own keys only, so 'constructor' or 'toString' never find a prototype member. */
export function goalSecret(secrets: Readonly<Record<string, GoalSecret>>, goalId: string): GoalSecret | undefined {
  return Object.hasOwn(secrets, goalId) ? secrets[goalId] : undefined;
}

/**
 * Re-reads the work right before writing so a stale copy never overwrites newer fields
 * (e.g. lastPlayedAt written by endSession while this screen was open). Runs under the shared repository
 * lock, so it can neither interleave with a service's read-modify-write nor re-create a work that a
 * concurrent 「削除」 just removed.
 */
export function patchWork(
  repo: ShioriRepo,
  workId: string,
  patch: (w: WorkRecord) => WorkRecord,
  now: number = Date.now(),
): Promise<void> {
  return withRepoLock(repo, async () => {
    const current = await repo.getWork(workId);
    if (!current) return;
    await repo.putWork({ ...patch(current), updatedAt: now });
  });
}

/** User-facing Japanese message for any error thrown by a service. */
export function errorMessageJa(e: unknown, fallback = 'うまくいきませんでした。もう一度お試しください'): string {
  return isShioriError(e) ? e.messageJa : fallback;
}

/** Non-archived progress by goal id. */
export function progressByGoal(progress: readonly GoalProgress[]): Map<string, GoalProgress> {
  const map = new Map<string, GoalProgress>();
  for (const p of progress) if (!p.archived) map.set(p.goalId, p);
  return map;
}

export function hintTierByGoal(hints: readonly HintReveal[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const h of hints) map.set(h.goalId, Math.max(map.get(h.goalId) ?? 0, h.tier));
  return map;
}

const HINT_TIER_NAMES = ['示唆', '方向', '答え'] as const;

/**
 * Name of hint tier i (1-based). Tiers are named by position, exactly as the studio labels the fields
 * (docs/SPEC.md §4.1: tier order = 示唆, 方向, 答え): a goal with one or two hints has only 示唆 (and 方向),
 * never an 答え.
 */
export function hintTierName(i: number): string {
  return HINT_TIER_NAMES[Math.min(Math.max(Math.trunc(i), 1), HINT_TIER_NAMES.length) - 1]!;
}

/** Only the third tier is the answer, which asks for a confirmation before it is shown (F8 AC2). */
export function isAnswerTier(i: number): boolean {
  return i === HINT_TIER_NAMES.length;
}

/**
 * Spoiler level used for a sealed item's teaser. Sealed items carry no level of their own, so the teaser
 * follows the goals of its condition: the lowest level among them (the teaser is written for everyone who
 * can open the item, and it is shown before any of them is reached).
 */
export function sealedSpoiler(m: ShioriManifestV1, item: SealedItem): SpoilerLevel {
  let level: SpoilerLevel | undefined;
  for (const id of item.unlock.goals) {
    const g = m.goals.find((x) => x.id === id);
    if (g && (level === undefined || g.spoiler < level)) level = g.spoiler;
  }
  return level ?? 0;
}

/** 「2/4」 (allOf) or 「いずれか1つ」 (anyOf), counted from the goals redeemed with a code. */
export function conditionText(item: SealedItem, redeemed: ReadonlySet<string>): string {
  if (item.unlock.mode === 'anyOf') return 'いずれか1つ';
  const have = item.unlock.goals.filter((g) => redeemed.has(g)).length;
  return `${have}/${item.unlock.goals.length}`;
}

export interface GoalView {
  goal: Goal;
  index: number;
  isCode: boolean;
  done: boolean;
  progress?: GoalProgress;
  /** decrypted secret (redeemed code goals only) */
  secret?: GoalSecret;
  redeemed: boolean;
  hintTier: number;
  isNew: boolean;
}

export function goalViews(
  data: WorkData,
  secrets: Record<string, GoalSecret>,
): GoalView[] {
  const m = data.manifest;
  if (!m) return [];
  const prog = progressByGoal(data.progress);
  const tiers = hintTierByGoal(data.hints);
  const redeemed = new Set(data.redeemedGoalIds);
  const fresh = new Set(data.work.newGoalIds);
  return m.goals.map((goal, index) => {
    const p = prog.get(goal.id);
    const v: GoalView = {
      goal,
      index,
      isCode: isCodeGoal(goal),
      done: p !== undefined,
      redeemed: redeemed.has(goal.id),
      hintTier: Math.min(tiers.get(goal.id) ?? 0, goal.hints.length),
      isNew: fresh.has(goal.id),
    };
    if (p) v.progress = p;
    const s = goalSecret(secrets, goal.id);
    if (s && v.isCode) v.secret = s;
    return v;
  });
}

/**
 * Id for a player-added goal (/^[a-z0-9][a-z0-9_-]{0,39}$/): `my-<n>` with n one past the highest `my-<n>`
 * seen in the manifest AND in `taken`. Pass every goal id the work still has records for (progress, archived
 * included, hints and goal notes): a deleted item's records stay keyed by its id, so reusing that id would hand
 * the old completion, hint tier and note to a brand-new item.
 */
export function newGoalId(m: ShioriManifestV1, taken: Iterable<string> = []): string {
  const used = new Set(m.goals.map((g) => g.id));
  for (const id of taken) used.add(id);
  let max = m.goals.length;
  for (const id of used) {
    const match = /^my-(\d{1,9})$/.exec(id);
    if (match) max = Math.max(max, Number(match[1]));
  }
  for (let n = max + 1; ; n++) {
    const id = `my-${n}`;
    if (!used.has(id)) return id;
  }
}

/** Every goal id the work has records for (progress — archived included —, hints and goal notes). */
export function goalIdsWithRecords(data: Pick<WorkData, 'progress' | 'hints' | 'notes'>): Set<string> {
  const ids = new Set<string>();
  for (const p of data.progress) ids.add(p.goalId);
  for (const h of data.hints) ids.add(h.goalId);
  for (const n of data.notes) if (n.goalId !== undefined) ids.add(n.goalId);
  return ids;
}

/** mm:ss under an hour, h:mm:ss after (live session timer). */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Length in characters (code points), as the services count them. */
export function charCount(s: string): number {
  return Array.from(s).length;
}

/** Date.now(), refreshed every `intervalMs` while it is a number (null = frozen). */
export function useNow(intervalMs: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (intervalMs === null) return;
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const t = setInterval(tick, intervalMs);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [intervalMs]);
  return now;
}

/** Parses a minutes field: '' → undefined, otherwise an integer 0..720 or an error message. */
export function parseMinutesField(v: string): { ok: true; value: number | undefined } | { ok: false; message: string } {
  const t = v.normalize('NFKC').trim();
  if (t === '') return { ok: true, value: undefined };
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0 || n > SESSION_MAX_MINUTES) {
    return { ok: false, message: `0〜${SESSION_MAX_MINUTES}の数で入力してください` };
  }
  return { ok: true, value: Math.round(n) };
}
