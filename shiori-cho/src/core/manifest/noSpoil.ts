// The no-spoil guard (docs/SPEC.md F16 AC4): the exported shiori.json must contain no plaintext code, secret title
// (unless identical to its public label), description, unlock message, payload title or body, or return code.
// A letter's `from` signature is not on that list: it is only a soft secret (collectSignatures), which the studio
// reports as a warning when it also appears in public text.
//
// Matching is by normalized haystack, not by listing spellings: a code is found in any spelling the app's own
// parser accepts (any width, case, separators, O/I/L aliases, katakana or half-width katakana), and secret texts
// are also compared with width, case and whitespace folded away.
import { CROCKFORD_ALPHABET, normalizeKana, parseCode } from '../codes';
import { KANA_DISPLAY_SEPARATOR, KANA_WORD_LENGTH, foldSpacingVoicedMarks } from '../codes/kana';
import type { CodeKind, StudioProject } from '../types';

/** Secrets shorter than this (in code points) are skipped: they would match by accident. */
export const MIN_SECRET_LENGTH = 2;

/** JSON keys whose string values are random base64url (never meaningful text). */
const BINARY_KEYS: ReadonlySet<string> = new Set(['iv', 'ct', 'tag', 'salt']);
/**
 * JSON keys whose string values come from a fixed vocabulary of the format (schema name, kinds, engines, modes,
 * algorithm), never from the creator. Like the keys themselves, they are only searched for the exact secret: a
 * folded or respelled match there ('After' in the kind 'afterword') would be a false alarm.
 */
const FIXED_VALUE_KEYS: ReadonlySet<string> = new Set(['schema', 'kind', 'engine', 'mode', 'type', 'codeKind', 'alg']);

/** True for a key whose values are fixed vocabulary (see leakMatcher's `fixed`). */
export function isFixedValueKey(key: string): boolean {
  return FIXED_VALUE_KEYS.has(key);
}
/** The same fields inside JSON text; their values are blanked before substring search. */
const BINARY_FIELD_RE = /"(iv|ct|tag|salt)"(\s*):(\s*)"[A-Za-z0-9_-]*"/g;

function charLength(s: string): number {
  return [...s].length;
}

function toKatakana(s: string): string {
  return s.replace(/[ぁ-ゖ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) + 0x60));
}

/**
 * Comparison form of free text for "contains" checks: NFKC (full-width → half-width), lower case, whitespace
 * removed. Shared with lint.ts so the editor and the guard agree.
 */
export function foldText(s: string): string {
  return s.normalize('NFKC').toLowerCase().replace(/\s+/g, '');
}

// ───────────────────────── normalized code search ─────────────────────────

const B32_ALIASES: Readonly<Record<string, string>> = { O: '0', I: '1', L: '1' };
const NOT_B32 = new RegExp(`[^${CROCKFORD_ALPHABET}]`, 'g');
/** Hiragana letters (after normalizeKana every kana word is made of these). */
const NOT_HIRAGANA = /[^ぁ-ゖ]/gu;

/**
 * Every Base32 code a player could type from `s`, run together: NFKC, ASCII upper case, the O→0 / I,L→1 aliases,
 * then everything outside the Crockford alphabet removed (separators, spaces, other text).
 */
function b32Haystack(s: string): string {
  return foldSpacingVoicedMarks(s)
    .normalize('NFKC')
    .replace(/[a-z]/g, (c) => c.toUpperCase())
    .replace(/[OIL]/g, (c) => B32_ALIASES[c] ?? c)
    .replace(NOT_B32, '');
}

/** Every kana code a player could type from `s`, run together: normalizeKana, then only hiragana letters kept. */
function kanaHaystack(s: string): string {
  return normalizeKana(s).replace(NOT_HIRAGANA, '');
}

/**
 * Every plaintext form a code could take in a public text: the raw draft input, the display form,
 * the canonical form and the bare 9-character / 15-kana form, plus common spellings (other separators,
 * lower case for Base32, katakana for kana codes). findLeaks also finds any other spelling parseCode accepts.
 */
