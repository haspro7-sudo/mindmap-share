// Generated cover art for a song: no images, just SVG shapes seeded by the song id.
import { memo, useMemo } from 'react'
import { palette, patternFor, type ArtPattern } from '../lib/art'
import { mulberry32, hashString } from '../lib/rng'
import './songArt.css'

type Props = {
  seed: string
  energy?: number
  pattern?: ArtPattern
  animate?: boolean
  className?: string
  /** 0..1 extra glow, e.g. while a card is being dragged toward "keep" */
  charge?: number
}

function SongArtImpl({ seed, energy = 0.5, pattern, animate = true, className, charge = 0 }: Props) {
  const p = useMemo(() => palette(seed, energy), [seed, energy])
  const kind = pattern ?? patternFor(seed)
  const uid = useMemo(() => 'a' + hashString(seed).toString(36), [seed])
  const shapes = useMemo(() => buildShapes(kind, seed, p), [kind, seed, p])
  return (
    <svg
      className={`song-art ${animate ? 'is-animated' : ''} ${className ?? ''}`}
      viewBox="0 0 400 400"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
      style={{ ['--charge' as string]: charge }}
    >
      <defs>
        <radialGradient id={`${uid}-bg`} cx="30%" cy="20%" r="100%">
          <stop offset="0%" stopColor={p.a} stopOpacity="0.85" />
          <stop offset="45%" stopColor={p.mid} />
          <stop offset="100%" stopColor={p.deep} />
        </radialGradient>
        <linearGradient id={`${uid}-a`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={p.a} />
          <stop offset="100%" stopColor={p.c} />
        </linearGradient>
        <linearGradient id={`${uid}-b`} x1="1" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={p.b} stopOpacity="0.9" />
          <stop offset="100%" stopColor={p.a} stopOpacity="0.2" />
        </linearGradient>
        {/* Soft glows as radial gradients: no SVG filters, so animation stays cheap on phones. */}
        <radialGradient id={`${uid}-ga`}>
          <stop offset="0%" stopColor={p.a} stopOpacity="0.7" />
          <stop offset="100%" stopColor={p.a} stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`${uid}-gb`}>
          <stop offset="0%" stopColor={p.b} stopOpacity="0.65" />
          <stop offset="100%" stopColor={p.b} stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="400" height="400" fill={`url(#${uid}-bg)`} />
      <g className="art-glow">
        <circle cx="110" cy="100" r="170" fill={`url(#${uid}-ga)`} />
        <circle cx="310" cy="310" r="200" fill={`url(#${uid}-gb)`} />
      </g>
      <g className={`art-layer art-${kind}`}>
        {shapes.map((s, i) => (
          <g key={i} className={s.cls} style={s.style}>
            {s.el(uid)}
          </g>
        ))}
      </g>
    </svg>
  )
}

type Shape = { cls: string; style?: React.CSSProperties; el: (uid: string) => React.ReactNode }

