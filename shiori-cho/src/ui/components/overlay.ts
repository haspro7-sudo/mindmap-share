/**
 * Shared helpers for modal layers (Sheet, dialogs, envelope reveal).
 *
 * - An overlay stack so that Escape closes only the topmost layer. Inside the app the shell's Escape → 「隠す」
 *   shortcut runs first (capture phase) and always wins, so these per-layer Escape handlers only act where no
 *   shell is mounted (tests, the first-launch screens).
 * - A reference-counted body scroll lock.
 * - A small focus trap / focus restore used by every modal layer. Only the topmost trap acts: Tab and
 *   Shift+Tab stay inside it — also when focus fell to <body> because the focused control was removed — and
 *   focus that moves outside it (a click on the page behind) is brought back. When a layer closes and the
 *   element to return to is gone, focus goes to the layer below instead of <body>.
 */
import { useEffect, useLayoutEffect } from 'react';
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

interface Trap {
  root: HTMLElement;
}
/** Active focus traps, innermost last. */
const traps: Trap[] = [];

/**
 * While `active`: moves focus into `ref` (to `initialFocus` if given, else the container itself),
 * keeps Tab / Shift+Tab inside it, and restores focus to the previously focused element afterwards
 * (or to the next open layer when that element was removed meanwhile).
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
    const trap: Trap = { root };
    traps.push(trap);
    const isTop = () => traps[traps.length - 1] === trap;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const target = initialFocus?.current ?? root;
    if (!root.contains(document.activeElement)) target.focus({ preventScroll: true });

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || !isTop()) return;
      const items = focusableIn(root);
      if (items.length === 0) {
        e.preventDefault();
        root.focus({ preventScroll: true });
        return;
      }
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const current = document.activeElement;
      if (!(current instanceof Node) || !root.contains(current)) {
        // focus is outside the layer (e.g. on <body> after the focused control was removed)
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      } else if (e.shiftKey && (current === first || current === root)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && current === last) {
        e.preventDefault();
        first.focus();
      }
    };
    const onFocusIn = (e: FocusEvent) => {
      if (!isTop()) return;
      const t = e.target;
      if (t instanceof Node && !root.contains(t)) root.focus({ preventScroll: true });
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('focusin', onFocusIn);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('focusin', onFocusIn);
      const i = traps.lastIndexOf(trap);
      if (i >= 0) traps.splice(i, 1);
      if (previous && previous.isConnected) {
        previous.focus({ preventScroll: true });
        return;
      }
      // The element to return to is gone: stay in the layer below, if one is still open.
      const below = traps[traps.length - 1];
      if (below && below.root.isConnected && !below.root.contains(document.activeElement)) below.root.focus({ preventScroll: true });
    };
    // initialFocus is a ref object: reading .current at activation time is intended.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, ref]);
}

/**
 * For a control that can disappear while focused (e.g. a hint button replaced by the hint): when it
 * unmounts with focus, focus moves to the modal layer containing it instead of falling to <body>.
 * Call with the control's ref.
 */
export function useFocusRescue(ref: RefObject<HTMLElement | null>): void {
  useLayoutEffect(
    () => () => {
      const el = ref.current;
      if (!el || typeof document === 'undefined' || document.activeElement !== el) return;
      const layer = el.closest<HTMLElement>('[role="dialog"],[role="alertdialog"]');
      if (!layer) return;
      queueMicrotask(() => {
        const now = document.activeElement;
        if (layer.isConnected && (now === null || now === document.body)) layer.focus({ preventScroll: true });
      });
    },
    [ref],
  );
}
