// Self-test (点検) of a built manifest: validates it, redeems every code, opens every goal secret and sealed item,
// and runs the no-spoil guard (docs/SPEC.md F16 AC3–AC4).
import { openGoalSecret, openItem } from '../crypto/shiori';
import { redeem } from '../redeem';
import type {
  Bytes,
  CodeRow,
  KdfParams,
  SealedItem,
  SelfTestCheck,
  SelfTestReport,
  ShioriManifestV1,
  StudioProject,
  ValidationIssue,
} from '../types';
import { normalizeGoalSecret, normalizePayload } from './build';
import { collectSecrets, findLeaks } from './noSpoil';
import { validateManifest } from './validate';

const SELFTEST_KEY = 'selftest';
const ISSUES_IN_MESSAGE = 3;
const LEAKS_IN_MESSAGE = 3;
const LEAK_PREVIEW_CHARS = 20;

/** Structural equality of JSON-like values; object key order is ignored and undefined-valued keys count as absent. */
export function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => jsonEqual(v, b[i]));
  }
  const ra = a as Record<string, unknown>;
  const rb = b as Record<string, unknown>;
  const ka = Object.keys(ra).filter((k) => ra[k] !== undefined);
  const kb = Object.keys(rb).filter((k) => rb[k] !== undefined);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => Object.hasOwn(rb, k) && jsonEqual(ra[k], rb[k]));
}

function check(id: string, ok: boolean, messageJa: string): SelfTestCheck {
  return { id, ok, messageJa };
}

function issuesText(issues: readonly ValidationIssue[]): string {
  const shown = issues
    .slice(0, ISSUES_IN_MESSAGE)
    .map((i) => (i.path === '' ? i.messageJa : `${i.path}：${i.messageJa}`))
    .join(' ／ ');
  return issues.length > ISSUES_IN_MESSAGE ? `${shown}（ほか${issues.length - ISSUES_IN_MESSAGE}件）` : shown;
}

function preview(s: string): string {
  const oneLine = s.replace(/\s+/g, ' ');
  const chars = [...oneLine];
  return chars.length > LEAK_PREVIEW_CHARS ? `${chars.slice(0, LEAK_PREVIEW_CHARS).join('')}…` : oneLine;
}

function reason(e: unknown): string {
  if (typeof e === 'object' && e !== null && 'messageJa' in e && typeof e.messageJa === 'string') return e.messageJa;
  return '予期しないエラーが発生しました';
}

/** A 32-byte value that is certainly not any goal's master (used to prove allOf needs every code). */
function wrongMaster(real: Uint8Array): Bytes {
  const out = new Uint8Array(real.length) as Bytes;
  for (let i = 0; i < real.length; i++) out[i] = real[i]! ^ 0xa5;
  return out;
}

async function openOrError(
  args: Parameters<typeof openItem>[0],
): Promise<{ ok: true; payload: Awaited<ReturnType<typeof openItem>> } | { ok: false; error: unknown }> {
  try {
    return { ok: true, payload: await openItem(args) };
  } catch (error) {
    return { ok: false, error };
  }
}

