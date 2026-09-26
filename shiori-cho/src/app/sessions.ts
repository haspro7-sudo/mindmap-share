// STUB (contract) — docs/SPEC.md F13.
import type { Session } from '../core/types';
import type { ShioriRepo } from '../storage/repo';

/** Throws ShioriError('conflict') if another session is open. Sets work.status 'playing' if it was 'backlog'. */
export declare function startSession(repo: ShioriRepo, workId: string, now?: number): Promise<Session>;
/** Ends the open session; minutes default sessionMinutes(start, now); updates work.lastPlayedAt and currentCheckpointId (if given). */
export declare function endSession(
  repo: ShioriRepo,
  sessionId: string,
  input: { minutes?: number; checkpointId?: string; whereNote?: string; nextTodo?: string },
  now?: number,
): Promise<Session>;
export declare function editSession(repo: ShioriRepo, session: Session): Promise<void>;
