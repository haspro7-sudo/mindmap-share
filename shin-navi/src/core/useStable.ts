// Selector helpers for derived values. zustand 5 requires selectors to return a cached
// snapshot; selectors that build new arrays/objects (e.g. selKnowView) would loop forever.
// useNaviStable keeps the previous result while it is structurally equal.
import { useRef } from 'react'
import { useNavi } from './store'
import type { NaviState } from './store/types'

export function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  if (Array.isArray(a)) {
    const bb = b as unknown[]
    if (a.length !== bb.length) return false
    for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], bb[i])) return false
    return true
  }
  const ka = Object.keys(a as object)
  const kb = Object.keys(b as object)
  if (ka.length !== kb.length) return false
  for (const k of ka) {
    if (!Object.prototype.hasOwnProperty.call(b, k)) return false
    if (!deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) return false
  }
  return true
}

/** Like useNavi(selector) but returns the previous value while the new one is deep-equal. */
export function useNaviStable<T>(selector: (s: NaviState) => T): T {
  const prev = useRef<{ v: T } | null>(null)
  return useNavi(s => {
    const next = selector(s)
    if (prev.current && deepEqual(prev.current.v, next)) return prev.current.v
    prev.current = { v: next }
    return next
  })
}
