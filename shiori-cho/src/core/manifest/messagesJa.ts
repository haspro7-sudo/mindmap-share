/**
 * Maps zod issues and custom validation codes to Japanese messages (docs/SPEC.md §4.2, F5 AC2).
 * Every message returned from this module is Japanese.
 */
import {
  KDF_ITERATIONS_DEFAULT,
  KDF_ITERATIONS_MAX,
  KDF_ITERATIONS_MIN,
  KDF_ITERATIONS_WARN_BELOW,
  MAX_MANIFEST_BYTES,
} from '../constants';
import type { ValidationIssue } from '../types';
import { BIDI_CHAR_CODE, CONTROL_CHAR_CODE, STORE_CODE_RE } from './payloadSchemas';
import { DATE_RE, ID_RE, VERSION_RE, WORK_ID_RE } from './schema';

type Params = Record<string, string | number>;

const IDENT_RE = /^[A-Za-z_$][\w$]*$/;

/** Formats a path array like ['goals', 3, 'hints', 1] → 'goals[3].hints[1]' */
export function formatPath(path: ReadonlyArray<PropertyKey>): string {
  let out = '';
  for (const seg of path) {
    if (typeof seg === 'number') {
      out += `[${seg}]`;
    } else if (typeof seg === 'string') {
      if (/^(0|[1-9]\d*)$/.test(seg)) out += `[${seg}]`;
      else if (IDENT_RE.test(seg)) out += out === '' ? seg : `.${seg}`;
      else out += `[${JSON.stringify(seg)}]`;
    } else {
      out += `[${String(seg)}]`;
    }
  }
  return out;
}

/** 100000 → '100,000' */
function fmtNum(n: number | bigint | string): string {
  const s = String(n);
  return /^-?\d+$/.test(s) ? s.replace(/\B(?=(\d{3})+(?!\d))/g, ',') : s;
}

function str(v: string | number | undefined, fallback = ''): string {
  return v === undefined ? fallback : String(v);
}

// ───────────────────────── Custom codes ─────────────────────────

const CUSTOM: Record<string, (p: Params) => string> = {
  // file level
  notShiori: (p) =>
    p.detected === 'studio'
      ? 'サークル工房のプロジェクトファイルのようです。しおりファイル（shiori.json）を選んでください'
      : p.detected === 'backup'
        ? 'バックアップファイルのようです。設定の「データ」から読み込んでください'
        : 'しおりファイルではないようです',
  schemaVersion: () => '新しいバージョンのしおり帳が必要です',
  tooLarge: () => `ファイルが大きすぎます（${MAX_MANIFEST_BYTES / 1024}KBまで）`,
  json: (p) => {
    if (p.reason === 'empty') return 'JSONの形式が正しくありません（内容が空です）';
    if (p.reason === 'end') return 'JSONの形式が正しくありません（途中で終わっているようです）';
    if (p.line !== undefined && p.column !== undefined) {
      return `JSONの形式が正しくありません（${p.line}行目 ${p.column}文字目付近）`;
    }
    return 'JSONの形式が正しくありません';
  },
  // cross-reference checks
  duplicateId: (p) => `ID「${str(p.id)}」が重複しています`,
  duplicateRef: (p) => `目標「${str(p.id)}」が重複して指定されています`,
  duplicateTag: (p) =>
    p.id !== undefined ? `目標「${p.id}」と同じ合言葉が使われています` : 'ほかの目標と同じ合言葉が使われています',
  danglingGroup: (p) => `グループ「${str(p.id)}」が見つかりません`,
  danglingCheckpoint: (p) => `章「${str(p.id)}」が見つかりません`,
  danglingGoal: (p) => `目標「${str(p.id)}」が見つかりません`,
  sealedRefersManual: (p) =>
    `目標「${str(p.id)}」は合言葉つきの目標ではありません（おまけの条件には合言葉つきの目標だけを指定できます）`,
  wrapsMismatch: () => 'wrapsの目標が条件の目標（unlock.goals）と一致していません',
  emptyGroup: (p) => `グループ「${str(p.label, str(p.id))}」に目標がありません`,
  // kdf
  kdfMissing: () => '合言葉つきの目標やおまけがあるため、鍵の設定（kdf）が必要です',
  kdfUnused: () => '鍵の設定（kdf）がありますが、合言葉つきの目標やおまけがありません',
  kdfIterations: () =>
    `反復回数は${fmtNum(KDF_ITERATIONS_MIN)}〜${fmtNum(KDF_ITERATIONS_MAX)}の整数にしてください`,
  kdfIterationsLow: () =>
    `反復回数が${fmtNum(KDF_ITERATIONS_WARN_BELOW)}未満です（${fmtNum(KDF_ITERATIONS_DEFAULT)}以上をおすすめします）`,
  // binary fields
  invalidBase64: () => 'base64url形式（パディングなし）になっていません',
  saltLength: (p) => `ソルトは16バイトにしてください（現在${str(p.actual, '?')}バイト）`,
  ivLength: (p) => `IVは12バイトにしてください（現在${str(p.actual, '?')}バイト）`,
  tagLength: (p) => `タグは16バイトにしてください（現在${str(p.actual, '?')}バイト）`,
  ctLength: (p) => `暗号文は16〜${fmtNum(65552)}バイトにしてください（現在${fmtNum(str(p.actual, '?'))}バイト）`,
  wrapLength: (p) => `鍵の暗号文は48バイトにしてください（現在${str(p.actual, '?')}バイト）`,
  // text refinements (payloadSchemas.ts)
  [CONTROL_CHAR_CODE]: () => '使えない制御文字が含まれています',
  [BIDI_CHAR_CODE]: () => '文字の向きを変える特殊な文字（U+202A〜202E、U+2066〜2069）は使えません',
  // generic (also produced from zod issues)
  required: () => '必須の項目です',
  invalid: () => '値が正しくありません',
};

