/**
 * Shared helpers for modal layers (Sheet, dialogs, envelope reveal).
 *
 * - An overlay stack so that Escape closes only the topmost layer, and the app-wide Escape → 「隠す」
 *   shortcut stays out of the way while a modal layer is open (see `hasOpenOverlay`).
 * - A reference-counted body scroll lock.
 * - A small focus trap / focus restore used by every modal layer.
 */
import { useEffect } from 'react';
import type { RefObject } from 'react';
import { useLatest } from './useLatest';

const stack: symbol[] = [];

/** true while any Sheet / dialog / envelope layer is open. */
export function hasOpenOverlay(): boolean {
  return stack.length > 0;
}

/**
 * Registers a modal layer while `active`. `onEscape` runs only when this layer is the topmost one;
 * the Escape event is then marked `defaultPrevented` so outer handlers ignore it.
 * Escape presses that belong to an IME composition (Japanese input) are ignored.
 */
export function useOverlayLayer(active: boolean, onEscape: () => void): void {
  const onEscapeRef = useLatest(onEscape);
  useEffect(() => {
    if (!active) return;
    const id = Symbol('overlay');
    stack.push(id);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.isComposing || e.keyCode === 229) return;
      if (stack[stack.length - 1] !== id || e.defaultPrevented) return;
      e.preventDefault();
      e.stopPropagation();
      onEscapeRef.current();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      const i = stack.lastIndexOf(id);
      if (i >= 0) stack.splice(i, 1);
    };
  }, [active, onEscapeRef]);
}

let scrollLocks = 0;
let savedOverflow = '';

/** Locks body scrolling while `active` (nested layers are counted). */
export function useScrollLock(active: boolean): void {
  useEffect(() => {
    if (!active || typeof document === 'undefined') return;
    const body = document.body;
    if (scrollLocks === 0) {
      savedOverflow = body.style.overflow;
      body.style.overflow = 'hidden';
    }
    scrollLocks += 1;
    return () => {
      scrollLocks = Math.max(0, scrollLocks - 1);
      if (scrollLocks === 0) body.style.overflow = savedOverflow;
    };
  }, [active]);
}

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export function focusableIn(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => !el.hasAttribute('inert') && el.getAttribute('aria-hidden') !== 'true',
  );
}

/**
 * While `active`: moves focus into `ref` (to `initialFocus` if given, else the container itself),
 * keeps Tab / Shift+Tab inside it, and restores focus to the previously focused element afterwards.
 */
export function useFocusTrap(
  ref: RefObject<HTMLElement | null>,
  active: boolean,
  initialFocus?: RefObject<HTMLElement | null>,
): void {
  useEffect(() => {
    if (!active) return;
    const root = ref.current;
    if (!root) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const target = initialFocus?.current ?? root;
    if (!root.contains(document.activeElement)) target.focus({ preventScroll: true });

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const items = focusableIn(root);
      if (items.length === 0) {
        e.preventDefault();
        root.focus({ preventScroll: true });
        return;
      }
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const current = document.activeElement;
      if (e.shiftKey && (current === first || current === root)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && current === last) {
        e.preventDefault();
        first.focus();
      } else if (current instanceof Node && !root.contains(current)) {
        e.preventDefault();
        first.focus();
      }
    };
    root.addEventListener('keydown', onKey);
    return () => {
      root.removeEventListener('keydown', onKey);
      if (previous && previous.isConnected) previous.focus({ preventScroll: true });
    };
    // initialFocus is a ref object: reading .current at activation time is intended.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, ref]);
}
