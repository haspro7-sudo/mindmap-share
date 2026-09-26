// Per-repository mutual exclusion for the library and unlock services (no React).
//
// The repositories have no cross-call transactions, so a double tap on 「確かめる」 or 「読み込む」
// could otherwise interleave two read-check-write sequences (for example two redemptions of the
// same code both reporting 'unlocked', or one manifest imported as two works), and a write that
// finishes after 「削除」 could re-create rows for a work that is gone. Every service that reads and
// then writes runs inside withRepoLock: library.ts (including deleteWork), unlock.ts, sessions.ts,
// backup.ts (restoreBackup / applyBackup) and the work page's patchWork. The lock is NOT reentrant:
// code that already holds it must call the `...InLock` helpers, never the public (locking) functions.
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
