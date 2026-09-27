// Generated menu glyphs (no image assets): glasses with liquid, ice and bubbles, a fries box,
// a karaage plate, a crescent for the breather. Colours come from the item's hue. The liquid level
// and the slosh are CSS transforms on SVG groups (transform-box: fill-box), bubbles are small
// transform/opacity loops that only run while the glyph is "live".
import { memo, useId, type CSSProperties } from 'react'
import type { MenuItem } from './menu'

type GlassShape = { top: [number, number]; bottom: [number, number]; y0: number; y1: number }

const TALL: GlassShape = { top: [19, 45], bottom: [22, 42], y0: 7, y1: 58 }
const ROCKS: GlassShape = { top: [13, 51], bottom: [16, 48], y0: 20, y1: 57 }
const TUMBLER: GlassShape = { top: [16, 48], bottom: [19, 45], y0: 13, y1: 58 }

const SHAPE: Record<string, GlassShape> = { highball: TALL, ginger: TALL, cola: TALL, oolong: ROCKS, water: TUMBLER }

const hsl = (h: number, s: number, l: number, a = 1) => `hsla(${h}, ${s}%, ${l}%, ${a})`

function glassPath(g: GlassShape): string {
  const r = 3.2
  const [tl, tr] = g.top
  const [bl, br] = g.bottom
  return `M${tl},${g.y0} L${tr},${g.y0} L${br},${g.y1 - r} Q${br},${g.y1} ${br - r},${g.y1} L${bl + r},${g.y1} Q${bl},${g.y1} ${bl},${g.y1 - r} Z`
}

type GlyphProps = {
  item: MenuItem
  size?: number
  /** liquid level 0..1 (drinks) — ordered items fill up */
  level?: number
  /** bubbles / zz / steam loop */
  live?: boolean
  /** bump this to replay the slosh */
  slosh?: number
  className?: string
  style?: CSSProperties
}

