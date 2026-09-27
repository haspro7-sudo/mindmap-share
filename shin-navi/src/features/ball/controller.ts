// One mirror ball on screen: owns the clock, the spin (auto / drag + inertia / seek-to-face),
// the store → scene mapping, the effect timelines and the flight/emitter plumbing. The React
// component only mounts it; every frame runs from the shared ticker without React renders.
import { naviApi } from '../../core/store'
import type { NaviState } from '../../core/store/types'
import { bus } from '../../core/events'
import { fxState } from '../../core/fxState'
import { ticker } from '../../core/ticker'
import { params } from '../../core/params'
import { introElapsedMs } from '../../core/intro'
import { registerResolver, resolveTarget } from '../../core/targets'
import { AURORA_PALETTES, areaColor, isSleeping } from '../../core/rules'
import { PIN_IDS, type AreaKey, type FaceMark, type FaceState, type PinId, type SongId } from '../../core/types'
import { SONG_BY_ID } from '../../data/songs'
import { areaKeyOf, areaTiles, ballLayout, tileArea, tilesCentroid, TILE_COUNT, type BallLayout } from './layout'
import { BallPainter, createScene, hexRgb, K_CHROME, K_MIRROR, K_NEON, K_PRISM, K_SKETCH, K_SMOKE, MARK_BIT, MOON_BIT, type Frame, type Scene } from './render'
import { TILT, frontRot, nearestAngle, project, tileAt, type BallView } from './hit'

export type Variant = 'hero' | 'mini' | 'record' | 'room' | 'standby' | 'wrap' | 'zoom'

/** seconds per revolution (0 = no auto spin) */
const PERIOD: Record<Variant, number> = { hero: 24, mini: 24, record: 40, room: 24, standby: 40, wrap: 30, zoom: 0 }
/** canvas size / ball diameter (room for the halo, glints and beams) */
export const PAD: Record<Variant, number> = { hero: 1.5, mini: 1.24, record: 1.4, room: 1.42, standby: 1.5, wrap: 1.45, zoom: 1 }
const DPR_CAP: Record<Variant, number> = { hero: 2, mini: 2, record: 2, room: 1.5, standby: 2, wrap: 2, zoom: 2 }

const STATE_KIND: Record<FaceState, number> = { sketch: K_SKETCH, neon: K_NEON, mirror: K_MIRROR, prism: K_PRISM }
export const PIN_COLOR: Record<PinId, string> = {
  spark: '#FFB547',
  allKnow: '#FF3DA8',
  airRead: '#2EF2FF',
  crossing: '#5CFFB0',
  harmony: '#C77DFF',
  answer: '#FF5A6E',
  importer: '#E6E9F5',
  polish: '#FFF1B8',
  hundred: '#FFD36B',
  faces30: '#8A6BFF',
}

const AREA_RGB = new Map<string, [number, number, number]>()
function areaRgb(songId: SongId): [number, number, number] {
  const s = SONG_BY_ID[songId]
  if (!s) return [220, 220, 235]
  let c = AREA_RGB.get(s.genre)
  if (!c) {
    c = hexRgb(areaColor(s.genre))
    AREA_RGB.set(s.genre, c)
  }
  return c
}

const PAL_CACHE = new Map<string, [number, number, number][]>()
/** aurora palette brightened into stage-light colours */
function lightPalette(key: keyof typeof AURORA_PALETTES): [number, number, number][] {
  let p = PAL_CACHE.get(key)
  if (!p) {
    p = AURORA_PALETTES[key].map(h => {
      const [r, g, b] = hexRgb(h)
      const m = Math.max(r, g, b, 1)
      return [(r * 255) / m, (g * 255) / m, (b * 255) / m] as [number, number, number]
    })
    PAL_CACHE.set(key, p)
  }
  return p
}

type Pulse = { tile: number; t0: number; dur: number; kind: 'blink2' | 'glow' }
type Seek = { from: number; to: number; t0: number; dur: number; tile: number }
type OutlineFx = { tiles: number[]; t0: number; dur: number }
type Beam = { tile: number; t0: number; dur: number; len: number }
type Ring = { tile: number; t0: number }

const now = () => performance.now()
const easeOut = (p: number) => 1 - Math.pow(1 - p, 3)
const easeInOut = (p: number) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2)

// ---------------------------------------------------------------- registry (face resolver)

const live = new Set<BallController>()
let offResolver: (() => void) | null = null
const TARGET_PRIORITY: Variant[] = ['record', 'hero', 'standby', 'wrap', 'mini']

function pickFaceTarget(): BallController | null {
  for (const v of TARGET_PRIORITY) for (const c of live) if (c.variant === v && c.isShown()) return c
  return null
}

function resolveFace(key: string): DOMRectReadOnly | null {
  const c = pickFaceTarget()
  return c ? c.faceRect(key) : null
}

function register(c: BallController) {
  live.add(c)
  if (!offResolver) offResolver = registerResolver('face', resolveFace)
}
function unregister(c: BallController) {
  live.delete(c)
  if (live.size === 0 && offResolver) {
    offResolver()
    offResolver = null
  }
}

/** The ball that feeds fxState.emitters this frame: the hero first, else whichever big ball shows. */
const EMITTER_PRIORITY: Variant[] = ['hero', 'record', 'room', 'standby', 'wrap']
function emitterOwner(): BallController | null {
  for (const v of EMITTER_PRIORITY) for (const c of live) if (c.variant === v && c.isShown()) return c
  return null
}

// ---------------------------------------------------------------- controller

export type ControllerOpts = { variant: Variant; size: number; reduced: boolean }
export type TapResult = { tile: number; songId?: SongId; lit: boolean; area: AreaKey | null; x: number; y: number }

