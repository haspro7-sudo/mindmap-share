// The mirror ball (SPEC D, B-2, C-1). One renderer, six presentations:
// hero (home, 196 / 160 px), mini (dock, 10 fps), record (big, rotatable), room (420 px, tonight's
// queue in the reservers' colours, nothing personal), standby, wrap (tonight's faces pulse).
// Every frame is drawn from the shared ticker by BallController; React only mounts it and
// re-renders when the face counts change (data attributes).
import { AnimatePresence, animate, motion } from 'motion/react'
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent as RPointerEvent, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { useNavi, naviApi } from '../../core/store'
import type { NaviState } from '../../core/store/types'
import { useNaviStable } from '../../core/useStable'
import { selFaceStats } from '../../core/selectors'
import { registerTarget } from '../../core/targets'
import { introDelay, introPending, introWait } from '../../core/intro'
import { SPRING } from '../../core/ui/motion'
import { Icon } from '../../core/ui/Icon'
import { sound } from '../../core/sound'
import type { AreaKey, SongId } from '../../core/types'
import { BallController, PAD, type Variant } from './controller'
import { areaTiles, ballLayout, parseArea } from './layout'
import { S } from './strings'
import './ball.css'

export type BallVariant = Exclude<Variant, 'zoom'>

export type MirrorBallProps = {
  variant: BallVariant
  size?: number
  highlightArea?: AreaKey
  flashSongIds?: SongId[]
  interactive?: boolean
  onFaceTap?(songId: SongId): void
  onAreaTap?(area: AreaKey): void
}

const DEFAULT_SIZE: Record<BallVariant, number> = { hero: 196, mini: 30, record: 280, room: 420, standby: 240, wrap: 220 }

type Entrance = 'drop' | 'short' | 'fade' | 'none'

type RoomStats = { lit: number; sketch: number; neon: number; mirror: number; prism: number }
/** The shared ball shows tonight's queue only: count those faces, never the personal collection. */
function selRoomStats(s: NaviState): RoomStats {
  const kind = new Map<string, 'neon' | 'mirror' | 'prism'>()
  for (const e of s.room.sung) kind.set(e.item.songId, e.knowShare >= 0.999 ? 'prism' : 'mirror')
  for (const q of s.room.queue) kind.set(q.songId, 'neon')
  if (s.room.now) kind.set(s.room.now.item.songId, 'neon')
  const out: RoomStats = { lit: kind.size, sketch: 0, neon: 0, mirror: 0, prism: 0 }
  for (const k of kind.values()) out[k]++
  return out
}

const openFaceDefault = (songId: SongId) => naviApi.getState().openSheet('face', { songId })
const openAreaDefault = (area: AreaKey) => {
  const { tempo, genre } = parseArea(area)
  naviApi.getState().openSheet('search', { filters: { tempo, genre } })
}

/** x/y: position in `host` (the hero, so the bubble floats above the floor lights and mood word) */
type Bubble = { area: AreaKey; x: number; y: number; below: boolean; key: number; host: HTMLElement | null }

