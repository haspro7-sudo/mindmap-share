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
  SealedKind,
  SealedPayload,
  ShioriManifestV1,
  StudioProject,
  ValidationIssue,
} from '../types';
import { formatPath, zodIssuesToValidationIssues } from './messagesJa';
import { goalSecretSchema, sealedPayloadSchema } from './payloadSchemas';
import { validateManifest } from './validate';

/** How many validation issues the build error message lists. */
const ISSUES_IN_MESSAGE = 3;

type Path = ReadonlyArray<string | number>;

/**
 * The build refused the project: a ShioriError('validation') whose message summarizes the first issues, carrying
 * every issue with its path ('goals[2].hints[0]'), so 点検 can list them all and link each one to its tab.
 */
export class BuildValidationError extends ShioriError {
  readonly issues: readonly ValidationIssue[];

  constructor(issues: readonly ValidationIssue[]) {
    super('validation', issuesMessage(issues));
    this.issues = issues;
  }
}

export function isBuildValidationError(e: unknown): e is BuildValidationError {
  return e instanceof BuildValidationError;
}

/** Collects the pre-check issues of a build (they are all reported together, before any PBKDF2). */
class Issues {
  readonly list: ValidationIssue[] = [];

  add(path: Path, code: string, messageJa: string): void {
    this.list.push({ path: formatPath(path), code, messageJa, severity: 'error' });
  }

  /** zod issues below `path`, each message prefixed with the item's name. */
  addZod(path: Path, name: string, zodIssues: ReadonlyArray<unknown>): void {
    for (const i of zodIssuesToValidationIssues(zodIssues, path)) this.list.push({ ...i, messageJa: `${name}：${i.messageJa}` });
  }

