import { describe, it, expect, vi } from 'vitest';
import { SESSION_MAX_MINUTES } from '../core/constants';
import { isShioriError } from '../core/errors';
import type { ManifestRecord, Session, ShioriManifestV1, WorkRecord } from '../core/types';
import { createMemoryRepo } from '../storage/memoryRepo';
import type { ShioriRepo } from '../storage/repo';
import {
  MSG_SESSION_OPEN_OTHER,
  MSG_SESSION_OPEN_SAME,
  SESSION_NOTE_MAX_CHARS,
  clampSessionMinutes,
  deleteSession,
  editSession,
  endSession,
  normalizeSessionNote,
  startSession,
} from './sessions';

const T0 = 1_790_000_000_000;
const MIN = 60_000;
const DAY_MS = 86_400_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function work(id: string, over: Partial<WorkRecord> = {}): WorkRecord {
  return {
    id,
    title: `星読みの図書館 ${id}`,
    alias: '作品A',
    kind: 'game',
    status: 'backlog',
    coverEmoji: '📘',
    coverColor: 'paper',
    spoilerTolerance: 1,
    newGoalIds: [],
    createdAt: T0 - 10 * MIN,
    updatedAt: T0 - 10 * MIN,
    ...over,
  };
}

function manifest(): ShioriManifestV1 {
  return {
    schema: 'shiori/1',
    work: { id: 'demo-sessions', title: 'テスト作品', kind: 'game', version: '1.0.0' },
    author: { kind: 'player' },
    checkpoints: [
      { id: 'ch1', label: '第1章' },
      { id: 'ch2', label: '第2章' },
    ],
    groups: [{ id: 'endings', label: 'エンディング' }],
    goals: [{ id: 'end-1', group: 'endings', label: 'END 1', spoiler: 0, hints: [], unlock: { type: 'manual' } }],
    sealed: [],
    changelog: [],
  };
}

function manifestRecord(workId: string): ManifestRecord {
  return { key: 'mk-1', workId, manifest: manifest(), source: 'quick', importedAt: T0 };
}

/** w1: backlog with a manifest (checkpoints ch1, ch2); w2: cleared, no manifest. */
function seeded(): ShioriRepo {
  return createMemoryRepo({
    works: [work('w1', { manifestKey: 'mk-1', manifestWorkId: 'demo-sessions' }), work('w2', { status: 'cleared' })],
    manifests: [manifestRecord('w1')],
  });
}

async function expectShioriError(p: Promise<unknown>, code: string, messageJa?: string): Promise<void> {
  const e = await p.then(
    () => undefined,
    (err: unknown) => err,
  );
  expect(isShioriError(e), `expected ShioriError(${code})`).toBe(true);
  if (!isShioriError(e)) return;
  expect(e.code).toBe(code);
  if (messageJa !== undefined) expect(e.messageJa).toBe(messageJa);
}

describe('helpers', () => {
  it('clampSessionMinutes rounds and clamps to 0..720', () => {
    expect(clampSessionMinutes(undefined)).toBeUndefined();
    expect(clampSessionMinutes(Number.NaN)).toBeUndefined();
    expect(clampSessionMinutes(Number.POSITIVE_INFINITY)).toBeUndefined();
    expect(clampSessionMinutes(-5)).toBe(0);
    expect(clampSessionMinutes(0)).toBe(0);
    expect(clampSessionMinutes(12.4)).toBe(12);
    expect(clampSessionMinutes(12.6)).toBe(13);
    expect(clampSessionMinutes(720)).toBe(720);
    expect(clampSessionMinutes(1000)).toBe(SESSION_MAX_MINUTES);
  });

  it('normalizeSessionNote trims, cuts to 100 characters and turns blanks into undefined', () => {
    expect(normalizeSessionNote(undefined)).toBeUndefined();
    expect(normalizeSessionNote('')).toBeUndefined();
    expect(normalizeSessionNote('   \n ')).toBeUndefined();
    expect(normalizeSessionNote('  第3章のボス前  ')).toBe('第3章のボス前');
    const long = 'あ'.repeat(150);
    expect(normalizeSessionNote(long)).toBe('あ'.repeat(SESSION_NOTE_MAX_CHARS));
    // Emoji are counted as one character and never split into lone surrogates.
    const emoji = normalizeSessionNote('📘'.repeat(120))!;
    expect(Array.from(emoji)).toHaveLength(SESSION_NOTE_MAX_CHARS);
    expect(emoji).toBe('📘'.repeat(SESSION_NOTE_MAX_CHARS));
  });
});

