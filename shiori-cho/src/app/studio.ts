// Creator editor services (サークル工房). docs/SPEC.md F16, §4.4.
import { zipSync } from 'fflate';
import type { Zippable } from 'fflate';
import { generateCode, parseCode } from '../core/codes';
import { CROCKFORD_ALPHABET } from '../core/codes/crockford';
import { KDF_ITERATIONS_DEFAULT, STUDIO_PROJECT_FORMAT } from '../core/constants';
import { randomBytes, utf8 } from '../core/encoding';
import type { Rng } from '../core/encoding';
import { isShioriError, ShioriError } from '../core/errors';
import { buildKitTextFiles, KIT_QR_DIR } from '../core/kit';
import { buildManifest } from '../core/manifest/build';
import { lintProject } from '../core/manifest/lint';
import { customMessageJa, formatPath, zodIssuesToValidationIssues } from '../core/manifest/messagesJa';
import { collectSecrets, findLeaks } from '../core/manifest/noSpoil';
import { ID_RE, studioProjectSchema } from '../core/manifest/schema';
import { selfTest } from '../core/manifest/selftest';
import { jsonErrorParams, utf8ByteLength, validateManifest } from '../core/manifest/validate';
import type { BuildResult, CodeKind, SelfTestReport, StudioProject, ValidationIssue } from '../core/types';

export interface CheckReport {
  build?: BuildResult;
  /** errors from build/validate/lint/noSpoil */
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  selfTest?: SelfTestReport;
  leaks: string[];
  /** true iff no errors and selfTest.ok */
  exportable: boolean;
}

/** Largest project file parseProjectJson accepts (UTF-8 bytes). A full project is at most a few MB. */
export const MAX_PROJECT_BYTES = 8 * 1024 * 1024;

const WORK_ID_PREFIX = 'w-';
const WORK_ID_CHARS = 10;
const LEAK_PREVIEW_CHARS = 20;
const CODE_ATTEMPTS = 100;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function issue(path: string, code: string, messageJa: string): ValidationIssue {
  return { path, code, messageJa, severity: 'error' };
}

// ───────────────────────── new project ─────────────────────────

/** Opaque manifest work id: "w-" + 10 lowercase Crockford base32 characters (50 bits). */
export function newStudioWorkId(rng: Rng = randomBytes): string {
  const bytes = rng(WORK_ID_CHARS);
  let out = WORK_ID_PREFIX;
  for (let i = 0; i < WORK_ID_CHARS; i++) {
    // 256 is a multiple of 32, so masking keeps the distribution uniform.
    out += CROCKFORD_ALPHABET[(bytes[i] ?? 0) & 31]!.toLowerCase();
  }
  return out;
}

/**
 * A starter project: empty title, a game at version 1.0.0, one group 「エンディング」, default KDF iterations
 * (200,000), no salt yet (generated at the first build and then kept), and no goals or extras.
 */
export function newStudioProject(appUrl: string, now: number = Date.now(), rng: Rng = randomBytes): StudioProject {
  return {
    format: STUDIO_PROJECT_FORMAT,
    version: 1,
    id: globalThis.crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
    appUrl: appUrl.trim(),
    work: { id: newStudioWorkId(rng), title: '', kind: 'game', version: '1.0.0' },
    kdfIterations: KDF_ITERATIONS_DEFAULT,
    checkpoints: [],
    groups: [{ id: 'endings', label: 'エンディング' }],
    goals: [],
    sealed: [],
    changelog: [],
  };
}

/**
 * A new code (display form) of `kind` that differs from every code already in the project, including the goal's
 * own current one, so 「作り直す」 always changes it (F16 AC2: codes are unique within a project).
 */
export function generateGoalCode(project: StudioProject, kind: CodeKind, rng?: Rng): string {
  const used = new Set<string>();
  for (const g of project.goals) {
    if (typeof g.code !== 'string') continue;
    const parsed = parseCode(g.code);
    if (parsed.ok) used.add(parsed.canonical);
  }
  for (let i = 0; i < CODE_ATTEMPTS; i++) {
    const code = generateCode(kind, rng);
    if (!used.has(code.canonical)) return code.display;
  }
  throw new ShioriError('internal', '合言葉を作れませんでした。もう一度お試しください');
}

// ───────────────────────── 点検 (build + checks) ─────────────────────────

function buildFailure(e: unknown): ValidationIssue {
  if (isShioriError(e)) return issue('', 'build', e.messageJa);
  return issue('', 'build', 'しおりファイルを作れませんでした（予期しないエラーが発生しました）');
}

function leakPreview(s: string): string {
  const chars = [...s.replace(/\s+/g, ' ')];
  return chars.length > LEAK_PREVIEW_CHARS ? `${chars.slice(0, LEAK_PREVIEW_CHARS).join('')}…` : chars.join('');
}

/** JSON keys whose values are random base64url (never searched, like findLeaks). */
const BINARY_KEYS: ReadonlySet<string> = new Set(['iv', 'ct', 'tag', 'salt']);