  throwIfAny(): void {
    if (this.list.length > 0) throw new BuildValidationError(this.list);
  }
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
 * With `kind`, a return code is kept only for kind 'returnCode' (the editor says a return code left on another kind
 * is not shown; the player's reader would otherwise show it, and the kit would not list it).
 */
export function normalizePayload(p: SealedPayload, kind?: SealedKind): SealedPayload {
  const out: SealedPayload = { title: p.title, body: p.body };
  if (!isBlank(p.from)) out.from = p.from;
  const rc = p.returnCode;
  const keepReturnCode = kind === undefined || kind === 'returnCode';
  if (keepReturnCode && rc && !(isBlank(rc.code) && isBlank(rc.instruction))) {
    out.returnCode = { code: rc.code, instruction: rc.instruction };
  }
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

/** Checks a code goal (no KDF). Returns undefined after adding its issues when it cannot be built. */
function prepareCodeGoal(d: DraftGoal, index: number, issues: Issues): PreparedCodeGoal | undefined {
  const name = `目標「${d.id}」`;
  const at = (...rest: (string | number)[]): Path => ['goals', index, ...rest];
  let ok = true;
  let parsedCode: { kind: CodeKind; canonical: string; display: string } | undefined;
  if (isBlank(d.code)) {
    issues.add(at('code'), 'codeMissing', `${name}の合言葉が設定されていません`);
    ok = false;
  } else {
    const parsed = parseCode(d.code ?? '');
    if (!parsed.ok) {
      issues.add(at('code'), 'codeInvalid', `${name}の合言葉が正しくありません：${codeErrorMessageJa(parsed.error)}`);
      ok = false;
    } else {
      parsedCode = parsed;
      const kind = d.codeKind ?? parsed.kind;
      if (parsed.kind !== kind) {
        issues.add(at('codeKind'), 'codeKindMismatch', `${name}の合言葉の種類が設定（${kind === 'kana' ? 'ひらがな5語' : '英数字'}）と一致しません`);
        ok = false;
      }
    }
  }
  if (!d.secret || isBlank(d.secret.title)) {
    issues.add(at('secret', 'title'), 'secretTitleMissing', `${name}の秘密タイトルを入力してください`);
    return undefined;
  }
  const secret = normalizeGoalSecret(d.secret);
  const checked = goalSecretSchema.safeParse(secret, { reportInput: true });
  if (!checked.success) {
    issues.addZod(at('secret'), `${name}の秘密タイトル・説明・解放メッセージ`, checked.error.issues);
    ok = false;
  }
  if (!ok || !parsedCode) return undefined;
  return { draft: d, kind: parsedCode.kind, canonical: parsedCode.canonical, display: parsedCode.display, secret };
}

function checkDuplicateCodes(codeGoals: ReadonlyArray<{ index: number; goal: PreparedCodeGoal }>, issues: Issues): void {
  const owner = new Map<string, string>();
  for (const { index, goal: g } of codeGoals) {
    const first = owner.get(g.canonical);
    if (first !== undefined) {
      issues.add(['goals', index, 'code'], 'duplicateCode', `目標「${first}」と「${g.draft.id}」に同じ合言葉が設定されています`);
    } else {
      owner.set(g.canonical, g.draft.id);
    }
  }
}

interface PreparedSealed {
  draft: DraftSealed;
  goals: string[];
  payload: SealedPayload;
}

function prepareSealed(
  s: DraftSealed,
  index: number,
  codeGoalIds: ReadonlySet<string>,
  allGoalIds: ReadonlySet<string>,
  issues: Issues,
): PreparedSealed | undefined {
  const name = `おまけ「${s.id}」`;
  const at = (...rest: (string | number)[]): Path => ['sealed', index, ...rest];
  let ok = true;
  if (s.mode !== 'allOf' && s.mode !== 'anyOf') {
    issues.add(at('mode'), 'sealedMode', `${name}の条件（すべて／どれか）が正しくありません`);
    ok = false;
  }
  const goals = [...new Set(s.goals ?? [])];
  if (goals.length === 0) {
    issues.add(at('goals'), 'sealedNoGoals', `${name}の条件に、合言葉つきの目標を1つ以上指定してください`);
    ok = false;
  }
  const checked = new Set<string>();
  (s.goals ?? []).forEach((g, j) => {
    if (checked.has(g)) return;
    checked.add(g);
    if (!allGoalIds.has(g)) {
      issues.add(at('goals', j), 'danglingGoal', `${name}の条件の目標「${g}」が見つかりません`);
      ok = false;
    } else if (!codeGoalIds.has(g)) {
      issues.add(at('goals', j), 'sealedRefersManual', `${name}の条件の目標「${g}」は合言葉つきの目標ではありません`);
      ok = false;
    }
  });
  const payload = normalizePayload(s.payload, s.kind);
  const parsed = sealedPayloadSchema.safeParse(payload, { reportInput: true });
  if (!parsed.success) {
    issues.addZod(at('payload'), `${name}の内容`, parsed.error.issues);
    ok = false;
  }
  return ok ? { draft: s, goals, payload } : undefined;
}

function resolveSalt(project: StudioProject, rng: Rng, issues: Issues): string | undefined {
  if (project.kdfSalt !== undefined) {
    let bytes: Bytes | undefined;
    try {
      bytes = b64uDecode(project.kdfSalt);
    } catch {
      bytes = undefined;
    }
    if (!bytes || bytes.length !== KDF_SALT_BYTES) {
      issues.add(['kdfSalt'], 'kdfSalt', '鍵のソルト（kdfSalt）が正しくありません');
      return undefined;
    }
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
 * Throws BuildValidationError (a ShioriError('validation') carrying every issue with its path) if the project is
 * not buildable (e.g. code goal without a valid code, or a manifest that does not validate).
 *
 * Every cheap check (codes, secrets, sealed conditions, payloads, iterations, salt) runs before the first
 * PBKDF2, and all their issues are reported together. One master is derived per code goal. `kdf` is included
 * only when there is at least one code goal or sealed item. A return code is sealed only for kind 'returnCode'.
 * The result is re-validated with validateManifest; `manifest` and `json` are the validated form.
 */
export async function buildManifest(project: StudioProject, opts: { rng?: Rng } = {}): Promise<BuildResult> {
  const rng = opts.rng ?? randomBytes;
  const workId = project.work.id;
  const issues = new Issues();

  const codeDrafts = project.goals.flatMap((g, index) => (g.unlockType === 'code' ? [{ g, index }] : []));
  const preparedCodes = codeDrafts.flatMap(({ g, index }) => {
    const goal = prepareCodeGoal(g, index, issues);
    return goal ? [{ index, goal }] : [];
  });
  checkDuplicateCodes(preparedCodes, issues);
  const codeGoals = preparedCodes.map((c) => c.goal);
  const codeGoalIds = new Set(codeDrafts.map(({ g }) => g.id));
  const allGoalIds = new Set(project.goals.map((g) => g.id));
  const sealed = project.sealed.flatMap((s, index) => {
    const prepared = prepareSealed(s, index, codeGoalIds, allGoalIds, issues);
    return prepared ? [prepared] : [];
  });

  const salt = resolveSalt(project, rng, issues);
  const needsKdf = codeDrafts.length > 0 || project.sealed.length > 0;
  const iterations = project.kdfIterations;
  if (needsKdf && (!Number.isInteger(iterations) || iterations < KDF_ITERATIONS_MIN || iterations > KDF_ITERATIONS_MAX)) {
    issues.add(
      ['kdfIterations'],
      'kdfIterations',
      `反復回数は${formatIterations(KDF_ITERATIONS_MIN)}〜${formatIterations(KDF_ITERATIONS_MAX)}の整数にしてください`,
    );
  }
  issues.throwIfAny();
  if (salt === undefined) throw new ShioriError('internal', '鍵のソルトを用意できませんでした');
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
  if (!result.ok) throw new BuildValidationError(result.errors);
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