export class BallController {
  readonly variant: Variant
  readonly scene: Scene = createScene()
  readonly layout: BallLayout = ballLayout()
  private painter: BallPainter
  private canvas: HTMLCanvasElement | null = null
  private ctx: CanvasRenderingContext2D | null = null
  size: number
  cw = 0
  ch = 0
  private dpr = 1
  rot: number
  /** camera tilt: 12° from above, leaning towards a face while it is shown off */
  private tilt = TILT
  private tiltTo = TILT
  private vel = 0
  private t = 0
  private seek: Seek | null = null
  private holdUntil = 0
  private focusTile = -1
  private dragging = false
  private dragSamples: { t: number; rot: number }[] = []
  reduced: boolean
  private shown = true
  private shownAt = -1e9
  private rect: DOMRect | null = null
  private rectAt = -1e9
  private acc = 0
  private lastT = 0
  private offs: (() => void)[] = []
  private pulses: Pulse[] = []
  private outlines: OutlineFx[] = []
  private beams: Beam[] = []
  private rings: Ring[] = []
  private beamNext = new Float64Array(TILE_COUNT)
  private linkStart = new Map<string, number>()
  private pinStart = new Map<string, number>()
  private synced = false
  private pendingLand = new Map<SongId, number>()
  private polished = new Map<SongId, number>()
  private deferred: { at: number; fn: () => void }[] = []
  private recentChanges: number[] = []
  private lit = 0
  /** frames drawn (tests read it through window.__ball) */
  frames = 0
  private drawMs: number[] = []
  private drawMsAt = 0
  // external inputs
  highlightArea: AreaKey | null = null
  bubbleArea: AreaKey | null = null
  private wrapTiles: number[] = []
  private wrapNext = 0
  private wrapIdx = 0
  private nowTile = -1
  private zoomView: { cx: number; cy: number; r: number; rot: number; tilt: number } | null = null
  private zoomTiles: number[] = []
  /** draw only on demand (peeking gap cards) */
  paused = false
  private drawnOnce = false
  private destroyed = false

  constructor(o: ControllerOpts) {
    this.variant = o.variant
    this.size = o.size
    this.reduced = o.reduced
    this.painter = new BallPainter(o.size / 2, o.variant === 'mini' ? 0.3 : o.variant === 'zoom' ? 1.6 : 0.8)
    // start with a pleasant angle rather than the seam of the genre sectors
    this.rot = o.variant === 'zoom' ? 0 : 0.35
  }

  // ------------------------------------------------------------ lifecycle

  attach(canvas: HTMLCanvasElement): void {
    this.canvas = canvas
    this.ctx = canvas.getContext('2d', { alpha: true })
    this.layoutCanvas()
    const api = naviApi
    this.sync(api.getState())
    this.offs.push(
      api.subscribe((s, prev) => {
        if (this.variant === 'room') {
          if (s.room.queue !== prev.room.queue || s.room.now !== prev.room.now || s.room.sung !== prev.room.sung || s.room.members !== prev.room.members) this.sync(s)
        } else if (s.col.faces !== prev.col.faces || s.col.links !== prev.col.links || s.col.pins !== prev.col.pins) this.sync(s)
        if (s.ui.reduced !== prev.ui.reduced) this.reduced = s.ui.reduced
      }),
    )
    this.listen()
    this.offs.push(ticker.add((dt, t) => this.tick(dt, t), 0))
    if (this.variant !== 'zoom') register(this)
    this.frame(now(), 0)
  }

  destroy(): void {
    this.destroyed = true
    this.offs.forEach(f => f())
    this.offs = []
    unregister(this)
    this.canvas = null
    this.ctx = null
  }

  setSize(size: number): void {
    if (size === this.size) return
    this.size = size
    this.painter.resize(size / 2)
    this.layoutCanvas()
    this.frame(now(), 0)
  }

  /** zoom variant: canvas size comes from its container */
  setCanvasBox(w: number, h: number): void {
    this.cw = w
    this.ch = h
    this.layoutCanvas()
    this.frame(now(), 0)
  }

  private layoutCanvas() {
    const c = this.canvas
    if (!c) return
    if (this.variant !== 'zoom') {
      this.cw = this.ch = Math.round(this.size * PAD[this.variant])
    } else {
      this.computeZoom()
    }
    const cap = Math.min(DPR_CAP[this.variant], typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1)
    this.dpr = Math.max(1, cap)
    const W = Math.max(1, Math.round(this.cw * this.dpr))
    const H = Math.max(1, Math.round(this.ch * this.dpr))
    if (c.width !== W) c.width = W
    if (c.height !== H) c.height = H
    this.rectAt = -1e9
  }

  // ------------------------------------------------------------ store → scene

  private sync(s: NaviState): void {
    const sc = this.scene
    const lay = this.layout
    const tiles = lay.tiles
    for (let i = 0; i < TILE_COUNT; i++) {
      const id = tiles[i].songId
      sc.kind[i] = id ? K_SMOKE : K_CHROME
      sc.marks[i] = 0
      sc.keyShift[i] = 0
      const c = id ? areaRgb(id) : ([210, 212, 228] as const)
      sc.rgb[i * 3] = c[0]
      sc.rgb[i * 3 + 1] = c[1]
      sc.rgb[i * 3 + 2] = c[2]
    }
    if (this.variant === 'room') this.syncRoom(s)
    else if (this.variant === 'zoom') this.syncPersonal(s, false)
    else this.syncPersonal(s, true)
    this.synced = true
  }

