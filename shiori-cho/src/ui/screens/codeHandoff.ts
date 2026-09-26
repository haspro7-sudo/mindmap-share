// One-shot hand-off from the deep-link landing (#/u/…, UnlockLanding) to the code screen (#/code).
// The deep link's code must not stay in the address bar (F11 AC1), so what the code screen needs to show
// afterwards (the code to retry or copy, and whether to show the iOS copy notice, F11 AC3) travels through
// sessionStorage instead: written right before the redirect, read once by the code screen, then removed.
// Only the code itself is stored (never a title); it expires after a few minutes.

export type CodeHandoffStatus = 'pending' | 'noMatch' | 'invalid';

export interface CodeHandoff {
  status: CodeHandoffStatus;
  /** display form of the code (or the raw text for 'invalid') */
  code: string;
  /** show 「ホーム画面のしおり帳で使う場合：…」 with a copy button (iOS Safari outside the home-screen app) */
  ios: boolean;
  /** Date.now() when written */
  at: number;
}

const KEY = 'shiori.codeHandoff';
/** Ignore a hand-off that was never picked up right away (e.g. the app was closed in between). */
const MAX_AGE_MS = 5 * 60_000;
const MAX_CODE_CHARS = 120;
const STATUSES: readonly CodeHandoffStatus[] = ['pending', 'noMatch', 'invalid'];

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

export function writeCodeHandoff(h: Omit<CodeHandoff, 'at'>, now: number = Date.now()): void {
  try {
    storage()?.setItem(KEY, JSON.stringify({ ...h, code: h.code.slice(0, MAX_CODE_CHARS), at: now }));
  } catch {
    // storage unavailable: the code screen simply shows no hand-off
  }
}

/** The pending hand-off, without removing it (safe to call twice under StrictMode). */
export function peekCodeHandoff(now: number = Date.now()): CodeHandoff | null {
  let raw: string | null = null;
  try {
    raw = storage()?.getItem(KEY) ?? null;
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<CodeHandoff> | null;
    if (!v || typeof v !== 'object') return null;
    if (!STATUSES.includes(v.status as CodeHandoffStatus)) return null;
    if (typeof v.code !== 'string' || typeof v.at !== 'number' || typeof v.ios !== 'boolean') return null;
    if (now - v.at > MAX_AGE_MS || v.at - now > MAX_AGE_MS) return null;
    return { status: v.status as CodeHandoffStatus, code: v.code.slice(0, MAX_CODE_CHARS), ios: v.ios, at: v.at };
  } catch {
    return null;
  }
}

export function clearCodeHandoff(): void {
  try {
    storage()?.removeItem(KEY);
  } catch {
    // ignore
  }
}
