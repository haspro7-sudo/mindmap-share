// Library services (本棚, no React). docs/SPEC.md F4–F7, §5.2.
//
// Importing (preview → commit), works without a manifest (記録だけ), かんたんしおり, the bundled demos,
// player-owned manifest edits and the manual goal toggle. Every write runs under the per-repository
// lock shared with unlock.ts (repoLock.ts), so a double tap cannot import one manifest as two works.
import { nextAlias } from '../core/alias';
import { ShioriError } from '../core/errors';
import { buildQuickManifest, newPlayerWorkId } from '../core/manifest/quick';
import { WORK_KINDS } from '../core/manifest/schema';
import { diffManifests, upgradeProgress } from '../core/manifest/upgrade';
import { manifestKey, parseManifestText, validateManifest } from '../core/manifest/validate';
import { STORE_CODE_INVALID_JA, parseStoreCode } from '../core/storeCode';
import type {
  CoverColor,
  ImportPreview,
  ManifestDiff,
  ManifestRecord,
  ManifestSource,
  QuickCounts,
  ShioriManifestV1,
  UnlockOutcome,
  ValidationIssue,
  WorkKind,
  WorkRecord,
} from '../core/types';
import amaotoManifest from '../demo/amaoto.shiori.json';
import hoshiyomiManifest from '../demo/hoshiyomi.shiori.json';
import type { ShioriRepo } from '../storage/repo';
import { withRepoLock } from './repoLock';
import {
  MSG_GOAL_NOT_FOUND,
  MSG_WORK_NOT_FOUND,
  collectMastersInLock,
  evaluateSealedInLock,
  isCodeGoal,
  loadWorkManifest,
  markManualDoneInLock,
  processPendingInLock,
  requireWorkManifest,
} from './unlock';

export const WORK_TITLE_MAX = 100;
export const WORK_ALIAS_MAX = 40;
/** Cover emoji length limit, in code points (one emoji may take several, e.g. flags or ZWJ sequences). */
export const COVER_EMOJI_MAX_CHARS = 16;
export const COVER_COLORS: readonly CoverColor[] = ['paper', 'sky', 'leaf', 'sun', 'rose', 'plum', 'slate'];

export const MSG_TITLE_REQUIRED = 'タイトルを入力してください';
export const MSG_TITLE_TOO_LONG = `タイトルは${WORK_TITLE_MAX}文字以内にしてください`;
export const MSG_ALIAS_TOO_LONG = `表示名は${WORK_ALIAS_MAX}文字以内にしてください`;
export const MSG_KIND_INVALID = '作品の種類を選んでください';
export const MSG_COVER_COLOR_INVALID = '色の指定が正しくありません';
export const MSG_COVER_EMOJI_INVALID = 'アイコンの絵文字が長すぎます';
export const MSG_CODE_GOAL_UNDO = '合言葉で達成した項目は取り消せません';
export const MSG_PLAYER_ONLY_EDIT = 'プレイヤーが作ったしおりだけ編集できます';
export const MSG_PLAYER_ONLY_EXPORT = 'プレイヤーが作ったしおりだけ書き出せます';
export const MSG_WORK_ID_LOCKED = 'しおりのIDは変更できません';
export const MSG_AUTHOR_LOCKED = 'しおりの作成者の種類は変更できません';
export const MSG_DEMO_BROKEN = 'サンプルのしおりを読み込めませんでした';
export const MSG_ATTACH_OTHER_WORK = 'このしおりファイルは、本棚の別の作品で使っています';
export const MSG_ATTACH_OTHER_MANIFEST =
  'この作品には、別の作品のサークルのしおりファイルが付いています。この作品のしおりファイルを選んでください';

/** The bundled SFW demos (docs/SPEC.md §4.6, §7.4), validated before use. */
const BUNDLED_DEMOS: readonly unknown[] = [hoshiyomiManifest, amaotoManifest];

// ───────────────────────── helpers ─────────────────────────

/** Default cover emoji for a work kind: 🎧 voice, 🖼️ CG集/漫画, 📘 otherwise. */
export function defaultCoverEmoji(kind: WorkKind): string {
  if (kind === 'voice') return '🎧';
  if (kind === 'cg' || kind === 'comic') return '🖼️';
  return '📘';
}

