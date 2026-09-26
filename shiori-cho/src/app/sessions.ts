// Play sessions (プレイ記録・前回の続き). docs/SPEC.md F13, §5.2.
//
// Only one session may be open app-wide. Calls are serialized per repository, so a double tap on
// 「始める」 cannot open two sessions even though the repo has no cross-call transactions.
import { SESSION_MAX_MINUTES } from '../core/constants';
import { ShioriError } from '../core/errors';
import { sessionMinutes } from '../core/session';
import type { Session, WorkRecord } from '../core/types';
import type { ShioriRepo } from '../storage/repo';

/** Maximum length of 「どこまで進んだ？」 and 「次にやること」, in characters (code points). */
export const SESSION_NOTE_MAX_CHARS = 100;

export const MSG_SESSION_OPEN_OTHER = 'ほかの作品の記録中です。先に終えてください';
export const MSG_SESSION_OPEN_SAME = 'すでに記録中です';
const MSG_WORK_NOT_FOUND = '作品が見つかりません';
const MSG_SESSION_NOT_FOUND = 'プレイ記録が見つかりません';
const MSG_SESSION_ALREADY_ENDED = 'この記録はすでに終わっています';
const MSG_SESSION_ID = 'プレイ記録のIDが正しくありません';
const MSG_STARTED_AT = '開始時刻が正しくありません';
const MSG_ENDED_AT = '終了時刻は開始時刻より後にしてください';
const MSG_MINUTES = 'プレイ時間が正しくありません';

// ───────────────────────── helpers ─────────────────────────

/** Per-repo queue: each call starts after the previous one settled (fulfilled or rejected). */
const queues = new WeakMap<ShioriRepo, Promise<void>>();