function Drink({ item, level, live, slosh }: { item: MenuItem; level: number; live: boolean; slosh: number }) {
  const g = SHAPE[item.id] ?? TUMBLER
  // unique per instance: the same drink can be drawn in the menu, the tracker and a card at once
  const id = `gl-${item.id}-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
  const h = item.hue
  const dark = item.id === 'cola'
  const clear = item.id === 'water'
  const liquidTop = dark ? hsl(h, 70, 34) : clear ? hsl(h, 90, 82, 0.7) : hsl(h, 95, 64)
  const liquidBot = dark ? hsl(h, 60, 14) : clear ? hsl(h, 90, 62, 0.55) : hsl(h, 90, 44)
  const surface = g.y0 + 3
  const height = g.y1 - surface
  const fizzy = item.id === 'highball' || item.id === 'ginger' || item.id === 'cola'
  const bubbles = fizzy ? [0, 1, 2, 3] : clear ? [0, 1] : []
  return (
    <>
      <defs>
        <clipPath id={`${id}-clip`}>
          <path d={glassPath(g)} />
        </clipPath>
        <linearGradient id={`${id}-liq`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={liquidTop} />
          <stop offset="1" stopColor={liquidBot} />
        </linearGradient>
        <linearGradient id={`${id}-glass`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.2" />
          <stop offset="0.35" stopColor="#ffffff" stopOpacity="0.04" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0.14" />
        </linearGradient>
      </defs>
      {/* glow under the glass */}
      <ellipse cx="32" cy={g.y1 + 2.5} rx="17" ry="3.2" fill={hsl(h, 95, 60, 0.35)} />
      <path d={glassPath(g)} fill={`url(#${id}-glass)`} />
      <g clipPath={`url(#${id}-clip)`}>
        <g className="gl-slosh" key={slosh}>
          <g className="gl-liquid" style={{ ['--lvl' as string]: String(Math.max(0.12, Math.min(1, level))) } as CSSProperties}>
            <rect x="8" y={surface} width="48" height={height + 2} fill={`url(#${id}-liq)`} />
            <rect x="8" y={surface} width="48" height="2.2" fill="#ffffff" opacity={dark ? 0.35 : 0.55} />
            {item.id !== 'cola' ? (
              <>
                <rect x="24" y={surface + 5} width="9" height="9" rx="2" fill="#ffffff" opacity="0.32" transform={`rotate(-14 28 ${surface + 9})`} />
                <rect x="32.5" y={surface + 10} width="8" height="8" rx="2" fill="#ffffff" opacity="0.24" transform={`rotate(18 36 ${surface + 14})`} />
              </>
            ) : null}
          </g>
        </g>
        {bubbles.map(i => (
          <circle key={i} className={live ? 'gl-bub is-live' : 'gl-bub'} cx={25 + i * 4.6} cy={g.y1 - 5 - (i % 2) * 5} r={i % 2 ? 1.1 : 1.5} fill="#ffffff" style={{ ['--d' as string]: `${i * 0.37}s` } as CSSProperties} />
        ))}
      </g>
      {/* rim and outline */}
      <path d={glassPath(g)} fill="none" stroke="#ffffff" strokeOpacity="0.72" strokeWidth="1.5" strokeLinejoin="round" />
      <path d={`M${g.top[0] + 3},${g.y0 + 5} L${g.bottom[0] + 3.2},${g.y1 - 6}`} stroke="#ffffff" strokeOpacity="0.45" strokeWidth="1.6" strokeLinecap="round" />
      {item.id === 'highball' ? (
        // lemon wheel on the rim
        <g transform={`translate(${g.top[1] - 2} ${g.y0 + 1})`}>
          <circle r="6.2" fill="#fff4a8" stroke="#ffd84d" strokeWidth="1.4" />
          <path d="M0,-4.6 V4.6 M-4,-2.3 L4,2.3 M-4,2.3 L4,-2.3" stroke="#f5c400" strokeWidth="0.9" />
        </g>
      ) : null}
      {item.id === 'cola' ? (
        // a striped straw
        <g>
          <path d={`M36,${g.y1 - 8} L44,${g.y0 - 5} L49,${g.y0 - 8}`} fill="none" stroke="#ffffff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
          <path d={`M36,${g.y1 - 8} L44,${g.y0 - 5} L49,${g.y0 - 8}`} fill="none" stroke="#ff3d6e" strokeWidth="3" strokeDasharray="3 3" strokeLinecap="round" strokeLinejoin="round" />
        </g>
      ) : null}
      {item.id === 'ginger' ? (
        // mint leaf
        <path d={`M${g.top[0] + 2},${g.y0 + 1} q6,-9 13,-4 q-6,6 -13,4 z`} fill="#6dff9e" opacity="0.9" />
      ) : null}
      {item.id === 'water' ? (
        <path d="M49,9 q4,6 0,8.5 q-4,-2.5 0,-8.5 z" fill={hsl(h, 95, 78)} opacity="0.95" />
      ) : null}
    </>
  )
}

function Fries({ item }: { item: MenuItem }) {
  const h = item.hue
  const sticks = [
    [22, -8],
    [27, -3],
    [32, 4],
    [37, -6],
    [42, 7],
    [29, 10],
    [35, -12],
  ]
  return (
    <>
      <ellipse cx="32" cy="60" rx="17" ry="3" fill={hsl(h, 95, 60, 0.35)} />
      {sticks.map(([x, a], i) => (
        <rect key={i} x={x - 2.2} y={8 + (i % 3) * 3} width="4.4" height="30" rx="1.6" fill={hsl(h, 96, 64)} stroke={hsl(h, 90, 40)} strokeWidth="0.8" transform={`rotate(${a} ${x} 36)`} />
      ))}
      <path d="M17,27 L47,27 L43,58 L21,58 Z" fill="#ff3d6e" stroke="#ffffff" strokeOpacity="0.7" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M17,27 Q32,36 47,27" fill="#ff7a9a" stroke="#ffffff" strokeOpacity="0.55" strokeWidth="1.2" />
      <circle cx="32" cy="45" r="5.2" fill="none" stroke="#ffffff" strokeOpacity="0.8" strokeWidth="1.3" />
      <path d="M29.6,45 l1.6,1.7 3.2,-3.4" fill="none" stroke="#ffffff" strokeOpacity="0.8" strokeWidth="1.3" strokeLinecap="round" />
    </>
  )
}

