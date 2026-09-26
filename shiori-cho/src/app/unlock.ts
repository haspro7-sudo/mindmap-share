// 合言葉 (code) redemption services (no React). docs/SPEC.md F10–F12, §5.2.
//
// - submitCode / handleDeepLink / processPending redeem codes against the imported manifests.
// - Masters derived from codes are cached on the Redemption (master, masterSalt). A cache is used only
//   while masterSalt equals the manifest's kdf.salt AND its lookup tag still matches the goal; otherwise
//   the master is re-derived from Redemption.canonical (one PBKDF2) and the cache is refreshed or dropped.
// - Decrypted goal secrets and sealed payloads are never persisted (F12 AC4).
// - Every public function runs under the per-repository lock (repoLock.ts). The exported `...InLock`
//   helpers are for library.ts, which already holds the lock.
import { codeErrorMessageJa, parseCode } from '../core/codes';
import { MASTER_BYTES, deriveMaster, lookupTag, openGoalSecret, openItem } from '../core/crypto/shiori';
import { b64uDecode, b64uEncode } from '../core/encoding';
import { ShioriError } from '../core/errors';
import { WORK_ID_RE } from '../core/manifest/schema';
import { redeem, satisfiedSealed } from '../core/redeem';
import type {
  Bytes,
  CodeGoal,
  Goal,
  GoalProgress,
  GoalSecret,
  ManifestRecord,
  PendingCode,
  RedeemCandidate,
  Redemption,
  SealedPayload,
  ShioriManifestV1,
  UnlockOutcome,
  WorkRecord,
} from '../core/types';
import type { ShioriRepo } from '../storage/repo';
import { withRepoLock } from './repoLock';

export const MSG_WORK_NOT_FOUND = '作品が見つかりません';
export const MSG_NO_MANIFEST = 'この作品にはしおりファイルがありません';
export const MSG_GOAL_NOT_FOUND = '項目が見つかりません';

// ───────────────────────── shared helpers (also used by library.ts) ─────────────────────────

/** A work together with its current manifest record. */
export interface WorkManifest {
  work: WorkRecord;
  record: ManifestRecord;
}

/** The work and its current ManifestRecord, or undefined (unknown work, 記録だけ, or record missing). */
export async function loadWorkManifest(repo: ShioriRepo, workId: string): Promise<WorkManifest | undefined> {
  const work = await repo.getWork(workId);
  if (!work?.manifestKey) return undefined;
  const record = await repo.getManifest(work.manifestKey);
  return record ? { work, record } : undefined;
}

/** Like loadWorkManifest, but throws ShioriError('notFound') with a Japanese message. */
export async function requireWorkManifest(repo: ShioriRepo, workId: string): Promise<WorkManifest> {
  const work = await repo.getWork(workId);
  if (!work) throw new ShioriError('notFound', MSG_WORK_NOT_FOUND);
  const record = work.manifestKey ? await repo.getManifest(work.manifestKey) : undefined;
  if (!record) throw new ShioriError('notFound', MSG_NO_MANIFEST);
  return { work, record };
}

export function isCodeGoal(g: Goal): g is CodeGoal {
  return g.unlock.type === 'code';
}

function findGoal(m: ShioriManifestV1, goalId: string): Goal | undefined {
  return m.goals.find((g) => g.id === goalId);
}

function findCodeGoal(m: ShioriManifestV1, goalId: string): CodeGoal | undefined {
  const g = findGoal(m, goalId);
  return g && isCodeGoal(g) ? g : undefined;
}

/** Hint tier currently revealed for a goal (0 = none). */
export async function currentHintTier(repo: ShioriRepo, workId: string, goalId: string): Promise<0 | 1 | 2 | 3> {
  const hint = (await repo.listHints(workId)).find((h) => h.goalId === goalId);
  return hint?.tier ?? 0;
}

/**
 * Marks a goal done with via 'manual' unless it already has progress (any via): the earliest
 * completion is kept. hintTierAtDone is the tier revealed right now. Caller holds the lock.
 */