/** Counts shown in the import preview (目標 N・合言葉 M・おまけ K). */
export function manifestStats(m: ShioriManifestV1): { goals: number; codeGoals: number; sealed: number } {
  return { goals: m.goals.length, codeGoals: m.goals.filter(isCodeGoal).length, sealed: m.sealed.length };
}

function validationError(messageJa: string): ShioriError {
  return new ShioriError('validation', messageJa);
}

/** One Japanese message for a list of manifest issues (the first one, plus how many more). */
function issuesError(issues: readonly ValidationIssue[]): ShioriError {
  const first = issues[0];
  if (!first) return validationError('しおりファイルの内容が正しくありません');
  const where = first.path === '' ? '' : `${first.path}：`;
  const more = issues.length > 1 ? `（ほか${issues.length - 1}件）` : '';
  return validationError(`しおりファイルの内容が正しくありません（${where}${first.messageJa}）${more}`);
}

function isWorkKind(v: unknown): v is WorkKind {
  return typeof v === 'string' && (WORK_KINDS as readonly string[]).includes(v);
}

function isCoverColor(v: unknown): v is CoverColor {
  return typeof v === 'string' && (COVER_COLORS as readonly string[]).includes(v);
}

interface WorkFields {
  title: string;
  alias?: string;
  storeCode?: string;
  kind: WorkKind;
  coverEmoji: string;
  coverColor: CoverColor;
}

/** Validates and normalizes the user-entered work fields (F4 AC1). alias undefined = use the default. */
function normalizeWorkInput(input: {
  title: string;
  alias?: string;
  storeCode?: string;
  kind: WorkKind;
  coverEmoji?: string;
  coverColor?: CoverColor;
}): WorkFields {
  const title = typeof input.title === 'string' ? input.title.trim() : '';
  if (title === '') throw validationError(MSG_TITLE_REQUIRED);
  if (title.length > WORK_TITLE_MAX) throw validationError(MSG_TITLE_TOO_LONG);

  const aliasRaw = typeof input.alias === 'string' ? input.alias.trim() : '';
  if (aliasRaw.length > WORK_ALIAS_MAX) throw validationError(MSG_ALIAS_TOO_LONG);

  let storeCode: string | undefined;
  const storeRaw = typeof input.storeCode === 'string' ? input.storeCode.trim() : '';
  if (storeRaw !== '') {
    const parsed = parseStoreCode(storeRaw);
    if (!parsed) throw validationError(STORE_CODE_INVALID_JA);
    storeCode = parsed.code;
  }

  if (!isWorkKind(input.kind)) throw validationError(MSG_KIND_INVALID);

  const emojiRaw = typeof input.coverEmoji === 'string' ? input.coverEmoji.trim() : '';
  if (Array.from(emojiRaw).length > COVER_EMOJI_MAX_CHARS) throw validationError(MSG_COVER_EMOJI_INVALID);
  const coverColor = input.coverColor ?? 'paper';
  if (!isCoverColor(coverColor)) throw validationError(MSG_COVER_COLOR_INVALID);

  const out: WorkFields = {
    title,
    kind: input.kind,
    coverEmoji: emojiRaw === '' ? defaultCoverEmoji(input.kind) : emojiRaw,
    coverColor,
  };
  if (aliasRaw !== '') out.alias = aliasRaw;
  if (storeCode !== undefined) out.storeCode = storeCode;
  return out;
}

async function aliasOrDefault(repo: ShioriRepo, alias: string | undefined): Promise<string> {
  if (alias !== undefined) return alias;
  return nextAlias((await repo.listWorks()).map((w) => w.alias));
}

function newWorkRecord(fields: WorkFields & { alias: string }, now: number): WorkRecord {
  const w: WorkRecord = {
    id: globalThis.crypto.randomUUID(),
    title: fields.title,
    alias: fields.alias,
    kind: fields.kind,
    status: 'backlog',
    coverEmoji: fields.coverEmoji,
    coverColor: fields.coverColor,
    spoilerTolerance: 1,
    newGoalIds: [],
    createdAt: now,
    updatedAt: now,
  };
  if (fields.storeCode !== undefined) w.storeCode = fields.storeCode;
  return w;
}

