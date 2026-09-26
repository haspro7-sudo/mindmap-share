// STUB (contract) — docs/SPEC.md §5.2, F13.
import type { Session } from './types';

/** min(round((end-start)/60000), 720), never negative */
export declare function sessionMinutes(start: number, end: number): number;
/** local calendar days between ts and now (0 = same local day) */
export declare function daysSince(ts: number, now: number): number;
/** 「今日」「昨日」「N日ぶり」 */
export declare function resumeLabelJa(days: number): string;
/** latest ENDED session having checkpointId, whereNote or nextTodo */
export declare function resumeInfo(sessions: readonly Session[]): Session | undefined;
export declare function totalMinutes(sessions: readonly Session[]): number;
/** 125 → 「2時間5分」, 40 → 「40分」 */
export declare function formatMinutesJa(minutes: number): string;