export async function markManualDoneInLock(repo: ShioriRepo, workId: string, goalId: string, now: number): Promise<void> {
  const prev = (await repo.listProgress(workId)).find((p) => p.goalId === goalId);
  if (prev) {
    if (prev.archived) await repo.putProgress({ ...prev, archived: false });
    return;
  }
  await repo.putProgress({
    workId,
    goalId,
    via: 'manual',
    doneAt: now,
    hintTierAtDone: await currentHintTier(repo, workId, goalId),
    archived: false,
  });
}

/** Records a code completion: new progress, or an upgrade of manual progress keeping the earliest doneAt. */
async function markCodeDone(repo: ShioriRepo, workId: string, goalId: string, now: number): Promise<void> {
  const prev = (await repo.listProgress(workId)).find((p) => p.goalId === goalId);
  if (prev?.via === 'code' && !prev.archived) return;
  let next: GoalProgress;
  if (prev && prev.doneAt <= now) {
    // Done earlier by hand: that completion (and the hint tier at that time) stays.
    next = { ...prev, via: 'code', archived: false };
  } else {
    next = {
      workId,
      goalId,
      via: 'code',
      doneAt: now,
      hintTierAtDone: await currentHintTier(repo, workId, goalId),
      archived: false,
    };
  }
  await repo.putProgress(next);
}

// ───────────────────────── cached masters ─────────────────────────

/**
 * Re-derivations known to fail (the canonical does not match the goal's tag under these kdf params),
 * so a stale redemption does not cost a PBKDF2 on every render. In memory only; the persisted record
 * simply has no master.
 */
const failedDerivations = new WeakMap<ShioriRepo, Set<string>>();

function failedSet(repo: ShioriRepo): Set<string> {
  let s = failedDerivations.get(repo);
  if (!s) {
    s = new Set();
    failedDerivations.set(repo, s);
  }
  return s;
}

function failureKey(workId: string, m: ShioriManifestV1, goal: CodeGoal, canonical: string): string {
  return JSON.stringify([workId, m.work.id, goal.id, goal.unlock.tag, m.kdf?.salt, m.kdf?.iterations, canonical]);
}

function hasCachedMaster(r: Redemption): boolean {
  return r.master !== undefined || r.masterSalt !== undefined;
}

function withoutCachedMaster(r: Redemption): Redemption {
  const { master: _master, masterSalt: _masterSalt, ...rest } = r;
  return rest;
}

/** HMAC tag check; any failure counts as "no match". */
async function tagMatches(master: Uint8Array, m: ShioriManifestV1, goal: CodeGoal): Promise<boolean> {
  try {
    return (await lookupTag(master, m.work.id)) === goal.unlock.tag;
  } catch (e) {
    if (e instanceof ShioriError) return false;
    throw e;
  }
}

/** The cached master if it belongs to the manifest's current kdf salt and still matches the goal's tag. */
async function validCachedMaster(r: Redemption, m: ShioriManifestV1, goal: CodeGoal): Promise<Bytes | undefined> {
  if (!m.kdf || r.master === undefined || r.masterSalt !== m.kdf.salt) return undefined;
  let master: Bytes;
  try {
    master = b64uDecode(r.master);
  } catch {
    return undefined;
  }
  if (master.length !== MASTER_BYTES) return undefined;
  return (await tagMatches(master, m, goal)) ? master : undefined;
}

/** PBKDF2 from the canonical code; undefined when the kdf params are unusable. */
async function tryDerive(canonical: string, m: ShioriManifestV1): Promise<Bytes | undefined> {
  if (!m.kdf) return undefined;
  try {
    return await deriveMaster(canonical, m.kdf);
  } catch (e) {
    if (e instanceof ShioriError) return undefined;
    throw e;
  }
}

/**
 * goalId → master for every redemption of the work whose code goal is in `m` and whose master is valid
 * for `m.kdf`. Missing or stale caches are re-derived from the canonical code (PBKDF2, in parallel) and
 * verified against the goal's tag: a match refreshes the cache, a mismatch drops it (the canonical stays).
 * With `dropOrphans` (used after a kdf change), caches of redemptions whose goal is no longer a code
 * goal of `m` are dropped too, since they cannot be verified. Caller holds the lock.
 */
