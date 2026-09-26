/**
 * CONTRACT: hash routes (docs/SPEC.md §6). The hash contains only local UUIDs, numeric indices,
 * or deep-link segments.
 */
export type WorkTab = 'progress' | 'extras' | 'log' | 'notes';
export type StudioTab = 'work' | 'structure' | 'goals' | 'extras' | 'check' | 'export';
export type HelpSection = 'usage' | 'demo-codes' | 'ios' | 'creators' | 'privacy' | 'about';

export type Route =
  | { name: 'home' }
  | { name: 'add' }
  | { name: 'work'; id: string; tab: WorkTab; sheet?: { type: 'goal' | 'sealed'; index: number } }
  | { name: 'workEdit'; id: string }
  | { name: 'code'; workId?: string }
  | { name: 'unlock'; manifestWorkId: string; code: string }
  | { name: 'settings' }
  | { name: 'studio' }
  | { name: 'studioProject'; id: string; tab: StudioTab }
  | { name: 'studioPreview'; id: string }
  | { name: 'demoPc' }
  | { name: 'help'; section?: HelpSection }
  | { name: 'notFound' };

export const WORK_TABS: readonly WorkTab[] = ['progress', 'extras', 'log', 'notes'];
export const STUDIO_TABS: readonly StudioTab[] = ['work', 'structure', 'goals', 'extras', 'check', 'export'];
export const HELP_SECTIONS: readonly HelpSection[] = ['usage', 'demo-codes', 'ios', 'creators', 'privacy', 'about'];

const DEFAULT_WORK_TAB: WorkTab = 'progress';
const DEFAULT_STUDIO_TAB: StudioTab = 'work';

/** Local work / studio project ids (UUIDs in practice). */
const LOCAL_ID_RE = /^[A-Za-z0-9-]{1,64}$/;
/** ManifestWork.id (docs/SPEC.md §4.1). */
const MANIFEST_WORK_ID_RE = /^[a-z0-9][a-z0-9-]{3,39}$/;
const SHEET_RE = /^([gx])(\d{1,9})$/;

const NOT_FOUND: Route = { name: 'notFound' };

function safeDecode(s: string): string | null {
  try {
    return decodeURIComponent(s);
  } catch {
    return null;
  }
}

/** Parses 'a=b&c=d' (first occurrence wins; undecodable values are ignored). */
function parseQuery(query: string): Map<string, string> {
  const params = new Map<string, string>();
  if (query === '') return params;
  for (const part of query.split('&')) {
    if (part === '') continue;
    const eq = part.indexOf('=');
    const key = safeDecode(eq < 0 ? part : part.slice(0, eq));
    const value = safeDecode(eq < 0 ? '' : part.slice(eq + 1));
    if (key === null || value === null || params.has(key)) continue;
    params.set(key, value);
  }
  return params;
}

