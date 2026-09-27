// The flow line under the phone lane: tonight's heat as a thin glowing wave, the queue ahead
// as a faint dotted continuation, and, while a card is dragged upward, Navi's read of how the
// air would move if that song were added ("Navi's read", a hypothesis). The drag preview is
// driven by the shared ticker reading fxState.drag, so dragging never re-renders React.
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useNavi } from '../../core/store'
import { fxState } from '../../core/fxState'
import { ticker } from '../../core/ticker'
import { clamp } from '../../lib/rng'
import { S } from './strings'
import { forecastHeat, forecastQueue, heatRange, heatSeries, smoothPath, trendOf } from './model'
import { presentOf } from './parts'

type Props = { height: number; onDrag?: (progress: number) => void }

export function FlowLine({ height, onDrag }: Props) {
  const t = S.useT()
  const uid = useId().replace(/:/g, '')
  const box = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(0)
  const sung = useNavi(s => s.room.sung)
  const heat = useNavi(s => s.room.heat)
  const now = useNavi(s => s.room.now)
  const queue = useNavi(s => s.room.queue)
  const members = useNavi(s => s.room.members)

  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const measure = () => setW(Math.round(el.clientWidth))
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const present = useMemo(() => presentOf(members), [members])
  const h = height
  const top = 2.5
  const bottom = h - 2.5

  const geo = useMemo(() => {
    const past = heatSeries(sung, 0.2, 6)
    const ahead = forecastQueue(heat, [...(now ? [now.item.songId] : []), ...queue.map(q => q.songId)], present).slice(0, 5)
    const [lo, hi] = heatRange([...past, ...ahead], 0.04, 0.35)
    const y = (v: number) => bottom - clamp((v - lo) / (hi - lo), 0, 1) * (bottom - top)
    // NOW sits a little left of centre: tonight so far flows in from the left edge,
    // the queue ahead continues as a dotted hypothesis on the right.
    const nowX = Math.round(w * 0.36)
    const pastVals = past.length > 1 ? past : [past[0], past[0]]
    const pastPts = pastVals.map((v, i) => ({ x: (nowX * i) / (pastVals.length - 1), y: y(v) }))
    const step = Math.max(12, Math.min(28, (w - nowX - 24) / Math.max(3, ahead.length + 1)))
    const nowPt = pastPts[pastPts.length - 1]
    const aheadPts = [nowPt, ...ahead.map((v, i) => ({ x: nowX + step * (i + 1), y: y(v) }))]
    const last = aheadPts[aheadPts.length - 1]
    const lastHeat = ahead.length ? ahead[ahead.length - 1] : past[past.length - 1]
    return { pastD: smoothPath(pastPts), aheadD: aheadPts.length > 1 ? smoothPath(aheadPts) : '', nowX, nowY: nowPt.y, last, lastHeat, step, lo, hi }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sung, heat, now?.item.songId, queue, present, w, h])

  // ---- drag preview (ticker-driven, no React renders)
  const preview = useRef<SVGPathElement>(null)
  const dot = useRef<SVGCircleElement>(null)
  const label = useRef<HTMLDivElement>(null)
  const geoRef = useRef(geo)
  geoRef.current = geo
  const dragRef = useRef(onDrag)
  dragRef.current = onDrag
  useEffect(() => {
    let song: string | undefined
    let shown = -1
    return ticker.add(() => {
      const d = fxState.drag
      const on = d.dir === 'up' && !!d.songId ? clamp(d.progress * 1.6, 0, 1) : 0
      dragRef.current?.(on)
      if (on !== shown) {
        shown = on
        const o = on.toFixed(3)
        if (preview.current) preview.current.style.opacity = o
        if (dot.current) dot.current.style.opacity = o
        if (label.current) label.current.style.opacity = o
      }
      if (on > 0 && d.songId !== song) {
        song = d.songId
        const g = geoRef.current
        const nextHeat = forecastHeat(g.lastHeat, d.songId!, present)
        const x2 = Math.min(g.last.x + g.step * 1.6 + 8, (box.current?.clientWidth ?? 200) - 5)
        const y2 = bottom - clamp((nextHeat - g.lo) / (g.hi - g.lo), 0, 1) * (bottom - top)
        const cx = (g.last.x + x2) / 2
        preview.current?.setAttribute('d', `M${g.last.x.toFixed(1)} ${g.last.y.toFixed(1)} C${cx.toFixed(1)} ${g.last.y.toFixed(1)} ${cx.toFixed(1)} ${y2.toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)}`)
        dot.current?.setAttribute('cx', x2.toFixed(1))
        dot.current?.setAttribute('cy', y2.toFixed(1))
        const lab = label.current
        if (lab) {
          lab.dataset.trend = trendOf(g.lastHeat, nextHeat)
          const bw = box.current?.clientWidth ?? 200
          const lw = lab.offsetWidth
          const lx = Math.max(0, Math.min(bw - lw, x2 - lw + 10))
          lab.style.transform = `translateX(${lx.toFixed(0)}px)`
        }
      }
      if (on === 0) song = undefined
    }, 5)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [present, h])

  return (
    <div ref={box} className="sg-flow" style={{ height: h }} aria-hidden="true">
      {w > 0 ? (
        <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="sg-flow__svg">
          <defs>
            <linearGradient id={`fl${uid}`} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor="#8A6BFF" stopOpacity="0.55" />
              <stop offset="0.5" stopColor="#FF3DA8" />
              <stop offset="1" stopColor="#FFB547" />
            </linearGradient>
          </defs>
          <line x1={0} x2={w} y1={bottom + 1.5} y2={bottom + 1.5} className="sg-flow__base" />
          {geo.aheadD ? <path d={geo.aheadD} className="sg-flow__ahead" /> : null}
          <path d={geo.pastD} className="sg-flow__glow" stroke={`url(#fl${uid})`} />
          <path d={geo.pastD} className="sg-flow__past" stroke={`url(#fl${uid})`} />
          <circle cx={geo.nowX} cy={geo.nowY} r={2.4} className="sg-flow__now" />
          <circle cx={geo.nowX} cy={geo.nowY} r={2.4} className="sg-flow__nowping" style={{ transformOrigin: `${geo.nowX}px ${geo.nowY}px` }} />
          <path ref={preview} className="sg-flow__preview" d="" style={{ opacity: 0 }} />
          <circle ref={dot} r={3} className="sg-flow__pdot" style={{ opacity: 0 }} />
        </svg>
      ) : null}
      <div ref={label} className="sg-flow__label" style={{ opacity: 0 }} data-trend="flat">
        <span className="sg-flow__tag">{t('flowForecast')}</span>
        <span className="sg-flow__t sg-flow__t--up">{t('flowUp')}</span>
        <span className="sg-flow__t sg-flow__t--down">{t('flowDown')}</span>
        <span className="sg-flow__t sg-flow__t--flat">{t('flowFlat')}</span>
      </div>
    </div>
  )
}