export async function collectMastersInLock(
  repo: ShioriRepo,
  workId: string,
  m: ShioriManifestV1,
  opts: { dropOrphans?: boolean } = {},
): Promise<Map<string, Bytes>> {
  const out = new Map<string, Bytes>();
  const failed = failedSet(repo);
  const toDerive: { r: Redemption; goal: CodeGoal; key: string }[] = [];

  for (const r of await repo.listRedemptions(workId)) {
    const goal = m.kdf ? findCodeGoal(m, r.goalId) : undefined;
    if (!goal) {
      if (opts.dropOrphans && hasCachedMaster(r)) await repo.putRedemption(withoutCachedMaster(r));
      continue;
    }
    const cached = await validCachedMaster(r, m, goal);
    if (cached) {
      out.set(goal.id, cached);
      continue;
    }
    const key = failureKey(workId, m, goal, r.canonical);
    if (failed.has(key)) {
      if (hasCachedMaster(r)) await repo.putRedemption(withoutCachedMaster(r));
      continue;
    }
    toDerive.push({ r, goal, key });
  }

  const derived = await Promise.all(toDerive.map(({ r }) => tryDerive(r.canonical, m)));
  for (let i = 0; i < toDerive.length; i++) {
    const { r, goal, key } = toDerive[i]!;
    const master = derived[i];
    if (master && m.kdf && (await tagMatches(master, m, goal))) {
      await repo.putRedemption({ ...r, master: b64uEncode(master), masterSalt: m.kdf.salt });
      out.set(goal.id, master);
    } else {
      failed.add(key);
      if (hasCachedMaster(r)) await repo.putRedemption(withoutCachedMaster(r));
    }
  }
  return out;
}

function mastersRecord(masters: ReadonlyMap<string, Uint8Array>): Record<string, Uint8Array> {
  const rec = Object.create(null) as Record<string, Uint8Array>;
  for (const [goalId, master] of masters) rec[goalId] = master;
  return rec;
}

async function tryOpenSecret(master: Uint8Array, m: ShioriManifestV1, goal: CodeGoal): Promise<GoalSecret | undefined> {
  if (!m.kdf) return undefined;
  try {
    return await openGoalSecret(master, m.kdf, m.work.id, goal.id, goal.secret);
  } catch (e) {
    if (e instanceof ShioriError) return undefined;
    throw e;
  }
}

// ───────────────────────── sealed evaluation ─────────────────────────

/**
 * Opens sealed items newly satisfied by the redemptions with valid masters (§5.2): each is decrypted
 * once to make sure it really opens, then stored as SealedOpen { seen: false }. Caller holds the lock.
 */
async function evaluateSealedFor(repo: ShioriRepo, workId: string, m: ShioriManifestV1, now: number): Promise<string[]> {
  const kdf = m.kdf;
  if (!kdf || m.sealed.length === 0) return [];
  const opened = new Set((await repo.listSealedOpens(workId)).map((o) => o.sealedId));
  // Nothing left to open: skip the master collection (and any re-derivation) entirely.
  if (m.sealed.every((s) => opened.has(s.id))) return [];
  const masters = await collectMastersInLock(repo, workId, m);
  if (masters.size === 0) return [];
  const rec = mastersRecord(masters);
  const ids: string[] = [];
  for (const item of satisfiedSealed(m, masters.keys())) {
    if (opened.has(item.id)) continue;
    let payload: SealedPayload | null;
    try {
      payload = await openItem({ workId: m.work.id, kdf, item, masters: rec });
    } catch (e) {
      if (e instanceof ShioriError) continue; // a broken box never counts as opened
      throw e;
    }
    if (!payload) continue;
    await repo.putSealedOpen({ workId, sealedId: item.id, firstOpenedAt: now, seen: false });
    opened.add(item.id);
    ids.push(item.id);
  }
  return ids;
}

