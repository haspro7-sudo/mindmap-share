// Camera math shared by the renderer, hit testing and flight targets (SPEC K-11):
// a point (lat, lon) spins by `rot` around the vertical axis, then the ball is tilted by `tilt`
// around the horizontal axis (positive tilt shows the top cap) and projected orthographically.
import { BANDS, BAND_DLAT, BAND_START, LAT_MAX, type BallLayout } from './layout'

export type BallView = { cx: number; cy: number; r: number; rot: number; tilt: number }
export type Projected = { x: number; y: number; z: number }

const RAD = Math.PI / 180
const TAU = Math.PI * 2

/** Default camera tilt: 12° from above (SPEC K-11), so the hanging cap and its pins show. */
export const TILT = 12 * RAD

/** Project a sphere point (degrees) to screen space. z > 0 faces the viewer. */
export function project(latDeg: number, lonDeg: number, v: BallView, lift = 1): Projected {
  const la = latDeg * RAD
  const lo = lonDeg * RAD + v.rot
  const cl = Math.cos(la)
  const x = cl * Math.sin(lo)
  const y = Math.sin(la)
  const z = cl * Math.cos(lo)
  const ct = Math.cos(v.tilt)
  const st = Math.sin(v.tilt)
  const y2 = y * ct - z * st
  const z2 = y * st + z * ct
  return { x: v.cx + x * v.r * lift, y: v.cy - y2 * v.r * lift, z: z2 }
}

/** Inverse of project for a screen point on the visible hemisphere (null outside the disc). */
export function unproject(px: number, py: number, v: BallView): { lat: number; lon: number } | null {
  const x = (px - v.cx) / v.r
  const y2 = -(py - v.cy) / v.r
  const d = x * x + y2 * y2
  if (d > 1) return null
  const z2 = Math.sqrt(1 - d)
  const ct = Math.cos(v.tilt)
  const st = Math.sin(v.tilt)
  const y = y2 * ct + z2 * st
  const z = -y2 * st + z2 * ct
  const lat = Math.asin(Math.max(-1, Math.min(1, y))) / RAD
  const lon = wrapDeg((Math.atan2(x, z) - v.rot) / RAD)
  return { lat, lon }
}

function wrapDeg(d: number): number {
  return ((((d + 180) % 360) + 360) % 360) - 180
}

/** Tile index under a lat/lon (null on the polar caps). */
export function tileAtLatLon(lat: number, lon: number): number | null {
  if (lat > LAT_MAX || lat < -LAT_MAX) return null
  const band = Math.min(BANDS.length - 1, Math.max(0, Math.floor((LAT_MAX - lat) / BAND_DLAT)))
  const count = BANDS[band]
  const k = Math.min(count - 1, Math.max(0, Math.floor(((wrapDeg(lon) + 180) / 360) * count)))
  return BAND_START[band] + k
}

/** Tile under a screen point, or null (outside the ball or on a cap). */
export function tileAt(px: number, py: number, v: BallView): number | null {
  const p = unproject(px, py, v)
  return p ? tileAtLatLon(p.lat, p.lon) : null
}

/** The spin angle that puts longitude `lonDeg` at the front centre. */
export function frontRot(lonDeg: number): number {
  return -lonDeg * RAD
}

/** The angle equivalent to `to` (mod 2π) closest to `from`. */
export function nearestAngle(from: number, to: number): number {
  let d = (to - from) % TAU
  if (d > Math.PI) d -= TAU
  if (d < -Math.PI) d += TAU
  return from + d
}

/** Screen centre of a tile under a view (with its depth). */
export function tileCenter(layout: BallLayout, i: number, v: BallView): Projected | null {
  const t = layout.tiles[i]
  return t ? project(t.lat, t.lon, v) : null
}
