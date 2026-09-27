// The wall of light (SPEC D-7): tonight's flow as a constellation the ball threw on the wall.
// x = room time, y = heat just after each song; dot size = applause light, colour = the singer.
// My dots are bright, roommates' dimmer. Special markers: turning point (shift), toast (glass),
// navi's pick (gold ring), everyone knew (prism ring), someone joined (a small door).
// `draw` lights the points one by one, then draws the lines with stroke-dashoffset over 1.6 s.
// `publicOnly` is the shared room screen version: nobody is singled out and nothing personal.
import { useId, useMemo, type CSSProperties } from 'react'
import type { MemberId, Night, WallMarker } from '../../core/types'
import { useNavi } from '../../core/store'
import { MEMBER_PROFILES } from '../../data/members'
import { displayPalette } from './nightName'
import { R } from './strings'

export type WallConstellationProps = { night: Night; width: number; height: number; draw?: boolean; publicOnly?: boolean }

type P = { x: number; y: number; r: number; by: MemberId; markers: WallMarker[]; i: number }

const PAD_X = 24
const PAD_TOP = 22
const PAD_BOTTOM = 14
const LINE_MS = 1600
const HEAT_MIN = 0.12
const PRISM = ['#FF3DA8', '#FFB547', '#C6FF3D', '#2EF2FF', '#8A6BFF', '#FF6FB1']

/** Catmull-Rom → cubic Bézier through the points (a soft, flowing line). */
function smoothPath(pts: { x: number; y: number }[]): string {
  if (!pts.length) return ''
  if (pts.length === 1) return `M${pts[0].x} ${pts[0].y}`
  let d = `M${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i]
    const p1 = pts[i]
    const p2 = pts[i + 1]
    const p3 = pts[i + 2] ?? p2
    const c1x = p1.x + (p2.x - p0.x) / 6
    const c1y = p1.y + (p2.y - p0.y) / 6
    const c2x = p2.x - (p3.x - p1.x) / 6
    const c2y = p2.y - (p3.y - p1.y) / 6
    d += ` C${c1x.toFixed(1)} ${c1y.toFixed(1)} ${c2x.toFixed(1)} ${c2y.toFixed(1)} ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`
  }
  return d
}

export function layoutPoints(night: Pick<Night, 'points'>, width: number, height: number): P[] {
  const pts = night.points
  if (!pts.length) return []
  let t0 = pts[0].t
  let t1 = pts[pts.length - 1].t
  // spread the night across the wall; a short night is centred instead of squeezed to one side
  if (t1 - t0 < 12) {
    const mid = (t0 + t1) / 2
    t0 = mid - 6
    t1 = mid + 6
  }
  const w = Math.max(10, width - PAD_X * 2)
  const h = Math.max(10, height - PAD_TOP - PAD_BOTTOM)
  const out = pts.map((p, i) => ({
    x: PAD_X + ((p.t - t0) / (t1 - t0)) * w,
    // heat 0.12…1 fills the wall (the room is never colder than its starting 0.2)
    y: PAD_TOP + (1 - Math.max(0, Math.min(1, (p.heat - HEAT_MIN) / (1 - HEAT_MIN)))) * h,
    r: 2.6 + 4.4 * Math.min(1, p.claps / 60),
    by: p.by,
    markers: p.markers,
    i,
  }))
  // songs that ended close together keep their order but never sit on top of each other
  if (out.length > 1) {
    const gap = Math.min(28, w / (out.length - 1)) * 0.9
    for (let i = 1; i < out.length; i++) out[i].x = Math.max(out[i].x, out[i - 1].x + gap)
    const first = out[0].x
    const last = out[out.length - 1].x
    const right = PAD_X + w
    if (last > right) {
      // squeeze back into the wall, anchored at the first point (or the left edge)
      const left = Math.min(first, right - gap * (out.length - 1))
      const k = (right - Math.max(PAD_X, left)) / Math.max(1e-6, last - first)
      for (const p of out) p.x = Math.max(PAD_X, left) + (p.x - first) * k
    }
  }
  return out
}

export function WallConstellation({ night, width, height, draw = false, publicOnly = false }: WallConstellationProps): JSX.Element {
  const t = R.useT()
  const uid = useId().replace(/:/g, '')
  const reduced = useNavi(s => s.ui.reduced)
  const pts = useMemo(() => layoutPoints(night, width, height), [night, width, height])
  const path = useMemo(() => smoothPath(pts), [pts])
  const [a, b, c] = displayPalette(night)
  const animate = draw && !reduced
  const n = pts.length
  const step = n > 1 ? Math.min(140, 900 / n) : 0
  const lineDelay = n * step + 160
  const bottom = height - PAD_BOTTOM + 4

  const color = (by: MemberId) => (by === 'me' ? '#FFFFFF' : (MEMBER_PROFILES[by]?.color ?? '#FFF6D8'))
  const bright = (by: MemberId) => publicOnly || by === 'me'

  return (
    <svg
      className={`wc${animate ? ' is-draw' : ''}${publicOnly ? ' is-public' : ''}`}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={t('wc.aria', { n })}
      data-testid="wall-constellation"
      data-points={n}
      data-private={publicOnly ? undefined : '1'}
      style={{ ['--wc-line-delay' as string]: `${lineDelay}ms`, ['--wc-line-ms' as string]: `${LINE_MS}ms` } as CSSProperties}
    >
      <defs>
        <linearGradient id={`l${uid}`} x1="0" x2="1" y1="0" y2="0">
          <stop offset="0%" stopColor={b} />
          <stop offset="55%" stopColor={a} />
          <stop offset="100%" stopColor={c} />
        </linearGradient>
        <linearGradient id={`f${uid}`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={a} stopOpacity="0.34" />
          <stop offset="100%" stopColor={a} stopOpacity="0" />
        </linearGradient>
        <radialGradient id={`h${uid}`}>
          <stop offset="0%" stopColor="#fff" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* heat guides: the wall's faint horizontal bands */}
      {[0.33, 0.55, 0.78].map(k => (
        <line key={k} className="wc__guide" x1={PAD_X} x2={width - PAD_X} y1={PAD_TOP + (1 - k) * (height - PAD_TOP - PAD_BOTTOM)} y2={PAD_TOP + (1 - k) * (height - PAD_TOP - PAD_BOTTOM)} />
      ))}
      <line className="wc__floor" x1={PAD_X - 6} x2={width - PAD_X + 6} y1={bottom} y2={bottom} />

      {n === 0 ? (
        <text className="wc__empty" x={width / 2} y={height / 2 + 4} textAnchor="middle">
          {t('wc.empty')}
        </text>
      ) : null}

      {n > 1 ? (
        <>
          <path className="wc__area" d={`${path} L${pts[n - 1].x.toFixed(1)} ${bottom} L${pts[0].x.toFixed(1)} ${bottom} Z`} fill={`url(#f${uid})`} />
          <path className="wc__line wc__line--glow" d={path} pathLength={1} stroke={`url(#l${uid})`} />
          <path className="wc__line" d={path} pathLength={1} stroke={`url(#l${uid})`} />
        </>
      ) : null}

      {pts.map(p => {
        const col = color(p.by)
        const hi = bright(p.by)
        const delay = { ['--d' as string]: `${p.i * step}ms` } as CSSProperties
        return (
          <g key={p.i} className={`wc__pt${hi ? ' is-bright' : ''}`} data-by={publicOnly ? undefined : p.by} style={delay}>
            <circle className="wc__halo" cx={p.x} cy={p.y} r={p.r * (hi ? 3.2 : 2.3)} fill={col} />
            {p.markers.includes('navi') ? <circle cx={p.x} cy={p.y} r={p.r + 3.6} fill="none" stroke="#FFD36B" strokeWidth="1.5" /> : null}
            {p.markers.includes('allKnow')
              ? PRISM.map((pc, k) => {
                  const rr = p.r + (p.markers.includes('navi') ? 7 : 5)
                  const a0 = (k / PRISM.length) * Math.PI * 2 - Math.PI / 2
                  const a1 = a0 + (Math.PI * 2) / PRISM.length - 0.18
                  return (
                    <path
                      key={pc}
                      d={`M${(p.x + rr * Math.cos(a0)).toFixed(2)} ${(p.y + rr * Math.sin(a0)).toFixed(2)} A${rr} ${rr} 0 0 1 ${(p.x + rr * Math.cos(a1)).toFixed(2)} ${(p.y + rr * Math.sin(a1)).toFixed(2)}`}
                      fill="none"
                      stroke={pc}
                      strokeWidth="1.7"
                      strokeLinecap="round"
                    />
                  )
                })
              : null}
            <circle className="wc__dot" cx={p.x} cy={p.y} r={p.r} fill={col} />
            {hi && !publicOnly ? <circle cx={p.x} cy={p.y} r={p.r * 0.5} fill="#FFF6D8" /> : null}
            <Markers p={p} />
          </g>
        )
      })}
    </svg>
  )
}

