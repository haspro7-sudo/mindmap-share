// M2 ball — PHASE-0 STUB (owned by M2 from phase 1). Public API per SPEC L/M2.
// The stub drives the legacy renderer (src/ui/mirrorBall.ts) from the shared ticker so the
// hero already drops in and spins; layoutBall is a simple placeholder of the D-2 layout.
import { createElement as h, useEffect, useRef } from 'react'
import { motion } from 'motion/react'
import { useShallow } from 'zustand/react/shallow'
import { drawMirrorBall, faceCount, type Face as DrawFace } from '../../ui/mirrorBall'
import { SONGS, GENRES, type Song } from '../../data/songs'
import type { AreaKey, CardBodyComponent, FaceState, SongId } from '../../core/types'
import { useNavi, naviApi } from '../../core/store'
import { selFaceStats } from '../../core/selectors'
import { ticker } from '../../core/ticker'
import { registerTarget, registerResolver } from '../../core/targets'
import { introDelay, introPending } from '../../core/intro'
import { SPRING } from '../../core/ui/motion'
import { StubBox } from '../../core/ui/StubBox'
import { tr } from '../../i18n'
import '../../styles/stubs.css'

export type BallTile = { i: number; band: number; lat: number; lon: number; dLat: number; dLon: number; songId?: SongId }

const BANDS = [9, 13, 16, 19, 20, 20, 19, 16, 13, 9]

/** Placeholder layout: tiles per D-2 bands, songs placed in (genre, bpm desc) order. M2 replaces with the greedy fit. */
export function layoutBall(songs: Song[]): { tiles: BallTile[]; bySong: Record<SongId, number> } {
  const tiles: BallTile[] = []
  const dLat = 14.4
  BANDS.forEach((count, band) => {
    const lat = 72 - dLat * (band + 0.5)
    const dLon = 360 / count
    for (let k = 0; k < count; k++) tiles.push({ i: tiles.length, band, lat, lon: -180 + dLon * (k + 0.5), dLat, dLon })
  })
  const order = [...songs].sort((a, b) => GENRES.indexOf(a.genre) - GENRES.indexOf(b.genre) || b.bpm - a.bpm)
  const bySong: Record<SongId, number> = {}
  order.forEach((s, n) => {
    const i = Math.round((n * tiles.length) / Math.max(1, order.length)) % tiles.length
    let j = i
    while (tiles[j].songId) j = (j + 1) % tiles.length
    tiles[j].songId = s.id
    bySong[s.id] = j
  })
  return { tiles, bySong }
}

type Variant = 'hero' | 'mini' | 'record' | 'room' | 'standby' | 'wrap'
const DEFAULT_SIZE: Record<Variant, number> = { hero: 196, mini: 32, record: 280, room: 420, standby: 240, wrap: 220 }
const STATE_NUM: Record<FaceState, DrawFace['state']> = { sketch: 1, neon: 2, mirror: 3, prism: 4 }
const SONG_INDEX: Record<SongId, number> = Object.fromEntries(SONGS.map((s, i) => [s.id, i]))

function hslHex(hDeg: number, s: number, l: number): string {
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => {
    const k = (n + hDeg / 30) % 12
    const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))
    return Math.round(c * 255)
      .toString(16)
      .padStart(2, '0')
  }
  return `#${f(0)}${f(8)}${f(4)}`
}
const AREA_HEX = GENRES.map((_, i) => hslHex((330 + 30 * i) % 360, 0.85, 0.62))

function buildFaces(variant: Variant): DrawFace[] {
  const s = naviApi.getState()
  const n = faceCount()
  const faces: DrawFace[] = Array.from({ length: n }, () => ({ state: 0, color: '#888888' }))
  const put = (songId: string, state: DrawFace['state'], color: string) => {
    const idx = SONG_INDEX[songId]
    if (idx == null) return
    faces[(idx * 37) % n] = { state, color }
  }
  if (variant === 'room') {
    // shared ball: only tonight's reserved songs, in the reserver's colour
    for (const q of [...(s.room.now ? [s.room.now.item] : []), ...s.room.queue]) put(q.songId, 2, s.room.members[q.by]?.color ?? '#ffffff')
    return faces
  }
  for (const f of Object.values(s.col.faces)) {
    const song = SONGS[SONG_INDEX[f.songId]]
    if (song) put(f.songId, STATE_NUM[f.state], AREA_HEX[GENRES.indexOf(song.genre)] ?? '#ffffff')
  }
  return faces
}