  private syncPersonal(s: NaviState, extras: boolean) {
    const sc = this.scene
    const lay = this.layout
    let lit = 0
    for (const f of Object.values(s.col.faces)) {
      const i = lay.bySong[f.songId]
      if (i == null) continue
      sc.kind[i] = STATE_KIND[f.state]
      let m = 0
      for (const k of f.marks as FaceMark[]) m |= MARK_BIT[k] ?? 0
      if (isSleeping(f, Date.now())) m |= MOON_BIT
      sc.marks[i] = m
      sc.keyShift[i] = f.keyShift ?? 0
      lit++
      // D-6 polishing a sleeping face makes it shine again
      const pol = f.polishedAt ?? 0
      const was = this.polished.get(f.songId)
      if (this.synced && pol && was !== pol) {
        sc.flash[i] = 1
        this.pulses.push({ tile: i, t0: now(), dur: 1100, kind: 'glow' })
        this.rings.push({ tile: i, t0: now() })
      }
      if (pol) this.polished.set(f.songId, pol)
    }
    this.lit = lit
    if (!extras) {
      sc.links = []
      sc.pins = []
      return
    }
    // links (D-5)
    const t = now()
    const links: Scene['links'] = []
    const seen = new Set<string>()
    for (const l of s.col.links) {
      const a = lay.bySong[l.a]
      const b = lay.bySong[l.b]
      if (a == null || b == null) continue
      const key = a < b ? `${a}-${b}` : `${b}-${a}`
      seen.add(key)
      if (!this.linkStart.has(key)) this.linkStart.set(key, this.synced ? t : -1e9)
      links.push({ a, b, p: 1 })
    }
    for (const k of [...this.linkStart.keys()]) if (!seen.has(k)) this.linkStart.delete(k)
    sc.links = links
    // groups of linked faces, painted as one shape on the record ball
    if (this.variant === 'record') {
      const parent = new Map<number, number>()
      const find = (x: number): number => {
        let r = x
        while (parent.has(r) && parent.get(r) !== r) r = parent.get(r)!
        return r
      }
      for (const l of links) {
        if (!parent.has(l.a)) parent.set(l.a, l.a)
        if (!parent.has(l.b)) parent.set(l.b, l.b)
        parent.set(find(l.a), find(l.b))
      }
      const groups = new Map<number, number[]>()
      for (const x of parent.keys()) {
        const r = find(x)
        if (!groups.has(r)) groups.set(r, [])
        groups.get(r)!.push(x)
      }
      sc.groups = [...groups.values()].filter(g => g.length >= 3)
    } else sc.groups = null
    // pins (D-10)
    const pins: Scene['pins'] = []
    for (const p of s.col.pins) {
      if (!this.pinStart.has(p.id)) this.pinStart.set(p.id, this.synced ? t + 420 : -1e9)
      pins.push({ color: PIN_COLOR[p.id] ?? '#FFD36B', slot: PIN_IDS.indexOf(p.id), s: 1 })
    }
    for (const k of [...this.pinStart.keys()]) if (!s.col.pins.some(p => p.id === k)) this.pinStart.delete(k)
    sc.pins = pins
  }

  private syncRoom(s: NaviState) {
    const sc = this.scene
    const lay = this.layout
    const put = (songId: SongId, kind: number, color: string) => {
      const i = lay.bySong[songId]
      if (i == null) return
      sc.kind[i] = kind
      const [r, g, b] = hexRgb(color)
      sc.rgb[i * 3] = r
      sc.rgb[i * 3 + 1] = g
      sc.rgb[i * 3 + 2] = b
    }
    const col = (by: string) => s.room.members[by as keyof typeof s.room.members]?.color ?? '#D8DCE8'
    for (const e of s.room.sung) put(e.item.songId, e.knowShare >= 0.999 ? K_PRISM : K_MIRROR, col(e.item.by))
    for (const q of s.room.queue) put(q.songId, K_NEON, col(q.by))
    this.nowTile = -1
    if (s.room.now) {
      put(s.room.now.item.songId, K_NEON, col(s.room.now.item.by))
      this.nowTile = lay.bySong[s.room.now.item.songId] ?? -1
    }
    sc.links = []
    sc.pins = []
    sc.groups = null
    let lit = 0
    for (let i = 0; i < TILE_COUNT; i++) if (sc.kind[i] >= K_SKETCH) lit++
    this.lit = lit
  }

  // ------------------------------------------------------------ events

  private listen(): void {
    const v = this.variant
    if (v === 'zoom') return
    const on = this.offs
    if (v === 'room') {
      on.push(
        bus.on('queue/added', e => this.faceFx(e.item.songId, 'neon', true)),
        bus.on('song/started', e => this.faceFx(e.item.songId, 'start', true)),
        bus.on('song/ended', e => this.faceFx(e.entry.item.songId, e.entry.knowShare >= 0.999 ? 'prism' : 'mirror', true)),
      )
      return
    }
    on.push(
      bus.on('face/changed', e => {
        const t = now()
        this.recentChanges = this.recentChanges.filter(x => t - x < 250)
        this.recentChanges.push(t)
        const bulk = this.recentChanges.length > 3
        const first = e.from === undefined && this.isFirstInArea(e.songId)
        if (e.to === 'sketch') {
          // a keep/import flight usually follows in the same tick: let the landing flash it
          this.defer(40, () => {
            if (!this.pendingLand.has(e.songId)) this.faceFx(e.songId, 'sketch', !bulk, first)
            else if (first) this.defer(360, () => this.areaGlow(e.songId))
          })
        } else this.faceFx(e.songId, e.to, !bulk, first)
      }),
      bus.on('fx/flight', e => {
        if ((e.kind !== 'keep' && e.kind !== 'import') || !e.to.startsWith('face:')) return
        const id = e.to.slice(5)
        const tile = this.layout.bySong[id]
        if (tile == null) return
        this.pendingLand.set(id, now())
        if (pickFaceTarget() === this || this.variant !== 'mini') this.seekTile(tile, 300, 1800)
        // fallback flash when nobody reports the landing
        this.defer(720, () => {
          if (this.pendingLand.has(id)) this.landed(id)
        })
      }),
      bus.on('fx/landed', e => {
        if (e.to.startsWith('face:')) this.landed(e.to.slice(5))
        else if (e.to === 'dock:record' && this.variant === 'mini') this.scene.flashAll = Math.max(this.scene.flashAll, 0.7)
      }),
      bus.on('link/added', e => {
        const a = this.layout.bySong[e.a]
        const b = this.layout.bySong[e.b]
        if (a == null || b == null) return
        const c = tilesCentroid([a, b], this.layout)
        this.seekLon(c.lon, 380, 2200, a, c.lat)
      }),
    )
  }