function buildShapes(kind: ArtPattern, seed: string, p: ReturnType<typeof palette>): Shape[] {
  const r = mulberry32(hashString(seed + kind))
  const shapes: Shape[] = []
  switch (kind) {
    case 'orbits': {
      const cx = 160 + r() * 80
      const cy = 160 + r() * 80
      for (let i = 0; i < 6; i++) {
        const rad = 40 + i * 32 + r() * 10
        const dash = 20 + r() * 120
        shapes.push({
          cls: `spin ${i % 2 ? 'rev' : ''}`,
          style: { transformOrigin: `${cx}px ${cy}px`, animationDuration: `${14 + i * 5}s` },
          el: uid => (
            <circle cx={cx} cy={cy} r={rad} fill="none" stroke={`url(#${uid}-a)`} strokeWidth={2 + (6 - i)} strokeDasharray={`${dash} ${dash / 2}`} strokeLinecap="round" opacity={0.85 - i * 0.1} />
          ),
        })
      }
      shapes.push({ cls: 'pulse', style: { transformOrigin: `${cx}px ${cy}px` }, el: () => <circle cx={cx} cy={cy} r={18} fill={p.c} /> })
      break
    }
    case 'waves': {
      for (let i = 0; i < 7; i++) {
        const amp = 18 + r() * 40
        const y = 70 + i * 45
        const freq = 1 + r() * 2
        let d = `M -40 ${y}`
        for (let x = -40; x <= 440; x += 20) d += ` L ${x} ${y + Math.sin((x / 400) * Math.PI * 2 * freq + i) * amp}`
        const sw = 3 + r() * 6
        shapes.push({
          cls: 'drift',
          style: { animationDuration: `${6 + i}s`, animationDelay: `${-i * 0.7}s` },
          el: uid => <path d={d} fill="none" stroke={i % 2 ? `url(#${uid}-b)` : `url(#${uid}-a)`} strokeWidth={sw} strokeLinecap="round" opacity={0.9 - i * 0.08} />,
        })
      }
      break
    }
    case 'prism': {
      for (let i = 0; i < 9; i++) {
        const x = r() * 400
        const y = r() * 400
        const s = 60 + r() * 140
        const rot = r() * 360
        const pts = [0, 120, 240].map(a => {
          const rad = ((a + rot) * Math.PI) / 180
          return `${x + Math.cos(rad) * s},${y + Math.sin(rad) * s}`
        })
        const op = 0.25 + r() * 0.35
        shapes.push({
          cls: `float ${i % 3 === 0 ? 'rev' : ''}`,
          style: { transformOrigin: `${x}px ${y}px`, animationDuration: `${8 + (i % 4) * 2}s` },
          el: uid => <polygon points={pts.join(' ')} fill={i % 2 ? `url(#${uid}-a)` : `url(#${uid}-b)`} opacity={op} style={{ mixBlendMode: 'screen' }} />,
        })
      }
      break
    }
    case 'bloom': {
      const cx = 200
      const cy = 200
      const petals = 8 + Math.floor(r() * 6)
      for (let ring = 0; ring < 3; ring++) {
        const len = 170 - ring * 45
        shapes.push({
          cls: `spin ${ring % 2 ? 'rev' : ''}`,
          style: { transformOrigin: `${cx}px ${cy}px`, animationDuration: `${30 + ring * 12}s` },
          el: uid => (
            <g>
              {Array.from({ length: petals }, (_, k) => (
                <ellipse
                  key={k}
                  cx={cx}
                  cy={cy - len / 2}
                  rx={len / 5}
                  ry={len / 2}
                  transform={`rotate(${(360 / petals) * k + ring * 12} ${cx} ${cy})`}
                  fill={ring === 1 ? `url(#${uid}-b)` : `url(#${uid}-a)`}
                  opacity={0.32 + ring * 0.12}
                  style={{ mixBlendMode: 'screen' }}
                />
              ))}
            </g>
          ),
        })
      }
      shapes.push({ cls: 'pulse', style: { transformOrigin: `${cx}px ${cy}px` }, el: () => <circle cx={cx} cy={cy} r={22} fill={p.c} /> })
      break
    }
    case 'sunset': {
      const horizon = 250 + r() * 30
      shapes.push({
        cls: 'pulse slow',
        style: { transformOrigin: `200px ${horizon}px` },
        el: uid => (
          <g>
            <circle cx={200} cy={horizon - 20} r={110} fill={`url(#${uid}-a)`} />
            {Array.from({ length: 6 }, (_, k) => (
              <rect key={k} x={80} y={horizon - 80 + k * 16} width={240} height={4 + k * 1.5} fill={p.deep} />
            ))}
          </g>
        ),
      })
      shapes.push({
        cls: 'grid-scroll',
        el: () => (
          <g opacity={0.8}>
            {Array.from({ length: 10 }, (_, k) => (
              <line key={'h' + k} x1={0} x2={400} y1={horizon + k * k * 3 + 4} y2={horizon + k * k * 3 + 4} stroke={p.c} strokeWidth={1.2} />
            ))}
            {Array.from({ length: 13 }, (_, k) => (
              <line key={'v' + k} x1={200} y1={horizon} x2={-400 + k * 100} y2={400} stroke={p.c} strokeWidth={1} opacity={0.7} />
            ))}
          </g>
        ),
      })
      break
    }
    case 'bubbles': {
      for (let i = 0; i < 14; i++) {
        const x = r() * 400
        const y = r() * 400
        const rad = 12 + r() * 70
        const op = 0.3 + r() * 0.4
        shapes.push({
          cls: 'rise',
          style: { animationDuration: `${7 + r() * 8}s`, animationDelay: `${-r() * 8}s` },
          el: uid => <circle cx={x} cy={y} r={rad} fill={i % 3 ? `url(#${uid}-b)` : `url(#${uid}-a)`} opacity={op} style={{ mixBlendMode: 'screen' }} />,
        })
      }
      break
    }
  }
  return shapes
}

export const SongArt = memo(SongArtImpl)