/** Stand-in "previous manifest" when a work has none: no goals, no kdf (every goal counts as added). */
function blankLike(m: ShioriManifestV1): ShioriManifestV1 {
  const { kdf: _kdf, ...rest } = m;
  return { ...rest, goals: [], sealed: [] };
}

/**
 * Replaces a work's manifest (import update, attach or player edit): stores the new record, carries progress
 * over by goal id (archive / un-archive), updates newGoalIds, re-derives cached masters when the kdf
 * changed, points the work at the new key and deletes the work's other manifest records.
 * Caller holds the lock.
 *
 * The repository has no multi-store transaction, so the steps are ordered so that stopping after any of them
 * (a quota error, the page being closed) leaves a consistent library:
 * 1. the new record is stored (until step 3 it is an unused extra record, removed by the next import);
 * 2. goals present in the new manifest are un-archived (harmless under the old manifest: it either has the
 *    goal too, or ignores it);
 * 3. the work points at the new record (from here on progress of goals missing from it is ignored anyway);
 * 4. goals missing from the new manifest are archived;
 * 5. the work's other records are deleted, and masters are re-derived when the kdf changed.
 */
async function replaceManifestInLock(
  repo: ShioriRepo,
  work: WorkRecord,
  old: ManifestRecord | undefined,
  next: { key: string; manifest: ShioriManifestV1; source: ManifestSource },
  now: number,
  opts: { markNew: boolean },
): Promise<void> {
  const newM = next.manifest;
  const oldM = old?.manifest;
  await repo.putManifest({ key: next.key, workId: work.id, manifest: newM, source: next.source, importedAt: now });

  const progress = await repo.listProgress(work.id);
  const upgraded = upgradeProgress(oldM ?? newM, newM, progress);
  for (let i = 0; i < progress.length; i++) {
    const after = upgraded.progress[i]!;
    if (progress[i]!.archived && !after.archived) await repo.putProgress(after);
  }

  // NEW badges: still-present old badges plus the goals this update added.
  const present = new Set(newM.goals.map((g) => g.id));
  const newGoalIds = work.newGoalIds.filter((id) => present.has(id));
  if (opts.markNew && oldM) for (const id of upgraded.newGoalIds) if (!newGoalIds.includes(id)) newGoalIds.push(id);

  const updated: WorkRecord = { ...work, manifestKey: next.key, manifestWorkId: newM.work.id, newGoalIds, updatedAt: now };
  if (updated.currentCheckpointId !== undefined && !newM.checkpoints.some((c) => c.id === updated.currentCheckpointId)) {
    delete updated.currentCheckpointId;
  }
  if (updated.storeCode === undefined && newM.work.storeCode !== undefined) updated.storeCode = newM.work.storeCode;
  await repo.putWork(updated);

  for (let i = 0; i < progress.length; i++) {
    const after = upgraded.progress[i]!;
    if (!progress[i]!.archived && after.archived) await repo.putProgress(after);
  }

  for (const rec of await repo.listManifests(work.id)) {
    if (rec.key !== next.key) await repo.deleteManifest(rec.key);
  }

  // A new salt (or iterations) invalidates every cached master: re-derive from the canonical codes.
  // Codes that no longer match keep their canonical form and lose the master.
  const kdfChanged = oldM ? diffManifests(oldM, newM).kdfChanged : true;
  if (kdfChanged) await collectMastersInLock(repo, work.id, newM, { dropOrphans: true });
}

/**
 * Commits a validated manifest (re-validated here, and re-checked against the current library so that a
 * stale or doubled preview cannot create a second work). Caller holds the lock.
 */