  private isFirstInArea(songId: SongId): boolean {
    const s = SONG_BY_ID[songId]
    if (!s) return false
    const area = areaKeyOf(s)
    const faces = naviApi.getState().col.faces
    for (const i of areaTiles(area, this.layout)) {
      const id = this.layout.tiles[i].songId!
      if (id !== songId && faces[id]) return false
    }
    return true
  }

  private defer(ms: number, fn: () => void) {
    this.deferred.push({ at: now() + ms, fn })
  }

  private landed(songId: SongId) {
    if (!this.pendingLand.has(songId)) return
    const t0 = this.pendingLand.get(songId)!
    this.pendingLand.delete(songId)
    const tile = this.layout.bySong[songId]
    if (tile == null) return
    this.scene.flash[tile] = 1
    this.pulses.push({ tile, t0: now(), dur: 900, kind: 'glow' })
    if (this.isFirstInArea(songId) && now() - t0 < 3000) this.areaGlow(songId)
    if (this.variant === 'mini') this.scene.flashAll = Math.max(this.scene.flashAll, 0.5)
  }

  private areaGlow(songId: SongId) {
    const s = SONG_BY_ID[songId]
    if (!s) return
    this.outlines.push({ tiles: areaTiles(areaKeyOf(s), this.layout), t0: now(), dur: 900 })
  }

  /** Visual reaction to a face rising to a new state (D-14). */
  private faceFx(songId: SongId, to: FaceState | 'start', turn: boolean, firstInArea = false) {
    const tile = this.layout.bySong[songId]
    if (tile == null) return
    const t = now()
    if (turn && this.variant !== 'mini') this.seekTile(tile, 320, 2000)
    const at = t + (turn ? 280 : 0)
    switch (to) {
      case 'sketch':
        this.scene.flash[tile] = 1
        this.pulses.push({ tile, t0: at, dur: 700, kind: 'glow' })
        break
      case 'neon':
        // the light thread from the lane arrives first, then the face blinks twice in its colour
        this.pulses.push({ tile, t0: at + 250, dur: 760, kind: 'blink2' })
        break
      case 'mirror':
        this.defer(at - t, () => {
          this.scene.flash[tile] = 1
          this.beams.push({ tile, t0: now(), dur: 1300, len: 1.5 })
          this.beamNext[tile] = now() + 4000
        })
        break
      case 'prism':
        this.defer(at - t, () => {
          this.scene.flash[tile] = 0.9
          this.rings.push({ tile, t0: now() })
          this.beams.push({ tile, t0: now(), dur: 1300, len: 1.5 })
        })
        break
      case 'start':
        this.pulses.push({ tile, t0: at, dur: 900, kind: 'glow' })
        break
    }
    if (firstInArea) this.defer(at - t + 200, () => this.areaGlow(songId))
  }

  // ------------------------------------------------------------ spin control

  private get base(): number {
    const p = PERIOD[this.variant]
    return this.reduced || !p ? 0 : (Math.PI * 2) / p
  }

  seekTile(tile: number, dur: number, hold: number): void {
    const t = this.layout.tiles[tile]
    if (!t) return
    // already turning to (or showing) this face: keep going, just hold it longer
    if (this.focusTile === tile && (this.seek?.tile === tile || now() < this.holdUntil)) {
      const end = this.seek ? this.seek.t0 + this.seek.dur : now()
      this.holdUntil = Math.max(this.holdUntil, end + hold)
      return
    }
    this.seekLon(t.lon, dur, hold, tile, t.lat)
  }

  /** lean the camera towards a face's latitude so southern (slow) faces are not seen edge-on */
  private focusTilt(lat: number | undefined): number {
    if (lat == null || this.variant === 'mini') return TILT
    const want = TILT + ((lat * Math.PI) / 180 - TILT) * 0.8
    return Math.max(-0.6, Math.min(0.6, want))
  }

  private seekLon(lon: number, dur: number, hold: number, tile: number, lat?: number) {
    if (this.dragging) return
    const t = now()
    const to = nearestAngle(this.rot, frontRot(lon))
    this.focusTile = tile
    this.tiltTo = this.focusTilt(lat)
    if (this.reduced) this.tilt = this.tiltTo
    if (this.reduced || Math.abs(to - this.rot) < 0.01) {
      this.rot = to
      this.seek = null
      this.holdUntil = t + hold
      return
    }
    this.seek = { from: this.rot, to, t0: t, dur, tile }
    this.holdUntil = t + dur + hold
  }

  /** hold the current angle (bubble open, pre-glow) */
  hold(ms: number): void {
    this.holdUntil = Math.max(this.holdUntil, now() + ms)
  }

  dragStart(): void {
    this.dragging = true
    this.seek = null
    this.dragSamples = [{ t: now(), rot: this.rot }]
  }

