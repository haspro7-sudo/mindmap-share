/**
 * CONTRACT: hash router hooks. Route shapes live in src/core/route.ts.
 */
import { useSyncExternalStore } from 'react';
import { buildHash, parseHashRoute } from '../core/route';
import type { Route } from '../core/route';

const ROUTE_EVENT = 'shiori:route';

function subscribe(onChange: () => void): () => void {
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
  return useSyncExternalStore(subscribe, getHash, () => '');
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

/** Go back if there is in-app history, otherwise navigate to the fallback route. */
export function goBack(fallback: Route = { name: 'home' }): void {
  if (window.history.length > 1) window.history.back();
  else navigate(fallback, { replace: true });
}
