// Canvas2D pseudo-3D mirror ball. Pure drawing code: callers own the canvas and the clock.
// Faces sit on latitude bands × longitude sectors; each face has a lifecycle state.

export type FaceState = 0 | 1 | 2 | 3 | 4 // 0 empty, 1 sketch (気になる), 2 neon (予約), 3 mirror (歌った), 4 prism (歌った＋全員知ってた)

export type Face = { state: FaceState; color: string; flash?: number /* 0..1 recent change */ }

export type BallGeometry = { bands: number; sectors: number; perCell: number }

export const DEFAULT_GEOMETRY: BallGeometry = { bands: 14, sectors: 8, perCell: 4 }

export function faceCount(g: BallGeometry = DEFAULT_GEOMETRY): number {
  return g.bands * g.sectors * g.perCell
}

/** Face index for (band, sector, slot). Band 0 is the top (newest), sector runs around the equator. */
export function faceIndex(band: number, sector: number, slot: number, g: BallGeometry = DEFAULT_GEOMETRY): number {
  return (band * g.sectors + sector) * g.perCell + slot
}

type Quad = { idx: number; pts: [number, number][]; nz: number; nx: number; ny: number; lat: number }

const TAU = Math.PI * 2

/**
 * Build the visible faces for a rotation. Latitudes span -78°..78° so the poles stay as caps.
 */
function project(g: BallGeometry, rotY: number, tiltX: number, r: number, cx: number, cy: number): Quad[] {
  const quads: Quad[] = []
  const latMax = (85 * Math.PI) / 180
  const cols = g.sectors * g.perCell
  const cosT = Math.cos(tiltX)
  const sinT = Math.sin(tiltX)
  const pt = (lat: number, lon: number): [number, number, number] => {
    // sphere point
    let x = Math.cos(lat) * Math.sin(lon)
    let y = Math.sin(lat)
    let z = Math.cos(lat) * Math.cos(lon)
    // tilt around X
    const y2 = y * cosT - z * sinT
    const z2 = y * sinT + z * cosT
    y = y2
    z = z2
    return [x, y, z]
  }
  const gap = 0.006
  for (let b = 0; b < g.bands; b++) {
    const lat1 = latMax - (b / g.bands) * latMax * 2
    const lat0 = latMax - ((b + 1) / g.bands) * latMax * 2
    for (let c = 0; c < cols; c++) {
      const lon0 = (c / cols) * TAU + rotY
      const lon1 = ((c + 1) / cols) * TAU + rotY
      const lc = (lon0 + lon1) / 2
      const latc = (lat0 + lat1) / 2
      const n = pt(latc, lc)
      if (n[2] <= 0.02) continue
      const corners: [number, number][] = [
        [lat1 - gap, lon0 + gap],
        [lat1 - gap, lon1 - gap],
        [lat0 + gap, lon1 - gap],
        [lat0 + gap, lon0 + gap],
      ].map(([la, lo]) => {
        const p = pt(la, lo)
        return [cx + p[0] * r, cy - p[1] * r]
      })
      const sector = Math.floor(c / g.perCell)
      const slot = c % g.perCell
      quads.push({ idx: faceIndex(b, sector, slot, g), pts: corners, nz: n[2], nx: n[0], ny: n[1], lat: latc })
    }
  }
  return quads.sort((a, b) => a.nz - b.nz)
}

export type DrawOptions = {
  size: number // css px of the square canvas
  t: number // seconds
  faces: Face[]
  geometry?: BallGeometry
  spin?: number // rad/s
  glow?: number // 0..1 overall brightness (grows with collection)
  highlightBand?: number | null // unexplored band hint
}