  dragBy(dxCss: number): void {
    if (!this.dragging) return
    this.rot += dxCss / (this.size / 2)
    const t = now()
    this.dragSamples.push({ t, rot: this.rot })
    while (this.dragSamples.length > 2 && t - this.dragSamples[0].t > 120) this.dragSamples.shift()
    if (this.reduced) this.frame(t, 0)
  }

  dragEnd(): void {
    if (!this.dragging) return
    this.dragging = false
    const s = this.dragSamples
    const a = s[0]
    const b = s[s.length - 1]
    const dt = (b.t - a.t) / 1000
    // a finger that rested before lifting throws nothing
    let v = s.length > 1 && now() - b.t < 140 ? (b.rot - a.rot) / Math.max(dt, 0.016) : 0
    v = Math.max(-10, Math.min(10, v))
    this.vel = this.reduced ? 0 : v
    this.holdUntil = 0
  }

  // ------------------------------------------------------------ queries

  get view(): BallView {
    if (this.variant === 'zoom' && this.zoomView) return { ...this.zoomView, rot: this.zoomView.rot + Math.sin(this.t * 0.45) * 0.05 }
    return { cx: this.cw / 2, cy: this.ch / 2, r: this.size / 2, rot: this.rot, tilt: this.tilt }
  }

  isShown(): boolean {
    const t = now()
    if (t - this.shownAt > 250) {
      this.shownAt = t
      this.shown = this.computeShown()
    }
    return this.shown
  }

  private computeShown(): boolean {
    const c = this.canvas
    if (!c || !c.isConnected) return false
    // full-screen overlays (standby, wrap, entry) cover the home ball and the dock
    if ((this.variant === 'hero' || this.variant === 'mini') && naviApi.getState().ui.overlay) return false
    const r = c.getBoundingClientRect()
    this.rect = r
    this.rectAt = now()
    if (r.width < 1 || r.height < 1) return false
    const W = window.innerWidth || 0
    const H = window.innerHeight || 0
    if (r.bottom < 0 || r.right < 0 || (W && r.left > W) || (H && r.top > H)) return false
    if (c.closest('[data-active="0"], [aria-hidden="true"]')) return false
    return true
  }

  private canvasRect(): DOMRect | null {
    const t = now()
    // while the ball is still dropping in, follow it every frame
    if (!this.rect || t - this.rectAt > (introElapsedMs() < 1600 ? 0 : 250)) {
      if (!this.canvas) return null
      this.rect = this.canvas.getBoundingClientRect()
      this.rectAt = t
    }
    return this.rect
  }

  /** Viewport rect of a face; starts turning the ball so the face comes to the front.
   *  'face:@pins' resolves to the hanging ring where earned pins stick (D-10). */
  faceRect(songId: string): DOMRectReadOnly | null {
    if (songId.startsWith('@pin')) return this.pinRingRect()
    const tile = this.layout.bySong[songId]
    if (tile == null || !this.canvas) return null
    this.seekTile(tile, 300, 1800)
    const v = this.view
    const rot = this.seek?.tile === tile ? this.seek.to : this.rot
    const tl = this.layout.tiles[tile]
    const p = project(tl.lat, tl.lon, { ...v, rot, tilt: this.variant === 'zoom' ? v.tilt : this.tiltTo })
    const rect = this.canvas.getBoundingClientRect()
    const k = rect.width / Math.max(1, this.cw)
    const face = Math.max(10, (this.size / 2) * ((tl.dLon * Math.PI) / 180) * Math.cos((tl.lat * Math.PI) / 180)) * k
    const x = rect.left + p.x * k
    const y = rect.top + p.y * k
    return new DOMRect(x - face / 2, y - face / 2, face, face)
  }

  private pinRingRect(): DOMRectReadOnly | null {
    if (!this.canvas) return null
    const v = this.view
    const p = project(84, 0, { ...v, rot: 0 })
    const rect = this.canvas.getBoundingClientRect()
    const k = rect.width / Math.max(1, this.cw)
    const w = Math.max(12, this.size * 0.3) * k
    return new DOMRect(rect.left + p.x * k - w / 2, rect.top + p.y * k - w / 4, w, w / 2)
  }

  /** What is under a viewport point. */
  hitTest(clientX: number, clientY: number): TapResult | null {
    const rect = this.canvas?.getBoundingClientRect()
    if (!rect) return null
    const k = rect.width / Math.max(1, this.cw)
    const x = (clientX - rect.left) / k
    const y = (clientY - rect.top) / k
    const tile = tileAt(x, y, this.view)
    if (tile == null) return null
    const songId = this.layout.tiles[tile].songId
    const lit = this.scene.kind[tile] >= K_SKETCH
    return { tile, songId, lit, area: tileArea(tile, this.layout), x, y }
  }

  /** css px inside the canvas → offset from the ball box's top-left */
  canvasToBox(x: number, y: number): { x: number; y: number } {
    const off = (this.cw - this.size) / 2
    return { x: x - off, y: y - off }
  }

  /** spin state (tests / debugging) */
  debugSpin(): { rot: number; vel: number; seek: boolean; hold: number; focus: number; tilt: number } {
    return { rot: this.rot, vel: this.vel, seek: !!this.seek, hold: Math.round(this.holdUntil - now()), focus: this.focusTile, tilt: this.tilt }
  }

  /** viewport centre + depth of a song's face in the current frame (tests) */
  debugFace(songId: SongId): { x: number; y: number; z: number } | null {
    const tile = this.layout.bySong[songId]
    if (tile == null || !this.canvas) return null
    const p = this.tilePoint(tile)
    const rect = this.canvas.getBoundingClientRect()
    const k = rect.width / Math.max(1, this.cw)
    return { x: rect.left + p.x * k, y: rect.top + p.y * k, z: p.z }
  }