function pick<T extends string>(allowed: readonly T[], value: string | undefined, fallback: T): T {
  return value !== undefined && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

function parseSheet(value: string | undefined): { type: 'goal' | 'sealed'; index: number } | undefined {
  if (value === undefined) return undefined;
  const m = SHEET_RE.exec(value);
  if (!m) return undefined;
  return { type: m[1] === 'g' ? 'goal' : 'sealed', index: Number(m[2]) };
}

/**
 * '#/', '', '#' → home; '#/add'; '#/w/<id>?tab=progress&sheet=g3'; '#/w/<id>/edit'; '#/code?w=<id>';
 * '#/u/<manifestWorkId>/<code>' (code percent-decoded); '#/settings'; '#/studio'; '#/studio/<pid>?tab=goals';
 * '#/studio/<pid>/preview'; '#/demo-pc'; '#/help' / '#/help/<section>'; anything else → notFound.
 * Default tabs: work → 'progress', studioProject → 'work'. Unknown tab values fall back to the default.
 * Only the known query params are read (tab, sheet=g<n>|x<n>, w); others are ignored.
 */
export function parseHashRoute(hash: string): Route {
  let h = typeof hash === 'string' ? hash : '';
  if (h.startsWith('#')) h = h.slice(1);
  if (h === '') return { name: 'home' };
  if (!h.startsWith('/')) return NOT_FOUND;

  const q = h.indexOf('?');
  let path = (q < 0 ? h : h.slice(0, q)).slice(1);
  const query = parseQuery(q < 0 ? '' : h.slice(q + 1));
  if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
  const seg = path === '' ? [] : path.split('/');
  if (seg.some((s) => s === '')) return NOT_FOUND;

  const [head, a, b] = seg;
  switch (seg.length) {
    case 0:
      return { name: 'home' };
    case 1:
      switch (head) {
        case 'add':
          return { name: 'add' };
        case 'code': {
          const w = query.get('w');
          return w !== undefined && LOCAL_ID_RE.test(w) ? { name: 'code', workId: w } : { name: 'code' };
        }
        case 'settings':
          return { name: 'settings' };
        case 'studio':
          return { name: 'studio' };
        case 'demo-pc':
          return { name: 'demoPc' };
        case 'help':
          return { name: 'help' };
        default:
          return NOT_FOUND;
      }
    case 2:
      if (head === 'w' && LOCAL_ID_RE.test(a!)) {
        const sheet = parseSheet(query.get('sheet'));
        const tab = pick(WORK_TABS, query.get('tab'), DEFAULT_WORK_TAB);
        return sheet ? { name: 'work', id: a!, tab, sheet } : { name: 'work', id: a!, tab };
      }
      if (head === 'studio' && LOCAL_ID_RE.test(a!)) {
        return { name: 'studioProject', id: a!, tab: pick(STUDIO_TABS, query.get('tab'), DEFAULT_STUDIO_TAB) };
      }
      if (head === 'help' && (HELP_SECTIONS as readonly string[]).includes(a!)) {
        return { name: 'help', section: a as HelpSection };
      }
      return NOT_FOUND;
    case 3:
      if (head === 'w' && b === 'edit' && LOCAL_ID_RE.test(a!)) return { name: 'workEdit', id: a! };
      if (head === 'studio' && b === 'preview' && LOCAL_ID_RE.test(a!)) return { name: 'studioPreview', id: a! };
      if (head === 'u' && MANIFEST_WORK_ID_RE.test(a!)) {
        const code = safeDecode(b!);
        return code ? { name: 'unlock', manifestWorkId: a!, code } : NOT_FOUND;
      }
      return NOT_FOUND;
    default:
      return NOT_FOUND;
  }
}

function withQuery(base: string, params: [string, string][]): string {
  if (params.length === 0) return base;
  return `${base}?${params.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')}`;
}

/** Inverse of parseHashRoute (omits default tab). Always starts with '#/'. */
export function buildHash(route: Route): string {
  const enc = encodeURIComponent;
  switch (route.name) {
    case 'home':
      return '#/';
    case 'add':
      return '#/add';
    case 'work': {
      const params: [string, string][] = [];
      if (route.tab !== DEFAULT_WORK_TAB) params.push(['tab', route.tab]);
      const sheet = route.sheet;
      if (sheet && Number.isSafeInteger(sheet.index) && sheet.index >= 0) {
        params.push(['sheet', `${sheet.type === 'goal' ? 'g' : 'x'}${sheet.index}`]);
      }
      return withQuery(`#/w/${enc(route.id)}`, params);
    }
    case 'workEdit':
      return `#/w/${enc(route.id)}/edit`;
    case 'code':
      return withQuery('#/code', route.workId !== undefined ? [['w', route.workId]] : []);
    case 'unlock':
      return `#/u/${enc(route.manifestWorkId)}/${enc(route.code)}`;
    case 'settings':
      return '#/settings';
    case 'studio':
      return '#/studio';
    case 'studioProject':
      return withQuery(`#/studio/${enc(route.id)}`, route.tab !== DEFAULT_STUDIO_TAB ? [['tab', route.tab]] : []);
    case 'studioPreview':
      return `#/studio/${enc(route.id)}/preview`;
    case 'demoPc':
      return '#/demo-pc';
    case 'help':
      return route.section !== undefined ? `#/help/${enc(route.section)}` : '#/help';
    case 'notFound':
      return '#/not-found';
  }
}

function stripCodePrefix(canonical: string): string {
  return canonical.replace(/^(b32|kana):/, '');
}

/** `${appUrl without trailing '#…'}#/u/${workId}/${encodeURIComponent(canonical without 'b32:'/'kana:' prefix)}` */
export function buildUnlockUrl(appUrl: string, manifestWorkId: string, canonical: string): string {
  const hashAt = appUrl.indexOf('#');
  const base = hashAt < 0 ? appUrl : appUrl.slice(0, hashAt);
  return `${base}#/u/${encodeURIComponent(manifestWorkId)}/${encodeURIComponent(stripCodePrefix(canonical))}`;
}

const UNLOCK_IN_TEXT_RE = /#\/u\/([a-z0-9][a-z0-9-]{3,39})\/(\S+)/gu;
/** Characters that end a code inside prose (never part of an encoded or raw code). */
const CODE_STOP_RE = /[/?#&<>"'`()[\]{}（）［］｛｝「」『』【】〈〉《》]/u;
/** Trailing punctuation trimmed from a code found inside prose. */
const TRAILING_PUNCT_RE = /[。、．，,.!！?？:：;；)）\]］}｝」』】〉》>"'”’…・~〜]+$/u;
const NON_ASCII_RE = /[^\x00-\x7f]/;

/**
 * Finds '#/u/<workId>/<code>' inside arbitrary text (e.g. a pasted URL inside prose).
 * The code runs until whitespace or the end; it stops early at URL delimiters and brackets,
 * an ASCII (percent-encoded) code also stops at the first non-ASCII character (「…/K7QM2XRAPを入力」),
 * and trailing punctuation such as 。、) ] is trimmed before percent-decoding.
 * Returns the first occurrence that decodes to a non-empty code, or null.
 */
export function extractUnlockFromText(text: string): { manifestWorkId: string; code: string } | null {
  if (typeof text !== 'string' || text === '') return null;
  for (const m of text.matchAll(UNLOCK_IN_TEXT_RE)) {
    let raw = m[2]!;
    const stop = CODE_STOP_RE.exec(raw);
    if (stop) raw = raw.slice(0, stop.index);
    if (raw !== '' && !NON_ASCII_RE.test(raw[0]!)) {
      const nonAscii = NON_ASCII_RE.exec(raw);
      if (nonAscii) raw = raw.slice(0, nonAscii.index);
    }
    raw = raw.replace(TRAILING_PUNCT_RE, '');
    if (raw === '') continue;
    const code = safeDecode(raw);
    if (code === null || code.trim() === '') continue;
    return { manifestWorkId: m[1]!, code };
  }
  return null;
}
