// StudioProject → sealed shiori.json (docs/SPEC.md §4.3, §4.4, F16).
import { codeErrorMessageJa, parseCode } from '../codes';
import { KDF_ITERATIONS_MAX, KDF_ITERATIONS_MIN, MANIFEST_SCHEMA } from '../constants';
import { deriveMaster, KDF_SALT_BYTES, lookupTag, sealGoalSecret, sealItem } from '../crypto/shiori';
import { b64uDecode, b64uEncode, randomBytes } from '../encoding';
import type { Rng } from '../encoding';
import { ShioriError } from '../errors';
import { buildUnlockUrl } from '../route';
import { parseStoreCode } from '../storeCode';
import type {
  BuildResult,
  Bytes,
  CodeGoal,
  CodeKind,
  CodeRow,
  DraftGoal,
  DraftSealed,
  GoalCommon,
  GoalSecret,
  KdfParams,
  ManifestWork,
  ManualGoal,
  SealedItem,
  SealedPayload,
  ShioriManifestV1,
  StudioProject,
  ValidationIssue,
} from '../types';
import { goalSecretSchema, sealedPayloadSchema } from './payloadSchemas';
import { validateManifest } from './validate';

/** How many validation issues the build error message lists. */
const ISSUES_IN_MESSAGE = 3;

function invalid(messageJa: string, cause?: unknown): never {
  throw new ShioriError('validation', messageJa, cause === undefined ? undefined : { cause });
}

function isBlank(s: string | undefined): boolean {
  return s === undefined || s.trim() === '';
}