/** evaluateSealed for a caller that already holds the lock. */
export async function evaluateSealedInLock(repo: ShioriRepo, workId: string, now: number): Promise<string[]> {
  const target = await loadWorkManifest(repo, workId);
  if (!target) return [];
  return evaluateSealedFor(repo, workId, target.record.manifest, now);
}

// ───────────────────────── redemption ─────────────────────────

interface Candidates {
  list: RedeemCandidate[];
  byKey: Map<string, WorkManifest>;
  works: WorkRecord[];
}

/** One candidate per work (its current manifest) that has a kdf and at least one code goal. */
async function loadCandidates(repo: ShioriRepo, onlyWorkId?: string): Promise<Candidates> {
  let works: WorkRecord[];
  if (onlyWorkId === undefined) works = await repo.listWorks();
  else {
    const w = await repo.getWork(onlyWorkId);
    works = w ? [w] : [];
  }
  const list: RedeemCandidate[] = [];
  const byKey = new Map<string, WorkManifest>();
  for (const work of works) {
    if (!work.manifestKey || byKey.has(work.manifestKey)) continue;
    const record = await repo.getManifest(work.manifestKey);
    if (!record?.manifest.kdf || !record.manifest.goals.some(isCodeGoal)) continue;
    list.push({ manifestKey: record.key, manifest: record.manifest });
    byKey.set(record.key, { work, record });
  }
  return { list, byKey, works };
}

/** manifest.work.id of the local work to try first (from its current manifest, else the work record). */
function preferredManifestWorkId(cands: Candidates, workId: string | undefined): string | undefined {
  if (workId === undefined) return undefined;
  for (const { work, record } of cands.byKey.values()) if (work.id === workId) return record.manifest.work.id;
  return cands.works.find((w) => w.id === workId)?.manifestWorkId;
}

function invalidOutcome(outcome: { error: UnlockOutcome['error'] }): UnlockOutcome {
  return { status: 'invalid', error: outcome.error, openedSealedIds: [] };
}

/**
 * Stores the redemption and code progress for a matched code, decrypts the goal secret and opens newly
 * satisfied sealed items. A redemption of the same goal with the same canonical → 'already' (its master
 * cache is refreshed); one with a different canonical is stale (the code was changed by an update) and
 * is replaced.
 */
async function applyMatch(
  repo: ShioriRepo,
  target: WorkManifest,
  goalId: string,
  canonical: string,
  master: Bytes,
  now: number,
): Promise<UnlockOutcome> {
  const { work, record } = target;
  const m = record.manifest;
  const goal = findCodeGoal(m, goalId);
  const kdf = m.kdf;
  if (!goal || !kdf) throw new ShioriError('internal', MSG_GOAL_NOT_FOUND);

  const masterB64 = b64uEncode(master);
  const existing = (await repo.listRedemptions(work.id)).find((r) => r.goalId === goalId);
  const already = existing !== undefined && existing.canonical === canonical;
  if (!already) {
    await repo.putRedemption({ workId: work.id, goalId, canonical, redeemedAt: now, master: masterB64, masterSalt: kdf.salt });
  } else if (existing.master !== masterB64 || existing.masterSalt !== kdf.salt) {
    await repo.putRedemption({ ...existing, master: masterB64, masterSalt: kdf.salt });
  }
  await markCodeDone(repo, work.id, goalId, now);
  const secret = await tryOpenSecret(master, m, goal);
  const openedSealedIds = await evaluateSealedFor(repo, work.id, m, now);
  const outcome: UnlockOutcome = {
    status: already ? 'already' : 'unlocked',
    workId: work.id,
    goalId,
    openedSealedIds,
    canonical,
  };
  if (secret) outcome.secret = secret;
  return outcome;
}