async function commitImportInLock(
  repo: ShioriRepo,
  input: ShioriManifestV1,
  source: ManifestSource,
  now: number,
): Promise<{ workId: string; pendingOutcomes: UnlockOutcome[] }> {
  const v = validateManifest(input);
  if (!v.ok) throw issuesError(v.errors);
  const manifest = v.manifest;
  const key = await manifestKey(manifest);
  const existing = await repo.findWorkByManifestWorkId(manifest.work.id);

  let workId: string;
  if (!existing) {
    const work = newWorkRecord(
      {
        title: manifest.work.title,
        alias: await aliasOrDefault(repo, manifest.work.safeTitle),
        kind: manifest.work.kind,
        coverEmoji: defaultCoverEmoji(manifest.work.kind),
        coverColor: 'paper',
      },
      now,
    );
    work.manifestKey = key;
    work.manifestWorkId = manifest.work.id;
    if (manifest.work.storeCode !== undefined) work.storeCode = manifest.work.storeCode;
    // The record first, then the work that points at it.
    await repo.putManifest({ key, workId: work.id, manifest, source, importedAt: now });
    await repo.putWork(work);
    workId = work.id;
  } else {
    workId = existing.id;
    const old = existing.manifestKey ? await repo.getManifest(existing.manifestKey) : undefined;
    if (old && existing.manifestKey === key) return { workId, pendingOutcomes: [] }; // 読み込み済みです
    await replaceManifestInLock(repo, existing, old, { key, manifest, source }, now, { markNew: true });
  }

  const pendingOutcomes = await processPendingInLock(repo, now, workId);
  await evaluateSealedInLock(repo, workId, now);
  return { workId, pendingOutcomes };
}

// ───────────────────────── public services ─────────────────────────

/**
 * Parses and validates a shiori.json text (F5). Invalid → every error (the UI shows at most 20).
 * A manifest whose work.id matches an existing work becomes an update preview with the goal diff;
 * alreadyImported means the stored manifest is byte-for-byte the same (「読み込み済みです」).
 */
export async function previewImport(repo: ShioriRepo, text: string): Promise<ImportPreview> {
  const r = parseManifestText(text);
  if (!r.ok) return { kind: 'invalid', errors: r.errors };
  const manifest = r.manifest;
  const warnings = r.warnings;
  const stats = manifestStats(manifest);
  const existing = await repo.findWorkByManifestWorkId(manifest.work.id);
  if (!existing) return { kind: 'new', manifest, warnings, stats };
  const old = existing.manifestKey ? await repo.getManifest(existing.manifestKey) : undefined;
  const diff: ManifestDiff = diffManifests(old?.manifest ?? blankLike(manifest), manifest);
  const alreadyImported = old !== undefined && existing.manifestKey === (await manifestKey(manifest));
  return { kind: 'update', manifest, warnings, stats, existing, diff, alreadyImported };
}

/**
 * New: creates WorkRecord (alias = manifest.work.safeTitle ?? nextAlias), stores ManifestRecord.
 * Update: stores new ManifestRecord, upgradeProgress (archive/unarchive), re-derives masters if kdf changed, sets newGoalIds, deletes the old ManifestRecord.
 * Then processPending + sealed evaluation. Returns the local work id and pending outcomes.
 *
 * Whether it is new or an update is decided again from the current library (the preview may be stale),
 * so committing the same preview twice is harmless. An already-imported manifest is a no-op.
 */
export function commitImport(
  repo: ShioriRepo,
  preview: Exclude<ImportPreview, { kind: 'invalid' }>,
  opts: { source: ManifestSource; now?: number },
): Promise<{ workId: string; pendingOutcomes: UnlockOutcome[] }> {
  return withRepoLock(repo, () => commitImportInLock(repo, preview.manifest, opts.source, opts.now ?? Date.now()));
}

/**
 * What a shiori.json would do to an existing work (作品ページ・作品設定の「しおりファイルを読み込む」):
 * - 'attach': the work has no manifest (記録だけ) — the file becomes its checklist;
 * - 'replacePlayer': the work has a player-made manifest (かんたんしおり) — the circle's file replaces it;
 * - 'update': the file has the same manifest work id as the work's current file — a normal update.
 * `blocked` says why the file cannot be used here: another local work already uses its manifest work id
 * ('otherWork'), or the work already has a circle's file for another work ('otherManifest').
 */
export type AttachPreview =
  | { kind: 'invalid'; errors: ValidationIssue[] }
  | {
      kind: 'ready';
      manifest: ShioriManifestV1;
      warnings: ValidationIssue[];
      stats: { goals: number; codeGoals: number; sealed: number };
      work: WorkRecord;
      mode: 'attach' | 'replacePlayer' | 'update';
      /** goal changes against the current manifest (every goal counts as added when there is none) */
      diff: ManifestDiff;
      /** the work already uses exactly this file */
      alreadyAttached: boolean;
      blocked?: { reason: 'otherWork'; other: WorkRecord } | { reason: 'otherManifest' };
    };

