import { describe, it, expect } from 'vitest';
import {
  daysSince,
  formatMinutesJa,
  hasResumeInfo,
  resumeInfo,
  resumeLabelJa,
  sessionMinutes,
  totalMinutes,
} from './session';
import type { Session } from './types';

const MIN = 60_000;
const HOUR = 60 * MIN;

/** Epoch ms of a Tokyo wall-clock time (explicit offset, independent of the process TZ). */
function jst(iso: string): number {
  return Date.parse(`${iso}+09:00`);
}

/** process.env without depending on Node type definitions (tsconfig.app.json has no 'node' types). */
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;

function session(id: string, extra: Partial<Session> = {}): Session {
  return { id, workId: 'w1', startedAt: 0, ...extra };
}

describe('test environment', () => {
  it('runs with TZ=Asia/Tokyo', () => {
    expect(new Date(jst('2026-09-26T12:00:00')).getTimezoneOffset()).toBe(-540);
    expect(new Date(jst('2026-09-26T00:30:00')).getDate()).toBe(26);
  });
});

describe('sessionMinutes', () => {
  it('rounds to the nearest minute', () => {
    expect(sessionMinutes(0, 0)).toBe(0);
    expect(sessionMinutes(0, 29_999)).toBe(0);
    expect(sessionMinutes(0, 30_000)).toBe(1);
    expect(sessionMinutes(0, 89_999)).toBe(1);
    expect(sessionMinutes(0, 90_000)).toBe(2);
    expect(sessionMinutes(1_000, 1_000 + 42 * MIN + 10_000)).toBe(42);
  });

  it('caps at 720 minutes', () => {
    expect(sessionMinutes(0, 720 * MIN)).toBe(720);
    expect(sessionMinutes(0, 720 * MIN + 29_999)).toBe(720);
    expect(sessionMinutes(0, 721 * MIN)).toBe(720);
    expect(sessionMinutes(0, 3 * 24 * HOUR)).toBe(720);
  });

  it('is never negative or NaN', () => {
    expect(sessionMinutes(10 * MIN, 0)).toBe(0);
    expect(Object.is(sessionMinutes(20_000, 0), 0)).toBe(true);
    expect(sessionMinutes(0, Number.NaN)).toBe(0);
    expect(sessionMinutes(Number.NaN, 0)).toBe(0);
    expect(sessionMinutes(0, Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe('daysSince (local calendar days, Asia/Tokyo)', () => {
  it('is 0 on the same local day', () => {
    expect(daysSince(jst('2026-09-26T00:00:00'), jst('2026-09-26T23:59:59'))).toBe(0);
    expect(daysSince(jst('2026-09-26T08:00:00'), jst('2026-09-26T08:00:00'))).toBe(0);
  });

  it('is 1 across local midnight even when only minutes apart', () => {
    expect(daysSince(jst('2026-09-25T23:59:00'), jst('2026-09-26T00:01:00'))).toBe(1);
  });

  it('uses the local (JST) date, not the UTC date', () => {
    // 2026-09-25T15:30Z = 09-26 00:30 JST and 2026-09-25T14:30Z = 09-25 23:30 JST: same UTC date, different JST dates.
    expect(daysSince(Date.parse('2026-09-25T14:30:00Z'), Date.parse('2026-09-25T15:30:00Z'))).toBe(1);
    // 2026-09-25T15:00Z (= 09-26 00:00 JST) and 2026-09-26T14:59Z (= 09-26 23:59 JST): two UTC dates, one JST date.
    expect(daysSince(Date.parse('2026-09-25T15:00:00Z'), Date.parse('2026-09-26T14:59:00Z'))).toBe(0);
  });

  it('counts calendar days, not 24-hour periods', () => {
    // 47 hours apart but only one calendar day
    expect(daysSince(jst('2026-09-24T00:30:00'), jst('2026-09-25T23:30:00'))).toBe(1);
    // 25 hours apart spanning two midnights
    expect(daysSince(jst('2026-09-24T23:30:00'), jst('2026-09-26T00:30:00'))).toBe(2);
    expect(daysSince(jst('2026-09-23T12:00:00'), jst('2026-09-26T09:00:00'))).toBe(3);
  });

  it('handles month and year boundaries and leap days', () => {
    expect(daysSince(jst('2026-12-31T23:00:00'), jst('2027-01-01T01:00:00'))).toBe(1);
    expect(daysSince(jst('2028-02-28T12:00:00'), jst('2028-03-01T12:00:00'))).toBe(2);
    expect(daysSince(jst('2026-01-01T00:00:00'), jst('2027-01-01T00:00:00'))).toBe(365);
  });

  it('never returns a negative value', () => {
    expect(daysSince(jst('2026-09-27T10:00:00'), jst('2026-09-26T10:00:00'))).toBe(0);
    expect(daysSince(Number.NaN, jst('2026-09-26T10:00:00'))).toBe(0);
  });

  it('is DST-safe in a zone with daylight saving time', (ctx) => {
    const prev = env.TZ;
    env.TZ = 'America/New_York';
    try {
      // Skip when the runtime does not honour a TZ change (e.g. some worker setups).
      if (new Date(Date.UTC(2026, 0, 15)).getTimezoneOffset() !== 300) ctx.skip();
      // US DST starts 2026-03-08 (23-hour day) and ends 2026-11-01 (25-hour day).
      const springBefore = Date.parse('2026-03-07T23:30:00-05:00');
      const springAfter = Date.parse('2026-03-09T00:30:00-04:00');
      expect(daysSince(springBefore, springAfter)).toBe(2);
      expect(daysSince(Date.parse('2026-03-08T00:10:00-05:00'), Date.parse('2026-03-08T23:50:00-04:00'))).toBe(0);
      expect(daysSince(Date.parse('2026-11-01T00:10:00-04:00'), Date.parse('2026-11-01T23:50:00-05:00'))).toBe(0);
      expect(daysSince(Date.parse('2026-10-31T23:50:00-04:00'), Date.parse('2026-11-02T00:10:00-05:00'))).toBe(2);
    } finally {
      if (prev === undefined) delete env.TZ;
      else env.TZ = prev;
    }
    // restored for the remaining tests
    expect(new Date(Date.UTC(2026, 0, 15)).getTimezoneOffset()).toBe(-540);
  });
});

describe('resumeLabelJa', () => {
  it('reads 今日 / 昨日 / N日ぶり', () => {
    expect(resumeLabelJa(0)).toBe('今日');
    expect(resumeLabelJa(1)).toBe('昨日');
    expect(resumeLabelJa(2)).toBe('2日ぶり');
    expect(resumeLabelJa(3)).toBe('3日ぶり');
    expect(resumeLabelJa(120)).toBe('120日ぶり');
  });

  it('clamps odd input', () => {
    expect(resumeLabelJa(-2)).toBe('今日');
    expect(resumeLabelJa(Number.NaN)).toBe('今日');
    expect(resumeLabelJa(2.7)).toBe('2日ぶり');
  });

  it('composes with daysSince across local midnight', () => {
    const now = jst('2026-09-26T00:05:00');
    expect(resumeLabelJa(daysSince(jst('2026-09-26T00:01:00'), now))).toBe('今日');
    expect(resumeLabelJa(daysSince(jst('2026-09-25T23:55:00'), now))).toBe('昨日');
    expect(resumeLabelJa(daysSince(jst('2026-09-23T23:55:00'), now))).toBe('3日ぶり');
  });
});

describe('resumeInfo', () => {
  it('picks the latest ended session that has resume info', () => {
    const sessions: Session[] = [
      session('open', { startedAt: 9_000, checkpointId: 'ch3' }), // not ended
      session('bare', { startedAt: 7_000, endedAt: 8_000, minutes: 1 }), // ended, no info
      session('mid', { startedAt: 5_000, endedAt: 6_000, whereNote: '第2章のボス前' }),
      session('old', { startedAt: 1_000, endedAt: 2_000, checkpointId: 'ch1' }),
    ];
    expect(resumeInfo(sessions)?.id).toBe('mid');
  });

  it('accepts a checkpoint, whereNote or nextTodo', () => {
    expect(resumeInfo([session('a', { endedAt: 1, checkpointId: 'ch1' })])?.id).toBe('a');
    expect(resumeInfo([session('b', { endedAt: 1, whereNote: '図書館の2階' })])?.id).toBe('b');
    expect(resumeInfo([session('c', { endedAt: 1, nextTodo: '猫に話しかける' })])?.id).toBe('c');
  });

  it('ignores empty or whitespace-only notes and empty checkpoint ids', () => {
    const s = session('x', { endedAt: 1, checkpointId: '', whereNote: '', nextTodo: '　 ' });
    expect(hasResumeInfo(s)).toBe(false);
    expect(resumeInfo([s])).toBeUndefined();
  });

  it('orders by endedAt, then startedAt, regardless of input order', () => {
    const a = session('a', { startedAt: 100, endedAt: 500, nextTodo: 'A' });
    const b = session('b', { startedAt: 200, endedAt: 500, nextTodo: 'B' });
    const c = session('c', { startedAt: 300, endedAt: 400, nextTodo: 'C' });
    expect(resumeInfo([a, b, c])?.id).toBe('b');
    expect(resumeInfo([c, b, a])?.id).toBe('b');
    // a later start but an earlier end loses
    const d = session('d', { startedAt: 1_000, endedAt: 450, nextTodo: 'D' });
    expect(resumeInfo([d, a])?.id).toBe('a');
  });

  it('returns undefined when nothing qualifies', () => {
    expect(resumeInfo([])).toBeUndefined();
    expect(resumeInfo([session('open', { nextTodo: 'まだ終わっていない' })])).toBeUndefined();
  });
});

describe('totalMinutes', () => {
  it('sums the minutes of ended sessions only', () => {
    const sessions: Session[] = [
      session('a', { endedAt: 1, minutes: 30 }),
      session('b', { endedAt: 2, minutes: 95 }),
      session('open', { minutes: 999 }),
      session('nomin', { endedAt: 3 }),
    ];
    expect(totalMinutes(sessions)).toBe(125);
  });

  it('is 0 for no sessions and ignores invalid minutes', () => {
    expect(totalMinutes([])).toBe(0);
    expect(
      totalMinutes([session('n', { endedAt: 1, minutes: Number.NaN }), session('m', { endedAt: 1, minutes: -5 })]),
    ).toBe(0);
  });
});

describe('formatMinutesJa', () => {
  it('formats minutes and hours', () => {
    expect(formatMinutesJa(0)).toBe('0分');
    expect(formatMinutesJa(1)).toBe('1分');
    expect(formatMinutesJa(40)).toBe('40分');
    expect(formatMinutesJa(59)).toBe('59分');
    expect(formatMinutesJa(60)).toBe('1時間');
    expect(formatMinutesJa(61)).toBe('1時間1分');
    expect(formatMinutesJa(120)).toBe('2時間');
    expect(formatMinutesJa(125)).toBe('2時間5分');
    expect(formatMinutesJa(720)).toBe('12時間');
    expect(formatMinutesJa(6000)).toBe('100時間');
  });

  it('clamps odd input', () => {
    expect(formatMinutesJa(-3)).toBe('0分');
    expect(formatMinutesJa(Number.NaN)).toBe('0分');
    expect(formatMinutesJa(59.6)).toBe('1時間');
  });
});