async function checkSealed(
  item: SealedItem,
  project: StudioProject,
  manifest: ShioriManifestV1,
  kdf: KdfParams,
  masters: ReadonlyMap<string, Bytes>,
): Promise<SelfTestCheck[]> {
  const id = `sealed:${item.id}`;
  const name = `おまけ「${item.label}」（${item.id}）`;
  const draft = project.sealed.find((s) => s.id === item.id);
  if (!draft) return [check(id, false, `${name}がプロジェクトに見つかりません`)];
  const missing = item.unlock.goals.filter((g) => !masters.has(g));
  if (missing.length > 0) {
    return [check(id, false, `${name}を確かめられません（目標「${missing.join('」「')}」の合言葉が確認できていません）`)];
  }

  const expected = normalizePayload(draft.payload, draft.kind);
  const workId = manifest.work.id;
  const all = Object.create(null) as Record<string, Uint8Array>;
  for (const g of item.unlock.goals) all[g] = masters.get(g)!;

  const out: SelfTestCheck[] = [];
  const opened = await openOrError({ workId, kdf, item, masters: all });
  let ok = opened.ok && opened.payload !== null && jsonEqual(opened.payload, expected);
  let message = ok
    ? `${name}を開けました`
    : opened.ok
      ? `${name}の中身が、プロジェクトの内容と一致しません`
      : `${name}を開けません：${reason(opened.error)}`;
  // anyOf: every listed code alone must open it (checks each wrap).
  if (ok && item.unlock.mode === 'anyOf') {
    for (const g of item.unlock.goals) {
      const single = await openOrError({ workId, kdf, item, masters: { [g]: all[g]! } });
      if (!single.ok || single.payload === null || !jsonEqual(single.payload, expected)) {
        ok = false;
        message = `${name}を目標「${g}」の合言葉だけで開けません`;
        break;
      }
    }
    if (ok) message = `${name}を、条件のどの合言葉でも開けました`;
  }
  out.push(check(id, ok, message));

  // allOf with ≥2 goals: a missing or wrong master must never open it.
  if (item.unlock.mode === 'allOf' && item.unlock.goals.length >= 2) {
    const strictId = `sealedStrict:${item.id}`;
    let strictOk = true;
    let strictMessage = `${name}は、すべての合言葉がそろうまで開かないことを確かめました`;
    for (const g of item.unlock.goals) {
      const without = Object.create(null) as Record<string, Uint8Array>;
      const wrong = Object.create(null) as Record<string, Uint8Array>;
      for (const h of item.unlock.goals) {
        if (h !== g) without[h] = all[h]!;
        wrong[h] = h === g ? wrongMaster(all[h]!) : all[h]!;
      }
      const a = await openOrError({ workId, kdf, item, masters: without });
      const b = await openOrError({ workId, kdf, item, masters: wrong });
      const aOk = a.ok && a.payload === null;
      const bOk = !b.ok || b.payload === null;
      if (!aOk || !bOk) {
        strictOk = false;
        strictMessage = `${name}が、目標「${g}」の合言葉なしでも開けてしまいます`;
        break;
      }
    }
    out.push(check(strictId, strictOk, strictMessage));
  }
  return out;
}

/**
 * Checks (each `{ id, ok, messageJa }`):
 * - 'validate': the manifest (after a JSON round trip, like an import) passes validateManifest.
 * - 'redeem:<goalId>': the code row's display form redeems exactly that goal (one PBKDF2 per row).
 * - 'secret:<goalId>': the goal secret opens with that master and equals the project's secret.
 * - 'sealed:<id>': the item opens with the masters of all its goals and equals the project's payload
 *   (anyOf items are also opened with each goal's master alone).
 * - 'sealedStrict:<id>' (allOf with ≥2 goals): with any one master missing or wrong it does not open.
 * - 'noSpoil': the public JSON contains none of the project's secrets.
 * `ok` is true iff every check passed. Masters come from the redeem results (no extra PBKDF2).
 */