export function MirrorBall(p: {
  variant: Variant
  size?: number
  highlightArea?: AreaKey
  flashSongIds?: SongId[]
  interactive?: boolean
  onFaceTap?(songId: SongId): void
  onAreaTap?(area: AreaKey): void
}): JSX.Element {
  const size = p.size ?? DEFAULT_SIZE[p.variant]
  const canvasSize = Math.round(size * 1.25)
  const ref = useRef<HTMLCanvasElement>(null)
  const wrap = useRef<HTMLDivElement>(null)
  const stats = useNavi(useShallow(selFaceStats))
  const dataKey = useNavi(s => (p.variant === 'room' ? s.room.queue.length + (s.room.now ? 1 : 0) : Object.keys(s.col.faces).length))
  const faces = useRef<DrawFace[]>([])
  const reduced = useNavi(s => s.ui.reduced)

  useEffect(() => {
    faces.current = buildFaces(p.variant)
    const unsub = naviApi.subscribe((s, prev) => {
      if (s.col.faces !== prev.col.faces || s.room.queue !== prev.room.queue || s.room.now !== prev.room.now) faces.current = buildFaces(p.variant)
    })
    return unsub
  }, [p.variant, dataKey])

  useEffect(() => {
    const c = ref.current
    const ctx = c?.getContext('2d')
    if (!c || !ctx) return
    const dpr = Math.min(p.variant === 'mini' ? 2 : 1.5, window.devicePixelRatio || 1)
    c.width = Math.round(canvasSize * dpr)
    c.height = Math.round(canvasSize * dpr)
    let acc = 0
    let t = 0
    const glow = Math.min(0.9, 0.25 + stats.lit / 60)
    const draw = () => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      drawMirrorBall(ctx, { size: canvasSize, t, faces: faces.current, spin: (Math.PI * 2) / 24, glow })
    }
    draw()
    if (reduced) return
    return ticker.add(dt => {
      t += dt / 1000
      acc += dt
      if (p.variant === 'mini' && acc < 100) return // 10 fps
      acc = 0
      draw()
    })
  }, [p.variant, canvasSize, reduced, stats.lit])

  useEffect(() => {
    const id = p.variant === 'hero' ? 'hero:ball' : p.variant === 'mini' ? 'dock:record' : p.variant === 'room' ? 'room:ball' : null
    if (!id) return
    registerTarget(id, wrap.current)
    const off = p.variant === 'hero' ? registerResolver('face', () => wrap.current?.getBoundingClientRect() ?? null) : undefined
    return () => {
      registerTarget(id, null)
      off?.()
    }
  }, [p.variant])

  const isHero = p.variant === 'hero' || p.variant === 'room'
  const drop = isHero && introPending('ballDrop') && !reduced
  const testid = p.variant === 'mini' ? 'ball-canvas-mini' : 'ball-canvas'
  const canvas = h('canvas', {
    ref,
    className: 'stub-ball__canvas',
    style: { width: canvasSize, height: canvasSize, margin: -(canvasSize - size) / 2 },
    'data-testid': testid,
    'data-variant': p.variant,
    'data-ready': '1',
    'data-lit-count': stats.lit,
    'data-sketch': stats.sketch,
    'data-neon': stats.neon,
    'data-mirror': stats.mirror,
    'data-prism': stats.prism,
    role: 'img',
    'aria-label': 'mirror ball',
  })
  return h(
    'div',
    { ref: wrap, className: `stub-ball stub-ball--${p.variant}`, style: { width: size, height: size }, 'data-private': p.variant === 'room' ? undefined : '1' },
    isHero
      ? h(motion.div, {
          className: 'stub-ball__wire',
          initial: drop ? { scaleY: 0 } : false,
          animate: { scaleY: 1 },
          transition: { duration: 0.4, ease: 'easeOut', delay: introDelay('wire') },
        })
      : null,
    h(
      motion.div,
      {
        className: 'stub-ball__body',
        initial: drop ? { y: -160 } : reduced && isHero ? { opacity: 0 } : false,
        animate: { y: 0, opacity: 1 },
        transition: reduced ? { duration: 0.3 } : { ...SPRING.drop, delay: introDelay('ballDrop') },
      },
      canvas,
    ),
  )
}

export const GapCardBody: CardBodyComponent = ({ card, setPrimary, act }) => {
  useEffect(() => {
    setPrimary({ action: 'openArea', label: { key: 'common.search.placeholder' }, enabled: true })
  }, [card.id])
  return h(
    StubBox,
    { name: 'GapCardBody', module: 'M2', className: 'stub-body' },
    h('div', { className: 'stub-body__area' }, card.area ?? ''),
    h('div', { className: 'stub-body__reason' }, tr(card.reason.text)),
    h('button', { type: 'button', className: 'stub-body__btn', onClick: () => act('openArea') }, card.area ?? 'area'),
  )
}