function serialized<T>(repo: ShioriRepo, fn: () => Promise<T>): Promise<T> {
  // The stored tail never rejects, so `fn` always runs.
  const run = (queues.get(repo) ?? Promise.resolve()).then(fn);
  queues.set(
    repo,
    run.then(
      () => undefined,
      () => undefined,
    ),
  );
  return run;
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** Integer minutes clamped to 0..720; undefined for a missing or non-finite value. */
export function clampSessionMinutes(v: number | undefined): number | undefined {
  if (!isFiniteNumber(v)) return undefined;
  return Math.min(SESSION_MAX_MINUTES, Math.max(0, Math.round(v)));
}

/** Trimmed and cut to 100 characters (code points, so emoji are never split); blank → undefined. */
export function normalizeSessionNote(s: string | undefined): string | undefined {
  if (typeof s !== 'string') return undefined;
  const t = s.trim();
  if (t === '') return undefined;
  const chars = Array.from(t);
  return chars.length > SESSION_NOTE_MAX_CHARS ? chars.slice(0, SESSION_NOTE_MAX_CHARS).join('').trimEnd() : t;
}

function conflictFor(open: Session, workId: string): ShioriError {
  return new ShioriError('conflict', open.workId === workId ? MSG_SESSION_OPEN_SAME : MSG_SESSION_OPEN_OTHER);
}

async function requireWork(repo: ShioriRepo, workId: string): Promise<WorkRecord> {
  const work = typeof workId === 'string' && workId !== '' ? await repo.getWork(workId) : undefined;
  if (!work) throw new ShioriError('notFound', MSG_WORK_NOT_FOUND);
  return work;
}

async function findSession(repo: ShioriRepo, sessionId: string): Promise<Session | undefined> {
  const open = await repo.getOpenSession();
  if (open?.id === sessionId) return open;
  return (await repo.listSessions()).find((s) => s.id === sessionId);
}

/**
 * The checkpoint id if it exists in the work's current manifest, otherwise undefined
 * (a blank id, a work without a manifest, or an id the manifest does not know are all ignored).
 */
async function resolveCheckpoint(
  repo: ShioriRepo,
  work: WorkRecord | undefined,
  checkpointId: string | undefined,
): Promise<string | undefined> {
  if (typeof checkpointId !== 'string' || checkpointId === '' || !work?.manifestKey) return undefined;
  const record = await repo.getManifest(work.manifestKey);
  return record?.manifest.checkpoints.some((c) => c.id === checkpointId) ? checkpointId : undefined;
}

/** A Session without undefined-valued keys (IndexedDB and structuredClone keep them otherwise). */
function compactSession(s: Session): Session {
  const out: Session = { id: s.id, workId: s.workId, startedAt: s.startedAt };
  if (s.endedAt !== undefined) out.endedAt = s.endedAt;
  if (s.minutes !== undefined) out.minutes = s.minutes;
  if (s.checkpointId !== undefined) out.checkpointId = s.checkpointId;
  if (s.whereNote !== undefined) out.whereNote = s.whereNote;
  if (s.nextTodo !== undefined) out.nextTodo = s.nextTodo;
  return out;
}

// ───────────────────────── services ─────────────────────────

/**
 * Opens a session for `workId`.
 * Throws ShioriError('notFound') for an unknown work, and ShioriError('conflict') when any session is open:
 * 「すでに記録中です」 for the same work, 「ほかの作品の記録中です。先に終えてください」 for another one.
 * A work in 'backlog' (積み) becomes 'playing' (updatedAt = now); other statuses are left alone.
 */
export function startSession(repo: ShioriRepo, workId: string, now: number = Date.now()): Promise<Session> {
  return serialized(repo, async () => {
    const work = await requireWork(repo, workId);
    const open = await repo.getOpenSession();
    if (open) throw conflictFor(open, workId);

    const session: Session = { id: globalThis.crypto.randomUUID(), workId, startedAt: now };
    await repo.putSession(session);
    if (work.status === 'backlog') await repo.putWork({ ...work, status: 'playing', updatedAt: now });
    return session;
  });
}

/**
 * Ends an open session.
 * - minutes: `input.minutes` rounded and clamped to 0..720, or sessionMinutes(startedAt, now) when absent/invalid.
 * - whereNote / nextTodo: trimmed, at most 100 characters; blank → absent.
 * - checkpointId: kept only if it exists in the work's manifest (unknown ids are ignored).
 * The work gets lastPlayedAt = now (and currentCheckpointId when a valid checkpoint was given).
 * Throws ShioriError('notFound') for an unknown session and ShioriError('conflict') if it already ended.
 */
export function endSession(
  repo: ShioriRepo,
  sessionId: string,
  input: { minutes?: number; checkpointId?: string; whereNote?: string; nextTodo?: string },
  now: number = Date.now(),
): Promise<Session> {
  return serialized(repo, async () => {
    const session = await findSession(repo, sessionId);
    if (!session) throw new ShioriError('notFound', MSG_SESSION_NOT_FOUND);
    if (session.endedAt !== undefined && session.endedAt !== null) {
      throw new ShioriError('conflict', MSG_SESSION_ALREADY_ENDED);
    }

    // A clock that went backwards must not produce endedAt < startedAt.
    const endedAt = Math.max(now, session.startedAt);
    const work = await repo.getWork(session.workId);
    const checkpointId = await resolveCheckpoint(repo, work, input.checkpointId);
    const ended = compactSession({
      id: session.id,
      workId: session.workId,
      startedAt: session.startedAt,
      endedAt,
      minutes: clampSessionMinutes(input.minutes) ?? sessionMinutes(session.startedAt, endedAt),
      checkpointId,
      whereNote: normalizeSessionNote(input.whereNote),
      nextTodo: normalizeSessionNote(input.nextTodo),
    });
    await repo.putSession(ended);

    if (work) {
      const next: WorkRecord = { ...work, lastPlayedAt: endedAt, updatedAt: now };
      if (checkpointId !== undefined) next.currentCheckpointId = checkpointId;
      await repo.putWork(next);
    }
    return ended;
  });
}

/**
 * Validates and stores an edited session (記録タブの編集). It can also add a record by hand.
 * - The work must exist (ShioriError('notFound')).
 * - startedAt must be a finite time ≥ 0; endedAt, if set, must not be before startedAt (ShioriError('validation')).
 * - An ended session always has minutes: a given value is rounded and clamped to 0..720 (a non-finite value is a
 *   validation error), a missing one becomes sessionMinutes(startedAt, endedAt). An open session has none.
 * - Re-opening a session while another one is open is a ShioriError('conflict').
 * - Notes and the checkpoint are normalized like endSession. The work record is not changed.
 */
export function editSession(repo: ShioriRepo, session: Session): Promise<void> {
  return serialized(repo, async () => {
    if (typeof session.id !== 'string' || session.id.trim() === '') throw new ShioriError('validation', MSG_SESSION_ID);
    const work = await requireWork(repo, session.workId);
    const { startedAt } = session;
    if (!isFiniteNumber(startedAt) || startedAt < 0) throw new ShioriError('validation', MSG_STARTED_AT);

    const rawEnd = session.endedAt ?? undefined;
    if (rawEnd !== undefined && (!isFiniteNumber(rawEnd) || rawEnd < startedAt)) {
      throw new ShioriError('validation', MSG_ENDED_AT);
    }

    let minutes: number | undefined;
    if (rawEnd === undefined) {
      const open = await repo.getOpenSession();
      if (open && open.id !== session.id) throw conflictFor(open, session.workId);
    } else if (session.minutes === undefined || session.minutes === null) {
      minutes = sessionMinutes(startedAt, rawEnd);
    } else {
      minutes = clampSessionMinutes(session.minutes);
      if (minutes === undefined) throw new ShioriError('validation', MSG_MINUTES);
    }

    await repo.putSession(
      compactSession({
        id: session.id,
        workId: session.workId,
        startedAt,
        endedAt: rawEnd,
        minutes,
        checkpointId: await resolveCheckpoint(repo, work, session.checkpointId),
        whereNote: normalizeSessionNote(session.whereNote),
        nextTodo: normalizeSessionNote(session.nextTodo),
      }),
    );
  });
}