interface AttachPlan {
  mode: 'attach' | 'replacePlayer' | 'update';
  current?: ManifestRecord;
  blocked?: { reason: 'otherWork'; other: WorkRecord } | { reason: 'otherManifest' };
}

/** Decides how `manifest` would attach to `work` (see AttachPreview). */
async function planAttach(repo: ShioriRepo, work: WorkRecord, manifest: ShioriManifestV1): Promise<AttachPlan> {
  const current = work.manifestKey ? await repo.getManifest(work.manifestKey) : undefined;
  const other = (await repo.listWorks()).find((w) => w.id !== work.id && w.manifestWorkId === manifest.work.id);
  let mode: AttachPlan['mode'] = 'attach';
  let blocked: AttachPlan['blocked'];
  if (current) {
    if (current.manifest.work.id === manifest.work.id) mode = 'update';
    else if (current.manifest.author.kind === 'player') mode = 'replacePlayer';
    else blocked = { reason: 'otherManifest' };
  }
  if (other && !blocked) blocked = { reason: 'otherWork', other };
  const plan: AttachPlan = { mode };
  if (current) plan.current = current;
  if (blocked) plan.blocked = blocked;
  return plan;
}

/**
 * Parses and validates a shiori.json text for attaching it to the existing work `workId` (see AttachPreview).
 * Throws ShioriError('notFound') for an unknown work.
 */
export async function previewAttach(repo: ShioriRepo, workId: string, text: string): Promise<AttachPreview> {
  const work = await repo.getWork(workId);
  if (!work) throw new ShioriError('notFound', MSG_WORK_NOT_FOUND);
  const r = parseManifestText(text);
  if (!r.ok) return { kind: 'invalid', errors: r.errors };
  const manifest = r.manifest;
  const plan = await planAttach(repo, work, manifest);
  const out: AttachPreview = {
    kind: 'ready',
    manifest,
    warnings: r.warnings,
    stats: manifestStats(manifest),
    work,
    mode: plan.mode,
    diff: diffManifests(plan.current?.manifest ?? blankLike(manifest), manifest),
    alreadyAttached: plan.current !== undefined && plan.current.key === (await manifestKey(manifest)),
  };
  if (plan.blocked) out.blocked = plan.blocked;
  return out;
}

/**
 * Attaches a shiori.json to the existing work `workId` instead of adding a new work, so its sessions, notes,
 * resume info and status stay where they are (a 記録だけ work gets its checklist; a かんたんしおり is replaced by
 * the circle's file; a file of the same manifest work id is a normal update, with NEW badges).
 * The manifest is validated again and every check is repeated under the lock. Refused with
 * ShioriError('conflict') when another local work already uses the file's manifest work id, or when the work
 * already has a circle's file for another work. Progress carries over by goal id (goals of a replaced
 * かんたんしおり are archived unless the new file uses the same ids). Then the pending codes are tried against
 * the work and newly satisfied sealed items are opened. Attaching the file the work already uses is a no-op.
 */
export function attachManifest(
  repo: ShioriRepo,
  workId: string,
  input: ShioriManifestV1,
  opts: { source: ManifestSource; now?: number },
): Promise<{ workId: string; pendingOutcomes: UnlockOutcome[]; openedSealedIds: string[] }> {
  return withRepoLock(repo, async () => {
    const now = opts.now ?? Date.now();
    const work = await repo.getWork(workId);
    if (!work) throw new ShioriError('notFound', MSG_WORK_NOT_FOUND);
    const v = validateManifest(input);
    if (!v.ok) throw issuesError(v.errors);
    const manifest = v.manifest;
    const plan = await planAttach(repo, work, manifest);
    if (plan.blocked) {
      throw new ShioriError('conflict', plan.blocked.reason === 'otherWork' ? MSG_ATTACH_OTHER_WORK : MSG_ATTACH_OTHER_MANIFEST);
    }
    const key = await manifestKey(manifest);
    if (plan.current?.key === key) return { workId, pendingOutcomes: [], openedSealedIds: [] };
    await replaceManifestInLock(repo, work, plan.current, { key, manifest, source: opts.source }, now, {
      markNew: plan.mode === 'update',
    });
    const pendingOutcomes = await processPendingInLock(repo, now, workId);
    const openedSealedIds = await evaluateSealedInLock(repo, workId, now);
    return { workId, pendingOutcomes, openedSealedIds };
  });
}