/** Codes customMessageJa knows about (exported for tests and UI copy review). */
export const CUSTOM_CODES: readonly string[] = Object.keys(CUSTOM);

/** Japanese message for a custom issue code (e.g. 'duplicateId', 'danglingGroup'). */
export function customMessageJa(code: string, params?: Record<string, string | number>): string {
  const fn = Object.prototype.hasOwnProperty.call(CUSTOM, code) ? CUSTOM[code] : undefined;
  return fn ? fn(params ?? {}) : '値が正しくありません';
}

// ───────────────────────── zod issues ─────────────────────────

const PATTERN_MESSAGES = new Map<string, string>([
  [String(WORK_ID_RE), '作品IDは半角英小文字・数字・「-」の4〜40文字にしてください（先頭は英小文字か数字）'],
  [String(ID_RE), 'IDは半角英小文字・数字・「-」「_」の1〜40文字にしてください（先頭は英小文字か数字）'],
  [String(VERSION_RE), 'バージョンは半角英数字と「.」「+」「-」の20文字以内にしてください'],
  [String(DATE_RE), '日付はYYYY-MM-DDの形式にしてください'],
  [String(STORE_CODE_RE), '作品コードの形式が違います（例: RJ01234567）'],
]);

const TYPE_NAMES: Record<string, string> = {
  string: '文字列',
  number: '数値',
  int: '整数',
  boolean: 'true か false ',
  array: '配列',
  object: 'オブジェクト',
  null: 'null',
};

