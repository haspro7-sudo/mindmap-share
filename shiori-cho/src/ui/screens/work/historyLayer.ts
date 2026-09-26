// In-page layers that Back closes: sheets kept in component state (記録を終える, 記録を編集, かんたんしおりにする,
// しおりファイルを読み込む) and the sub-views of #/add.
//
// Route sheets (sheet=g<n> / x<n>) are history entries of their own. Layers that live in component state are
// not, so Android Back (or the browser's Back) would leave the page and drop what was typed. While such a layer
// is open, a marker entry with the same URL sits on top of history: Back pops it and closes the layer while the
// page stays, and closing the layer from the page (×, キャンセル, saving) pops the marker again, so no stray entry
// is left behind. The marker copies the current history state (including the router's in-app index).
import { useEffect, useRef } from 'react';
import { useLatest } from '../../components/useLatest';

const KEY = 'shioriLayer';

/** Tokens of the layers that are open right now (a token left on an entry by a replace is ignored). */
const live = new Set<string>();
let seq = 0;
/** true while leaveLayersThen() pops markers: layers then close without calling their onBack */
let leaving = false;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function markerOf(state: unknown): string | undefined {
  const v = isRecord(state) ? state[KEY] : undefined;
  return typeof v === 'string' && live.has(v) ? v : undefined;
}

interface Layer {
  token: string;
  url: string;
  popped: boolean;
  closeTimer?: ReturnType<typeof setTimeout>;
}

/**
 * While `open`, Back closes the layer by calling `onBack` (instead of leaving the page). The caller closes the
 * layer from the page as usual (setting `open` to false or unmounting it); the marker entry is then removed.
 */
export function useBackToClose(open: boolean, onBack: () => void): void {
  const onBackRef = useLatest(onBack);
  const layerRef = useRef<Layer | null>(null);

  useEffect(() => {
    if (!open || typeof window === 'undefined') return;
    let layer = layerRef.current;
    if (layer && layer.closeTimer !== undefined) {
      // The effect ran again right away (React StrictMode): the marker is still there, keep it.
      clearTimeout(layer.closeTimer);
      delete layer.closeTimer;
    } else {
      const token = `${Date.now().toString(36)}-${++seq}`;
      const url = window.location.href;
      try {
        const base = isRecord(window.history.state) ? window.history.state : {};
        window.history.pushState({ ...base, [KEY]: token }, '', url);
      } catch {
        return; // no history: Back simply behaves as before
      }
      live.add(token);
      layer = { token, url, popped: false };
      layerRef.current = layer;
    }
    const current = layer;

    const onPop = () => {
      if (isRecord(window.history.state) && window.history.state[KEY] === current.token) return;
      current.popped = true;
      live.delete(current.token);
      window.removeEventListener('popstate', onPop);
      if (!leaving) onBackRef.current();
    };
    window.addEventListener('popstate', onPop);

    return () => {
      window.removeEventListener('popstate', onPop);
      if (current.popped) {
        layerRef.current = null;
        return;
      }
      // Closed from the page, or the page went away. Wait a tick (StrictMode mounts again at once), then pop the
      // marker if it is still the current entry (not when a navigation already moved past it).
      current.closeTimer = setTimeout(() => {
        layerRef.current = null;
        const onTop = markerOf(window.history.state) === current.token && window.location.href === current.url;
        live.delete(current.token);
        if (onTop) window.history.back();
      }, 0);
    };
  }, [open, onBackRef]);
}

/**
 * For a layer whose work ends by leaving the page (e.g. an import that then opens the new work with a replace):
 * pops the open layers' markers first, then runs `fn`, so the navigation replaces the page's own entry and not
 * the marker. Without an open layer, `fn` runs at once.
 */
export function leaveLayersThen(fn: () => void): void {
  if (typeof window === 'undefined' || markerOf(window.history.state) === undefined) {
    fn();
    return;
  }
  leaving = true;
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    window.removeEventListener('popstate', onPop);
    clearTimeout(timer);
    leaving = false;
    fn();
  };
  const onPop = () => {
    if (markerOf(window.history.state) === undefined) finish();
    else window.history.back();
  };
  window.addEventListener('popstate', onPop);
  // Should Back never report back (no history support), go on anyway.
  const timer = setTimeout(finish, 1000);
  window.history.back();
}
