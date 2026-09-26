// Per-repository mutual exclusion for the library and unlock services (no React).
//
// The repositories have no cross-call transactions, so a double tap on 「確かめる」 or 「読み込む」
// could otherwise interleave two read-check-write sequences (for example two redemptions of the
// same code both reporting 'unlocked', or one manifest imported as two works). Every service in
// library.ts / unlock.ts that writes runs inside withRepoLock. The lock is NOT reentrant: code that
// already holds it must call the `...InLock` helpers, never the public (locking) functions.
import type { ShioriRepo } from '../storage/repo';

/** Tail of each repository's queue. The stored promise never rejects, so the next task always runs. */
const tails = new WeakMap<ShioriRepo, Promise<void>>();

/** Runs `fn` after every earlier task for the same repository has settled (fulfilled or rejected). */
export function withRepoLock<T>(repo: ShioriRepo, fn: () => Promise<T>): Promise<T> {
  const run = (tails.get(repo) ?? Promise.resolve()).then(fn);
  tails.set(
    repo,
    run.then(
      () => undefined,
      () => undefined,
    ),
  );
  return run;
}
