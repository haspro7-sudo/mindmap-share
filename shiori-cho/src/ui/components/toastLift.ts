// Keeps toasts (shell/UiProvider, portaled to <body>) clear of sticky bottom bars without CSS :has():
// a bar publishes its measured height as `--toast-lift` on <html>, and .ui-toasts adds it to its offset
// (see UiProvider.css). Only one bar is expected at a time; the last one to publish wins and clearing is
// done by whoever published.
//
// Also: `useHtmlFlag` sets a data attribute on <html> while mounted (reference-counted), used for
// data-bottom-nav (the bottom navigation) and data-sheet-open (Sheet), which the toast offset reads too.
import { useEffect } from 'react';
import type { RefObject } from 'react';

const LIFT_VAR = '--toast-lift';
/** gap between the bar's top edge and the toast */
const LIFT_GAP_PX = 10;

/** Publishes `ref`'s height (+ a small gap) as --toast-lift while `active`, following size changes. */
export function useToastLift(ref: RefObject<HTMLElement | null>, active = true): void {
  useEffect(() => {
    const el = ref.current;
    if (!active || !el || typeof document === 'undefined') return;
    const root = document.documentElement;
    const publish = () => {
      const h = el.getBoundingClientRect().height;
      root.style.setProperty(LIFT_VAR, `${Math.max(0, Math.round(h)) + LIFT_GAP_PX}px`);
    };
    publish();
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(publish);
    ro?.observe(el);
    return () => {
      ro?.disconnect();
      root.style.removeProperty(LIFT_VAR);
    };
  }, [ref, active]);
}

const flagCounts = new Map<string, number>();

/** Sets `data-<name>` on <html> while `active` (nested users are counted). */
export function useHtmlFlag(name: string, active: boolean): void {
  useEffect(() => {
    if (!active || typeof document === 'undefined') return;
    const root = document.documentElement;
    const attr = `data-${name}`;
    const n = (flagCounts.get(attr) ?? 0) + 1;
    flagCounts.set(attr, n);
    root.setAttribute(attr, '');
    return () => {
      const left = (flagCounts.get(attr) ?? 1) - 1;
      if (left <= 0) {
        flagCounts.delete(attr);
        root.removeAttribute(attr);
      } else {
        flagCounts.set(attr, left);
      }
    };
  }, [name, active]);
}
