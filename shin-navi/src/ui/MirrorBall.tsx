// React wrapper around the mirror ball renderer. Faces are read from a ref each frame,
// so updating the collection never re-renders on every tick.
import { useEffect, useRef } from 'react'
import { drawMirrorBall, type Face, type DrawOptions } from './mirrorBall'

type Props = {
  faces: Face[]
  size: number
  spin?: number
  glow?: number
  highlightBand?: number | null
  className?: string
  onTap?: (e: React.PointerEvent<HTMLCanvasElement>) => void
  /** exposes the clock so flights can aim at a face */
  clockRef?: React.MutableRefObject<number>
}

export function MirrorBall({ faces, size, spin, glow, highlightBand, className, onTap, clockRef }: Props) {
  const ref = useRef<HTMLCanvasElement>(null)
  const state = useRef<Omit<DrawOptions, 't'>>({ faces, size, spin, glow, highlightBand })
  state.current = { faces, size, spin, glow, highlightBand }
  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    let raf = 0
    const t0 = performance.now()
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    const frame = (now: number) => {
      const s = state.current.size
      if (canvas.width !== Math.floor(s * dpr)) {
        canvas.width = Math.floor(s * dpr)
        canvas.height = Math.floor(s * dpr)
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      const t = reduce ? 0 : (now - t0) / 1000
      if (clockRef) clockRef.current = t
      drawMirrorBall(ctx, { ...state.current, t })
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    const onVis = () => {
      cancelAnimationFrame(raf)
      if (!document.hidden) raf = requestAnimationFrame(frame)
    }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      cancelAnimationFrame(raf)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [clockRef])
  return <canvas ref={ref} className={className} style={{ width: size, height: size }} onPointerUp={onTap} aria-label="mirror ball" role="img" />
}