/** Path ('goals[3].teaser') of the first public string of the manifest that contains `secret`, or ''. */
export function findLeakPath(value: unknown, secret: string): string {
  const walk = (v: unknown, path: (string | number)[]): string | undefined => {
    if (typeof v === 'string') return v.includes(secret) ? formatPath(path) : undefined;
    if (Array.isArray(v)) {
      for (let i = 0; i < v.length; i++) {
        const found = walk(v[i], [...path, i]);
        if (found !== undefined) return found;
      }
      return undefined;
    }
    if (isRecord(v)) {
      for (const [k, child] of Object.entries(v)) {
        if (k.includes(secret)) return formatPath([...path, k]);
        if (BINARY_KEYS.has(k) && typeof child === 'string') continue;
        const found = walk(child, [...path, k]);
        if (found !== undefined) return found;
      }
    }
    return undefined;
  };
  return walk(value, []) ?? '';
}

function leakIssue(manifest: unknown, leak: string): ValidationIssue {
  return issue(
    findLeakPath(manifest, leak),
    'leak',
    `公開用のしおりファイルに秘密の内容が含まれています：「${leakPreview(leak)}」`,
  );
}

/** Adds the issues whose (code, message) is not already listed (lint and validate both warn about some things). */
function addUnique(target: ValidationIssue[], extra: readonly ValidationIssue[]): void {
  const seen = new Set(target.map((i) => `${i.code}\u0000${i.messageJa}`));
  for (const i of extra) {
    const k = `${i.code}\u0000${i.messageJa}`;
    if (seen.has(k)) continue;
    seen.add(k);
    target.push(i);
  }
}

/**
 * 点検: lintProject → (only when lint has no errors) buildManifest → validateManifest → selfTest → no-spoil guard.
 * - Lint errors stop here: no PBKDF2 runs, `build` is absent and the report is not exportable.
 * - A build failure (ShioriError('validation'), e.g. a payload that is too long) becomes an error issue.
 * - Every leak found by findLeaks is an error ('leak').
 * - exportable = no errors && selfTest.ok. Warnings never block; the UI asks for an acknowledgement.
 * The project is not modified: the caller persists `build.salt` into project.kdfSalt (withBuildSalt, or
 * markExported after an export), so that later builds keep the same salt and tags. Otherwise every update of the
 * file makes players' devices re-derive their keys, and the return-code hashes in the kit change.
 */
export async function buildAndCheck(project: StudioProject): Promise<CheckReport> {
  const lint = lintProject(project);
  const errors = lint.filter((i) => i.severity === 'error');
  const warnings = lint.filter((i) => i.severity !== 'error');
  if (errors.length > 0) return { errors, warnings, leaks: [], exportable: false };

  let build: BuildResult;
  try {
    build = await buildManifest(project);
  } catch (e) {
    return { errors: [buildFailure(e)], warnings, leaks: [], exportable: false };
  }

  const validated = validateManifest(build.manifest);
  if (!validated.ok) errors.push(...validated.errors);
  addUnique(warnings, validated.warnings);

  let report: SelfTestReport;
  try {
    report = await selfTest(build.manifest, build.codes, project);
  } catch (e) {
    const detail = isShioriError(e) ? `：${e.messageJa}` : '';
    report = { ok: false, checks: [{ id: 'selftest', ok: false, messageJa: `点検を最後まで実行できませんでした${detail}` }] };
  }

  const leaks = findLeaks(build.json, collectSecrets(project));
  for (const leak of leaks) errors.push(leakIssue(build.manifest, leak));

  return { build, errors, warnings, selfTest: report, leaks, exportable: errors.length === 0 && report.ok };
}

/** The project with kdfSalt = build.salt (unchanged object when it already matches). Persist this after 点検. */
export function withBuildSalt(project: StudioProject, build: Pick<BuildResult, 'salt'>): StudioProject {
  return project.kdfSalt === build.salt ? project : { ...project, kdfSalt: build.salt };
}

/**
 * The project as it should be stored after an export (kit, shiori.json or project backup): kdfSalt = build.salt
 * and lastExportedAt = now, which later triggers 「発売済みの作品では合言葉を変えないでください」 on regeneration.
 * updatedAt is left alone (exporting is not an edit).
 */
export function markExported(project: StudioProject, build: Pick<BuildResult, 'salt'>, now: number = Date.now()): StudioProject {
  return { ...withBuildSalt(project, build), lastExportedAt: now };
}

// ───────────────────────── export ─────────────────────────

export const MSG_STALE_BUILD = '点検のあとで内容が変わりました。もう一度「点検」してから書き出してください';

/**
 * Throws ShioriError('conflict', MSG_STALE_BUILD) when `build` cannot be the build of `project`: another work id,
 * another salt than the project's stored one, or other code goals/codes. (Cheap: no PBKDF2.)
 */
