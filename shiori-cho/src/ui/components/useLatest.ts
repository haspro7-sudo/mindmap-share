import { useLayoutEffect, useRef } from 'react';
import type { RefObject } from 'react';

/**
 * A ref that always holds the latest `value` (updated after each commit), for reading the current props /
 * state inside timers, native event listeners and async callbacks without re-subscribing.
 * Read `.current` only outside render.
 */
export function useLatest<T>(value: T): RefObject<T> {
  const ref = useRef(value);
  useLayoutEffect(() => {
    ref.current = value;
  });
  return ref;
}