  tapFlash(tile: number): void {
    this.scene.flash[tile] = Math.max(this.scene.flash[tile], 0.55)
  }

  /** screen point of a tile (canvas css px), current frame */
  tilePoint(tile: number): { x: number; y: number; z: number } {
    const tl = this.layout.tiles[tile]
    return project(tl.lat, tl.lon, this.view)
  }

  setWrapSongs(ids: SongId[] | undefined): void {
    this.wrapTiles = (ids ?? []).map(id => this.layout.bySong[id]).filter((x): x is number => x != null)
    this.wrapIdx = 0
    this.wrapNext = now() + 900
  }

  setZoomArea(a: AreaKey | null): void {
    this.zoomTiles = a ? areaTiles(a, this.layout) : []
    this.scene.mute.fill(a ? 0.42 : 0)
    for (const i of this.zoomTiles) this.scene.mute[i] = 0
    this.computeZoom()
    this.frame(now(), 0)
  }

  private computeZoom() {
    if (this.variant !== 'zoom') return
    const w = this.cw || 300
    const h = this.ch || 150
    const tiles = this.zoomTiles
    const c = tiles.length ? tilesCentroid(tiles, this.layout) : { lat: 0, lon: 0 }
    const tilt = (Math.max(-58, Math.min(58, c.lat)) * Math.PI) / 180
    const r = Math.max(h * 0.72, w * 0.62)
    // the area sits in the upper part of the card (text below), a little right of the sphere
    // centre so the ball's curved edge and rim light show on the right
    const off = 0.3
    const rot = frontRot(c.lon) + off
    const dx = Math.sin(off) * Math.cos((c.lat * Math.PI) / 180 - tilt) * r
    this.zoomView = { cx: w * 0.5 - dx, cy: h * 0.36, r, rot, tilt }
    this.painter.resize(r, 1.6)
  }

  /** Short intro (same-night reload): one quick turn and a flash. */
  introSpin(): void {
    if (this.reduced) return
    const t = now()
    this.seek = { from: this.rot - Math.PI * 2, to: this.rot, t0: t, dur: 800, tile: -1 }
    this.rot -= Math.PI * 2
    this.holdUntil = t + 800
    this.defer(420, () => (this.scene.flashAll = 0.85))
  }

  /** B-2 1.4 s: the face under a point of the ball box flashes white once. */
  flashAtBox(x: number, y: number): void {
    const off = (this.cw - this.size) / 2
    const tile = tileAt(x + off, y + off, this.view)
    if (tile == null) return
    this.scene.flash[tile] = 1
    this.pulses.push({ tile, t0: now(), dur: 900, kind: 'glow' })
  }

  /** B-2 ~1.0 s: turn so the opener face will be in front when it flashes. */
  prepareOpener(songId: SongId | undefined): void {
    const tile = songId != null ? this.layout.bySong[songId] : undefined
    if (tile != null) this.seekTile(tile, 420, 1400)
  }

  // ------------------------------------------------------------ frame

  private tick(dt: number, t: number): void {
    if (this.destroyed) return
    if (this.deferred.length) {
      const due = this.deferred.filter(d => d.at <= t)
      if (due.length) {
        this.deferred = this.deferred.filter(d => d.at > t)
        for (const d of due) d.fn()
      }
    }
    if (this.paused || !this.isShown()) {
      this.lastT = 0
      return
    }
    // spin in real time even when frames are slow (the ticker clamps dt at 50 ms)
    const real = this.lastT ? Math.min(200, Math.max(dt, t - this.lastT)) : dt
    if (this.variant === 'mini') {
      this.acc += real
      this.lastT = t
      if (this.acc < 100) return
      const a = this.acc
      this.acc = this.acc > 200 ? 0 : this.acc - 100
      this.frame(t, a - this.acc)
      return
    }
    this.lastT = t
    this.frame(t, real)
  }

  /** advance state by dtMs and draw */
  frame(t: number, dtMs: number): void {
    const ctx = this.ctx
    if (!ctx || !this.canvas) return
    const dt = Math.min(0.2, dtMs / 1000)
    // --- spin
    if (!this.dragging) {
      if (this.seek) {
        const p = Math.min(1, (t - this.seek.t0) / this.seek.dur)
        this.rot = this.seek.from + (this.seek.to - this.seek.from) * (this.seek.tile < 0 ? easeOut(p) : easeInOut(p))
        if (p >= 1) {
          this.seek = null
          this.vel = 0
        }
      } else if (t < this.holdUntil) {
        this.vel = 0
      } else {
        const base = this.base
        this.vel += (base - this.vel) * (1 - Math.exp(-dt / 0.7))
        this.rot += this.vel * dt
      }
    }
    if (this.rot > 1e4 || this.rot < -1e4) this.rot = this.rot % (Math.PI * 2)
    // the camera leans in while a face is shown off, then drifts back to its 12° view
    const focusing = !this.dragging && (this.seek != null || t < this.holdUntil)
    if (!focusing) this.tiltTo = TILT
    if (this.tilt !== this.tiltTo) {
      const k = 1 - Math.exp(-dt / (focusing ? 0.16 : 0.9))
      this.tilt += (this.tiltTo - this.tilt) * k
      if (Math.abs(this.tilt - this.tiltTo) < 1e-4) this.tilt = this.tiltTo
    }
    if (!this.reduced) this.t += dt * (0.55 + Math.min(1.2, fxState.speed) * 0.65)
    this.updateFx(t, dt)
    // --- draw
    const pal = fxState.auroraT >= 1 ? lightPalette(fxState.aurora) : this.blendPalette()
    const f: Frame = {
      view: this.view,
      t: this.t,
      w: this.cw,
      h: this.ch,
      dpr: this.dpr,
      detail: this.variant === 'mini' ? 0 : this.variant === 'zoom' ? 1 : 2,
      glowLevel: Math.min(1, this.lit / 40),
      boost: fxState.flash,
      palette: pal,
      paletteMix: 0.32,
      gold: fxState.gold,
      exposure: this.variant === 'zoom' ? 0.78 : 1,
      lite: fxState.quality === 0,
    }
    this.painter.draw(ctx, this.scene, f)
    this.frames++
    if (!this.drawnOnce) {
      this.drawnOnce = true
      this.canvas.setAttribute('data-ready', '1')
    }
    if (params.test) this.recordDrawMs(t)
    if (this.variant !== 'mini' && this.variant !== 'zoom' && emitterOwner() === this) this.writeEmitters()
  }

