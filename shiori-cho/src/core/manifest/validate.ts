/**
 * shiori.json validation (docs/SPEC.md §4.2, F5 AC2).
 * parseManifestText: size check → JSON.parse (Japanese error with position) → validateManifest.
 * validateManifest: schema id pre-check → zod structure → cross-reference checks.
 */
import { KDF_ITERATIONS_WARN_BELOW, MANIFEST_SCHEMA, MAX_MANIFEST_BYTES } from '../constants';
import { b64uEncode, sha256, utf8 } from '../encoding';
import type { ShioriManifestV1, ValidateResult, ValidationIssue } from '../types';
import { customMessageJa, formatPath, zodIssuesToValidationIssues } from './messagesJa';
import { manifestSchema } from './schema';

type Params = Record<string, string | number>;

function issue(
  path: ReadonlyArray<PropertyKey>,
  code: string,
  severity: ValidationIssue['severity'],
  params?: Params,
): ValidationIssue {
  return { path: formatPath(path), code, messageJa: customMessageJa(code, params), severity };
}

function fail(errors: ValidationIssue[], warnings: ValidationIssue[] = []): ValidateResult {
  return { ok: false, errors, warnings };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

// ───────────────────────── Text → object ─────────────────────────

/** UTF-8 byte length without allocating. Lone surrogates count as 3 bytes (U+FFFD), like TextEncoder. */
export function utf8ByteLength(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      const d = s.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) {
        n += 4;
        i++;
      } else n += 3;
    } else n += 3;
  }
  return n;
}

/**
 * Offset of the first JSON syntax error in `s` (RFC 8259), or -1 if `s` is valid JSON.
 * Used when the engine's SyntaxError message carries no position (Safari, some V8 messages).
 * Iterative, so deeply nested input cannot overflow the stack.
 */
export function locateJsonError(s: string): number {
  const n = s.length;
  let i = 0;
  const stack: number[] = []; // 0 = array, 1 = object
  const ARR = 0;
  const OBJ = 1;

  const skipWs = () => {
    while (i < n) {
      const c = s.charCodeAt(i);
      if (c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d) i++;
      else break;
    }
  };
  const isDigit = (c: number) => c >= 0x30 && c <= 0x39;
  const isHex = (c: number) => isDigit(c) || (c >= 0x41 && c <= 0x46) || (c >= 0x61 && c <= 0x66);

  // Each scanner returns true on success (i after the token) or false with i at the error.
  const scanString = (): boolean => {
    i++; // opening quote
    while (i < n) {
      const c = s.charCodeAt(i);
      if (c === 0x22) {
        i++;
        return true;
      }
      if (c < 0x20) return false;
      if (c === 0x5c) {
        const e = s[i + 1];
        if (e === undefined) {
          i = n;
          return false;
        }
        if ('"\\/bfnrt'.includes(e)) i += 2;
        else if (e === 'u') {
          for (let k = 2; k < 6; k++) {
            if (i + k >= n || !isHex(s.charCodeAt(i + k))) {
              i = Math.min(i + k, n);
              return false;
            }
          }
          i += 6;
        } else {
          i++;
          return false;
        }
      } else i++;
    }
    return false; // unterminated: i === n
  };
  const scanDigits = (): boolean => {
    if (i >= n || !isDigit(s.charCodeAt(i))) return false;
    while (i < n && isDigit(s.charCodeAt(i))) i++;
    return true;
  };
  const scanNumber = (): boolean => {
    if (s[i] === '-') i++;
    if (s[i] === '0') i++;
    else if (!scanDigits()) return false;
    if (s[i] === '.') {
      i++;
      if (!scanDigits()) return false;
    }
    if (s[i] === 'e' || s[i] === 'E') {
      i++;
      if (s[i] === '+' || s[i] === '-') i++;
      if (!scanDigits()) return false;
    }
    return true;
  };
  const scanLiteral = (word: string): boolean => {
    for (let k = 0; k < word.length; k++) {
      if (s[i] !== word[k]) return false;
      i++;
    }
    return true;
  };
  /** Scans one value; for containers it only consumes the opener. Returns 'open' | 'done' | 'error'. */
  const scanValue = (): 'open' | 'done' | 'error' => {
    skipWs();
    const c = s[i];
    if (c === '{' || c === '[') {
      i++;
      skipWs();
      if (s[i] === (c === '{' ? '}' : ']')) {
        i++;
        return 'done';
      }
      stack.push(c === '{' ? OBJ : ARR);
      return 'open';
    }
    if (c === '"') return scanString() ? 'done' : 'error';
    if (c === '-' || (c !== undefined && isDigit(c.charCodeAt(0)))) return scanNumber() ? 'done' : 'error';
    if (c === 't') return scanLiteral('true') ? 'done' : 'error';
    if (c === 'f') return scanLiteral('false') ? 'done' : 'error';
    if (c === 'n') return scanLiteral('null') ? 'done' : 'error';
    return 'error';
  };
  /** Scans `"key":` inside an object. */
  const scanKey = (): boolean => {
    skipWs();
    if (s[i] !== '"' || !scanString()) return false;
    skipWs();
    if (s[i] !== ':') return false;
    i++;
    return true;
  };

  let expectKey = false;
  for (;;) {
    if (expectKey) {
      if (!scanKey()) return i;
      expectKey = false;
    }
    const v = scanValue();
    if (v === 'error') return i;
    if (v === 'open') {
      if (stack[stack.length - 1] === OBJ) expectKey = true;
      continue;
    }
    // After a complete value: close containers or continue with ','.
    for (;;) {
      skipWs();
      if (stack.length === 0) return i < n ? i : -1;
      const top = stack[stack.length - 1];
      const c = s[i];
      if (c === ',') {
        i++;
        if (top === OBJ) expectKey = true;
        break;
      }
      if ((top === ARR && c === ']') || (top === OBJ && c === '}')) {
        stack.pop();
        i++;
        continue;
      }
      return i;
    }
  }
}