function Karaage({ item, live }: { item: MenuItem; live: boolean }) {
  const h = item.hue
  const bits: [number, number, number][] = [
    [23, 39, 7.5],
    [34, 36, 8.2],
    [42, 43, 6.8],
    [29, 46, 7],
  ]
  return (
    <>
      <ellipse cx="32" cy="49" rx="25" ry="8.5" fill="#f3f0ff" opacity="0.92" />
      <ellipse cx="32" cy="47.5" rx="20" ry="5.6" fill="#ffffff" opacity="0.55" />
      <path d="M11,44 q7,-9 15,-3 q-7,4 -15,3 z" fill="#7dff8e" opacity="0.85" />
      {bits.map(([x, y, r], i) => (
        <g key={i}>
          <path
            d={`M${x - r},${y} q${r * 0.2},${-r * 1.1} ${r},${-r} q${r * 0.9},${r * 0.1} ${r},${r * 0.9} q${-r * 0.3},${r * 0.8} ${-r},${r * 0.7} q${-r * 0.8},${-r * 0.1} ${-r},${-r * 0.6} z`}
            fill={hsl(h, 88, 50)}
            stroke={hsl(h, 80, 30)}
            strokeWidth="0.9"
          />
          <circle cx={x - r * 0.25} cy={y - r * 0.4} r={r * 0.25} fill={hsl(h + 12, 100, 78)} opacity="0.75" />
        </g>
      ))}
      <path d="M44,33 a7,7 0 0 1 9,6 l-8,1 z" fill="#fff27a" stroke="#ffd84d" strokeWidth="1" />
      {[0, 1, 2].map(i => (
        <path key={i} className={live ? 'gl-steam is-live' : 'gl-steam'} d={`M${25 + i * 7},27 q-3,-5 0,-9 q3,-4 0,-8`} fill="none" stroke="#ffffff" strokeOpacity="0.55" strokeWidth="1.4" strokeLinecap="round" style={{ ['--d' as string]: `${i * 0.45}s` } as CSSProperties} />
      ))}
    </>
  )
}

function Rest({ item, live }: { item: MenuItem; live: boolean }) {
  const h = item.hue
  return (
    <>
      <circle cx="32" cy="33" r="21" fill={hsl(h, 90, 60, 0.16)} />
      <path d="M38,13 a20,20 0 1 0 12,32 a16,16 0 1 1 -12,-32 z" fill={hsl(h, 95, 78)} stroke="#ffffff" strokeOpacity="0.6" strokeWidth="1.2" />
      <circle cx="30" cy="27" r="1.8" fill={hsl(h, 70, 60)} opacity="0.6" />
      <circle cx="24" cy="38" r="2.4" fill={hsl(h, 70, 60)} opacity="0.5" />
      {[
        [49, 16, 1.4],
        [55, 27, 1],
        [44, 52, 1.2],
      ].map(([x, y, r], i) => (
        <circle key={i} cx={x} cy={y} r={r} fill="#ffffff" className={live ? 'gl-twinkle is-live' : 'gl-twinkle'} style={{ ['--d' as string]: `${i * 0.6}s` } as CSSProperties} />
      ))}
      <g className={live ? 'gl-zz is-live' : 'gl-zz'}>
        <text x="47" y="40" fontSize="9" fontWeight="900" fill="#ffffff" opacity="0.85">
          z
        </text>
        <text x="52" y="33" fontSize="6.5" fontWeight="900" fill="#ffffff" opacity="0.6">
          z
        </text>
      </g>
    </>
  )
}

function GlyphImpl({ item, size = 56, level = 0.55, live = false, slosh = 0, className, style }: GlyphProps) {
  return (
    <svg className={`gl gl--${item.kind}${className ? ` ${className}` : ''}`} width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" style={style} data-glyph={item.id}>
      {item.kind === 'drink' || item.kind === 'water' ? (
        <Drink item={item} level={level} live={live} slosh={slosh} />
      ) : item.id === 'fries' ? (
        <Fries item={item} />
      ) : item.id === 'karaage' ? (
        <Karaage item={item} live={live} />
      ) : (
        <Rest item={item} live={live} />
      )}
    </svg>
  )
}

export const Glyph = memo(GlyphImpl)
