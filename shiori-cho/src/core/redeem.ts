// STUB (contract) — docs/SPEC.md §4.3 Verification, F10.
import type { KdfParams, Bytes, RedeemCandidate, RedeemResult, SealedItem, ShioriManifestV1 } from './types';

export interface RedeemOptions {
  /** manifest.work.id to try first */
  preferWorkId?: string;
  /** injectable for tests (spy); defaults to crypto/shiori.deriveMaster */
  derive?: (canonical: string, kdf: KdfParams) => Promise<Bytes>;
}
/** Parses input (no KDF on parse failure), derives master once per candidate manifest with kdf, matches tag. */
export declare function redeem(input: string, candidates: readonly RedeemCandidate[], opts?: RedeemOptions): Promise<RedeemResult>;
/** Sealed items whose condition is satisfied by the redeemed goal ids (allOf: all; anyOf: any). */
export declare function satisfiedSealed(m: ShioriManifestV1, redeemedGoalIds: Iterable<string>): SealedItem[];