/** 1-based line and column (in code points) of a UTF-16 offset. */
function lineColumn(s: string, offset: number): { line: number; column: number } {
  const before = s.slice(0, Math.max(0, Math.min(offset, s.length)));
  let line = 1;
  let lineStart = 0;
  for (let i = 0; i < before.length; i++) {
    if (before.charCodeAt(i) === 0x0a) {
      line++;
      lineStart = i + 1;
    }
  }
  return { line, column: Array.from(before.slice(lineStart)).length + 1 };
}

/** Builds the 'json' issue params from a SyntaxError message (V8/Firefox) or our own locator. */
export function jsonErrorParams(s: string, message: string): Params {
  if (s.trim() === '') return { reason: 'empty' };
  // Anchored at the end so that a snippet of the input quoted inside the message cannot match.
  // V8: "... in JSON at position 12 (line 3 column 1)" / older V8: "... in JSON at position 12"
  const v8 = /at position (\d+)(?: \(line (\d+) column (\d+)\))?$/.exec(message);
  if (v8) {
    if (v8[2] !== undefined && v8[3] !== undefined) return { line: Number(v8[2]), column: Number(v8[3]) };
    return lineColumn(s, Number(v8[1]));
  }
  // Firefox: "JSON.parse: ... at line 1 column 2 of the JSON data"
  const ff = /at line (\d+) column (\d+) of the JSON data$/.exec(message);
  if (ff) return { line: Number(ff[1]), column: Number(ff[2]) };
  const offset = locateJsonError(s);
  if (offset < 0) return {};
  if (offset >= s.length) return { reason: 'end' };
  return lineColumn(s, offset);
}

/** Size check (512 KiB, UTF-8 bytes) → JSON.parse (Japanese error with position) → validateManifest. */
export function parseManifestText(text: string): ValidateResult {
  // Every UTF-16 unit encodes to at least one byte, so a long string is too large without counting.
  if (text.length > MAX_MANIFEST_BYTES || utf8ByteLength(text) > MAX_MANIFEST_BYTES) {
    return fail([issue([], 'tooLarge', 'error')]);
  }
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text; // tolerate a UTF-8 BOM
  let obj: unknown;
  try {
    obj = JSON.parse(body);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return fail([issue([], 'json', 'error', jsonErrorParams(body, message))]);
  }
  return validateManifest(obj);
}

// ───────────────────────── Object → manifest ─────────────────────────

function precheck(obj: unknown): ValidationIssue | undefined {
  if (!isRecord(obj)) return issue([], 'notShiori', 'error');
  const schema = obj.schema;
  if (schema === MANIFEST_SCHEMA) return undefined;
  if (typeof schema === 'string' && schema.startsWith('shiori/')) return issue(['schema'], 'schemaVersion', 'error');
  if (obj.format === 'shiori-studio-project') return issue([], 'notShiori', 'error', { detected: 'studio' });
  if (obj.format === 'shiori-backup') return issue([], 'notShiori', 'error', { detected: 'backup' });
  return issue([], 'notShiori', 'error');
}