export function codeSecretForms(code: string): string[] {
  const out: string[] = [];
  const raw = code.trim();
  if (raw !== '') out.push(raw);
  const parsed = parseCode(code);
  if (!parsed.ok) return out;
  const { canonical, display, kind } = parsed;
  const bare = canonical.slice(canonical.indexOf(':') + 1);
  out.push(display, canonical, bare);
  if (kind === 'b32') {
    const groups = display.split('-');
    out.push(groups.join(' '), display.toLowerCase(), bare.toLowerCase());
  } else {
    const chars = [...bare];
    const words: string[] = [];
    for (let i = 0; i < chars.length; i += KANA_WORD_LENGTH) words.push(chars.slice(i, i + KANA_WORD_LENGTH).join(''));
    for (const sep of [' ', '　', '、', ',']) out.push(words.join(sep));
    out.push(toKatakana(bare), toKatakana(words.join(KANA_DISPLAY_SEPARATOR)));
  }
  return out;
}

// ───────────────────────── collecting secrets ─────────────────────────

/** True when `secret` is already public as `label` (identical after trimming, or after folding width/case/spaces). */
function sameAsPublic(secret: string, label: string): boolean {
  return secret.trim() === label.trim() || foldText(secret) === foldText(label);
}

/**
 * All secret strings of a project that must never appear in the public JSON (F16 AC4): codes in display+canonical
 * forms, secret titles unless equal to the public label, descriptions, unlock messages, payload titles and bodies,
 * and return codes. Empty/very short strings (< 2 chars) are skipped. A payload title identical to its sealed item's
 * public label is skipped too (it is public already). `from` signatures are not collected (see collectSignatures).
 */
export function collectSecrets(project: StudioProject): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (s: string | undefined) => {
    if (typeof s !== 'string') return;
    const t = s.trim();
    if (charLength(t) < MIN_SECRET_LENGTH || seen.has(t)) return;
    seen.add(t);
    out.push(t);
  };

  for (const g of project.goals) {
    if (g.unlockType !== 'code') continue;
    if (typeof g.code === 'string') for (const form of codeSecretForms(g.code)) add(form);
    const secret = g.secret;
    if (!secret) continue;
    if (typeof secret.title === 'string' && !sameAsPublic(secret.title, g.label)) add(secret.title);
    add(secret.description);
    add(secret.unlockMessage);
  }
  for (const s of project.sealed) {
    const p = s.payload;
    if (!p) continue;
    if (typeof p.title === 'string' && !sameAsPublic(p.title, s.label)) add(p.title);
    add(p.body);
    add(p.returnCode?.code);
  }
  return out;
}

export interface SignatureSecret {
  /** index in project.sealed */
  index: number;
  /** public label of the sealed item */
  label: string;
  /** the trimmed signature */
  from: string;
}

/**
 * The `from` signatures of sealed extras: soft secrets. They are not on the F16 AC4 list, and a letter is usually
 * signed by a character who is named in public text, so a match is only a warning in the studio. Signatures equal
 * to the public circle or author name, and very short ones, are skipped.
 */
export function collectSignatures(project: StudioProject): SignatureSecret[] {
  const publicNames = [project.work.circle, project.authorName].filter((n): n is string => typeof n === 'string' && n.trim() !== '');
  const out: SignatureSecret[] = [];
  const seen = new Set<string>();
  project.sealed.forEach((s, index) => {
    const from = s.payload?.from?.trim();
    if (!from || charLength(from) < MIN_SECRET_LENGTH || seen.has(from)) return;
    if (publicNames.some((n) => sameAsPublic(from, n))) return;
    seen.add(from);
    out.push({ index, label: s.label, from });
  });
  return out;
}

// ───────────────────────── matching ─────────────────────────

/** A public string prepared once for every kind of comparison. */
interface Haystack {
  raw: string;
  /** a key or a fixed-vocabulary value: compared with the exact secret only */
  fixed: boolean;
  folded: string;
  b32?: string;
  kana?: string;
}

function haystack(raw: string, fixed = false): Haystack {
  return { raw, fixed, folded: fixed ? '' : foldText(raw) };
}

function b32Of(h: Haystack): string {
  h.b32 ??= b32Haystack(h.raw);
  return h.b32;
}

function kanaOf(h: Haystack): string {
  h.kana ??= kanaHaystack(h.raw);
  return h.kana;
}