  private pal: [number, number, number][] = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ]
  private blendPalette(): [number, number, number][] {
    const a = lightPalette(fxState.auroraFrom)
    const b = lightPalette(fxState.aurora)
    const k = Math.max(0, Math.min(1, fxState.auroraT))
    for (let i = 0; i < 3; i++) for (let c = 0; c < 3; c++) this.pal[i][c] = a[i][c] + (b[i][c] - a[i][c]) * k
    return this.pal
  }

  private recordDrawMs(t: number) {
    this.drawMs.push(this.painter.lastMs)
    if (this.drawMs.length > 90) this.drawMs.shift()
    if (t - this.drawMsAt > 1000 && this.canvas) {
      this.drawMsAt = t
      const xs = [...this.drawMs].sort((a, b) => a - b)
      this.canvas.setAttribute('data-draw-ms', xs[Math.floor(xs.length / 2)].toFixed(3))
      this.canvas.setAttribute('data-draw-ms-p90', xs[Math.floor(xs.length * 0.9)].toFixed(3))
    }
  }

  private updateFx(t: number, dt: number) {
    const sc = this.scene
    sc.glow.fill(0)
    sc.outline.fill(0)
    // white flashes decay
    const fdec = dt * 2.1
    for (let i = 0; i < TILE_COUNT; i++) if (sc.flash[i] > 0) sc.flash[i] = Math.max(0, sc.flash[i] - fdec)
    if (sc.flashAll > 0) sc.flashAll = Math.max(0, sc.flashAll - dt * 1.6)
    // pulses
    if (this.pulses.length) {
      if (this.pulses.some(p => t >= p.t0 + p.dur)) this.pulses = this.pulses.filter(p => t < p.t0 + p.dur)
      for (const p of this.pulses) {
        if (t < p.t0) continue
        const q = (t - p.t0) / p.dur
        const v = p.kind === 'blink2' ? Math.pow(Math.sin(q * Math.PI * 2), 2) : Math.sin(q * Math.PI) * (1 - q * 0.4)
        sc.glow[p.tile] = Math.max(sc.glow[p.tile], v)
        if (p.kind === 'blink2') sc.flash[p.tile] = Math.max(sc.flash[p.tile], v * 0.35)
      }
    }
    // drag preview: the face the card would land on starts to glow (C-1)
    if (this.variant === 'hero' || this.variant === 'mini') {
      const d = fxState.drag
      if (d.dir === 'right' && d.songId) {
        const tile = this.layout.bySong[d.songId]
        if (tile != null) {
          const pr = Math.max(0, Math.min(1, d.progress))
          sc.glow[tile] = Math.max(sc.glow[tile], (0.3 + 0.7 * pr) * (0.8 + 0.2 * Math.sin(t / 90)))
          if (this.variant === 'hero' && pr > 0.12) this.seekTile(tile, 480, 900)
        }
      }
    }
    // wrap: tonight's new faces pulse and parade to the front
    if (this.wrapTiles.length) {
      this.wrapTiles.forEach((tile, k) => {
        sc.glow[tile] = Math.max(sc.glow[tile], 0.45 + 0.45 * Math.sin(t / 380 + k * 1.3))
      })
      if (t > this.wrapNext && !this.dragging) {
        const tile = this.wrapTiles[this.wrapIdx % this.wrapTiles.length]
        this.wrapIdx++
        this.seekTile(tile, 700, 1600)
        this.defer(650, () => (sc.flash[tile] = 0.8))
        this.wrapNext = t + 2600
      }
    }
    // room: the song being sung breathes
    if (this.nowTile >= 0) sc.glow[this.nowTile] = Math.max(sc.glow[this.nowTile], 0.35 + 0.35 * Math.sin(t / 260))
    // outlines
    const blink = 0.55 + 0.45 * Math.sin(t / 170)
    if (this.highlightArea) for (const i of areaTiles(this.highlightArea, this.layout)) sc.outline[i] = Math.max(sc.outline[i], blink)
    if (this.zoomTiles.length) for (const i of this.zoomTiles) sc.outline[i] = Math.max(sc.outline[i], 0.35 + 0.65 * Math.max(0, Math.sin(t / 240)))
    if (this.bubbleArea) {
      for (const i of areaTiles(this.bubbleArea, this.layout)) {
        sc.outline[i] = Math.max(sc.outline[i], 0.6 + 0.4 * Math.sin(t / 140))
        sc.glow[i] = Math.max(sc.glow[i], 0.18)
      }
    }
    if (this.outlines.length) {
      if (this.outlines.some(o => t >= o.t0 + o.dur)) this.outlines = this.outlines.filter(o => t < o.t0 + o.dur)
      for (const o of this.outlines) {
        if (t < o.t0) continue
        const q = (t - o.t0) / o.dur
        const v = Math.sin(Math.PI * Math.min(1, q * 1.4)) * (1 - q * 0.3)
        for (const i of o.tiles) {
          sc.outline[i] = Math.max(sc.outline[i], v)
          sc.glow[i] = Math.max(sc.glow[i], v * 0.5)
        }
      }
    }
    // links draw in (stroke 400 ms)
    if (sc.links.length) {
      for (const l of sc.links) {
        const key = l.a < l.b ? `${l.a}-${l.b}` : `${l.b}-${l.a}`
        const st = this.linkStart.get(key) ?? -1e9
        l.p = Math.max(0, Math.min(1, (t - st - 250) / 400))
      }
    }
    // pins spring into the hanging ring
    if (sc.pins.length) {
      for (const p of sc.pins) {
        const st = this.pinStart.get(PIN_IDS[p.slot]) ?? -1e9
        const q = (t - st) / 520
        p.s = q <= 0 ? 0 : q >= 1 ? 1 : 1 + Math.sin(q * Math.PI * 1.5) * (1 - q) * 0.9 - (1 - q) * (1 - q) * 0.2
      }
    }
    // prism rings
    if (this.rings.length) {
      if (this.rings.some(r => t >= r.t0 + 700)) this.rings = this.rings.filter(r => t < r.t0 + 700)
      sc.rings.length = this.rings.length
      this.rings.forEach((r, k) => {
        const o = sc.rings[k] ?? (sc.rings[k] = { tile: 0, p: 0 })
        o.tile = r.tile
        o.p = (t - r.t0) / 700
      })
    } else if (sc.rings.length) sc.rings.length = 0
    // mirror beams: each front-facing mirror throws one every 4 s, 6 at most at once
    if (this.variant !== 'mini' && this.variant !== 'zoom') {
      if (this.beams.some(b => t >= b.t0 + b.dur)) this.beams = this.beams.filter(b => t < b.t0 + b.dur)
      if (!this.reduced && this.beams.length < 6) {
        const pz = this.painter.pz
        for (let i = 0; i < TILE_COUNT && this.beams.length < 6; i++) {
          const k = sc.kind[i]
          if ((k === K_MIRROR || k === K_PRISM) && pz[i] > 0.82 && t > this.beamNext[i]) {
            this.beamNext[i] = t + 4000 + (i % 7) * 180
            this.beams.push({ tile: i, t0: t, dur: 1100, len: 0.9 + ((i * 37) % 10) / 20 })
          }
        }
      }
      sc.beams.length = this.beams.length
      this.beams.forEach((b, k) => {
        const o = sc.beams[k] ?? (sc.beams[k] = { tile: 0, p: 0, len: 1 })
        o.tile = b.tile
        o.p = (t - b.t0) / b.dur
        o.len = b.len
      })
    }
  }

  private writeEmitters() {
    const rect = this.canvasRect()
    if (!rect) return
    const k = rect.width / Math.max(1, this.cw)
    const out = fxState.emitters
    const b = this.painter.bright
    const px = this.painter.px
    const py = this.painter.py
    const pz = this.painter.pz
    let n = 0
    const put = (i: number) => {
      if (!out[n]) out[n] = { x: 0, y: 0 }
      out[n].x = rect.left + px[i] * k
      out[n].y = rect.top + py[i] * k
      n++
    }
    const kind = this.scene.kind
    for (const i of b) if (n < 8 && pz[i] > 0.45 && (kind[i] === K_MIRROR || kind[i] === K_PRISM)) put(i)
    for (const i of b) if (n < 6 && pz[i] > 0.45 && kind[i] !== K_MIRROR && kind[i] !== K_PRISM) put(i)
    // always offer a few points on the front of the ball
    for (let i = 0; n < 4 && i < TILE_COUNT; i += 37) if (pz[i] > 0.5) put(i)
    out.length = n
  }
}

