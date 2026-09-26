/**
 * DLsite store codes (docs/SPEC.md F4 AC1, §7.3). This is the single table of store URLs.
 */
import { ShioriError } from './errors';

export interface StoreCode {
  prefix: 'RJ' | 'VJ' | 'BJ';
  digits: string;
  /** normalized, e.g. 'RJ01667536' */
  code: string;
}

/** User-facing message for an invalid store code (F4 AC1). */
export const STORE_CODE_INVALID_JA = '作品コードの形式が違います（例: RJ01234567）';

const STORE_CODE_PARSE_RE = /^(RJ|VJ|BJ)(\d{6}|\d{8})$/;

/** Store floor per prefix. The touch variant appends '-touch'. */
export const STORE_FLOORS: Readonly<Record<StoreCode['prefix'], string>> = {
  RJ: 'maniax',
  VJ: 'pro',
  BJ: 'books',
};

/** NFKC + trim + upper; RJ/VJ/BJ + 6 or 8 digits; else null */
export function parseStoreCode(input: string): StoreCode | null {
  if (typeof input !== 'string') return null;
  const s = input.normalize('NFKC').trim().toUpperCase();
  const m = STORE_CODE_PARSE_RE.exec(s);
  if (!m) return null;
  const prefix = m[1] as StoreCode['prefix'];
  const digits = m[2]!;
  return { prefix, digits, code: prefix + digits };
}

/**
 * RJ→maniax, VJ→pro, BJ→books; touch → '<floor>-touch'. https://www.dlsite.com/<floor>/work/=/product_id/<code>.html
 * Throws ShioriError('validation') when the code is not a valid store code.
 */
export function buildStoreUrl(code: string | StoreCode, opts: { touch: boolean }): string {
  // Re-parse objects too, so a hand-built StoreCode can never inject arbitrary text into the URL.
  const parsed = parseStoreCode(typeof code === 'string' ? code : code.code);
  if (!parsed) throw new ShioriError('validation', STORE_CODE_INVALID_JA);
  const floor = STORE_FLOORS[parsed.prefix] + (opts.touch ? '-touch' : '');
  return `https://www.dlsite.com/${floor}/work/=/product_id/${parsed.code}.html`;
}
