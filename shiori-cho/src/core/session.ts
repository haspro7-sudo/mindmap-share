/**
 * Play-session helpers (docs/SPEC.md §5.2, F13). Calendar math uses the device's local time zone.
 */
import { SESSION_MAX_MINUTES } from './constants';
import type { Session } from './types';

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

/** min(round((end-start)/60000), 720), never negative */
export function sessionMinutes(start: number, end: number): number {
  const raw = Math.round((end - start) / MINUTE_MS);
  if (!Number.isFinite(raw)) return 0;
  return Math.max(0, Math.min(raw, SESSION_MAX_MINUTES));
}

/**
 * Local calendar date of `ts` as a day number. Built from the local Y/M/D through Date.UTC, so it
 * is an exact integer and unaffected by DST transitions (23- or 25-hour days).
 */
function localDayNumber(ts: number): number {
  const d = new Date(ts);
  return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY_MS;
}

/** local calendar days between ts and now (0 = same local day); never negative */
export function daysSince(ts: number, now: number): number {
  if (!Number.isFinite(ts) || !Number.isFinite(now)) return 0;
  const days = localDayNumber(now) - localDayNumber(ts);
  return Number.isFinite(days) && days > 0 ? days : 0;
}

/** 「今日」「昨日」「N日ぶり」 */
export function resumeLabelJa(days: number): string {
  const d = Number.isFinite(days) ? Math.max(0, Math.floor(days)) : 0;
  if (d === 0) return '今日';
  if (d === 1) return '昨日';
  return `${d}日ぶり`;
}

function hasText(s: string | undefined): boolean {
  return s !== undefined && s.trim() !== '';
}

/** true when the session carries something to resume from (checkpoint, 「どこまで」 or 「次にやること」). */
export function hasResumeInfo(s: Session): boolean {
  return (s.checkpointId !== undefined && s.checkpointId !== '') || hasText(s.whereNote) || hasText(s.nextTodo);
}

/** latest ENDED session having checkpointId, whereNote or nextTodo (by endedAt, then startedAt) */
export function resumeInfo(sessions: readonly Session[]): Session | undefined {
  let best: Session | undefined;
  let bestEnded = -Infinity;
  for (const s of sessions) {
    if (s.endedAt === undefined || !hasResumeInfo(s)) continue;
    if (
      best === undefined ||
      s.endedAt > bestEnded ||
      (s.endedAt === bestEnded && s.startedAt > best.startedAt)
    ) {
      best = s;
      bestEnded = s.endedAt;
    }
  }
  return best;
}

/** Sum of `minutes` over ended sessions (missing or invalid minutes count as 0). */
export function totalMinutes(sessions: readonly Session[]): number {
  let sum = 0;
  for (const s of sessions) {
    if (s.endedAt === undefined) continue;
    const m = s.minutes;
    if (m !== undefined && Number.isFinite(m) && m > 0) sum += m;
  }
  return sum;
}

/** 125 → 「2時間5分」, 120 → 「2時間」, 40 → 「40分」 */
export function formatMinutesJa(minutes: number): string {
  const total = Number.isFinite(minutes) ? Math.max(0, Math.round(minutes)) : 0;
  if (total < 60) return `${total}分`;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return m === 0 ? `${h}時間` : `${h}時間${m}分`;
}