// ---------------------------------------------------------------- test hook (?test=1)

declare global {
  interface Window {
    __ball?: {
      face(songId: SongId, variant?: Variant): { x: number; y: number; z: number } | null
      resolve(songId: SongId): { x: number; y: number; w: number; h: number } | null
      emitters(): { x: number; y: number }[]
      rot(variant?: Variant): number | null
      frames(variant?: Variant): number | null
      darkPoint(variant?: Variant): { x: number; y: number; songId?: SongId } | null
      spin(variant?: Variant): ReturnType<BallController['debugSpin']> | null
      /** simulate the card drag preview that M3 writes into fxState.drag */
      drag(dir: 'up' | 'right' | 'left' | null, songId?: SongId, progress?: number): void
    }
  }
}

if (typeof window !== 'undefined' && params.test) {
  const find = (v: Variant) => [...live].find(c => c.variant === v) ?? null
  window.__ball = {
    face: (id, v = 'hero') => find(v)?.debugFace(id) ?? null,
    resolve: id => {
      const r = resolveTarget(`face:${id}`)
      return r ? { x: r.left, y: r.top, w: r.width, h: r.height } : null
    },
    emitters: () => fxState.emitters.map(e => ({ x: e.x, y: e.y })),
    rot: (v = 'hero') => find(v)?.rot ?? null,
    frames: (v = 'hero') => find(v)?.frames ?? null,
    spin: (v = 'hero') => find(v)?.debugSpin() ?? null,
    drag: (dir, songId, progress = 0) => {
      fxState.drag = { dir, songId, progress }
    },
    darkPoint: (v = 'hero') => {
      // a front-facing song face that is not lit yet
      const c = find(v)
      if (!c) return null
      const faces = naviApi.getState().col.faces
      let best: { x: number; y: number; songId?: SongId; z: number } | null = null
      for (const t of c.layout.tiles) {
        if (!t.songId || faces[t.songId]) continue
        const p = c.debugFace(t.songId)
        if (p && p.z > 0.75 && (!best || p.z > best.z)) best = { ...p, songId: t.songId }
      }
      return best
    },
  }
}
