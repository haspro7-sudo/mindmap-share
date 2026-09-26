// STUB (contract) — derivations in docs/SPEC.md §4.3. Golden vectors there are verified correct.
import type { B64u, Bytes, EncBox, GoalSecret, KdfParams, SealedItem, SealedPayload, SealedUnlock } from '../types';
import type { Rng } from '../encoding';

/** PBKDF2-HMAC-SHA256(utf8(canonical), salt, iterations, 32) */
export declare function deriveMaster(canonical: string, kdf: KdfParams): Promise<Bytes>;
/** HMAC-SHA256(master, utf8("shiori/1|tag|" + workId))[0..16] as b64u */
export declare function lookupTag(master: Uint8Array, workId: string): Promise<B64u>;
/** HKDF-SHA256(master, salt, "shiori/1|goal|" + goalId) → 32 bytes */
export declare function goalKey(master: Uint8Array, kdf: KdfParams, goalId: string): Promise<Bytes>;
export declare function sealGoalSecret(
  master: Uint8Array, kdf: KdfParams, workId: string, goalId: string, secret: GoalSecret, rng?: Rng,
): Promise<EncBox>;
/** Decrypts and validates against goalSecretSchema; throws ShioriError('decrypt') on failure. */
export declare function openGoalSecret(
  master: Uint8Array, kdf: KdfParams, workId: string, goalId: string, box: EncBox,
): Promise<GoalSecret>;
/** HKDF over concat(masters sorted by goal id, code-unit order), info "shiori/1|seal|" + sealedId */
export declare function allOfKey(masters: Readonly<Record<string, Uint8Array>>, kdf: KdfParams, sealedId: string): Promise<Bytes>;
export declare function sealItem(args: {
  workId: string;
  kdf: KdfParams;
  sealedId: string;
  mode: 'allOf' | 'anyOf';
  /** goalId → master for every goal in the condition */
  masters: Readonly<Record<string, Uint8Array>>;
  payload: SealedPayload;
  rng?: Rng;
}): Promise<{ unlock: SealedUnlock; box: EncBox }>;
/**
 * Opens a sealed item with the masters the player has.
 * Returns null if the condition is not satisfied by the provided masters.
 * Throws ShioriError('decrypt') on tampering / wrong binding / invalid payload.
 */
export declare function openItem(args: {
  workId: string;
  kdf: KdfParams;
  item: SealedItem;
  masters: Readonly<Record<string, Uint8Array>>;
}): Promise<SealedPayload | null>;
