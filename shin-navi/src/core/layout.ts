// Layout context (SPEC F-5 / K-7). The view mode and box size come from a ResizeObserver on
// the app root, never from window media queries. Providers nest: the dual layout wraps the
// phone frame and the room pane in their own providers with a forced view and their own box.
import { createContext, createElement, useContext, useLayoutEffect, useMemo, useRef, useState, type HTMLAttributes, type ReactNode } from 'react'
import { params } from './params'
import { useNavi } from './store'
import type { ViewMode } from './types'

export type Box = { w: number; h: number }

type LayoutCtx = {
  w: number
  h: number
  /** view forced by an enclosing frame (dual: left 'phone', right 'room') */
  forced?: ViewMode
  /** accumulated CSS scale of enclosing frames (dual phone frame ≈ 0.86) */
  scale: number
  /** the provider's element (for converting viewport rects into local coordinates) */
  el: () => HTMLElement | null
}

const Ctx = createContext<LayoutCtx | null>(null)

function viewportBox(): Box {
  if (typeof window === 'undefined') return { w: 390, h: 844 }
  return { w: window.innerWidth || 390, h: window.innerHeight || 844 }
}

export type LayoutProviderProps = Omit<HTMLAttributes<HTMLDivElement>, 'children'> & {
  children?: ReactNode
  /** force the view for everything inside (dual frames) */
  view?: ViewMode
  /** fixed logical box instead of measuring (the scaled 390×844 phone frame) */
  fixed?: Box
  /** CSS scale applied to this provider's element by its parent */
  scale?: number
}

/** Measures its own element (100% × 100% by default) and provides box + view to descendants. */
export function LayoutProvider({ view, fixed, scale = 1, children, style, ...rest }: LayoutProviderProps) {
  const ref = useRef<HTMLDivElement>(null)
  const parent = useContext(Ctx)
  const [box, setBox] = useState<Box>(() => fixed ?? viewportBox())
  const fw = fixed?.w
  const fh = fixed?.h

  useLayoutEffect(() => {
    if (fw != null && fh != null) {
      setBox(b => (b.w === fw && b.h === fh ? b : { w: fw, h: fh }))
      return
    }
    const el = ref.current
    if (!el) return
    // clientWidth/Height are layout sizes: unaffected by transforms on ancestors.
    const measure = () => {
      const w = Math.round(el.clientWidth)
      const h = Math.round(el.clientHeight)
      if (w > 0 && h > 0) setBox(b => (b.w === w && b.h === h ? b : { w, h }))
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [fw, fh])

  const accScale = (parent?.scale ?? 1) * scale
  const value = useMemo<LayoutCtx>(() => ({ w: box.w, h: box.h, forced: view ?? undefined, scale: accScale, el: () => ref.current }), [box.w, box.h, view, accScale])

  return createElement(
    Ctx.Provider,
    { value },
    createElement('div', { ref, ...rest, style: { position: 'relative', width: '100%', height: '100%', ...style } }, children),
  )
}

/** Automatic choice: < 700 px wide → phone; ≥ 700 and landscape → room. dual is never automatic. */
export function autoView(w: number, h: number): ViewMode {
  if (w < 700) return 'phone'
  return w > h ? 'room' : 'phone'
}

/** ?view > presenter setting (session.view unless 'auto') > automatic from the root box. */
export function useViewMode(): ViewMode {
  const ctx = useContext(Ctx)
  const stored = useNavi(s => s.session.view)
  if (ctx?.forced) return ctx.forced
  if (params.view) return params.view
  if (stored !== 'auto') return stored
  const b = ctx ?? viewportBox()
  return autoView(b.w, b.h)
}

/** Size of the nearest layout box. compact: shorter than 760 px (the 360×740 phone variant). */
export function useBox(): { w: number; h: number; compact: boolean } {
  const ctx = useContext(Ctx)
  const b = ctx ?? viewportBox()
  return useMemo(() => ({ w: b.w, h: b.h, compact: b.h < 760 }), [b.w, b.h])
}

/**
 * For layers inside a scaled frame (dual): converts viewport rects (getBoundingClientRect,
 * resolveTarget) into this provider's local, unscaled coordinates.
 */
export function useLayoutFrame(): { scale: number; toLocal(r: { left: number; top: number; width: number; height: number }): { x: number; y: number; w: number; h: number } } {
  const ctx = useContext(Ctx)
  return useMemo(() => {
    const scale = ctx?.scale ?? 1
    return {
      scale,
      toLocal(r) {
        const el = ctx?.el()
        const o = el ? el.getBoundingClientRect() : { left: 0, top: 0 }
        return { x: (r.left - o.left) / scale, y: (r.top - o.top) / scale, w: r.width / scale, h: r.height / scale }
      },
    }
  }, [ctx])
}

// ---- phone shell metrics (SPEC F-3). Shared so sheets, shells and features agree.

export type PhoneMetrics = {
  status: number
  lane: number
  laneCompact: number
  search: number
  hero: number
  ball: number
  /** ball centre, relative to the hero top */
  ballCy: number
  /** floor horizon, relative to the hero top */
  horizon: number
  deck: number
  action: number
  dock: number
  cardW: number
  cardH: number
  /** y of the lane's bottom edge (sheets start here), before the safe-area inset */
  laneBottom: number
  small: boolean
}

export function phoneMetrics(b: Box): PhoneMetrics {
  const small = b.h < 760 || b.w < 375
  if (small) {
    return { status: 40, lane: 56, laneCompact: 44, search: 36, hero: 196, ball: 160, ballCy: 84, horizon: 158, deck: 268, action: 52, dock: 64, cardW: 290, cardH: 260, laneBottom: 96, small }
  }
  return { status: 44, lane: 64, laneCompact: 44, search: 40, hero: 244, ball: 196, ballCy: 102, horizon: 192, deck: 308, action: 56, dock: 80, cardW: 320, cardH: 296, laneBottom: 108, small }
}

export function usePhoneMetrics(): PhoneMetrics {
  const { w, h } = useBox()
  return useMemo(() => phoneMetrics({ w, h }), [w, h])
}

/** Room screen column split (SPEC F-4 / F-5), as percentages. */
export function roomColumns(w: number, inDual: boolean): [number, number, number] {
  if (inDual) return [30, 45, 25]
  return w <= 1100 ? [28, 44, 28] : [26, 46, 28]
}