/** A secret prepared once: exact forms, the folded form, and the bare canonical when it is a code. */
interface Needle {
  secret: string;
  forms: string[];
  folded?: string;
  code?: { kind: CodeKind; canonical: string; bare: string };
}

function needle(secret: string, withEscaped: boolean): Needle {
  const forms = [secret];
  if (withEscaped) {
    const escaped = JSON.stringify(secret).slice(1, -1);
    if (escaped !== secret) forms.push(escaped);
  }
  const folded = foldText(secret);
  const n: Needle = { secret, forms };
  if (charLength(folded) >= MIN_SECRET_LENGTH) n.folded = folded;
  const parsed = parseCode(secret);
  if (parsed.ok) {
    n.code = { kind: parsed.kind, canonical: parsed.canonical, bare: parsed.canonical.slice(parsed.canonical.indexOf(':') + 1) };
  }
  return n;
}

function matches(h: Haystack, n: Needle): boolean {
  if (n.forms.some((f) => h.raw.includes(f))) return true;
  if (h.fixed) return false;
  if (n.folded !== undefined && h.folded.includes(n.folded)) return true;
  if (n.code) return (n.code.kind === 'b32' ? b32Of(h) : kanaOf(h)).includes(n.code.bare);
  return false;
}

/**
 * A predicate telling whether a public string contains `secret` in any form findLeaks would report
 * (exact, width/case/space folded, or — for a code — any spelling the parser accepts). Used to locate a leak.
 * Pass `fixed` for a JSON key or a value of a fixed-vocabulary key (isFixedValueKey): exact matches only.
 */
export function leakMatcher(secret: string): (publicText: string, fixed?: boolean) => boolean {
  const n = needle(secret, false);
  return (text, fixed = false) => matches(haystack(text, fixed), n);
}

/**
 * Every key and string value of a parsed JSON document except the base64url binary fields. Keys and
 * fixed-vocabulary values are marked `fixed`.
 */
function publicStrings(value: unknown, out: Haystack[], key?: string): void {
  if (typeof value === 'string') {
    if (key === undefined || !BINARY_KEYS.has(key)) out.push(haystack(value, key !== undefined && FIXED_VALUE_KEYS.has(key)));
  } else if (Array.isArray(value)) {
    for (const v of value) publicStrings(v, out);
  } else if (typeof value === 'object' && value !== null) {
    for (const [k, v] of Object.entries(value)) {
      out.push(haystack(k, true));
      publicStrings(v, out, k);
    }
  }
}

/**
 * Returns the secrets that occur in `json`, each at most once (the forms of one code are reported once).
 *
 * If `json` parses, every decoded key and string value is searched, so any escaping style is covered and
 * numbers such as `"iterations": 200000` cannot match a short secret like 「0000」. Otherwise the text is
 * searched for each secret both raw and JSON-escaped (so multi-line bodies are found). Either way the random
 * base64url values of iv/ct/tag/salt are left out, so short secrets cannot match them by chance.
 *
 * Each public string is compared three ways: the exact secret; its folded form (NFKC, lower case, no whitespace —
 * 「ＡＢＣ」 or 「星図 の果て」 still match); and, for a secret that is a code, every spelling parseCode accepts
 * (full-width, other separators, O for 0, katakana, half-width katakana, words split by spaces…). Keys and values
 * of fixed-vocabulary keys (kind, engine, mode…) are compared with the exact secret only.
 */
export function findLeaks(json: string, secrets: readonly string[]): string[] {
  let haystacks: Haystack[];
  let raw: boolean;
  try {
    haystacks = [];
    publicStrings(JSON.parse(json) as unknown, haystacks);
    raw = false;
  } catch {
    haystacks = [haystack(json.replace(BINARY_FIELD_RE, '"$1"$2:$3""'))];
    raw = true;
  }

  const leaks: string[] = [];
  const reported = new Set<string>();
  const reportedCodes = new Set<string>();
  for (const s of secrets) {
    if (typeof s !== 'string' || charLength(s) < MIN_SECRET_LENGTH || reported.has(s)) continue;
    const n = needle(s, raw);
    if (n.code && reportedCodes.has(n.code.canonical)) continue;
    if (haystacks.some((h) => matches(h, n))) {
      reported.add(s);
      if (n.code) reportedCodes.add(n.code.canonical);
      leaks.push(s);
    }
  }
  return leaks;
}