/** Small glyphs above a point: shift (turn arrow), toast (glass), join (door). */
function Markers({ p }: { p: P }) {
  const icons: JSX.Element[] = []
  let x = p.x
  const y = p.y - p.r - 10
  const list = p.markers.filter(m => m === 'shift' || m === 'toast' || m === 'join')
  x -= ((list.length - 1) * 11) / 2
  for (const m of list) {
    const cx = x
    if (m === 'shift')
      icons.push(
        <path
          key={m}
          className="wc__mk"
          d={`M${cx - 4} ${y + 3} q3 -7 8 -6 M${cx + 1.6} ${y - 5.4} l2.4 2.4 -3 1.6`}
          fill="none"
          stroke="#2EF2FF"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />,
      )
    else if (m === 'toast')
      icons.push(
        <path
          key={m}
          className="wc__mk"
          d={`M${cx - 3.4} ${y - 5} h6.8 l-.8 4.2 a2.6 2.6 0 0 1 -5.2 0 z M${cx} ${y + 1.8} v3.6 M${cx - 2.4} ${y + 5.4} h4.8`}
          fill="rgba(255,181,71,.35)"
          stroke="#FFB547"
          strokeWidth="1.3"
          strokeLinejoin="round"
          strokeLinecap="round"
        />,
      )
    else
      icons.push(
        <g key={m} className="wc__mk">
          <rect x={cx - 3.4} y={y - 5.5} width="6.8" height="10" rx="1.4" fill="rgba(61,245,200,.2)" stroke="#3DF5C8" strokeWidth="1.3" />
          <circle cx={cx + 1.4} cy={y} r="0.9" fill="#3DF5C8" />
        </g>,
      )
    x += 11
  }
  return <>{icons}</>
}
