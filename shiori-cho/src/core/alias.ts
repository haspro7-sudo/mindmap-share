/**
 * Default aliases for works (docs/SPEC.md F2 AC2, F4 AC1).
 */
export const ALIAS_PREFIX = '作品';

/** Bijective base-26 label: 1 → 'A', 26 → 'Z', 27 → 'AA', 28 → 'AB', 702 → 'ZZ', 703 → 'AAA'. */
export function aliasLetters(n: number): string {
  let out = '';
  let x = Math.floor(n);
  while (x > 0) {
    const r = (x - 1) % 26;
    out = String.fromCharCode(65 + r) + out;
    x = Math.floor((x - 1) / 26);
  }
  return out;
}

/** First unused of 「作品A」…「作品Z」「作品AA」「作品AB」… given existing aliases. */
export function nextAlias(existing: readonly string[]): string {
  // NFKC + trim so that e.g. a full-width 「作品Ａ」 also counts as taken.
  const used = new Set(existing.map((a) => a.normalize('NFKC').trim()));
  // At most existing.length candidates can be taken, so this always terminates.
  for (let n = 1; ; n++) {
    const candidate = ALIAS_PREFIX + aliasLetters(n);
    if (!used.has(candidate)) return candidate;
  }
}