/** Draw one frame. The canvas transform must already be scaled for DPR. */
export function drawMirrorBall(ctx: CanvasRenderingContext2D, o: DrawOptions): void {
  const g = o.geometry ?? DEFAULT_GEOMETRY
  const s = o.size
  const cx = s / 2
  const cy = s / 2
  const r = s * 0.4
  const rot = o.t * (o.spin ?? 0.35)
  const tilt = 0.28
  const glow = o.glow ?? 0.3
  ctx.clearRect(0, 0, s, s)

  // Halo
  const halo = ctx.createRadialGradient(cx, cy, r * 0.6, cx, cy, r * 1.25)
  halo.addColorStop(0, `rgba(190, 170, 255, ${0.12 + glow * 0.25})`)
  halo.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = halo
  ctx.fillRect(0, 0, s, s)

  // Base sphere (dark with rim light)
  const base = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.4, r * 0.1, cx, cy, r)
  base.addColorStop(0, '#3a3552')
  base.addColorStop(0.7, '#15122a')
  base.addColorStop(1, '#07061a')
  ctx.fillStyle = base
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, TAU)
  ctx.fill()

  // Light direction sweeps slowly so mirror faces "catch" the light in turn.
  const lxr = Math.sin(o.t * 0.9) * 0.55 - 0.3
  const lyr = 0.55
  const lzr = 0.78
  const ll = Math.hypot(lxr, lyr, lzr)
  const lx = lxr / ll
  const ly = lyr / ll
  const lz = lzr / ll
  const quads = project(g, rot, tilt, r, cx, cy)
  for (const q of quads) {
    const f = o.faces[q.idx] ?? { state: 0, color: '#888' }
    const edgeFade = Math.min(1, q.nz * 2.4)
    // Reflect the view ray off the tile and look up the room's coloured lights.
    const rx = 2 * q.nz * q.nx
    const ry = 2 * q.nz * q.ny
    const rz = 2 * q.nz * q.nz - 1
    const env = roomLight(rx, ry, rz, o.t)
    const lambert = Math.max(0, q.nx * lx + q.ny * ly + q.nz * lz)
    const spec = Math.pow(Math.max(0, rx * lx + ry * ly + rz * lz), 18)
    ctx.beginPath()
    ctx.moveTo(q.pts[0][0], q.pts[0][1])
    for (let i = 1; i < 4; i++) ctx.lineTo(q.pts[i][0], q.pts[i][1])
    ctx.closePath()
    const flash = f.flash ?? 0
    switch (f.state) {
      case 0: {
        // Unlit mirror: dim reflections so the ball still reads as glass, not paint.
        const hint = o.highlightBand != null && Math.floor(q.idx / (g.sectors * g.perCell)) === o.highlightBand
        // Real mirror tiles sit at slightly different angles: jitter brightness per tile.
        const jit = TILE_JITTER[q.idx % TILE_JITTER.length]
        const k = (0.3 + lambert * 0.18) * jit + spec * 0.5
        ctx.fillStyle = `rgba(${Math.min(255, 48 + env[0] * k)}, ${Math.min(255, 46 + env[1] * k)}, ${Math.min(255, 66 + env[2] * k)}, ${edgeFade})`
        ctx.fill()
        if (spec > 0.7 && jit > 1) {
          const [px, py] = centroid(q.pts)
          drawGlint(ctx, px, py, 2 + spec * 6, spec * 0.7)
        }
        if (hint) {
          ctx.strokeStyle = `rgba(125, 249, 255, ${0.35 + 0.3 * Math.sin(o.t * 4)})`
          ctx.lineWidth = 0.8
          ctx.stroke()
        }
        break
      }
      case 1: {
        const k = 0.22
        ctx.fillStyle = `rgba(${22 + env[0] * k}, ${20 + env[1] * k}, ${40 + env[2] * k}, ${edgeFade})`
        ctx.fill()
        ctx.fillStyle = withAlpha(f.color, (0.25 + lambert * 0.2) * edgeFade)
        ctx.fill()
        ctx.strokeStyle = withAlpha(f.color, 0.95 * edgeFade)
        ctx.lineWidth = 0.9
        ctx.stroke()
        break
      }
      case 2: {
        ctx.fillStyle = withAlpha(f.color, (0.7 + lambert * 0.3) * edgeFade)
        ctx.fill()
        ctx.fillStyle = `rgba(255,255,255,${(0.08 + spec * 0.5) * edgeFade})`
        ctx.fill()
        break
      }
      case 3: {
        // Full mirror: bright reflections of the room lights, tinted by the song.
        const k = 0.75 + lambert * 0.35
        ctx.fillStyle = `rgba(${Math.min(255, 30 + env[0] * k + spec * 255)}, ${Math.min(255, 30 + env[1] * k + spec * 255)}, ${Math.min(255, 45 + env[2] * k + spec * 255)}, ${edgeFade})`
        ctx.fill()
        ctx.fillStyle = withAlpha(f.color, 0.18 * edgeFade)
        ctx.fill()
        break
      }
      case 4: {
        const hue = (q.idx * 29 + o.t * 110) % 360
        ctx.fillStyle = `hsla(${hue}, 100%, ${58 + lambert * 14 + spec * 28}%, ${edgeFade})`
        ctx.fill()
        break
      }
    }
    if (flash > 0) {
      ctx.fillStyle = `rgba(255,255,255,${flash * 0.9 * edgeFade})`
      ctx.fill()
    }
    if (f.state >= 3 && spec > 0.45) {
      const [px, py] = centroid(q.pts)
      drawGlint(ctx, px, py, 3 + spec * 10, spec)
    }
  }

  // Specular sheen over the whole ball
  const sheen = ctx.createRadialGradient(cx - r * 0.38, cy - r * 0.42, 0, cx - r * 0.38, cy - r * 0.42, r * 0.7)
  sheen.addColorStop(0, 'rgba(255,255,255,0.28)')
  sheen.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = sheen
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, TAU)
  ctx.fill()
  // Rim
  ctx.strokeStyle = `rgba(200, 190, 255, ${0.25 + glow * 0.3})`
  ctx.lineWidth = 1.2
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, TAU)
  ctx.stroke()
}