async function submitCodeInLock(
  repo: ShioriRepo,
  input: string,
  ctx: { workId?: string; now: number },
): Promise<UnlockOutcome> {
  const parsed = parseCode(input);
  if (!parsed.ok) return invalidOutcome(parsed);
  const cands = await loadCandidates(repo);
  const result = await redeem(parsed.canonical, cands.list, { preferWorkId: preferredManifestWorkId(cands, ctx.workId) });
  if (result.status === 'invalid') return invalidOutcome(result);
  if (result.status === 'noMatch') return { status: 'noMatch', canonical: result.canonical, openedSealedIds: [] };
  const target = cands.byKey.get(result.manifestKey);
  if (!target) throw new ShioriError('internal', MSG_WORK_NOT_FOUND);
  return applyMatch(repo, target, result.goalId, result.canonical, result.master, ctx.now);
}

/**
 * Tries every pending code (oldest first). With `onlyWorkId`, only that work's manifest is tried (used
 * right after an import: at most one PBKDF2 per pending code). Matched codes ('unlocked' / 'already')
 * and codes that can never parse are removed; unmatched ones stay pending.
 * Returns the outcomes of the matched codes only. Caller holds the lock.
 */
export async function processPendingInLock(repo: ShioriRepo, now: number, onlyWorkId?: string): Promise<UnlockOutcome[]> {
  const pending = await repo.listPending();
  if (pending.length === 0) return [];
  const cands = await loadCandidates(repo, onlyWorkId);
  if (cands.list.length === 0) return [];
  const outcomes: UnlockOutcome[] = [];
  for (const p of pending) {
    const result = await redeem(p.canonical, cands.list, { preferWorkId: p.manifestWorkIdHint });
    if (result.status === 'invalid') {
      await repo.deletePending(p.id);
      continue;
    }
    if (result.status === 'noMatch') continue;
    const target = cands.byKey.get(result.manifestKey);
    if (!target) continue;
    outcomes.push(await applyMatch(repo, target, result.goalId, result.canonical, result.master, now));
    await repo.deletePending(p.id);
  }
  return outcomes;
}

function validHint(manifestWorkId: string | undefined): string | undefined {
  return manifestWorkId !== undefined && WORK_ID_RE.test(manifestWorkId) ? manifestWorkId : undefined;
}

async function addPendingInLock(
  repo: ShioriRepo,
  code: string,
  manifestWorkIdHint: string | undefined,
  now: number,
): Promise<string> {
  const parsed = parseCode(code);
  if (!parsed.ok) throw new ShioriError('validation', codeErrorMessageJa(parsed.error));
  const canonical = parsed.canonical;
  const hint = validHint(manifestWorkIdHint);
  const existing = (await repo.listPending()).find((p) => p.canonical === canonical);
  if (existing) {
    // Deduplicated by canonical; a hint learned later (e.g. from a deep link) is kept.
    if (hint !== undefined && existing.manifestWorkIdHint === undefined) {
      await repo.putPending({ ...existing, manifestWorkIdHint: hint });
    }
    return canonical;
  }
  const p: PendingCode = { id: globalThis.crypto.randomUUID(), canonical, receivedAt: now };
  if (hint !== undefined) p.manifestWorkIdHint = hint;
  await repo.putPending(p);
  return canonical;
}

// ───────────────────────── public services ─────────────────────────

/** ctx.workId = local work id to try first (its manifest.work.id becomes preferWorkId). */
export function submitCode(repo: ShioriRepo, input: string, ctx?: { workId?: string; now?: number }): Promise<UnlockOutcome> {
  return withRepoLock(repo, () => submitCodeInLock(repo, input, { workId: ctx?.workId, now: ctx?.now ?? Date.now() }));
}

/**
 * Stores a pending code (dedup by canonical). Accepts the canonical or any display form; throws
 * ShioriError('validation') with the code's Japanese error message if it is not a valid code.
 * A hint that is not a valid manifest work id is ignored.
 */
export async function addPending(repo: ShioriRepo, canonical: string, manifestWorkIdHint?: string, now?: number): Promise<void> {
  await withRepoLock(repo, () => addPendingInLock(repo, canonical, manifestWorkIdHint, now ?? Date.now()));
}