export function MirrorBall(p: MirrorBallProps): JSX.Element {
  const variant = p.variant
  const size = Math.round(p.size ?? DEFAULT_SIZE[variant])
  const interactive = !!p.interactive && variant !== 'room' && variant !== 'mini'
  const reduced = useNavi(s => s.ui.reduced)
  const introMode = useNavi(s => s.session.intro)
  const stats = useNaviStable(variant === 'room' ? selRoomStats : selFaceStats)
  const t = S.useT()
  const wrap = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const ctl = useRef<BallController | null>(null)
  const hangs = variant === 'hero' || variant === 'room'
  const [first] = useState<Entrance>(() => {
    if (!hangs) return 'none'
    if (reduced) return 'fade'
    if (naviApi.getState().ui.overlay === 'entry') return 'none' // plays when the entry screen closes
    if (introMode === 'full' && introPending('ballDrop')) return 'drop'
    if (introMode === 'short' && introPending('ballDrop')) return 'short'
    return 'none'
  })
  // leaving the entry screen (S0 -> S1) replays the full descent
  const [replay, setReplay] = useState(0)
  useEffect(() => {
    if (!hangs) return
    let prev = naviApi.getState().ui.overlay
    return naviApi.subscribe(s => {
      const o = s.ui.overlay
      if (prev === 'entry' && o !== 'entry') setReplay(k => k + 1)
      prev = o
    })
  }, [hangs])
  const entrance: Entrance = replay > 0 ? (reduced ? 'fade' : 'drop') : first
  const [bubble, setBubble] = useState<Bubble | null>(null)
  const bubbleEl = useRef<HTMLDivElement>(null)

  // ---- controller lifecycle
  useLayoutEffect(() => {
    const c = new BallController({ variant, size, reduced: naviApi.getState().ui.reduced })
    ctl.current = c
    if (canvasRef.current) c.attach(canvasRef.current)
    return () => {
      c.destroy()
      ctl.current = null
    }
  }, [variant])
  useEffect(() => ctl.current?.setSize(size), [size])
  useEffect(() => {
    if (ctl.current) ctl.current.reduced = reduced
  }, [reduced])
  useEffect(() => {
    if (ctl.current) ctl.current.highlightArea = p.highlightArea ?? null
  }, [p.highlightArea])
  const flashKey = (p.flashSongIds ?? []).join(',')
  useEffect(() => ctl.current?.setWrapSongs(p.flashSongIds), [flashKey])

  // ---- flight targets
  useEffect(() => {
    const id = variant === 'hero' ? 'hero:ball' : variant === 'mini' ? 'dock:record' : variant === 'room' ? 'room:ball' : null
    if (!id || !wrap.current) return
    registerTarget(id, wrap.current)
    return () => registerTarget(id, null)
  }, [variant])

  // ---- entrance choreography (B-2 / B-5). The body is animated imperatively so the canvas
  // inside it is never remounted when the descent replays.
  useLayoutEffect(() => {
    const el = bodyRef.current
    if (!el) return
    if (entrance === 'drop') {
      el.style.transform = 'translateY(-160px)'
      const a = animate(el, { y: [-160, 0] }, { ...SPRING.drop, delay: replay > 0 ? 0 : introDelay('ballDrop') })
      return () => a.stop()
    }
    if (entrance === 'fade') {
      el.style.opacity = '0'
      const a = animate(el, { opacity: [0, 1] }, { duration: 0.3 })
      return () => a.stop()
    }
  }, [replay])
  useEffect(() => {
    const c = ctl.current
    if (!c) return
    if (entrance === 'short') c.introSpin()
    if (entrance !== 'drop' || variant !== 'hero') return
    const opener = () => naviApi.getState().deck.cards[0]?.songId
    // B-2 1.4 s: turn the opener's face to the front, then flash the face the light falls from
    // (the falling streak itself is drawn by the deck, from 72 % of the ball's height)
    const rise = replay > 0 ? 1400 : introWait('cardRise') * 1000
    const t1 = window.setTimeout(() => ctl.current?.prepareOpener(opener()), Math.max(0, rise - 760))
    const t2 = window.setTimeout(() => ctl.current?.flashAtBox(size / 2, size * 0.72), Math.max(0, rise - 240))
    return () => {
      window.clearTimeout(t1)
      window.clearTimeout(t2)
    }
  }, [replay])

  // ---- dark-area bubble lifetime
  useEffect(() => {
    const c = ctl.current
    if (c) c.bubbleArea = bubble?.area ?? null
    if (!bubble) return
    c?.hold(5200)
    const tm = window.setTimeout(() => setBubble(null), 5000)
    const away = (e: Event) => {
      const el = bubbleEl.current
      if (el && e.target instanceof Node && el.contains(e.target)) return
      setBubble(null)
    }
    const tm2 = window.setTimeout(() => document.addEventListener('pointerdown', away, true), 0)
    return () => {
      window.clearTimeout(tm)
      window.clearTimeout(tm2)
      document.removeEventListener('pointerdown', away, true)
    }
  }, [bubble?.key])

  // ---- C-1: a horizontal drag anywhere in the hero turns the ball too (not only on the ball)
  useEffect(() => {
    if (variant !== 'hero' || !interactive) return
    const host = wrap.current?.closest('[data-testid="hero"]') as HTMLElement | null
    if (!host) return
    let st: { id: number; x: number; y: number; lastX: number; drag: boolean; k: number } | null = null
    const down = (e: PointerEvent) => {
      const target = e.target as Element | null
      if (!target || wrap.current?.contains(target) || target.closest?.('button, a, input, [role="button"]')) return
      const r = host.getBoundingClientRect()
      st = { id: e.pointerId, x: e.clientX, y: e.clientY, lastX: e.clientX, drag: false, k: r.width / Math.max(1, host.offsetWidth) }
    }
    const move = (e: PointerEvent) => {
      if (!st || st.id !== e.pointerId) return
      const dx = e.clientX - st.x
      const dy = e.clientY - st.y
      if (!st.drag) {
        if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy) * 1.3) {
          st.drag = true
          ctl.current?.dragStart()
        } else if (Math.abs(dy) > 12) {
          st = null
          return
        }
      }
      if (st.drag) {
        ctl.current?.dragBy((e.clientX - st.lastX) / st.k)
        st.lastX = e.clientX
      }
    }
    const up = (e: PointerEvent) => {
      if (!st || st.id !== e.pointerId) return
      if (st.drag) ctl.current?.dragEnd()
      st = null
    }
    host.addEventListener('pointerdown', down)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    return () => {
      host.removeEventListener('pointerdown', down)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
  }, [variant, interactive])

  // ---- gestures on the ball: horizontal drag spins (inertia), tap opens a face or the area bubble
  const g = useRef<{ id: number; x: number; y: number; t: number; mode: 'pending' | 'drag' | 'none'; lastX: number; k: number } | null>(null)
  const onPointerDown = (e: RPointerEvent<HTMLDivElement>) => {
    const el = wrap.current
    if (!interactive || !el || !ctl.current) return
    const r = el.getBoundingClientRect()
    const dx = e.clientX - (r.left + r.width / 2)
    const dy = e.clientY - (r.top + r.height / 2)
    if (Math.hypot(dx, dy) > (r.width / 2) * 1.04) return
    g.current = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), mode: 'pending', lastX: e.clientX, k: r.width / size }
  }
  const onPointerMove = (e: RPointerEvent<HTMLDivElement>) => {
    const s = g.current
    const c = ctl.current
    if (!s || s.id !== e.pointerId || !c) return
    const dx = e.clientX - s.x
    const dy = e.clientY - s.y
    if (s.mode === 'pending') {
      if (Math.abs(dx) > 6 && Math.abs(dx) > Math.abs(dy) * 1.1) {
        s.mode = 'drag'
        try {
          wrap.current?.setPointerCapture(e.pointerId)
        } catch {
          /* synthetic pointer */
        }
        c.dragStart()
        if (bubble) setBubble(null)
      } else if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) s.mode = 'none' // a vertical swipe belongs to the hero
    }
    if (s.mode === 'drag') {
      c.dragBy((e.clientX - s.lastX) / s.k)
      s.lastX = e.clientX
    }
  }
  const onPointerUp = (e: RPointerEvent<HTMLDivElement>) => {
    const s = g.current
    const c = ctl.current
    if (!s || s.id !== e.pointerId || !c) return
    g.current = null
    if (s.mode === 'drag') return c.dragEnd()
    if (s.mode === 'none') return
    if (Math.hypot(e.clientX - s.x, e.clientY - s.y) < 8 && performance.now() - s.t < 650) tap(e.clientX, e.clientY)
  }
  const onPointerCancel = () => {
    if (g.current?.mode === 'drag') ctl.current?.dragEnd()
    g.current = null
  }
  const tap = (clientX: number, clientY: number) => {
    const c = ctl.current
    if (!c) return
    const hit = c.hitTest(clientX, clientY)
    if (!hit) return
    c.tapFlash(hit.tile)
    if (hit.lit && hit.songId) {
      setBubble(null)
      ;(p.onFaceTap ?? openFaceDefault)(hit.songId)
      return
    }
    if (!hit.area) return
    sound.play('tap')
    const b = c.canvasToBox(hit.x, hit.y)
    const below = b.y < size * 0.5
    let x = size / 2
    let y = below ? b.y + 14 : b.y - 14
    const host = (wrap.current?.closest('[data-testid="hero"]') as HTMLElement | null) ?? null
    if (host && wrap.current) {
      const hr = host.getBoundingClientRect()
      const wr = wrap.current.getBoundingClientRect()
      const k = hr.width / Math.max(1, host.offsetWidth)
      x += (wr.left - hr.left) / k
      y += (wr.top - hr.top) / k
    }
    setBubble({ area: hit.area, x, y, below, key: Date.now(), host })
  }
  const openArea = (area: AreaKey) => {
    setBubble(null)
    ;(p.onAreaTap ?? openAreaDefault)(area)
  }

  // ---- markup
  const cw = Math.round(size * PAD[variant])
  const off = -(cw - size) / 2
  const testid = variant === 'mini' ? 'ball-canvas-mini' : 'ball-canvas'
  const label = variant === 'room' ? t('roomLabel', { n: stats.lit }) : t('label', { n: stats.lit })
  return (
    <div
      ref={wrap}
      className={`mb mb--${variant}${interactive ? ' is-interactive' : ''}`}
      style={{ width: size, height: size }}
      data-private={variant === 'room' ? undefined : '1'}
      data-variant={variant}
      onPointerDown={interactive ? onPointerDown : undefined}
      onPointerMove={interactive ? onPointerMove : undefined}
      onPointerUp={interactive ? onPointerUp : undefined}
      onPointerCancel={interactive ? onPointerCancel : undefined}
    >
      {hangs ? (
        <motion.div
          key={`w${replay}`}
          className="mb__wire"
          aria-hidden
          initial={entrance === 'drop' ? { scaleY: 0 } : false}
          animate={{ scaleY: 1 }}
          transition={{ duration: 0.4, ease: 'easeOut', delay: replay > 0 ? 0 : introDelay('wire') }}
        />
      ) : null}
      <div ref={bodyRef} className="mb__body">
        <canvas
          ref={canvasRef}
          className="mb__canvas"
          style={{ width: cw, height: cw, left: off, top: off } as CSSProperties}
          data-testid={testid}
          data-variant={variant}
          data-lit-count={stats.lit}
          data-sketch={stats.sketch}
          data-neon={stats.neon}
          data-mirror={stats.mirror}
          data-prism={stats.prism}
          role="img"
          aria-label={label}
        />
      </div>
      {bubble?.host ? (
        createPortal(<AnimatePresence>{bubble ? <AreaBubble key={bubble.key} b={bubble} onOpen={openArea} elRef={bubbleEl} /> : null}</AnimatePresence>, bubble.host)
      ) : (
        <AnimatePresence>{bubble ? <AreaBubble key={bubble.key} b={bubble} onOpen={openArea} elRef={bubbleEl} /> : null}</AnimatePresence>
      )}
    </div>
  )
}