describe('startSession', () => {
  it('opens a session with a random UUID and moves a backlog work to playing', async () => {
    const repo = seeded();
    const s = await startSession(repo, 'w1', T0);
    expect(s.id).toMatch(UUID_RE);
    expect(s).toEqual({ id: s.id, workId: 'w1', startedAt: T0 });
    expect(await repo.getOpenSession()).toEqual(s);
    const w = await repo.getWork('w1');
    expect(w?.status).toBe('playing');
    expect(w?.updatedAt).toBe(T0);
  });

  it('uses crypto.randomUUID for the id', async () => {
    const repo = seeded();
    const spy = vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue('11111111-2222-4333-8444-555555555555');
    try {
      const s = await startSession(repo, 'w1', T0);
      expect(s.id).toBe('11111111-2222-4333-8444-555555555555');
    } finally {
      spy.mockRestore();
    }
  });

  it('leaves other statuses (and updatedAt) alone', async () => {
    const repo = seeded();
    await startSession(repo, 'w2', T0);
    const w = await repo.getWork('w2');
    expect(w?.status).toBe('cleared');
    expect(w?.updatedAt).toBe(T0 - 10 * MIN);
  });

  it('defaults now to Date.now()', async () => {
    const repo = seeded();
    const before = Date.now();
    const s = await startSession(repo, 'w1');
    expect(s.startedAt).toBeGreaterThanOrEqual(before);
    expect(s.startedAt).toBeLessThanOrEqual(Date.now());
  });

  it('refuses a second session for another work', async () => {
    const repo = seeded();
    await startSession(repo, 'w1', T0);
    await expectShioriError(startSession(repo, 'w2', T0 + MIN), 'conflict', MSG_SESSION_OPEN_OTHER);
    expect(MSG_SESSION_OPEN_OTHER).toBe('ほかの作品の記録中です。先に終えてください');
    expect(await repo.listSessions()).toHaveLength(1);
  });

  it('refuses a second session for the same work', async () => {
    const repo = seeded();
    await startSession(repo, 'w1', T0);
    await expectShioriError(startSession(repo, 'w1', T0 + MIN), 'conflict', MSG_SESSION_OPEN_SAME);
    expect(MSG_SESSION_OPEN_SAME).toBe('すでに記録中です');
  });

  it('opens only one session when two starts race (double tap)', async () => {
    const repo = seeded();
    const results = await Promise.allSettled([startSession(repo, 'w1', T0), startSession(repo, 'w2', T0)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected');
    expect(rejected && isShioriError(rejected.reason) && rejected.reason.code).toBe('conflict');
    expect((await repo.listSessions()).filter((s) => s.endedAt === undefined)).toHaveLength(1);
  });

  it('throws notFound for an unknown work', async () => {
    const repo = seeded();
    await expectShioriError(startSession(repo, 'nope', T0), 'notFound');
    await expectShioriError(startSession(repo, '', T0), 'notFound');
    expect(await repo.listSessions()).toHaveLength(0);
  });

  it('allows a new session once the previous one ended', async () => {
    const repo = seeded();
    const s1 = await startSession(repo, 'w1', T0);
    await endSession(repo, s1.id, {}, T0 + 30 * MIN);
    const s2 = await startSession(repo, 'w2', T0 + 40 * MIN);
    expect(s2.id).not.toBe(s1.id);
    expect((await repo.getOpenSession())?.id).toBe(s2.id);
  });
});

describe('endSession', () => {
  it('defaults minutes to the wall clock and updates lastPlayedAt', async () => {
    const repo = seeded();
    const s = await startSession(repo, 'w1', T0);
    const ended = await endSession(repo, s.id, {}, T0 + 42 * MIN + 10_000);
    expect(ended).toEqual({ id: s.id, workId: 'w1', startedAt: T0, endedAt: T0 + 42 * MIN + 10_000, minutes: 42 });
    expect(await repo.getOpenSession()).toBeUndefined();
    expect((await repo.listSessions('w1'))[0]).toEqual(ended);
    const w = await repo.getWork('w1');
    expect(w?.lastPlayedAt).toBe(T0 + 42 * MIN + 10_000);
    expect(w?.updatedAt).toBe(T0 + 42 * MIN + 10_000);
    expect(w?.currentCheckpointId).toBeUndefined();
  });

  it('rounds the wall-clock minutes (sessionMinutes)', async () => {
    const repo = seeded();
    const s = await startSession(repo, 'w1', T0);
    expect((await endSession(repo, s.id, {}, T0 + 90_000)).minutes).toBe(2);
  });

  it('caps the default at 720 minutes', async () => {
    const repo = seeded();
    const s = await startSession(repo, 'w1', T0);
    const ended = await endSession(repo, s.id, {}, T0 + 20 * 60 * MIN);
    expect(ended.minutes).toBe(720);
  });

  it('uses input.minutes, rounded and clamped to 0..720', async () => {
    for (const [given, expected] of [
      [25, 25],
      [12.6, 13],
      [-3, 0],
      [5000, 720],
    ] as const) {
      const repo = seeded();
      const s = await startSession(repo, 'w1', T0);
      expect((await endSession(repo, s.id, { minutes: given }, T0 + 60 * MIN)).minutes).toBe(expected);
    }
  });

  it('falls back to the wall clock for a non-finite input.minutes', async () => {
    const repo = seeded();
    const s = await startSession(repo, 'w1', T0);
    expect((await endSession(repo, s.id, { minutes: Number.NaN }, T0 + 15 * MIN)).minutes).toBe(15);
  });

  it('trims notes, cuts them to 100 characters and drops blank ones', async () => {
    const repo = seeded();
    const s = await startSession(repo, 'w1', T0);
    const ended = await endSession(
      repo,
      s.id,
      { whereNote: '  図書館の屋上まで  ', nextTodo: 'い'.repeat(130) },
      T0 + 10 * MIN,
    );
    expect(ended.whereNote).toBe('図書館の屋上まで');
    expect(ended.nextTodo).toBe('い'.repeat(100));

    const repo2 = seeded();
    const s2 = await startSession(repo2, 'w1', T0);
    const ended2 = await endSession(repo2, s2.id, { whereNote: '   ', nextTodo: '', checkpointId: '' }, T0 + MIN);
    expect(Object.keys(ended2).sort()).toEqual(['endedAt', 'id', 'minutes', 'startedAt', 'workId']);
    expect(Object.keys((await repo2.listSessions())[0]!).sort()).toEqual(['endedAt', 'id', 'minutes', 'startedAt', 'workId']);
  });

  it('stores a known checkpoint on the session and as the work\'s current checkpoint', async () => {
    const repo = seeded();
    const s = await startSession(repo, 'w1', T0);
    const ended = await endSession(repo, s.id, { checkpointId: 'ch2', nextTodo: '第2章のボス' }, T0 + 5 * MIN);
    expect(ended.checkpointId).toBe('ch2');
    expect((await repo.getWork('w1'))?.currentCheckpointId).toBe('ch2');
  });

  it('ignores a checkpoint the manifest does not have', async () => {
    const repo = createMemoryRepo({
      works: [work('w1', { manifestKey: 'mk-1', currentCheckpointId: 'ch1' })],
      manifests: [manifestRecord('w1')],
    });
    const s = await startSession(repo, 'w1', T0);
    const ended = await endSession(repo, s.id, { checkpointId: 'ch9' }, T0 + 5 * MIN);
    expect(ended.checkpointId).toBeUndefined();
    const w = await repo.getWork('w1');
    expect(w?.currentCheckpointId).toBe('ch1');
    expect(w?.lastPlayedAt).toBe(T0 + 5 * MIN);
  });

  it('ignores a checkpoint for a work without a manifest (or with a missing manifest record)', async () => {
    const repo = createMemoryRepo({ works: [work('w2'), work('w3', { manifestKey: 'gone' })] });
    const s = await startSession(repo, 'w2', T0);
    expect((await endSession(repo, s.id, { checkpointId: 'ch1' }, T0 + MIN)).checkpointId).toBeUndefined();
    expect((await repo.getWork('w2'))?.currentCheckpointId).toBeUndefined();
    const s3 = await startSession(repo, 'w3', T0 + 2 * MIN);
    expect((await endSession(repo, s3.id, { checkpointId: 'ch1' }, T0 + 3 * MIN)).checkpointId).toBeUndefined();
  });

  it('never ends before it started when the clock went backwards', async () => {
    const repo = seeded();
    const s = await startSession(repo, 'w1', T0);
    const ended = await endSession(repo, s.id, {}, T0 - 5 * MIN);
    expect(ended.endedAt).toBe(T0);
    expect(ended.minutes).toBe(0);
  });

  it('throws notFound for an unknown session and conflict for an ended one', async () => {
    const repo = seeded();
    await expectShioriError(endSession(repo, 'missing', {}, T0), 'notFound');
    const s = await startSession(repo, 'w1', T0);
    await endSession(repo, s.id, { whereNote: '一回目' }, T0 + MIN);
    await expectShioriError(endSession(repo, s.id, { whereNote: '二回目' }, T0 + 2 * MIN), 'conflict');
    expect((await repo.listSessions())[0]?.whereNote).toBe('一回目');
  });

  it('can end an open session that is not the latest open one', async () => {
    // Two open sessions can exist after merging backups from two devices.
    const repo = createMemoryRepo({
      works: [work('w1'), work('w2')],
      sessions: [
        { id: 's-old', workId: 'w1', startedAt: T0 },
        { id: 's-new', workId: 'w2', startedAt: T0 + MIN },
      ],
    });
    const ended = await endSession(repo, 's-old', {}, T0 + 10 * MIN);
    expect(ended.minutes).toBe(10);
    expect((await repo.getOpenSession())?.id).toBe('s-new');
  });

  it('still records the session when its work is gone', async () => {
    const repo = createMemoryRepo({ sessions: [{ id: 's1', workId: 'ghost', startedAt: T0 }] });
    const ended = await endSession(repo, 's1', {}, T0 + 3 * MIN);
    expect(ended.minutes).toBe(3);
    expect(await repo.getWork('ghost')).toBeUndefined();
  });
});

describe('editSession', () => {
  async function ended(repo: ShioriRepo): Promise<Session> {
    const s = await startSession(repo, 'w1', T0);
    return endSession(repo, s.id, { whereNote: 'はじめ' }, T0 + 30 * MIN);
  }

  it('stores normalized edits', async () => {
    const repo = seeded();
    const s = await ended(repo);
    await editSession(repo, { ...s, minutes: 44.4, whereNote: '  書庫の奥  ', nextTodo: '  ', checkpointId: 'ch1' });
    const stored = (await repo.listSessions())[0]!;
    expect(stored).toEqual({ ...s, minutes: 44, whereNote: '書庫の奥', checkpointId: 'ch1' });
    expect('nextTodo' in stored).toBe(false);
  });

  it('clamps minutes and fills missing minutes from the times', async () => {
    const repo = seeded();
    const s = await ended(repo);
    await editSession(repo, { ...s, minutes: 9999 });
    expect((await repo.listSessions())[0]?.minutes).toBe(720);
    await editSession(repo, { ...s, minutes: undefined, endedAt: T0 + 50 * MIN });
    expect((await repo.listSessions())[0]?.minutes).toBe(50);
  });

  it('drops an unknown checkpoint', async () => {
    const repo = seeded();
    const s = await ended(repo);
    await editSession(repo, { ...s, checkpointId: 'nowhere' });
    expect((await repo.listSessions())[0]?.checkpointId).toBeUndefined();
  });

  it('changes nothing else of the work record when the end time stays', async () => {
    const repo = seeded();
    const s = await ended(repo);
    const before = await repo.getWork('w1');
    await editSession(repo, { ...s, checkpointId: 'ch2', minutes: 12, whereNote: '別のメモ' }, T0 + 99 * MIN);
    expect(await repo.getWork('w1')).toEqual(before);
  });

  it('recomputes lastPlayedAt from the work\'s sessions when an end time moves', async () => {
    const repo = seeded();
    const s = await ended(repo); // ends at T0 + 30 min
    expect((await repo.getWork('w1'))?.lastPlayedAt).toBe(T0 + 30 * MIN);
    await editSession(repo, { ...s, endedAt: T0 + 10 * MIN }, T0 + 99 * MIN);
    const w = await repo.getWork('w1');
    expect(w?.lastPlayedAt).toBe(T0 + 10 * MIN);
    expect(w?.updatedAt).toBe(T0 + 99 * MIN);
    // a record added by hand that ended later becomes the last play
    await editSession(repo, { id: 'manual-1', workId: 'w1', startedAt: T0 + 40 * MIN, endedAt: T0 + 60 * MIN }, T0 + 100 * MIN);
    expect((await repo.getWork('w1'))?.lastPlayedAt).toBe(T0 + 60 * MIN);
  });

  it('moving a session to another work updates both works', async () => {
    const repo = seeded();
    const s = await ended(repo);
    await editSession(repo, { ...s, workId: 'w2' }, T0 + 99 * MIN);
    expect((await repo.getWork('w1'))?.lastPlayedAt).toBeUndefined();
    expect((await repo.getWork('w2'))?.lastPlayedAt).toBe(T0 + 30 * MIN);
  });

  it('rejects bad times and minutes', async () => {
    const repo = seeded();
    const s = await ended(repo);
    await expectShioriError(editSession(repo, { ...s, endedAt: T0 - 1 }), 'validation');
    await expectShioriError(editSession(repo, { ...s, startedAt: Number.NaN }), 'validation');
    await expectShioriError(editSession(repo, { ...s, startedAt: -1 }), 'validation');
    await expectShioriError(editSession(repo, { ...s, endedAt: Number.POSITIVE_INFINITY }), 'validation');
    await expectShioriError(editSession(repo, { ...s, minutes: Number.NaN }), 'validation');
    await expectShioriError(editSession(repo, { ...s, id: ' ' }), 'validation');
    expect((await repo.listSessions())[0]).toEqual(s);
  });

  it('rejects an unknown work', async () => {
    const repo = seeded();
    const s = await ended(repo);
    await expectShioriError(editSession(repo, { ...s, workId: 'ghost' }), 'notFound');
  });

  it('refuses to re-open a session while another one is open', async () => {
    const repo = seeded();
    const s = await ended(repo);
    const open = await startSession(repo, 'w2', T0 + 40 * MIN);
    await expectShioriError(editSession(repo, { ...s, endedAt: undefined, minutes: undefined }), 'conflict', MSG_SESSION_OPEN_OTHER);
    // Editing the open session itself is fine (it stays open, without minutes).
    await editSession(repo, { ...open, whereNote: 'まだ途中', minutes: 5 });
    const stored = await repo.getOpenSession();
    expect(stored).toEqual({ ...open, whereNote: 'まだ途中' });
  });

  it('can add a record by hand', async () => {
    const repo = seeded();
    await editSession(repo, { id: 'manual-1', workId: 'w2', startedAt: T0, endedAt: T0 + 20 * MIN });
    expect(await repo.listSessions('w2')).toEqual([
      { id: 'manual-1', workId: 'w2', startedAt: T0, endedAt: T0 + 20 * MIN, minutes: 20 },
    ]);
  });
});

describe('deleteSession', () => {
  async function play(repo: ShioriRepo, start: number, end: number): Promise<Session> {
    const s = await startSession(repo, 'w1', start);
    return endSession(repo, s.id, {}, end);
  }

  it('deletes the session and moves lastPlayedAt back to the latest remaining one', async () => {
    const repo = seeded();
    await play(repo, T0, T0 + 30 * MIN);
    const accidental = await play(repo, T0 + DAY_MS, T0 + DAY_MS + MIN);
    expect((await repo.getWork('w1'))?.lastPlayedAt).toBe(T0 + DAY_MS + MIN);

    await deleteSession(repo, accidental.id, T0 + DAY_MS + 2 * MIN);
    expect((await repo.listSessions('w1')).map((s) => s.id)).not.toContain(accidental.id);
    const w = await repo.getWork('w1');
    expect(w?.lastPlayedAt).toBe(T0 + 30 * MIN);
    expect(w?.updatedAt).toBe(T0 + DAY_MS + 2 * MIN);
  });

  it('removes lastPlayedAt when no ended session is left, and ignores unknown ids', async () => {
    const repo = seeded();
    const only = await play(repo, T0, T0 + 5 * MIN);
    await deleteSession(repo, 'no-such-session');
    expect((await repo.getWork('w1'))?.lastPlayedAt).toBe(T0 + 5 * MIN);
    await deleteSession(repo, only.id, T0 + 6 * MIN);
    expect(await repo.getWork('w1')).not.toHaveProperty('lastPlayedAt');
  });

  it('shares the repository lock with the library services', async () => {
    const { withRepoLock } = await import('./repoLock');
    const repo = seeded();
    const order: string[] = [];
    let release: () => void = () => undefined;
    const held = withRepoLock(repo, () => new Promise<void>((r) => (release = r)).then(() => void order.push('held')));
    const started = startSession(repo, 'w1', T0).then(() => void order.push('start'));
    await Promise.resolve();
    expect(order).toEqual([]);
    release();
    await Promise.all([held, started]);
    expect(order).toEqual(['held', 'start']);
  });
});
