// L4 (SPEC K-11): one canvas for one-shot bursts. It sleeps (off the ticker) until a burst is
// fired and goes back to sleep when the last particle fades. Triggers: bus fx/burst (spark12 at
// the lane slot, stamp, area…), a face turning prism (rainbow burst at the face), and a pin
// flight landing (gold pin burst). Targets resolve through core/targets and are converted into
// this layer's own coordinates, so bursts land correctly inside the scaled dual phone frame.
import { memo, useEffect, useRef } from 'react'
import { bus, type BurstPreset, type TargetId } from '../../core/events'
import { ticker } from '../../core/ticker'
import { fxState } from '../../core/fxState'
import { naviApi } from '../../core/store'
import { resolveTarget, rectCenter } from '../../core/targets'
import { areaColor } from '../../core/rules'
import { songColor } from '../../core/actions'
import { selTonight } from '../../core/selectors'
import { params } from '../../core/params'
import { SONG_BY_ID } from '../../data/songs'
import { BurstSystem } from './bursts'
import { hexToRgb, lighten, rgbCss } from './sprites'
import { fxDebug } from './debug'
import './fx.css'

/** Colours a burst should take from what it celebrates. */
function colorsFor(preset: BurstPreset, at: TargetId | { x: number; y: number }): string[] | undefined {
  const s = naviApi.getState()
  if (typeof at === 'string' && at.startsWith('face:')) {
    const song = SONG_BY_ID[at.slice(5)]
    if (song) return [areaColor(song.genre), '#FFFFFF']
  }
  if (preset === 'spark12') {
    // the song that was just thrown into the lane
    let last: { songId: string; addedAt: number } | null = null
    for (const q of s.room.queue) if (q.by === 'me' && (!last || q.addedAt >= last.addedAt)) last = q
    if (last) return [songColor(last.songId), '#FFD36B', '#FFE9A8']
  }
  // tonight's colours, lifted so the ink reads on the dark calendar
  if (preset === 'stamp') return selTonight(s).palette.map(c => rgbCss(lighten(hexToRgb(c), 0.28)))
  return undefined
}

function BurstInner(): JSX.Element {
  if (params.test) fxDebug.renders.burst++
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const cv = ref.current
    const ctx = cv?.getContext('2d')
    if (!cv || !ctx) return
    const sys = new BurstSystem()
    let w = 0
    let h = 0
    let dpr = 1
    let off: (() => void) | null = null

    const size = () => {
      w = cv.clientWidth || 1
      h = cv.clientHeight || 1
      dpr = Math.min(1.5, window.devicePixelRatio || 1)
      const cw = Math.max(1, Math.round(w * dpr))
      const ch = Math.max(1, Math.round(h * dpr))
      if (cv.width !== cw || cv.height !== ch) {
        cv.width = cw
        cv.height = ch
      }
    }
    size()
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(size) : null
    ro?.observe(cv)

    const loop = (dt: number) => {
      sys.step(dt)
      sys.draw(ctx, dpr, w, h)
      if (params.test) {
        fxDebug.frames.burst++
        fxDebug.particles = sys.parts.length
      }
      if (!sys.busy) {
        ctx.setTransform(1, 0, 0, 1, 0, 0)
        ctx.clearRect(0, 0, cv.width, cv.height)
        // asleep: not even composited until the next burst
        cv.style.visibility = 'hidden'
        off?.()
        off = null
      }
    }

    /** viewport point → this canvas (undoes the dual frame's scale) */
    const toLocal = (x: number, y: number) => {
      const r = cv.getBoundingClientRect()
      const k = r.width > 0 ? w / r.width : 1
      return { x: (x - r.left) * k, y: (y - r.top) * k }
    }

    const fire = (preset: BurstPreset, at: TargetId | { x: number; y: number }) => {
      if (cv.offsetParent === null) return
      let p: { x: number; y: number } | null = null
      if (typeof at === 'string') {
        const r = resolveTarget(at) ?? (at.startsWith('face:') ? resolveTarget('hero:ball') : null)
        if (r) p = rectCenter(r)
      } else p = at
      if (!p) return
      const q = toLocal(p.x, p.y)
      if (q.x < -40 || q.y < -40 || q.x > w + 40 || q.y > h + 40) return
      sys.fire(preset, q.x, q.y, { colors: colorsFor(preset, at), reduced: fxState.reduced, lite: fxState.quality === 0 })
      if (params.test) fxDebug.bursts++
      if (!off) {
        cv.style.visibility = 'visible'
        off = ticker.add(loop, 20)
      }
    }

    const pinTo = new Map<string, number>()
    const offs = [
      bus.on('fx/burst', e => fire(e.preset, e.at)),
      bus.on('face/changed', e => {
        if (e.to !== 'prism' || e.from === 'prism') return
        setTimeout(() => fire('prism', `face:${e.songId}`), 160)
      }),
      bus.on('fx/flight', e => {
        if (e.kind === 'pin') pinTo.set(e.to, performance.now())
      }),
      bus.on('fx/landed', e => {
        const t = pinTo.get(e.to)
        if (t != null && performance.now() - t < 2000) {
          pinTo.delete(e.to)
          fire('pin', e.to)
        }
      }),
    ]

    return () => {
      offs.forEach(f => f())
      off?.()
      ro?.disconnect()
    }
  }, [])

  return <canvas ref={ref} className="fx-burst" aria-hidden="true" style={{ visibility: 'hidden' }} />
}

const BurstMemo = memo(BurstInner)

/** Sparks, rainbow rings, pin and stamp bursts (one canvas, asleep when idle). */
export function BurstLayer(): JSX.Element {
  return <BurstMemo />
}