function AreaBubble({ b, onOpen, elRef }: { b: Bubble; onOpen(a: AreaKey): void; elRef: RefObject<HTMLDivElement> }) {
  const t = S.useT()
  const { tempo, genre } = parseArea(b.area)
  const lay = ballLayout()
  const ids = areaTiles(b.area).map(i => lay.tiles[i].songId!)
  const lit = useNavi(s => ids.filter(id => !!s.col.faces[id]).length)
  return (
    <div ref={elRef} className={`mb-bubble-pos${b.below ? ' is-below' : ''}`} style={{ left: b.x, top: b.y }} data-private="1" onPointerDown={e => e.stopPropagation()}>
      <motion.div
        className="mb-bubble"
        data-testid="ball-area-bubble"
        data-area={b.area}
        initial={{ opacity: 0, scale: 0.86, y: b.below ? -6 : 6 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.92, transition: { duration: 0.14 } }}
        transition={SPRING.snappy}
      >
        <div className="mb-bubble__title">{t('areaTitle', { tempo: { tempo }, genre: { genre } })}</div>
        <div className="mb-bubble__sub">{lit > 0 ? t('areaLit', { n: ids.length, k: lit }) : t('areaDark', { n: ids.length })}</div>
        <button
          type="button"
          className="mb-bubble__btn"
          data-testid="ball-area-open"
          onPointerDown={e => e.stopPropagation()}
          onClick={e => {
            e.stopPropagation()
            onOpen(b.area)
          }}
        >
          <Icon name="chevron" size={14} strokeWidth={2.4} />
          {t('openArea')}
        </button>
      </motion.div>
    </div>
  )
}
