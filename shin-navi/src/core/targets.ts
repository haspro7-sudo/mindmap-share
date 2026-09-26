// Flight targets (SPEC K-7). Elements register under a TargetId; the ball and the floor
// orbs register resolvers so 'face:<songId>' and 'orb:<member>' resolve to live positions.
import type { TargetId } from './events'

type Prefix = 'face' | 'orb'
type Resolver = (key: string) => DOMRectReadOnly | null

const elements = new Map<string, HTMLElement>()
const resolvers = new Map<Prefix, Resolver>()

/** Register (or with null, unregister) the element a TargetId points to. */
export function registerTarget(id: TargetId, el: HTMLElement | null): void {
  if (el) elements.set(id, el)
  else elements.delete(id)
}

/** Register the resolver for 'face:*' or 'orb:*'. Returns an unregister function. */
export function registerResolver(prefix: Prefix, fn: Resolver): () => void {
  resolvers.set(prefix, fn)
  return () => {
    if (resolvers.get(prefix) === fn) resolvers.delete(prefix)
  }
}

function rectOf(el: HTMLElement | undefined): DOMRectReadOnly | null {
  if (!el || !el.isConnected) return null
  const r = el.getBoundingClientRect()
  return r.width > 0 || r.height > 0 ? r : null
}

/**
 * Current viewport rect of a target, or null when nothing on screen matches.
 * Fallbacks keep flights landing somewhere sensible: a face without a resolver lands on
 * the hero ball, lane insert/end positions fall back to the next slot.
 */
export function resolveTarget(id: TargetId): DOMRectReadOnly | null {
  const colon = id.indexOf(':')
  const prefix = id.slice(0, colon)
  if (prefix === 'face' || prefix === 'orb') {
    const fn = resolvers.get(prefix)
    if (fn) {
      try {
        const r = fn(id.slice(colon + 1))
        if (r) return r
      } catch (err) {
        console.warn('[targets]', id, err)
      }
    }
    const direct = rectOf(elements.get(id))
    if (direct) return direct
    return prefix === 'face' ? rectOf(elements.get('hero:ball')) ?? rectOf(elements.get('room:ball')) : null
  }
  const direct = rectOf(elements.get(id))
  if (direct) return direct
  if (id === 'lane:insert' || id === 'lane:end') return rectOf(elements.get('lane:next'))
  if (id === 'room:lane') return null
  return null
}

const refCache = new Map<string, (el: HTMLElement | null) => void>()
/** Stable ref callback for JSX: <div ref={targetRef('dock:record')} />. */
export function targetRef(id: TargetId): (el: HTMLElement | null) => void {
  let fn = refCache.get(id)
  if (!fn) {
    fn = (el: HTMLElement | null) => registerTarget(id, el)
    refCache.set(id, fn)
  }
  return fn
}

/** Center point of a rect (handy for bursts). */
export function rectCenter(r: DOMRectReadOnly): { x: number; y: number } {
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
}
