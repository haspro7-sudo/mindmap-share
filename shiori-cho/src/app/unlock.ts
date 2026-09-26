// STUB (contract) — code redemption services. docs/SPEC.md F10–F12, §5.2.
import type { GoalSecret, SealedPayload, UnlockOutcome } from '../core/types';
import type { ShioriRepo } from '../storage/repo';

/** ctx.workId = local work id to try first (its manifest.work.id becomes preferWorkId). */
export declare function submitCode(repo: ShioriRepo, input: string, ctx?: { workId?: string; now?: number }): Promise<UnlockOutcome>;
/** Stores a pending code (dedup by canonical). */
export declare function addPending(repo: ShioriRepo, canonical: string, manifestWorkIdHint?: string, now?: number): Promise<void>;
/** Tries all pending codes against current manifests; removes redeemed/already ones. */
export declare function processPending(repo: ShioriRepo, now?: number): Promise<UnlockOutcome[]>;
/** Handles '#/u/<manifestWorkId>/<code>': redeem if possible; else store as pending (status 'pending'). */
export declare function handleDeepLink(repo: ShioriRepo, manifestWorkId: string, code: string, now?: number): Promise<UnlockOutcome>;
/** goalId → decrypted secret, for every redeemed code goal of the work that has a cached master. */
export declare function decryptGoalSecrets(repo: ShioriRepo, workId: string): Promise<Record<string, GoalSecret>>;
/** Decrypts a sealed item if the player's masters satisfy it (never persisted). */
export declare function readSealed(repo: ShioriRepo, workId: string, sealedId: string): Promise<SealedPayload | null>;
/** Opens newly satisfied sealed items (putSealedOpen seen:false). Returns newly opened sealed ids. */
export declare function evaluateSealed(repo: ShioriRepo, workId: string, now?: number): Promise<string[]>;
/** Marks a code goal done with via 'manual' (does not open seals). */
export declare function markDoneWithoutCode(repo: ShioriRepo, workId: string, goalId: string, now?: number): Promise<void>;