/**
 * Deletes a work and everything that belongs to it (repo.deleteWork cascades), under the shared lock so that
 * a service still working on the work (e.g. a background master re-derivation) cannot write rows for it
 * afterwards.
 */
export function deleteWork(repo: ShioriRepo, workId: string): Promise<void> {
  return withRepoLock(repo, () => repo.deleteWork(workId));
}

/**
 * 記録だけ付ける: a work without a manifest. Title 1..100 (trimmed), alias ≤40 (default nextAlias),
 * store code RJ/VJ/BJ + 6 or 8 digits in any width or case. Throws ShioriError('validation').
 */
export function createWork(
  repo: ShioriRepo,
  input: { title: string; alias?: string; storeCode?: string; kind: WorkKind; coverEmoji?: string; coverColor?: CoverColor },
  now?: number,
): Promise<WorkRecord> {
  return withRepoLock(repo, async () => {
    const fields = normalizeWorkInput(input);
    const work = newWorkRecord({ ...fields, alias: await aliasOrDefault(repo, fields.alias) }, now ?? Date.now());
    await repo.putWork(work);
    return work;
  });
}

/** かんたんしおり (F6): a work with a player-authored manifest (source 'quick'). Throws ShioriError('validation'). */
export function createQuickWork(
  repo: ShioriRepo,
  input: { title: string; alias?: string; storeCode?: string; kind: WorkKind; counts: QuickCounts },
  now?: number,
): Promise<WorkRecord> {
  return withRepoLock(repo, async () => {
    const t = now ?? Date.now();
    const fields = normalizeWorkInput(input);
    let manifestWorkId = newPlayerWorkId();
    while (await repo.findWorkByManifestWorkId(manifestWorkId)) manifestWorkId = newPlayerWorkId();
    const manifest = buildQuickManifest({ title: fields.title, kind: fields.kind, workId: manifestWorkId, counts: input.counts });
    const key = await manifestKey(manifest);
    const work = newWorkRecord({ ...fields, alias: await aliasOrDefault(repo, fields.alias) }, t);
    work.manifestKey = key;
    work.manifestWorkId = manifestWorkId;
    await repo.putManifest({ key, workId: work.id, manifest, source: 'quick', importedAt: t });
    await repo.putWork(work);
    return work;
  });
}

/** Imports both bundled SFW demos (idempotent: existing demo works are kept). Returns local work ids. */
export function importBundledDemos(repo: ShioriRepo, now?: number): Promise<string[]> {
  return withRepoLock(repo, async () => {
    const t = now ?? Date.now();
    const ids: string[] = [];
    for (const raw of BUNDLED_DEMOS) {
      const v = validateManifest(raw);
      if (!v.ok) throw new ShioriError('internal', MSG_DEMO_BROKEN);
      const existing = await repo.findWorkByManifestWorkId(v.manifest.work.id);
      if (existing) {
        ids.push(existing.id);
        continue;
      }
      ids.push((await commitImportInLock(repo, v.manifest, 'bundled', t)).workId);
    }
    return ids;
  });
}

/**
 * For player-owned manifests (author.kind 'player'): apply a mutation, validate, store as source 'player-edit'.
 * `mutate` receives a deep copy. work.id and author.kind must stay the same (ShioriError('conflict')); an
 * invalid result throws ShioriError('validation') and changes nothing. Progress of removed goals is archived.
 */