interface LooseIssue {
  code?: unknown;
  path?: unknown;
  message?: unknown;
  input?: unknown;
  [k: string]: unknown;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function pathOf(iss: LooseIssue): PropertyKey[] {
  return Array.isArray(iss.path) ? (iss.path as PropertyKey[]) : [];
}

function numOf(v: unknown): number | undefined {
  if (typeof v === 'number') return v;
  if (typeof v === 'bigint') return Number(v);
  return undefined;
}

function isMissing(iss: LooseIssue): boolean {
  if ('input' in iss) return iss.input === undefined;
  return typeof iss.message === 'string' && /received undefined$/.test(iss.message);
}

function fmtValue(v: unknown): string {
  return typeof v === 'string' ? v : String(v);
}

function valuesList(values: unknown): string {
  return Array.isArray(values) ? values.map(fmtValue).join(' / ') : '';
}

function customParams(iss: LooseIssue): Params {
  const out: Params = {};
  if (isRecord(iss.params)) {
    for (const [k, v] of Object.entries(iss.params)) {
      if (typeof v === 'string' || typeof v === 'number') out[k] = v;
    }
  }
  return out;
}

function sizeMessage(iss: LooseIssue, big: boolean): { code: string; messageJa: string } {
  const origin = typeof iss.origin === 'string' ? iss.origin : '';
  const limit = numOf(big ? iss.maximum : iss.minimum) ?? 0;
  const inclusive = iss.inclusive !== false;
  const exact = iss.exact === true;
  const n = fmtNum(limit);
  if (origin === 'string') {
    if (exact) return { code: big ? 'tooLong' : 'tooShort', messageJa: `${n}文字にしてください` };
    if (big) return { code: 'tooLong', messageJa: `${n}文字以内にしてください` };
    if (limit <= 1) return { code: 'tooShort', messageJa: '空にはできません' };
    return { code: 'tooShort', messageJa: `${n}文字以上にしてください` };
  }
  if (origin === 'array' || origin === 'set') {
    if (exact) return { code: big ? 'tooMany' : 'tooFew', messageJa: `${n}個にしてください` };
    if (big) return { code: 'tooMany', messageJa: `${n}個までにしてください` };
    if (limit <= 1) return { code: 'tooFew', messageJa: '1つ以上必要です' };
    return { code: 'tooFew', messageJa: `${n}個以上必要です` };
  }
  if (big) return { code: 'tooBig', messageJa: inclusive ? `${n}以下にしてください` : `${n}未満にしてください` };
  return { code: 'tooSmall', messageJa: inclusive ? `${n}以上にしてください` : `${n}より大きくしてください` };
}

function convert(iss: LooseIssue, prefix: readonly PropertyKey[], out: ValidationIssue[]): void {
  const fullPath = [...prefix, ...pathOf(iss)];
  const push = (code: string, messageJa: string): void => {
    out.push({ path: formatPath(fullPath), code, messageJa, severity: 'error' });
  };

  switch (iss.code) {
    case 'invalid_type': {
      if (isMissing(iss)) return push('required', customMessageJa('required'));
      const expected = typeof iss.expected === 'string' ? iss.expected : '';
      const name = TYPE_NAMES[expected];
      return push('invalidType', name ? `${name}で指定してください` : '値の種類が正しくありません');
    }
    case 'too_big':
    case 'too_small': {
      const { code, messageJa } = sizeMessage(iss, iss.code === 'too_big');
      return push(code, messageJa);
    }
    case 'invalid_format': {
      const pattern = typeof iss.pattern === 'string' ? iss.pattern : undefined;
      const known = pattern !== undefined ? PATTERN_MESSAGES.get(pattern) : undefined;
      return push('invalidFormat', known ?? '形式が正しくありません');
    }
    case 'invalid_value': {
      const values = Array.isArray(iss.values) ? iss.values : [];
      if (values.length === 1) return push('invalidValue', `「${fmtValue(values[0])}」にしてください`);
      return push('invalidValue', `次のどれかにしてください：${valuesList(values)}`);
    }
    case 'invalid_union': {
      const branches = Array.isArray(iss.errors) ? (iss.errors as unknown[]).filter(Array.isArray) : [];
      const nonEmpty = branches.filter((b) => b.length > 0) as unknown[][];
      if (nonEmpty.length > 0) {
        // Report the branch that came closest to matching (fewest issues).
        const best = nonEmpty.reduce((a, b) => (b.length < a.length ? b : a));
        for (const sub of best) {
          if (isRecord(sub)) convert(sub as LooseIssue, fullPath, out);
        }
        return;
      }
      if (Array.isArray(iss.options) && iss.options.length > 0) {
        return push('invalidValue', `次のどれかにしてください：${valuesList(iss.options)}`);
      }
      return push('invalid', customMessageJa('invalid'));
    }
    case 'unrecognized_keys': {
      const keys = Array.isArray(iss.keys) ? iss.keys.map(String).join(', ') : '';
      return push('unknownKey', `不明な項目があります：${keys}`);
    }
    case 'not_multiple_of': {
      const d = numOf(iss.divisor);
      return push('invalidNumber', d !== undefined ? `${fmtNum(d)}の倍数にしてください` : '数値が正しくありません');
    }
    case 'custom': {
      const params = customParams(iss);
      const code = typeof params.code === 'string' ? params.code : 'invalid';
      return push(code, customMessageJa(code, params));
    }
    default:
      return push('invalid', customMessageJa('invalid'));
  }
}

/** Converts a zod error's issues into ValidationIssue[] with Japanese messages. */
export function zodIssuesToValidationIssues(issues: ReadonlyArray<unknown>): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  for (const iss of issues) {
    if (isRecord(iss)) convert(iss as LooseIssue, [], out);
  }
  return out;
}
