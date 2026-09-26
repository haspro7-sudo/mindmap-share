// Code redemption (docs/SPEC.md §4.3 "Verification", F10 AC2–AC3).
import { parseCode } from './codes';
import { deriveMaster, lookupTag } from './crypto/shiori';
import { ShioriError } from './errors';
import type { KdfParams, Bytes, RedeemCandidate, RedeemResult, SealedItem, ShioriManifestV1 } from './types';

export interface RedeemOptions {
  /** manifest.work.id to try first */
  preferWorkId?: string;
  /** injectable for tests (spy); defaults to crypto/shiori.deriveMaster */
  derive?: (canonical: string, kdf: KdfParams) => Promise<Bytes>;
}

/** Candidates whose manifest.work.id === preferWorkId first, then the rest (both in their original order). */
function orderCandidates(candidates: readonly RedeemCandidate[], preferWorkId: string | undefined): RedeemCandidate[] {
  if (preferWorkId === undefined) return [...candidates];
  const preferred: RedeemCandidate[] = [];
  const rest: RedeemCandidate[] = [];
  for (const c of candidates) (c.manifest.work.id === preferWorkId ? preferred : rest).push(c);
  return [...preferred, ...rest];
}

/** The master depends only on (canonical, salt, iterations), so identical kdf params share one derivation. */
function kdfCacheKey(kdf: KdfParams): string {
  return `${kdf.alg}|${kdf.iterations}|${kdf.salt}`;
}

/**
 * Parses input (no KDF on parse failure), derives master once per candidate manifest with kdf, matches tag.
 *
 * - An invalid code returns `{ status: 'invalid' }` without calling `derive`.
 * - Candidates are tried in order (preferred work first). A candidate is skipped without a KDF when it has no
 *   kdf or no code goal of the parsed kind. Masters are cached per identical (salt, iterations) pair.
 * - A candidate whose kdf params are unusable (ShioriError from derive / lookupTag) is skipped; any other
 *   error (e.g. WebCrypto unavailable) propagates.
 */
export async function redeem(
  input: string, candidates: readonly RedeemCandidate[], opts: RedeemOptions = {},
): Promise<RedeemResult> {
  const parsed = parseCode(input);
  if (!parsed.ok) return { status: 'invalid', error: parsed.error };
  const { canonical, kind } = parsed;
  const derive = opts.derive ?? deriveMaster;
  const masters = new Map<string, Promise<Bytes>>();

  for (const c of orderCandidates(candidates, opts.preferWorkId)) {
    const m = c.manifest;
    const kdf = m.kdf;
    if (!kdf) continue;
    const goals = m.goals.filter((g) => g.unlock.type === 'code' && g.unlock.codeKind === kind);
    if (goals.length === 0) continue;

    const key = kdfCacheKey(kdf);
    let pending = masters.get(key);
    if (!pending) {
      // async wrapper: a synchronous throw from an injected derive becomes a rejection handled below.
      pending = (async () => derive(canonical, kdf))();
      masters.set(key, pending);
    }
    let master: Bytes;
    let tag: string;
    try {
      master = await pending;
      tag = await lookupTag(master, m.work.id);
    } catch (e) {
      if (e instanceof ShioriError) continue;
      throw e;
    }
    const hit = goals.find((g) => g.unlock.type === 'code' && g.unlock.tag === tag);
    if (hit) return { status: 'matched', manifestKey: c.manifestKey, goalId: hit.id, canonical, master };
  }
  return { status: 'noMatch', canonical };
}

/** Sealed items whose condition is satisfied by the redeemed goal ids (allOf: all; anyOf: any). */
export function satisfiedSealed(m: ShioriManifestV1, redeemedGoalIds: Iterable<string>): SealedItem[] {
  const have = new Set(redeemedGoalIds);
  return m.sealed.filter((s) => {
    const goals = s.unlock.goals;
    if (goals.length === 0) return false;
    return s.unlock.mode === 'allOf' ? goals.every((g) => have.has(g)) : goals.some((g) => have.has(g));
  });
}
