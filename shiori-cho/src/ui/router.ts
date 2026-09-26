/**
 * CONTRACT: hash router hooks. Route shapes live in src/core/route.ts.
 *
 * In-app history depth: every history entry of the app carries its position in `history.state.shioriIdx`
 * (0 for the entry the app was opened on, +1 for each entry pushed inside the app; replaceState keeps it).
 * `goBack` uses it to go back only within the app: `history.length` also counts other sites' entries in the
 * same tab, so an app opened from a circle's page (or a deep link) would otherwise leave on 「戻る」.
 */
import { useSyncExternalStore } from 'react';
import { buildHash, parseHashRoute } from '../core/route';
import type { Route } from '../core/route';

const ROUTE_EVENT = 'shiori:route';
const IDX_KEY = 'shioriIdx';

let lastIdx = -1;

function readIdx(state: unknown): number | undefined {
  if (state === null || typeof state !== 'object') return undefined;
  const v = (state as Record<string, unknown>)[IDX_KEY];
  return typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : undefined;
}

/**
 * Gives the current history entry its in-app index if it has none yet (a new entry: one past the entry we
 * came from), and remembers it. Runs at start-up and on every hash change. Exported for tests.
 */
export function stampHistoryEntry(): number {
  if (typeof window === 'undefined') return 0;
  const h = window.history;
  const known = readIdx(h.state);
  if (known !== undefined) {
    lastIdx = known;
    return known;
  }
  const idx = lastIdx + 1;
  try {
    const base = h.state !== null && typeof h.state === 'object' ? (h.state as Record<string, unknown>) : {};
    h.replaceState({ ...base, [IDX_KEY]: idx }, '');
  } catch {
    // history unavailable: goBack falls back to the parent route
  }
  lastIdx = idx;
  return idx;
}

/** In-app index of the current history entry (0 = the entry the app was opened on). */
export function historyIndex(): number {
  return typeof window === 'undefined' ? 0 : (readIdx(window.history.state) ?? 0);
}

/** Test hook: forget what was seen (as after a fresh page load). */
export function resetHistoryTrackingForTests(): void {
  lastIdx = -1;
}

if (typeof window !== 'undefined') {
  stampHistoryEntry();
  // Registered at module load, so it runs before the React subscriptions below re-render.
  window.addEventListener('hashchange', () => stampHistoryEntry());
}

/** Calls `onChange` after every navigation (hash change or navigate()); returns the unsubscribe function. */
export function subscribeRouteChange(onChange: () => void): () => void {
  window.addEventListener('hashchange', onChange);
  window.addEventListener(ROUTE_EVENT, onChange);
  return () => {
    window.removeEventListener('hashchange', onChange);
    window.removeEventListener(ROUTE_EVENT, onChange);
  };
}

function getHash(): string {
  return window.location.hash;
}

/** Current hash string (re-renders on navigation). */
export function useHash(): string {
  return useSyncExternalStore(subscribeRouteChange, getHash, () => '');
}

/** Current parsed route (re-renders on navigation). */
export function useRoute(): Route {
  return parseHashRoute(useHash());
}

/** Hash for a route, for use in <a href>. */
export function hrefFor(route: Route): string {
  return buildHash(route);
}

/**
 * Navigate to a route or a raw hash ('#/…').
 * replace: true uses history.replaceState (no new history entry, used for deep-link cleanup).
 */
export function navigate(to: Route | string, opts: { replace?: boolean } = {}): void {
  const hash = typeof to === 'string' ? (to.startsWith('#') ? to : `#${to}`) : buildHash(to);
  if (hash === window.location.hash) return;
  if (opts.replace) {
    const url = `${window.location.pathname}${window.location.search}${hash}`;
    window.history.replaceState(window.history.state, '', url);
    window.dispatchEvent(new Event(ROUTE_EVENT));
  } else {
    window.location.hash = hash;
  }
}

/**
 * Go back if the current entry was reached inside the app (see the module comment), otherwise replace it
 * with the fallback route (never leaves the app).
 */
export function goBack(fallback: Route = { name: 'home' }): void {
  stampHistoryEntry();
  if (historyIndex() > 0) window.history.back();
  else navigate(fallback, { replace: true });
}