export function assertBuildMatchesProject(project: StudioProject, build: BuildResult): void {
  const expected = project.goals
    .filter((g) => g.unlockType === 'code')
    .map((g) => {
      const parsed = parseCode(g.code ?? '');
      return `${g.id}\u0000${parsed.ok ? parsed.canonical : ''}`;
    });
  const actual = build.codes.map((c) => `${c.goalId}\u0000${c.canonical}`);
  const stale =
    build.manifest.work.id !== project.work.id ||
    (project.kdfSalt !== undefined && project.kdfSalt !== build.salt) ||
    expected.length !== actual.length ||
    expected.some((e, i) => e !== actual[i]);
  if (stale) throw new ShioriError('conflict', MSG_STALE_BUILD);
}

/** 'shiori-kit-<work.id>.zip' (§4.4) */
export function kitZipFileName(project: StudioProject): string {
  return `shiori-kit-${project.work.id}.zip`;
}

/**
 * The creator kit as a zip (fflate): the text files of buildKitTextFiles (UTF-8) in their order, then one QR PNG
 * per code row at 非公開_ゲームに埋め込む/qr/<goalId>.png, rendered by `renderQrPng(row.unlockUrl, row.display)`
 * one after another in code-row order. The project backup inside the kit is markExported(project, build, now):
 * it carries kdfSalt = build.salt and lastExportedAt, so a project restored from the kit keeps its tags and its
 * "already released" state. The caller should store the same (markExported) in the studio repo.
 * A build that no longer matches the project (codes or work id edited after 点検) is refused with
 * ShioriError('conflict') before anything is rendered.
 */
export async function exportKitZip(
  project: StudioProject,
  build: BuildResult,
  renderQrPng: (url: string, caption: string) => Promise<Uint8Array>,
): Promise<Uint8Array> {
  assertBuildMatchesProject(project, build);
  const kitProject = markExported(project, build, Date.now());
  const files: Zippable = {};
  const add = (path: string, bytes: Uint8Array, stored = false) => {
    if (Object.hasOwn(files, path)) throw new ShioriError('internal', `キットのファイル名が重複しています（${path}）`);
    // PNGs are already compressed: store them as they are.
    files[path] = stored ? [bytes, { level: 0 }] : bytes;
  };

  for (const f of buildKitTextFiles({ project: kitProject, json: build.json, codes: build.codes, appUrl: project.appUrl })) {
    add(f.path, typeof f.content === 'string' ? utf8(f.content) : f.content);
  }
  for (const row of build.codes) {
    if (!ID_RE.test(row.goalId)) throw new ShioriError('validation', `目標ID「${row.goalId}」はファイル名に使えません`);
    const png = await renderQrPng(row.unlockUrl, row.display);
    add(`${KIT_QR_DIR}/${row.goalId}.png`, png, true);
  }
  return zipSync(files, { level: 6 });
}

/** The project file ('shiori-studio-project', version 1): pretty-printed JSON. Contains every secret. */
export function exportProjectJson(project: StudioProject): string {
  return JSON.stringify(project, null, 2);
}

function notProject(raw: unknown): ValidationIssue {
  if (isRecord(raw)) {
    if (typeof raw.schema === 'string' && raw.schema.startsWith('shiori/')) {
      return issue('', 'notProject', 'しおりファイル（shiori.json）のようです。工房で読み込めるのはプロジェクトファイルです');
    }
    if (raw.format === 'shiori-backup') {
      return issue('', 'notProject', 'バックアップファイルのようです。設定の「データ」から読み込んでください');
    }
  }
  return issue('', 'notProject', 'サークル工房のプロジェクトファイルではないようです');
}

/**
 * Reads a project file. Checks, in order: size (8 MB) → JSON syntax (Japanese message with the position) →
 * format 'shiori-studio-project' → version (newer → 「新しいバージョンのしおり帳が必要です」) → studioProjectSchema
 * (unknown keys stripped, defaults filled). Failures come back as Japanese ValidationIssue[] (never throws).
 */
export function parseProjectJson(text: string): { ok: true; project: StudioProject } | { ok: false; errors: ValidationIssue[] } {
  const fail = (errors: ValidationIssue[]) => ({ ok: false as const, errors });
  if (typeof text !== 'string') return fail([notProject(undefined)]);
  if (text.length > MAX_PROJECT_BYTES || utf8ByteLength(text) > MAX_PROJECT_BYTES) {
    return fail([issue('', 'tooLarge', `ファイルが大きすぎます（${MAX_PROJECT_BYTES / 1024 / 1024}MBまで）`)]);
  }
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return fail([issue('', 'json', customMessageJa('json', jsonErrorParams(body, message)))]);
  }

  if (!isRecord(raw) || raw.format !== STUDIO_PROJECT_FORMAT) return fail([notProject(raw)]);
  if (typeof raw.version === 'number' && raw.version > 1) {
    return fail([issue('version', 'schemaVersion', customMessageJa('schemaVersion'))]);
  }
  const parsed = studioProjectSchema.safeParse(raw, { reportInput: true });
  if (!parsed.success) return fail(zodIssuesToValidationIssues(parsed.error.issues));
  return { ok: true, project: parsed.data };
}
