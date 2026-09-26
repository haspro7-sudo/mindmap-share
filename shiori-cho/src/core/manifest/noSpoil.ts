// The no-spoil guard (docs/SPEC.md F16 AC4): the exported shiori.json must contain no plaintext code,
// secret title (unless identical to its public label), description, unlock message, payload title/body/from,
// or return code.
import { KANA_DISPLAY_SEPARATOR, KANA_WORD_LENGTH } from '../codes/kana';
import { parseCode } from '../codes';
import type { StudioProject } from '../types';

/** Secrets shorter than this (in code points) are skipped: they would match by accident. */
export const MIN_SECRET_LENGTH = 2;

/** JSON keys whose string values are random base64url (never meaningful text). */
const BINARY_KEYS: ReadonlySet<string> = new Set(['iv', 'ct', 'tag', 'salt']);
/** The same fields inside JSON text; their values are blanked before substring search. */
const BINARY_FIELD_RE = /"(iv|ct|tag|salt)"(\s*):(\s*)"[A-Za-z0-9_-]*"/g;

function charLength(s: string): number {
  return [...s].length;
}

function toKatakana(s: string): string {
  return s.replace(/[ぁ-ゖ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) + 0x60));
}

/**
 * Every plaintext form a code could take in a public text: the raw draft input, the display form,
 * the canonical form and the bare 9-character / 15-kana form, plus common spellings (other separators,
 * lower case for Base32, katakana for kana codes).
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

/**
 * All secret strings of a project that must never appear in the public JSON (codes in display+canonical
 * forms, secret titles unless equal to the public label, descriptions, unlock messages, payload
 * titles/bodies/from, return codes). Empty/very short strings (< 2 chars) are skipped.
 * Like a secret title identical to its public label, a payload title identical to its sealed item's public
 * label and a `from` signature identical to the public circle/author name are skipped (they are public already).
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
    if (typeof secret.title === 'string' && secret.title.trim() !== g.label.trim()) add(secret.title);
    add(secret.description);
    add(secret.unlockMessage);
  }
  // A letter signed with the circle's (public) name is not a secret.
  const publicNames = new Set([project.work.circle, project.authorName].filter((n) => n !== undefined).map((n) => n.trim()));
  for (const s of project.sealed) {
    const p = s.payload;
    if (!p) continue;
    if (typeof p.title === 'string' && p.title.trim() !== s.label.trim()) add(p.title);
    add(p.body);
    if (typeof p.from === 'string' && !publicNames.has(p.from.trim())) add(p.from);
    add(p.returnCode?.code);
  }
  return out;
}

/** Every key and string value of a parsed JSON document except the base64url binary fields. */
function publicStrings(value: unknown, out: string[], key?: string): void {
  if (typeof value === 'string') {
    if (key === undefined || !BINARY_KEYS.has(key)) out.push(value);
  } else if (Array.isArray(value)) {
    for (const v of value) publicStrings(v, out);
  } else if (typeof value === 'object' && value !== null) {
    for (const [k, v] of Object.entries(value)) {
      out.push(k);
      publicStrings(v, out, k);
    }
  }
}

/**
 * Returns the secrets that occur in `json` (also checks JSON-escaped forms).
 *
 * If `json` parses, every decoded key and string value is searched, so any escaping style is covered and
 * numbers such as `"iterations": 200000` cannot match a short secret like 「0000」. Otherwise the text is
 * searched for each secret both raw and JSON-escaped (so multi-line bodies are found). Either way the random
 * base64url values of iv/ct/tag/salt are left out, so short secrets cannot match them by chance.
 */
export function findLeaks(json: string, secrets: readonly string[]): string[] {
  let haystacks: string[];
  let raw: boolean;
  try {
    haystacks = [];
    publicStrings(JSON.parse(json) as unknown, haystacks);
    raw = false;
  } catch {
    haystacks = [json.replace(BINARY_FIELD_RE, '"$1"$2:$3""')];
    raw = true;
  }

  const leaks: string[] = [];
  const reported = new Set<string>();
  for (const s of secrets) {
    if (typeof s !== 'string' || charLength(s) < MIN_SECRET_LENGTH || reported.has(s)) continue;
    const forms = [s];
    if (raw) {
      const escaped = JSON.stringify(s).slice(1, -1);
      if (escaped !== s) forms.push(escaped);
    }
    if (haystacks.some((h) => forms.some((f) => h.includes(f)))) {
      reported.add(s);
      leaks.push(s);
    }
  }
  return leaks;
}