function checkDuplicateIds(
  items: readonly { id: string }[],
  collection: string,
  errors: ValidationIssue[],
): void {
  const seen = new Set<string>();
  items.forEach((item, i) => {
    if (seen.has(item.id)) errors.push(issue([collection, i, 'id'], 'duplicateId', 'error', { id: item.id }));
    seen.add(item.id);
  });
}

function crossCheck(m: ShioriManifestV1): { errors: ValidationIssue[]; warnings: ValidationIssue[] } {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];

  // kdf presence and strength
  const hasCodeGoal = m.goals.some((g) => g.unlock.type === 'code');
  const needsKdf = hasCodeGoal || m.sealed.length > 0;
  if (needsKdf && !m.kdf) errors.push(issue(['kdf'], 'kdfMissing', 'error'));
  if (m.kdf) {
    if (!needsKdf) warnings.push(issue(['kdf'], 'kdfUnused', 'warning'));
    if (m.kdf.iterations < KDF_ITERATIONS_WARN_BELOW) {
      warnings.push(issue(['kdf', 'iterations'], 'kdfIterationsLow', 'warning', { iterations: m.kdf.iterations }));
    }
  }

  // unique ids per collection
  checkDuplicateIds(m.checkpoints, 'checkpoints', errors);
  checkDuplicateIds(m.groups, 'groups', errors);
  checkDuplicateIds(m.goals, 'goals', errors);
  checkDuplicateIds(m.sealed, 'sealed', errors);

  const checkpointIds = new Set(m.checkpoints.map((c) => c.id));
  const groupIds = new Set(m.groups.map((g) => g.id));
  const goalsById = new Map<string, ShioriManifestV1['goals'][number]>();
  for (const g of m.goals) if (!goalsById.has(g.id)) goalsById.set(g.id, g);

  // goal references and tag uniqueness
  const tagOwner = new Map<string, string>();
  m.goals.forEach((g, i) => {
    if (!groupIds.has(g.group)) errors.push(issue(['goals', i, 'group'], 'danglingGroup', 'error', { id: g.group }));
    if (g.missable && !checkpointIds.has(g.missable.before)) {
      errors.push(
        issue(['goals', i, 'missable', 'before'], 'danglingCheckpoint', 'error', { id: g.missable.before }),
      );
    }
    if (g.unlock.type === 'code') {
      const owner = tagOwner.get(g.unlock.tag);
      if (owner !== undefined) {
        errors.push(issue(['goals', i, 'unlock', 'tag'], 'duplicateTag', 'error', { id: owner }));
      } else tagOwner.set(g.unlock.tag, g.id);
    }
  });

  // sealed conditions
  m.sealed.forEach((s, i) => {
    s.unlock.goals.forEach((gid, j) => {
      const g = goalsById.get(gid);
      const path = ['sealed', i, 'unlock', 'goals', j];
      if (!g) errors.push(issue(path, 'danglingGoal', 'error', { id: gid }));
      else if (g.unlock.type !== 'code') errors.push(issue(path, 'sealedRefersManual', 'error', { id: gid }));
    });
    if (s.unlock.mode === 'anyOf') {
      const goals = new Set(s.unlock.goals);
      const wrapGoals = s.unlock.wraps.map((w) => w.goal);
      const wrapSet = new Set(wrapGoals);
      const same =
        wrapGoals.length === wrapSet.size && wrapSet.size === goals.size && wrapGoals.every((gid) => goals.has(gid));
      if (!same) errors.push(issue(['sealed', i, 'unlock', 'wraps'], 'wrapsMismatch', 'error'));
    }
  });

  // groups without goals
  const usedGroups = new Set(m.goals.map((g) => g.group));
  m.groups.forEach((g, i) => {
    if (!usedGroups.has(g.id)) warnings.push(issue(['groups', i], 'emptyGroup', 'warning', { id: g.id, label: g.label }));
  });

  return { errors, warnings };
}

/** Structural (zod) + cross-reference + binary-length checks. Unknown keys stripped. Defaults filled. */
export function validateManifest(obj: unknown): ValidateResult {
  const pre = precheck(obj);
  if (pre) return fail([pre]);
  const parsed = manifestSchema.safeParse(obj, { reportInput: true });
  if (!parsed.success) return fail(zodIssuesToValidationIssues(parsed.error.issues));
  const { errors, warnings } = crossCheck(parsed.data);
  if (errors.length > 0) return fail(errors, warnings);
  return { ok: true, manifest: parsed.data, warnings };
}

/** b64u(SHA-256(utf8(JSON.stringify(manifest)))) */
export async function manifestKey(m: ShioriManifestV1): Promise<string> {
  return b64uEncode(await sha256(utf8(JSON.stringify(m))));
}