/**
 * Tries all pending codes against current manifests; removes redeemed/already ones (and ones that are not
 * valid codes at all). Returns the outcomes of the codes that matched ('unlocked' or 'already').
 */
export function processPending(repo: ShioriRepo, now?: number): Promise<UnlockOutcome[]> {
  return withRepoLock(repo, () => processPendingInLock(repo, now ?? Date.now()));
}

/**
 * Handles '#/u/<manifestWorkId>/<code>': redeem if possible; else store as pending (status 'pending').
 * The code is tried against every imported manifest, the linked work first.
 */
export function handleDeepLink(repo: ShioriRepo, manifestWorkId: string, code: string, now?: number): Promise<UnlockOutcome> {
  return withRepoLock(repo, async () => {
    const t = now ?? Date.now();
    const parsed = parseCode(code);
    if (!parsed.ok) return invalidOutcome(parsed);
    const work = await repo.findWorkByManifestWorkId(manifestWorkId);
    const target = work ? await loadWorkManifest(repo, work.id) : undefined;
    if (!work || !target) {
      await addPendingInLock(repo, parsed.canonical, manifestWorkId, t);
      return { status: 'pending', canonical: parsed.canonical, openedSealedIds: [] };
    }
    return submitCodeInLock(repo, parsed.canonical, { workId: work.id, now: t });
  });
}

/**
 * goalId → decrypted secret, for every redeemed code goal of the work whose master is valid (cached, or
 * re-derived from the canonical code and then cached). Goals whose secret cannot be decrypted are left out.
 */
export function decryptGoalSecrets(repo: ShioriRepo, workId: string): Promise<Record<string, GoalSecret>> {
  return withRepoLock(repo, async () => {
    const out: Record<string, GoalSecret> = {};
    const target = await loadWorkManifest(repo, workId);
    if (!target) return out;
    const m = target.record.manifest;
    const masters = await collectMastersInLock(repo, workId, m);
    for (const [goalId, master] of masters) {
      const goal = findCodeGoal(m, goalId);
      if (!goal) continue;
      const secret = await tryOpenSecret(master, m, goal);
      if (secret) out[goalId] = secret;
    }
    return out;
  });
}

/**
 * Decrypts a sealed item if the player's masters satisfy it (never persisted). Returns null for an unknown
 * item or an unmet condition. Throws ShioriError('decrypt') if the box is damaged.
 */
export function readSealed(repo: ShioriRepo, workId: string, sealedId: string): Promise<SealedPayload | null> {
  return withRepoLock(repo, async () => {
    const target = await loadWorkManifest(repo, workId);
    if (!target) return null;
    const m = target.record.manifest;
    const item = m.sealed.find((s) => s.id === sealedId);
    if (!item || !m.kdf) return null;
    const masters = await collectMastersInLock(repo, workId, m);
    if (!item.unlock.goals.some((g) => masters.has(g))) return null;
    return openItem({ workId: m.work.id, kdf: m.kdf, item, masters: mastersRecord(masters) });
  });
}

/** Opens newly satisfied sealed items (putSealedOpen seen:false). Returns newly opened sealed ids. */
export function evaluateSealed(repo: ShioriRepo, workId: string, now?: number): Promise<string[]> {
  return withRepoLock(repo, () => evaluateSealedInLock(repo, workId, now ?? Date.now()));
}

/**
 * Marks a code goal done with via 'manual' (does not open seals: no Redemption is created, so the real
 * title stays masked). No-op if the goal is already done. Throws ShioriError('notFound') for an unknown
 * work or goal.
 */
export function markDoneWithoutCode(repo: ShioriRepo, workId: string, goalId: string, now?: number): Promise<void> {
  return withRepoLock(repo, async () => {
    const { record } = await requireWorkManifest(repo, workId);
    if (!findGoal(record.manifest, goalId)) throw new ShioriError('notFound', MSG_GOAL_NOT_FOUND);
    await markManualDoneInLock(repo, workId, goalId, now ?? Date.now());
  });
}