function formatIterations(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

// ───────────────────────── normalization (shared with selftest) ─────────────────────────

/** GoalSecret with empty optional fields dropped (what gets sealed; also what selfTest expects back). */
export function normalizeGoalSecret(secret: GoalSecret): GoalSecret {
  return {
    title: secret.title,
    ...(isBlank(secret.description) ? {} : { description: secret.description }),
    ...(isBlank(secret.unlockMessage) ? {} : { unlockMessage: secret.unlockMessage }),
  };
}

/**
 * SealedPayload with empty optional parts dropped: an empty `from`, a returnCode / storeLink whose fields are
 * all empty (the editor's "unset" state). A store code is normalized (ｒｊ０１… → RJ01…) when it parses.
 */
export function normalizePayload(p: SealedPayload): SealedPayload {
  const out: SealedPayload = { title: p.title, body: p.body };
  if (!isBlank(p.from)) out.from = p.from;
  const rc = p.returnCode;
  if (rc && !(isBlank(rc.code) && isBlank(rc.instruction))) out.returnCode = { code: rc.code, instruction: rc.instruction };
  const sl = p.storeLink;
  if (sl && !(isBlank(sl.storeCode) && isBlank(sl.caption))) {
    out.storeLink = { storeCode: parseStoreCode(sl.storeCode)?.code ?? sl.storeCode, caption: sl.caption };
  }
  return out;
}

/** Hints without trailing empty tiers (middle empty tiers are kept so validation reports them). */
function publicHints(hints: readonly string[] | undefined): string[] {
  const out = [...(hints ?? [])];
  while (out.length > 0 && isBlank(out[out.length - 1])) out.pop();
  return out;
}

/** Only the GoalCommon fields (never unlockType/codeKind/code/secret); empty teaser/missable dropped. */
function goalCommon(d: DraftGoal): GoalCommon {
  const missable = d.missable;
  const keepMissable = missable !== undefined && !(isBlank(missable.before) && isBlank(missable.warn));
  return {
    id: d.id,
    group: d.group,
    label: d.label,
    ...(isBlank(d.teaser) ? {} : { teaser: d.teaser }),
    spoiler: d.spoiler ?? 0,
    hints: publicHints(d.hints),
    ...(keepMissable ? { missable: { before: missable.before, warn: missable.warn } } : {}),
  };
}

function manifestWork(w: ManifestWork): ManifestWork {
  return {
    id: w.id,
    title: w.title,
    ...(isBlank(w.safeTitle) ? {} : { safeTitle: w.safeTitle }),
    ...(isBlank(w.circle) ? {} : { circle: w.circle }),
    ...(w.storeCode === undefined || isBlank(w.storeCode)
      ? {}
      : { storeCode: parseStoreCode(w.storeCode)?.code ?? w.storeCode }),
    kind: w.kind,
    ...(w.engine === undefined ? {} : { engine: w.engine }),
    version: w.version,
  };
}

// ───────────────────────── pre-checks (before any PBKDF2) ─────────────────────────

interface PreparedCodeGoal {
  draft: DraftGoal;
  kind: CodeKind;
  canonical: string;
  display: string;
  secret: GoalSecret;
}

function prepareCodeGoal(d: DraftGoal): PreparedCodeGoal {
  const name = `目標「${d.id}」`;
  if (isBlank(d.code)) invalid(`${name}の合言葉が設定されていません`);
  const parsed = parseCode(d.code ?? '');
  if (!parsed.ok) invalid(`${name}の合言葉が正しくありません：${codeErrorMessageJa(parsed.error)}`);
  const kind = d.codeKind ?? parsed.kind;
  if (parsed.kind !== kind) {
    invalid(`${name}の合言葉の種類が設定（${kind === 'kana' ? 'ひらがな5語' : '英数字'}）と一致しません`);
  }
  if (!d.secret || isBlank(d.secret.title)) invalid(`${name}の秘密タイトルを入力してください`);
  const secret = normalizeGoalSecret(d.secret);
  const checked = goalSecretSchema.safeParse(secret);
  if (!checked.success) {
    invalid(`${name}の秘密タイトル・説明・解放メッセージの長さや文字を確かめてください`, checked.error);
  }
  return { draft: d, kind, canonical: parsed.canonical, display: parsed.display, secret };
}

function checkDuplicateCodes(codeGoals: readonly PreparedCodeGoal[]): void {
  const owner = new Map<string, string>();
  for (const g of codeGoals) {
    const first = owner.get(g.canonical);
    if (first !== undefined) invalid(`目標「${first}」と「${g.draft.id}」に同じ合言葉が設定されています`);
    owner.set(g.canonical, g.draft.id);
  }
}

interface PreparedSealed {
  draft: DraftSealed;
  goals: string[];
  payload: SealedPayload;
}

function prepareSealed(s: DraftSealed, codeGoalIds: ReadonlySet<string>, allGoalIds: ReadonlySet<string>): PreparedSealed {
  const name = `おまけ「${s.id}」`;
  if (s.mode !== 'allOf' && s.mode !== 'anyOf') invalid(`${name}の条件（すべて／どれか）が正しくありません`);
  const goals = [...new Set(s.goals ?? [])];
  if (goals.length === 0) invalid(`${name}の条件に、合言葉つきの目標を1つ以上指定してください`);
  for (const g of goals) {
    if (!allGoalIds.has(g)) invalid(`${name}の条件の目標「${g}」が見つかりません`);
    if (!codeGoalIds.has(g)) invalid(`${name}の条件の目標「${g}」は合言葉つきの目標ではありません`);
  }
  const payload = normalizePayload(s.payload);
  const checked = sealedPayloadSchema.safeParse(payload);
  if (!checked.success) invalid(`${name}の内容（タイトル・本文など）の長さや文字を確かめてください`, checked.error);
  return { draft: s, goals, payload };
}

function resolveSalt(project: StudioProject, rng: Rng): string {
  if (project.kdfSalt !== undefined) {
    let bytes: Bytes | undefined;
    try {
      bytes = b64uDecode(project.kdfSalt);
    } catch {
      bytes = undefined;
    }
    if (!bytes || bytes.length !== KDF_SALT_BYTES) invalid('鍵のソルト（kdfSalt）が正しくありません');
    return project.kdfSalt;
  }
  const bytes = rng(KDF_SALT_BYTES);
  if (!(bytes instanceof Uint8Array) || bytes.length !== KDF_SALT_BYTES) {
    throw new ShioriError('internal', '乱数の生成に失敗しました');
  }
  return b64uEncode(bytes);
}

function issuesMessage(issues: readonly ValidationIssue[]): string {
  const shown = issues
    .slice(0, ISSUES_IN_MESSAGE)
    .map((i) => (i.path === '' ? i.messageJa : `${i.path}：${i.messageJa}`))
    .join(' ／ ');
  const more = issues.length > ISSUES_IN_MESSAGE ? `（ほか${issues.length - ISSUES_IN_MESSAGE}件）` : '';
  return `しおりファイルを作れませんでした：${shown}${more}`;
}

// ───────────────────────── build ─────────────────────────

/**
 * Builds the public manifest. Uses project.kdfSalt if set (else generates 16 random bytes → returned as `salt`).
 * Throws ShioriError('validation') if the project is not buildable (e.g. code goal without a valid code).
 *
 * Every cheap check (codes, secrets, sealed conditions, payloads, iterations, salt) runs before the first
 * PBKDF2. One master is derived per code goal. `kdf` is included only when there is at least one code goal or
 * sealed item. The result is re-validated with validateManifest; `manifest` and `json` are the validated form.
 */
export async function buildManifest(project: StudioProject, opts: { rng?: Rng } = {}): Promise<BuildResult> {
  const rng = opts.rng ?? randomBytes;
  const workId = project.work.id;

  const codeGoals = project.goals.filter((g) => g.unlockType === 'code').map(prepareCodeGoal);
  checkDuplicateCodes(codeGoals);
  const codeGoalIds = new Set(codeGoals.map((g) => g.draft.id));
  const allGoalIds = new Set(project.goals.map((g) => g.id));
  const sealed = project.sealed.map((s) => prepareSealed(s, codeGoalIds, allGoalIds));

  const salt = resolveSalt(project, rng);
  const needsKdf = codeGoals.length > 0 || sealed.length > 0;
  const iterations = project.kdfIterations;
  if (needsKdf && (!Number.isInteger(iterations) || iterations < KDF_ITERATIONS_MIN || iterations > KDF_ITERATIONS_MAX)) {
    invalid(
      `反復回数は${formatIterations(KDF_ITERATIONS_MIN)}〜${formatIterations(KDF_ITERATIONS_MAX)}の整数にしてください`,
    );
  }
  const kdf: KdfParams = { alg: 'PBKDF2-SHA256', iterations, salt };

  // PBKDF2 once per code goal (in parallel; no randomness involved).
  const masterList = await Promise.all(codeGoals.map((g) => deriveMaster(g.canonical, kdf)));
  const masters = new Map<string, Bytes>();
  codeGoals.forEach((g, i) => masters.set(g.draft.id, masterList[i]!));
  const prepared = new Map(codeGoals.map((g) => [g.draft.id, g] as const));

  // Sealing runs sequentially so that an injected rng is consumed in a deterministic order.
  const goals: (ManualGoal | CodeGoal)[] = [];
  for (const d of project.goals) {
    const common = goalCommon(d);
    const p = d.unlockType === 'code' ? prepared.get(d.id) : undefined;
    const master = p ? masters.get(d.id) : undefined;
    if (!p || !master) {
      goals.push({ ...common, unlock: { type: 'manual' } });
      continue;
    }
    const tag = await lookupTag(master, workId);
    const secret = await sealGoalSecret(master, kdf, workId, d.id, p.secret, rng);
    goals.push({ ...common, unlock: { type: 'code', codeKind: p.kind, tag }, secret });
  }

  const items: SealedItem[] = [];
  for (const s of sealed) {
    const itemMasters = Object.create(null) as Record<string, Uint8Array>;
    for (const g of s.goals) itemMasters[g] = masters.get(g)!;
    const { unlock, box } = await sealItem({
      workId,
      kdf,
      sealedId: s.draft.id,
      mode: s.draft.mode,
      masters: itemMasters,
      payload: s.payload,
      rng,
    });
    items.push({
      id: s.draft.id,
      label: s.draft.label,
      ...(isBlank(s.draft.teaser) ? {} : { teaser: s.draft.teaser }),
      kind: s.draft.kind,
      unlock,
      box,
    });
  }

  const authorName = project.authorName;
  const draft: ShioriManifestV1 = {
    schema: MANIFEST_SCHEMA,
    work: manifestWork(project.work),
    author: { kind: 'creator', ...(isBlank(authorName) ? {} : { name: authorName }) },
    ...(needsKdf ? { kdf } : {}),
    checkpoints: project.checkpoints.map((c) => ({ id: c.id, label: c.label })),
    groups: project.groups.map((g) => ({ id: g.id, label: g.label })),
    goals,
    sealed: items,
    changelog: project.changelog.map((c) => ({ version: c.version, date: c.date, notes: c.notes })),
  };

  const result = validateManifest(draft);
  if (!result.ok) throw new ShioriError('validation', issuesMessage(result.errors));
  const manifest = result.manifest;

  const codes: CodeRow[] = codeGoals.map((g) => ({
    goalId: g.draft.id,
    label: g.draft.label,
    secretTitle: g.secret.title,
    codeKind: g.kind,
    display: g.display,
    canonical: g.canonical,
    unlockUrl: buildUnlockUrl(project.appUrl, workId, g.canonical),
  }));

  return { manifest, json: JSON.stringify(manifest, null, 2), codes, salt };
}
