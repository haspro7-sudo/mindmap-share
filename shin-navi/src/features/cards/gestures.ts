// Card gesture maths (SPEC C-1). Pure functions only: the pointer plumbing lives in DeckView.
//   up    : vertical dominant, and >= 600 px/s upward or moved >= 35% of the card height
//   right : horizontal dominant, and >= 600 px/s or moved >= 35% of the card width
//   left  : same, to the left
//   down  : vertical dominant downward (no action: the card springs back)
//   tap   : moved < 8 px and released before 500 ms
//   long  : moved < 8 px and held >= 500 ms
//   null  : a drag that did not reach any threshold (spring back)

export type Gesture = 'up' | 'right' | 'left' | 'down' | 'tap' | 'long' | null
export type GestureInput = { dx: number; dy: number; vx: number; vy: number; w: number; h: number; ms: number; moved: number }

export const TAP_SLOP = 8
export const LONG_MS = 500
export const FLICK_V = 600
export const DIST_RATIO = 0.35
/** A release moving back against the drag this fast cancels a distance-only commit. */
const PULLBACK_V = 350

export function classifyGesture(g: GestureInput): Gesture {
  if (g.moved < TAP_SLOP) return g.ms >= LONG_MS ? 'long' : 'tap'
  const ax = Math.abs(g.dx)
  const ay = Math.abs(g.dy)
  if (ay >= ax) {
    const up = g.dy < 0
    // velocity along the drag direction (positive = moving the same way as the displacement)
    const along = up ? -g.vy : g.vy
    if (along >= FLICK_V || (ay >= g.h * DIST_RATIO && along > -PULLBACK_V)) return up ? 'up' : 'down'
    return null
  }
  const right = g.dx > 0
  const along = right ? g.vx : -g.vx
  if (along >= FLICK_V || (ax >= g.w * DIST_RATIO && along > -PULLBACK_V)) return right ? 'right' : 'left'
  return null
}

export type DragDir = 'up' | 'right' | 'left' | null

/** Direction a drag is currently heading (for previews), or null while it is still small / downward. */
export function dragDirection(dx: number, dy: number): DragDir {
  const ax = Math.abs(dx)
  const ay = Math.abs(dy)
  if (Math.max(ax, ay) < 12) return null
  if (ay >= ax) return dy < 0 ? 'up' : null
  return dx > 0 ? 'right' : 'left'
}

/** 0..1 progress toward the commit distance in the current direction. */
export function dragProgress(dx: number, dy: number, w: number, h: number): number {
  const dir = dragDirection(dx, dy)
  if (!dir) return 0
  const d = dir === 'up' ? -dy / (h * DIST_RATIO) : Math.abs(dx) / (w * DIST_RATIO)
  return Math.max(0, Math.min(1, d))
}

/** Tilt while dragging: dx * 0.06 degrees (SPEC C-1), clamped so fast throws stay readable. */
export function tiltFor(dx: number): number {
  return Math.max(-18, Math.min(18, dx * 0.06))
}

/**
 * Rubber-band resistance for directions that have no action (down, or right on a card that
 * cannot be kept): the card follows the finger less and less the further it goes.
 */
export function resist(d: number, k = 0.35, limit = 90): number {
  const s = Math.sign(d)
  const a = Math.abs(d) * k
  return s * (limit * (1 - Math.exp(-a / limit)))
}

/** Release velocity from the last pointer samples (px/s), robust to a stalled final frame. */
export class VelocityTracker {
  private pts: { t: number; x: number; y: number }[] = []
  constructor(private windowMs = 90) {}
  reset(): void {
    this.pts = []
  }
  add(t: number, x: number, y: number): void {
    this.pts.push({ t, x, y })
    const cut = t - this.windowMs * 2
    while (this.pts.length > 2 && this.pts[0].t < cut) this.pts.shift()
  }
  velocity(now?: number): { vx: number; vy: number } {
    const p = this.pts
    if (p.length < 2) return { vx: 0, vy: 0 }
    const last = p[p.length - 1]
    const end = now ?? last.t
    // Held still before release: no flick.
    if (end - last.t > 120) return { vx: 0, vy: 0 }
    let first = p[0]
    for (let i = p.length - 2; i >= 0; i--) {
      first = p[i]
      if (last.t - p[i].t >= this.windowMs) break
    }
    const dt = Math.max(8, last.t - first.t) / 1000
    return { vx: (last.x - first.x) / dt, vy: (last.y - first.y) / dt }
  }
}

/** Point on a quadratic bezier. */
export function qbez(p0: number, p1: number, p2: number, t: number): number {
  const u = 1 - t
  return u * u * p0 + 2 * u * t * p1 + t * t * p2
}

export const easeInOutQuad = (t: number): number => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2)
export const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3)
export const easeInCubic = (t: number): number => t * t * t
