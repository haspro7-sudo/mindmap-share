// Creator-side lint (errors + warnings) of a StudioProject (docs/SPEC.md F16 AC3, §4.3 "PUBLIC fields").
// Runs without any KDF, so the editor can call it on every change. Every draft state that buildManifest or
// validateManifest would reject should be reported here with its exact path, so the forms show it inline and 点検
// can link to the right tab (the build's own errors are the last line of defence).
import { codeErrorMessageJa, parseCode } from '../codes';
import { KDF_ITERATIONS_MAX, KDF_ITERATIONS_MIN, KDF_ITERATIONS_WARN_BELOW } from '../constants';
import { b64uDecode } from '../encoding';
import { STORE_CODE_INVALID_JA, parseStoreCode } from '../storeCode';
import type { CodeKind, DraftGoal, StudioProject, ValidationIssue } from '../types';
import { formatPath } from './messagesJa';
import { MIN_SECRET_LENGTH, foldText } from './noSpoil';
import { DATE_RE, ID_RE, VERSION_RE, WORK_ID_RE } from './schema';

type Path = ReadonlyArray<string | number>;

function fmtNum(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function kindName(kind: CodeKind): string {
  return kind === 'kana' ? 'ひらがな5語' : '英数字';
}

/** Comparison form for "contains" checks: NFKC, lower case, whitespace removed (the same as the no-spoil guard). */
const fold = foldText;

function isBlank(s: string | undefined): boolean {
  return s === undefined || s.trim() === '';
}

// Characters the manifest schema rejects (docs/SPEC.md §4.2): control characters (other than '\n' in multi-line
// fields) and bidi overrides / isolates.
// eslint-disable-next-line no-control-regex
const CONTROL_SINGLELINE = /[\u0000-\u001F\u007F-\u009F]/;
// eslint-disable-next-line no-control-regex
const CONTROL_MULTILINE = /[\u0000-\u0009\u000B-\u001F\u007F-\u009F]/;
const BIDI = /[\u202A-\u202E\u2066-\u2069]/;

/** https://…, or http:// on localhost / 127.0.0.1 / [::1] (local testing). */
const HTTPS_RE = /^https:\/\/[^\s/?#]+/i;
const LOCAL_HTTP_RE = /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d{1,5})?([/?#]|$)/i;

export function isAllowedAppUrl(url: string): boolean {
  const u = url.trim();
  return HTTPS_RE.test(u) || LOCAL_HTTP_RE.test(u);
}

/** http://localhost, 127.0.0.1 or [::1]: fine for testing, but QR codes and はじめに.txt then point at the test machine. */
export function isLocalAppUrl(url: string): boolean {
  return LOCAL_HTTP_RE.test(url.trim());
}

/**
 * Errors: invalid work.id, empty work title, invalid version or store code; empty checkpoint / group / goal / sealed
 * labels and payload titles; control or bidi characters in any text; code goal without code / invalid code /
 * codeKind mismatch / missing secret title; duplicate codes across goals; duplicate ids; dangling goal.group or
 * missable.before; a missable warning left empty; an empty hint tier before a filled one; sealed with no goals or
 * referencing a manual/unknown goal; returnCode item without payload.returnCode; a half-filled store link; a hint
 * containing the goal's secret title; invalid changelog version or date; iterations outside 100k..2M; an invalid
 * kdfSalt.
 * Warnings: code goal without hints; tier-1 hint equal to or containing the last hint; missable before the first
 * checkpoint; empty group; appUrl not https:// (http://localhost allowed); iterations < 150k; teaser/label
 * containing the secret title.
 * Paths look like 'goals[2].hints[0]'. Errors come first, then warnings.
 */
export function lintProject(project: StudioProject): ValidationIssue[] {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  const error = (path: Path, code: string, messageJa: string) =>
    errors.push({ path: formatPath(path), code, messageJa, severity: 'error' });
  const warn = (path: Path, code: string, messageJa: string) =>
    warnings.push({ path: formatPath(path), code, messageJa, severity: 'warning' });
  /** Control / bidi characters that the manifest schema rejects (`what` names the field in the message). */
  const chars = (path: Path, value: string | undefined, what: string, multiline = false) => {
    if (typeof value !== 'string' || value === '') return;
    if ((multiline ? CONTROL_MULTILINE : CONTROL_SINGLELINE).test(value)) {
      error(
        path,
        'controlChar',
        multiline ? `${what}に、タブなどの見えない制御文字が含まれています` : `${what}に、改行やタブなどの制御文字は使えません（1行で書いてください）`,
      );
    } else if (BIDI.test(value)) {
      error(path, 'bidiChar', `${what}に、文字の向きを変える特殊な文字（U+202A〜202E、U+2066〜2069）は使えません`);
    }
  };
  const required = (path: Path, value: string | undefined, code: string, messageJa: string) => {
    if (isBlank(value)) error(path, code, messageJa);
  };

  // ── work, app URL, kdf ──
  const w = project.work;
  if (!WORK_ID_RE.test(w.id)) {
    error(
      ['work', 'id'],
      'workId',
      '作品IDは半角英小文字・数字・「-」の4〜40文字にしてください（先頭は英小文字か数字）',
    );
  }
  required(['work', 'title'], w.title, 'workTitleMissing', '作品タイトルを入力してください');
  chars(['work', 'title'], w.title, '作品タイトル');
  chars(['work', 'safeTitle'], w.safeTitle, '表示名（おしのび用）');
  chars(['work', 'circle'], w.circle, 'サークル名');
  chars(['authorName'], project.authorName, '作成者名');
  if (!VERSION_RE.test(w.version)) {
    error(['work', 'version'], 'workVersion', 'バージョンは半角英数字と「.」「+」「-」で20文字までにしてください（例：1.0.0）');
  }
  if (w.storeCode !== undefined && !isBlank(w.storeCode) && !parseStoreCode(w.storeCode)) {
    error(['work', 'storeCode'], 'storeCodeInvalid', STORE_CODE_INVALID_JA);
  }
  if (isBlank(project.appUrl)) {
    warn(['appUrl'], 'appUrlMissing', 'アプリのURLが空です（QRコードやはじめに.txtに使われます）');
  } else if (!isAllowedAppUrl(project.appUrl)) {
    warn(['appUrl'], 'appUrlNotHttps', 'アプリのURLは https:// で始まるものにしてください（試験用の http://localhost は使えます）');
  }
  const it = project.kdfIterations;
  if (!Number.isInteger(it) || it < KDF_ITERATIONS_MIN || it > KDF_ITERATIONS_MAX) {
    error(
      ['kdfIterations'],
      'kdfIterations',
      `反復回数は${fmtNum(KDF_ITERATIONS_MIN)}〜${fmtNum(KDF_ITERATIONS_MAX)}の整数にしてください`,
    );
  } else if (it < KDF_ITERATIONS_WARN_BELOW) {
    warn(
      ['kdfIterations'],
      'kdfIterationsLow',
      `反復回数が${fmtNum(KDF_ITERATIONS_WARN_BELOW)}未満です（200,000以上をおすすめします）`,
    );
  }
  if (project.kdfSalt !== undefined) {
    let n = -1;
    try {
      n = b64uDecode(project.kdfSalt).length;
    } catch {
      n = -1;
    }
    if (n !== 16) error(['kdfSalt'], 'kdfSalt', '鍵のソルト（kdfSalt）が正しくありません（16バイトのbase64url）');
  }

  // ── duplicate ids ──
  const collections: ReadonlyArray<readonly [string, ReadonlyArray<{ id: string }>]> = [
    ['checkpoints', project.checkpoints],
    ['groups', project.groups],
    ['goals', project.goals],
    ['sealed', project.sealed],
  ];
  for (const [name, items] of collections) {
    const seen = new Set<string>();
    items.forEach((item, i) => {
      if (!ID_RE.test(item.id)) {
        error([name, i, 'id'], 'idInvalid', `ID「${item.id}」は、半角の英小文字・数字・「-」「_」の40文字までにしてください（先頭は英小文字か数字）`);
      } else if (seen.has(item.id)) {
        error([name, i, 'id'], 'duplicateId', `ID「${item.id}」が重複しています`);
      }
      seen.add(item.id);
    });
  }

  // ── checkpoint / group labels ──
  project.checkpoints.forEach((c, i) => {
    required(['checkpoints', i, 'label'], c.label, 'labelMissing', `章「${c.id}」の名前を入力してください`);
    chars(['checkpoints', i, 'label'], c.label, `章「${c.label || c.id}」の名前`);
  });
  project.groups.forEach((g, i) => {
    required(['groups', i, 'label'], g.label, 'labelMissing', `グループ「${g.id}」の名前を入力してください`);
    chars(['groups', i, 'label'], g.label, `グループ「${g.label || g.id}」の名前`);
  });

  const groupIds = new Set(project.groups.map((g) => g.id));
  const checkpointIndex = new Map<string, number>();
  project.checkpoints.forEach((c, i) => {
    if (!checkpointIndex.has(c.id)) checkpointIndex.set(c.id, i);
  });
  const goalsById = new Map<string, DraftGoal>();
  for (const g of project.goals) if (!goalsById.has(g.id)) goalsById.set(g.id, g);

  // ── goals ──
  const codeOwner = new Map<string, string>();
  project.goals.forEach((g, i) => {
    const at = (...rest: (string | number)[]): Path => ['goals', i, ...rest];
    const name = `目標「${g.label || g.id}」`;

    required(at('label'), g.label, 'labelMissing', `目標「${g.id}」の表示名を入力してください`);
    chars(at('label'), g.label, `${name}の表示名`);
    chars(at('teaser'), g.teaser, `${name}のひとこと`);
    if (!groupIds.has(g.group)) {
      error(at('group'), 'danglingGroup', isBlank(g.group) ? `${name}のグループを選んでください` : `グループ「${g.group}」が見つかりません`);
    }
    if (g.missable && !(isBlank(g.missable.before) && isBlank(g.missable.warn))) {
      required(at('missable', 'warn'), g.missable.warn, 'missableWarnMissing', `${name}の「取り返し注意」の文を入力してください`);
      chars(at('missable', 'warn'), g.missable.warn, `${name}の「取り返し注意」の文`);
      const idx = checkpointIndex.get(g.missable.before);
      if (idx === undefined) {
        error(
          at('missable', 'before'),
          'danglingCheckpoint',
          isBlank(g.missable.before) ? `${name}の「取り返し注意」の章を選んでください` : `章「${g.missable.before}」が見つかりません`,
        );
      } else if (idx === 0) {
        warn(
          at('missable', 'before'),
          'missableBeforeFirst',
          `${name}の「取り返し注意」が最初の章になっています。プレイヤーが現在地を選ぶと、注意が表示されなくなります`,
        );
      }
    }

    const hints = g.hints ?? [];
    // Trailing empty tiers are dropped by the build; an empty tier before a filled one would be an empty hint.
    const lastFilled = hints.reduce((last, h, k) => (isBlank(h) ? last : k), -1);
    hints.forEach((h, k) => {
      if (k < lastFilled && isBlank(h)) {
        error(at('hints', k), 'hintGap', `${name}のヒント${k + 1}が空です。ヒントは1から順に入力してください`);
      } else if (CONTROL_SINGLELINE.test(h)) {
        error(at('hints', k), 'hintControlChar', `${name}のヒント${k + 1}に、改行やタブは使えません（1行で書いてください）`);
      } else {
        chars(at('hints', k), h, `${name}のヒント${k + 1}`);
      }
    });
    if (hints.length >= 2) {
      const first = fold(hints[0] ?? '');
      const last = fold(hints[hints.length - 1] ?? '');
      if (last !== '' && first.includes(last)) {
        warn(
          at('hints', 0),
          'hintRevealsAnswer',
          first === last
            ? `${name}の最初のヒントが最後のヒント（答え）と同じです`
            : `${name}の最初のヒントに、最後のヒント（答え）がそのまま含まれています`,
        );
      }
    }

    if (g.unlockType !== 'code') return;

    // code
    if (isBlank(g.code)) {
      error(at('code'), 'codeMissing', `${name}の合言葉がありません。合言葉を作ってください`);
    } else {
      const parsed = parseCode(g.code ?? '');
      if (!parsed.ok) {
        error(at('code'), 'codeInvalid', `${name}の合言葉が正しくありません：${codeErrorMessageJa(parsed.error)}`);
      } else {
        if (g.codeKind !== undefined && parsed.kind !== g.codeKind) {
          error(
            at('codeKind'),
            'codeKindMismatch',
            `${name}の合言葉は${kindName(parsed.kind)}ですが、種類が${kindName(g.codeKind)}になっています`,
          );
        }
        const owner = codeOwner.get(parsed.canonical);
        if (owner !== undefined) {
          error(at('code'), 'duplicateCode', `${name}の合言葉が、目標「${owner}」と同じです。作り直してください`);
        } else {
          codeOwner.set(parsed.canonical, g.id);
        }
      }
    }

    // secret title and public text that could leak it
    const title = g.secret?.title ?? '';
    if (isBlank(title)) {
      error(at('secret', 'title'), 'secretTitleMissing', `${name}の秘密タイトルを入力してください`);
    }
    chars(at('secret', 'title'), g.secret?.title, `${name}の秘密タイトル`);
    chars(at('secret', 'description'), g.secret?.description, `${name}の説明`, true);
    chars(at('secret', 'unlockMessage'), g.secret?.unlockMessage, `${name}の解放メッセージ`, true);
    if (hints.every((h) => isBlank(h))) {
      warn(at('hints'), 'noHints', `${name}にヒントがありません。詰まったプレイヤーのために1つ以上あると親切です`);
    }
    const t = fold(title);
    // A title identical to the public label is public by the creator's choice.
    if ([...t].length >= MIN_SECRET_LENGTH && t !== fold(g.label)) {
      hints.forEach((h, k) => {
        if (fold(h).includes(t)) {
          error(at('hints', k), 'hintLeaksSecret', `${name}のヒント${k + 1}に秘密タイトルが含まれています（ヒントは公開されます）`);
        }
      });
      if (fold(g.label).includes(t)) {
        warn(at('label'), 'labelLeaksSecret', `${name}の表示名に秘密タイトルが含まれています（表示名は公開されます）`);
      }
      if (g.teaser !== undefined && fold(g.teaser).includes(t)) {
        warn(at('teaser'), 'teaserLeaksSecret', `${name}のひとことに秘密タイトルが含まれています（ひとことは公開されます）`);
      }
    }
  });

  // ── groups without goals ──
  const usedGroups = new Set(project.goals.map((g) => g.group));
  project.groups.forEach((g, i) => {
    if (!usedGroups.has(g.id)) warn(['groups', i], 'emptyGroup', `グループ「${g.label || g.id}」に目標がありません`);
  });

  // ── sealed items ──
  project.sealed.forEach((s, i) => {
    const name = `おまけ「${s.label || s.id}」`;
    const at = (...rest: (string | number)[]): Path => ['sealed', i, ...rest];
    required(at('label'), s.label, 'labelMissing', `おまけ「${s.id}」の表示名を入力してください`);
    chars(at('label'), s.label, `${name}の表示名`);
    chars(at('teaser'), s.teaser, `${name}のひとこと`);
    const p = s.payload;
    required(at('payload', 'title'), p?.title, 'payloadTitleMissing', `${name}の中身のタイトルを入力してください`);
    chars(at('payload', 'title'), p?.title, `${name}のタイトル`);
    chars(at('payload', 'body'), p?.body, `${name}の本文`, true);
    chars(at('payload', 'from'), p?.from, `${name}の署名`);
    chars(at('payload', 'returnCode', 'code'), p?.returnCode?.code, `${name}の返し合言葉`);
    chars(at('payload', 'returnCode', 'instruction'), p?.returnCode?.instruction, `${name}の返し合言葉の案内`, true);
    const link = p?.storeLink;
    if (link && !(isBlank(link.storeCode) && isBlank(link.caption))) {
      if (!parseStoreCode(link.storeCode)) error(at('payload', 'storeLink', 'storeCode'), 'storeCodeInvalid', `${name}のリンク：${STORE_CODE_INVALID_JA}`);
      required(at('payload', 'storeLink', 'caption'), link.caption, 'storeLinkCaptionMissing', `${name}のリンクの説明を入力してください`);
      chars(at('payload', 'storeLink', 'caption'), link.caption, `${name}のリンクの説明`);
    }
    const goals = s.goals ?? [];
    if (goals.length === 0) {
      error(['sealed', i, 'goals'], 'sealedNoGoals', `${name}の条件に、合言葉つきの目標を1つ以上指定してください`);
    }
    goals.forEach((gid, j) => {
      const g = goalsById.get(gid);
      if (!g) {
        error(['sealed', i, 'goals', j], 'danglingGoal', `${name}の条件の目標「${gid}」が見つかりません`);
      } else if (g.unlockType !== 'code') {
        error(
          ['sealed', i, 'goals', j],
          'sealedRefersManual',
          `${name}の条件の目標「${g.label || gid}」は合言葉つきではありません（条件には合言葉つきの目標だけを指定できます）`,
        );
      }
    });
    if (s.kind === 'returnCode') {
      const rc = s.payload?.returnCode;
      if (!rc || isBlank(rc.code)) {
        error(['sealed', i, 'payload', 'returnCode'], 'returnCodeMissing', `${name}は「返し合言葉」なので、返し合言葉を入力してください`);
      } else if (isBlank(rc.instruction)) {
        error(
          ['sealed', i, 'payload', 'returnCode', 'instruction'],
          'returnCodeMissing',
          `${name}の返し合言葉の使い方（どこで入力するか）を入力してください`,
        );
      }
    }
  });

  // ── changelog ──
  project.changelog.forEach((c, i) => {
    const name = `更新履歴「${c.version || i + 1}」`;
    if (!VERSION_RE.test(c.version)) error(['changelog', i, 'version'], 'changelogVersion', `${name}のバージョンが正しくありません（例：1.0.1）`);
    if (!DATE_RE.test(c.date)) error(['changelog', i, 'date'], 'changelogDate', `${name}の日付を選んでください`);
    chars(['changelog', i, 'notes'], c.notes, `${name}の内容`, true);
  });

  return [...errors, ...warnings];
}