export function updatePlayerManifest(
  repo: ShioriRepo,
  workId: string,
  mutate: (m: ShioriManifestV1) => ShioriManifestV1,
  now?: number,
): Promise<void> {
  return withRepoLock(repo, async () => {
    const { work, record } = await requireWorkManifest(repo, workId);
    const current = record.manifest;
    if (current.author.kind !== 'player') throw new ShioriError('conflict', MSG_PLAYER_ONLY_EDIT);
    const copy = structuredClone(current);
    // A mutation that edits the copy in place and forgets to return it still works.
    const draft: unknown = mutate(copy) ?? copy;
    const v = validateManifest(draft);
    if (!v.ok) {
      // Identity checks first: they explain the problem better than a schema error would.
      const d = draft as Partial<ShioriManifestV1> | null;
      if (d && typeof d === 'object' && d.work?.id !== current.work.id) throw new ShioriError('conflict', MSG_WORK_ID_LOCKED);
      throw issuesError(v.errors);
    }
    const next = v.manifest;
    if (next.work.id !== current.work.id) throw new ShioriError('conflict', MSG_WORK_ID_LOCKED);
    if (next.author.kind !== 'player') throw new ShioriError('conflict', MSG_AUTHOR_LOCKED);
    const key = await manifestKey(next);
    if (key === record.key) return;
    const t = now ?? Date.now();
    await clearRecordsOfAddedGoalsInLock(repo, work.id, current, next, t);
    await replaceManifestInLock(repo, work, record, { key, manifest: next, source: 'player-edit' }, t, {
      markNew: false,
    });
  });
}

/**
 * A goal the player adds is always new, so records still keyed by its id (left by an earlier, deleted item
 * with the same id) must not carry over: its progress and hint reveal are removed and its notes are kept as
 * notes of the work (no longer tied to a goal). Caller holds the lock.
 */
async function clearRecordsOfAddedGoalsInLock(
  repo: ShioriRepo,
  workId: string,
  current: ShioriManifestV1,
  next: ShioriManifestV1,
  now: number,
): Promise<void> {
  const before = new Set(current.goals.map((g) => g.id));
  const added = new Set(next.goals.map((g) => g.id).filter((id) => !before.has(id)));
  if (added.size === 0) return;
  const [progress, hints, notes] = await Promise.all([repo.listProgress(workId), repo.listHints(workId), repo.listNotes(workId)]);
  for (const p of progress) if (added.has(p.goalId)) await repo.deleteProgress(workId, p.goalId);
  for (const h of hints) if (added.has(h.goalId)) await repo.deleteHint(workId, h.goalId);
  for (const n of notes) {
    if (n.goalId === undefined || !added.has(n.goalId)) continue;
    const { goalId: _goalId, ...rest } = n;
    await repo.putNote({ ...rest, updatedAt: Math.max(now, n.updatedAt) });
  }
}

/** The player-owned manifest as a shiori.json text (F6 AC4). Throws ShioriError('conflict') for creator files. */
export async function exportPlayerManifest(repo: ShioriRepo, workId: string): Promise<string> {
  const { record } = await requireWorkManifest(repo, workId);
  if (record.manifest.author.kind !== 'player') throw new ShioriError('conflict', MSG_PLAYER_ONLY_EXPORT);
  return JSON.stringify(record.manifest, null, 2);
}

/**
 * Manual toggle; records hintTierAtDone from the current hint reveal.
 * Done: via 'manual' (no-op if already done, so the earliest completion stays). Undone: removes manual
 * progress; progress earned with a code cannot be undone (ShioriError('conflict')). Unknown work or goal
 * → ShioriError('notFound').
 */
export function setGoalDone(repo: ShioriRepo, workId: string, goalId: string, done: boolean, now?: number): Promise<void> {
  return withRepoLock(repo, async () => {
    const { record } = await requireWorkManifest(repo, workId);
    if (!record.manifest.goals.some((g) => g.id === goalId)) throw new ShioriError('notFound', MSG_GOAL_NOT_FOUND);
    if (done) {
      await markManualDoneInLock(repo, workId, goalId, now ?? Date.now());
      return;
    }
    const prev = (await repo.listProgress(workId)).find((p) => p.goalId === goalId);
    if (!prev) return;
    if (prev.via === 'code') throw new ShioriError('conflict', MSG_CODE_GOAL_UNDO);
    await repo.deleteProgress(workId, goalId);
  });
}

/** Loads the ManifestRecord for a work (or undefined). */
export async function getWorkManifest(repo: ShioriRepo, workId: string): Promise<ShioriManifestV1 | undefined> {
  return (await loadWorkManifest(repo, workId))?.record.manifest;
}