const TILE_JITTER = Array.from({ length: 97 }, (_, i) => 0.7 + (((Math.sin(i * 91.7) * 43758.55) % 1) + 1) % 1 * 0.6)

// Three coloured stage lights (pink, cyan, warm) that drift slowly around the room.
const LIGHTS: { dir: [number, number, number]; rgb: [number, number, number]; speed: number }[] = [
  { dir: [-0.6, 0.6, 0.5], rgb: [255, 60, 170], speed: 0.23 },
  { dir: [0.7, 0.2, 0.6], rgb: [60, 230, 255], speed: -0.17 },
  { dir: [0.0, 0.8, 0.6], rgb: [255, 220, 150], speed: 0.11 },
]
function roomLight(rx: number, ry: number, rz: number, t: number): [number, number, number] {
  let r = 18
  let g = 14
  let b = 36
  for (const L of LIGHTS) {
    const a = t * L.speed
    const ca = Math.cos(a)
    const sa = Math.sin(a)
    const dx = L.dir[0] * ca - L.dir[2] * sa
    const dz = L.dir[0] * sa + L.dir[2] * ca
    const d = Math.max(0, rx * dx + ry * L.dir[1] + rz * dz)
    const k = Math.pow(d, 6) * 1.1 + d * 0.15
    r += L.rgb[0] * k
    g += L.rgb[1] * k
    b += L.rgb[2] * k
  }
  return [Math.min(255, r), Math.min(255, g), Math.min(255, b)]
}

function centroid(pts: [number, number][]): [number, number] {
  let x = 0
  let y = 0
  for (const p of pts) {
    x += p[0]
    y += p[1]
  }
  return [x / pts.length, y / pts.length]
}

function drawGlint(ctx: CanvasRenderingContext2D, x: number, y: number, len: number, a: number) {
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  ctx.strokeStyle = `rgba(255,255,255,${Math.min(1, a)})`
  ctx.lineWidth = 1.2
  ctx.beginPath()
  ctx.moveTo(x - len, y)
  ctx.lineTo(x + len, y)
  ctx.moveTo(x, y - len)
  ctx.lineTo(x, y + len)
  ctx.stroke()
  ctx.restore()
}

const alphaCache = new Map<string, [number, number, number]>()
function withAlpha(color: string, a: number): string {
  let rgb = alphaCache.get(color)
  if (!rgb) {
    if (color.startsWith('#') && color.length === 7) {
      const n = parseInt(color.slice(1), 16)
      rgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255]
    } else rgb = [200, 200, 255]
    alphaCache.set(color, rgb)
  }
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${Math.max(0, Math.min(1, a))})`
}

/** Screen position of a face's centre for the current frame (for flight targets). */
export function faceScreenPoint(idx: number, o: Pick<DrawOptions, 'size' | 't' | 'spin' | 'geometry'>): [number, number] | null {
  const g = o.geometry ?? DEFAULT_GEOMETRY
  const s = o.size
  const quads = project(g, o.t * (o.spin ?? 0.35), 0.28, s * 0.4, s / 2, s / 2)
  const q = quads.find(x => x.idx === idx)
  return q ? centroid(q.pts) : null
}