export async function selfTest(manifest: ShioriManifestV1, codes: readonly CodeRow[], project: StudioProject): Promise<SelfTestReport> {
  const checks: SelfTestCheck[] = [];
  const json = JSON.stringify(manifest);

  // validate (as a player's import would see it)
  let m = manifest;
  const validated = validateManifest(JSON.parse(json) as unknown);
  if (validated.ok) {
    m = validated.manifest;
    checks.push(check('validate', true, 'しおりファイルの形式に問題はありません'));
  } else {
    checks.push(check('validate', false, `しおりファイルの形式に問題があります：${issuesText(validated.errors)}`));
  }

  // redeem every code row (in parallel: one PBKDF2 each)
  const candidates = [{ manifestKey: SELFTEST_KEY, manifest: m }];
  const results = await Promise.all(
    codes.map(async (row) => {
      try {
        return { row, result: await redeem(row.display, candidates, { preferWorkId: m.work.id }) };
      } catch (error) {
        return { row, error };
      }
    }),
  );
  const masters = new Map<string, Bytes>();
  const kdf = m.kdf;
  for (const r of results) {
    const { row } = r;
    const id = `redeem:${row.goalId}`;
    const name = `目標「${row.label}」（${row.goalId}）`;
    const result = 'result' in r ? r.result : undefined;
    const matched =
      result?.status === 'matched' && result.goalId === row.goalId && result.canonical === row.canonical;
    if (matched) {
      masters.set(row.goalId, result.master);
      checks.push(check(id, true, `${name}の合言葉で解放できました`));
    } else if (!result) {
      checks.push(check(id, false, `${name}の合言葉を確かめられません：${reason('error' in r ? r.error : undefined)}`));
    } else if (result.status === 'invalid') {
      checks.push(check(id, false, `${name}の合言葉の形式が正しくありません`));
    } else if (result.status === 'matched') {
      checks.push(check(id, false, `${name}の合言葉で、別の目標「${result.goalId}」が解放されてしまいます`));
    } else {
      checks.push(check(id, false, `${name}の合言葉で解放できません`));
    }
  }
  // code goals that have no row in the code sheet
  const rowIds = new Set(codes.map((c) => c.goalId));
  for (const g of m.goals) {
    if (g.unlock.type === 'code' && !rowIds.has(g.id)) {
      checks.push(check(`redeem:${g.id}`, false, `目標「${g.label}」（${g.id}）の合言葉が控えにありません`));
    }
  }

  // goal secrets
  for (const row of codes) {
    const id = `secret:${row.goalId}`;
    const name = `目標「${row.label}」（${row.goalId}）`;
    const goal = m.goals.find((g) => g.id === row.goalId);
    const draft = project.goals.find((g) => g.id === row.goalId);
    const master = masters.get(row.goalId);
    if (!goal || goal.unlock.type !== 'code' || !('secret' in goal)) {
      checks.push(check(id, false, `${name}がしおりファイルに見つかりません`));
    } else if (!draft?.secret) {
      checks.push(check(id, false, `${name}の秘密情報がプロジェクトに見つかりません`));
    } else if (!master || !kdf) {
      checks.push(check(id, false, `${name}の秘密情報を確かめられません（合言葉で解放できていません）`));
    } else {
      try {
        const secret = await openGoalSecret(master, kdf, m.work.id, goal.id, goal.secret);
        const same = jsonEqual(secret, normalizeGoalSecret(draft.secret));
        checks.push(
          check(id, same, same ? `${name}の秘密タイトルなどを復号できました` : `${name}の秘密情報が、プロジェクトの内容と一致しません`),
        );
      } catch (e) {
        checks.push(check(id, false, `${name}の秘密情報を復号できません：${reason(e)}`));
      }
    }
  }

  // sealed items (every project item must be in the manifest)
  for (const draft of project.sealed) {
    if (!m.sealed.some((s) => s.id === draft.id)) {
      checks.push(check(`sealed:${draft.id}`, false, `おまけ「${draft.label}」（${draft.id}）がしおりファイルに見つかりません`));
    }
  }
  for (const item of m.sealed) {
    if (!kdf) {
      checks.push(check(`sealed:${item.id}`, false, `おまけ「${item.label}」（${item.id}）を確かめられません（鍵の設定がありません）`));
      continue;
    }
    checks.push(...(await checkSealed(item, project, m, kdf, masters)));
  }

  // no-spoil guard
  const leaks = findLeaks(json, collectSecrets(project));
  if (leaks.length === 0) {
    checks.push(check('noSpoil', true, 'しおりファイルに合言葉や秘密の文字列は含まれていません'));
  } else {
    const shown = leaks.slice(0, LEAKS_IN_MESSAGE).map((s) => `「${preview(s)}」`).join('、');
    const more = leaks.length > LEAKS_IN_MESSAGE ? `ほか${leaks.length - LEAKS_IN_MESSAGE}件` : '';
    checks.push(check('noSpoil', false, `しおりファイルに秘密の文字列が含まれています：${shown}${more}`));
  }

  return { ok: checks.length > 0 && checks.every((c) => c.ok), checks };
}
