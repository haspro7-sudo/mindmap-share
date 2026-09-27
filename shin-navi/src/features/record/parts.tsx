// Small visual parts shared by the record screen, the sheets and the wrap: face swatches in the
// four states, mark glyphs, pin enamel badges, the calendar stamp (a tiny mirror ball in the
// night's colours with its constellation) and section headings. Pure SVG/CSS, no images.
import { useId, type CSSProperties, type ReactNode } from 'react'
import type { FaceMark, FaceState, Night, PinId, SongId } from '../../core/types'
import { SONG_BY_ID } from '../../data/songs'
import { areaColor } from '../../core/rules'
import { hashString, mulberry32 } from '../../lib/rng'
import { displayPalette } from './nightName'

// ---------------------------------------------------------------- section heading

export function SectionHead({ label, title, aside, sub }: { label: string; title: string; aside?: ReactNode; sub?: string }) {
  return (
    <header className="rc-sec__head">
      <div className="rc-sec__row">
        <span className="rc-lbl">{label}</span>
        <h3 className="rc-sec__title">{title}</h3>
        {aside != null ? <span className="rc-sec__aside">{aside}</span> : null}
      </div>
      {sub ? <p className="rc-sec__sub">{sub}</p> : null}
    </header>
  )
}

// ---------------------------------------------------------------- face swatch

export const colorOfSong = (songId: SongId | undefined): string => {
  const s = songId ? SONG_BY_ID[songId] : undefined
  return s ? areaColor(s.genre) : '#8A6BFF'
}

export type SwatchState = FaceState | 'dark'

/** One ball face as a tile: sketch (silver outline), neon (area colour), mirror (chrome), prism (rainbow). */
export function FaceSwatch({
  state,
  songId,
  size = 28,
  marks,
  moon,
  className,
  style,
}: {
  state: SwatchState
  songId?: SongId
  size?: number
  marks?: FaceMark[]
  moon?: boolean
  className?: string
  style?: CSSProperties
}) {
  const c = colorOfSong(songId)
  return (
    <span className={`rc-face rc-face--${state}${className ? ` ${className}` : ''}`} style={{ width: size, height: size, ['--c' as string]: c, ...style } as CSSProperties} aria-hidden="true">
      {state === 'prism' ? <i className="rc-face__prism" /> : null}
      {state === 'mirror' || state === 'prism' ? <i className="rc-face__glint" /> : null}
      {marks?.includes('gold') ? <i className="rc-face__gold" /> : null}
      {marks?.includes('duet') ? <i className="rc-face__duet" /> : null}
      {marks?.includes('navi') ? <i className="rc-face__navi" /> : null}
      {moon ? (
        <svg className="rc-face__moon" viewBox="0 0 16 16">
          <path d="M10.8 2.6a5.6 5.6 0 1 0 2.6 8.1a4.6 4.6 0 0 1-2.6-8.1z" fill="#F6E7B0" />
        </svg>
      ) : null}
    </span>
  )
}

// ---------------------------------------------------------------- mark glyphs (D-3 marks)

export const MARKS: FaceMark[] = ['key', 'stitch', 'duet', 'seal', 'visa', 'navi', 'gold', 'twin']

export function MarkGlyph({ mark, size = 22 }: { mark: FaceMark; size?: number }) {
  const common = { width: size, height: size, viewBox: '0 0 24 24', 'aria-hidden': true as const, className: `rc-mark rc-mark--${mark}` }
  switch (mark) {
    case 'key':
      return (
        <svg {...common}>
          <rect x="3" y="3" width="18" height="18" rx="4" fill="rgba(125,249,255,.12)" stroke="#7DF9FF" strokeWidth="1.4" />
          <path d="M10 6.5v10.5M10 12.6c2.6-2.2 5.2-1.2 4.6 1.2c-.5 1.8-2.6 2.7-4.6 3.2" fill="none" stroke="#E9FDFF" strokeWidth="1.7" strokeLinecap="round" />
        </svg>
      )
    case 'stitch':
      return (
        <svg {...common}>
          <rect x="3" y="3" width="18" height="18" rx="4" fill="rgba(201,204,216,.14)" stroke="#C9CCD8" strokeWidth="1.2" />
          <rect x="6.5" y="6.5" width="11" height="11" rx="2" fill="none" stroke="#F1F3FA" strokeWidth="1.5" strokeDasharray="2.2 2" />
        </svg>
      )
    case 'duet':
      return (
        <svg {...common}>
          <path d="M5 3h14a2 2 0 0 1 2 2v14z" fill="#FF6FB1" />
          <path d="M3 5a2 2 0 0 1 2-2L21 19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" fill="#3DF5C8" />
          <path d="M4 4l16 16" stroke="#0B0620" strokeWidth="1.2" />
        </svg>
      )
    case 'seal':
      return (
        <svg {...common}>
          <path d="M12 2.6l2 1.6 2.5-.4 1 2.3 2.3 1-.4 2.5 1.6 2-1.6 2 .4 2.5-2.3 1-1 2.3-2.5-.4-2 1.6-2-1.6-2.5.4-1-2.3-2.3-1 .4-2.5-1.6-2 1.6-2-.4-2.5 2.3-1 1-2.3 2.5.4z" fill="#C8264F" />
          <circle cx="12" cy="12" r="4.6" fill="none" stroke="#FF9AB5" strokeWidth="1.3" />
          <path d="M10 12.2l1.4 1.4 2.8-3" fill="none" stroke="#FFE3EA" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )
    case 'visa':
      return (
        <svg {...common}>
          <rect x="3" y="5" width="18" height="14" rx="2.5" fill="rgba(198,255,61,.1)" stroke="#C6FF3D" strokeWidth="1.3" strokeDasharray="2.4 1.6" />
          <circle cx="9" cy="12" r="3" fill="none" stroke="#C6FF3D" strokeWidth="1.3" />
          <path d="M14 10h4M14 12.5h3M14 15h4" stroke="#E8FFB0" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
      )
    case 'navi':
      return (
        <svg {...common}>
          <rect x="3" y="3" width="18" height="18" rx="4" fill="rgba(255,211,107,.08)" stroke="rgba(255,211,107,.4)" strokeWidth="1.2" />
          <circle cx="17" cy="7" r="3.4" fill="#FFD36B" />
          <circle cx="16.2" cy="6.2" r="1.1" fill="#FFF6D8" />
        </svg>
      )
    case 'gold':
      return (
        <svg {...common}>
          <rect x="3.5" y="3.5" width="17" height="17" rx="3.5" fill="rgba(255,211,107,.12)" stroke="#FFD36B" strokeWidth="2.4" />
          <rect x="7.5" y="7.5" width="9" height="9" rx="1.5" fill="rgba(255,246,216,.5)" />
        </svg>
      )
    case 'twin':
      return (
        <svg {...common}>
          <rect x="3" y="3" width="18" height="18" rx="4" fill="rgba(138,107,255,.12)" stroke="rgba(138,107,255,.55)" strokeWidth="1.2" />
          <circle cx="9.5" cy="12" r="2.6" fill="#E9E4FF" />
          <circle cx="15" cy="12" r="2.6" fill="none" stroke="#E9E4FF" strokeWidth="1.4" />
        </svg>
      )
  }
}

// ---------------------------------------------------------------- pins (D-10)

export const PIN_TINT: Record<PinId, [string, string]> = {
  spark: ['#FFB547', '#FF6A3D'],
  allKnow: ['#FF3DA8', '#2EF2FF'],
  airRead: ['#2EF2FF', '#5B6CFF'],
  crossing: ['#C6FF3D', '#2EC4A6'],
  harmony: ['#C77DFF', '#FF6FB1'],
  answer: ['#FF6FB1', '#C8264F'],
  importer: ['#E9ECF5', '#8C92AC'],
  polish: ['#9DB4FF', '#F6E7B0'],
  hundred: ['#FFD36B', '#FF9F1C'],
  faces30: ['#FF3DA8', '#8A6BFF'],
}

function PinPath({ id }: { id: PinId }) {
  const s = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.9, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  switch (id) {
    case 'spark':
      return (
        <>
          <path d="M12 3.5c1.2 3 4.8 4.8 4.8 9.2a4.8 4.8 0 0 1-9.6 0c0-2.2 1.2-3.6 2.4-4.6c.2 1.6.9 2.6 1.9 3c-.5-2.6.1-5 .5-7.6z" {...s} />
          <path d="M12 17.8a1.8 1.8 0 0 1-1.8-1.8c0-1.2 1.1-1.8 1.8-3c.7 1.2 1.8 1.8 1.8 3a1.8 1.8 0 0 1-1.8 1.8z" fill="currentColor" />
        </>
      )
    case 'allKnow':
      return (
        <>
          <circle cx="12" cy="12" r="7.6" {...s} strokeDasharray="1 3.2" />
          <circle cx="12" cy="4.6" r="1.9" fill="currentColor" />
          <circle cx="19.4" cy="12" r="1.9" fill="currentColor" />
          <circle cx="12" cy="19.4" r="1.9" fill="currentColor" />
          <circle cx="4.6" cy="12" r="1.9" fill="currentColor" />
          <path d="M9.4 12.2l1.8 1.8 3.6-3.8" {...s} />
        </>
      )
    case 'airRead':
      return (
        <>
          <path d="M3.5 15c2.2 0 2.2-3 4.3-3s2.2 3 4.3 3s2.2-6 4.3-6" {...s} />
          <path d="M16.4 5.5h3.6v3.6M20 5.5l-4 4" {...s} />
        </>
      )
    case 'crossing':
      return (
        <>
          <rect x="5.5" y="3.5" width="13" height="17" rx="2" {...s} />
          <circle cx="12" cy="10.5" r="3.4" {...s} strokeWidth={1.5} />
          <path d="M8.6 10.5h6.8M12 7.1c-1.2 1.1-1.2 5.7 0 6.8M12 7.1c1.2 1.1 1.2 5.7 0 6.8" {...s} strokeWidth={1.1} />
          <path d="M9 16.8h6" {...s} />
        </>
      )
    case 'harmony':
      return (
        <>
          <circle cx="9.4" cy="12" r="5.2" {...s} />
          <circle cx="14.6" cy="12" r="5.2" {...s} />
        </>
      )
    case 'answer':
      return (
        <>
          <rect x="3.8" y="6" width="16.4" height="12" rx="2" {...s} />
          <path d="M4.4 7l7.6 6l7.6-6" {...s} />
          <circle cx="12" cy="15.6" r="2.2" fill="currentColor" />
        </>
      )
    case 'importer':
      return (
        <>
          <circle cx="12" cy="12" r="7.6" {...s} strokeDasharray="2.2 2" />
          <circle cx="12" cy="12" r="2.4" fill="currentColor" />
          <path d="M16.5 4.5l3 3" {...s} />
        </>
      )
    case 'polish':
      return (
        <>
          <path d="M14.5 4.2a7.4 7.4 0 1 0 5.3 10.8a6 6 0 0 1-5.3-10.8z" {...s} />
          <path d="M18 3.6l.6 1.5 1.5.6-1.5.6-.6 1.5-.6-1.5-1.5-.6 1.5-.6z" fill="currentColor" />
        </>
      )
    case 'hundred':
      return (
        <text x="12" y="15.6" textAnchor="middle" fontSize="9.6" fontWeight="900" fill="currentColor" style={{ letterSpacing: '-0.04em' }}>
          100
        </text>
      )
    case 'faces30':
      return (
        <>
          <circle cx="12" cy="12" r="8" {...s} />
          <path d="M5.2 8.2h13.6M4 12h16M5.2 15.8h13.6" {...s} strokeWidth={1.1} />
          <path d="M9.2 4.6v14.8M14.8 4.6v14.8" {...s} strokeWidth={1.1} />
          <rect x="9.6" y="8.6" width="4.8" height="3" fill="currentColor" />
          <rect x="15.1" y="12.4" width="3" height="3" fill="currentColor" />
          <rect x="6" y="12.4" width="2.8" height="3" fill="currentColor" opacity="0.6" />
        </>
      )
  }
}

/** Enamel pin: glowing when earned, an outline when not (the condition is shown next to it). */
export function PinBadge({ id, earned, size = 48 }: { id: PinId; earned: boolean; size?: number }) {
  const [a, b] = PIN_TINT[id]
  return (
    <span className={`rc-pinb${earned ? ' is-earned' : ''}`} style={{ width: size, height: size, ['--pa' as string]: a, ['--pb' as string]: b } as CSSProperties} aria-hidden="true">
      {earned ? <i className="rc-pinb__glow" /> : null}
      <i className="rc-pinb__disc" />
      <svg className="rc-pinb__glyph" viewBox="0 0 24 24" width={Math.round(size * 0.56)} height={Math.round(size * 0.56)}>
        <PinPath id={id} />
      </svg>
    </span>
  )
}

// ---------------------------------------------------------------- the stamp (D-9)

/** Normalised constellation of a night (0..1 in x and y) for the stamp silhouette. */
export function silhouette(n: Pick<Night, 'points'>): { x: number; y: number }[] {
  const pts = n.points
  if (!pts.length) return []
  const t0 = pts[0].t
  const t1 = pts[pts.length - 1].t
  const span = Math.max(1e-6, t1 - t0)
  const idx = pts.length <= 14 ? pts.map((_, i) => i) : Array.from({ length: 14 }, (_, k) => Math.round((k * (pts.length - 1)) / 13))
  return idx.map(i => ({ x: pts.length === 1 ? 0.5 : (pts[i].t - t0) / span, y: 1 - Math.max(0, Math.min(1, pts[i].heat)) }))
}

/**
 * The calendar stamp: a small mirror ball in the night's palette with the night's constellation
 * drawn over it, inside a slightly rough ink ring. Deterministic per night id.
 */
export function StampArt({ night, size = 44, className, style }: { night: Pick<Night, 'id' | 'palette' | 'points'>; size?: number; className?: string; style?: CSSProperties }) {
  const uid = useId().replace(/:/g, '')
  const [a, b, c] = displayPalette(night)
  const rnd = mulberry32(hashString(`stamp|${night.id}`))
  const tilt = Math.round((rnd() - 0.5) * 22)
  // rough ink ring
  const ring: string[] = []
  const N = 28
  for (let i = 0; i <= N; i++) {
    const ang = (i / N) * Math.PI * 2
    const r = 45 + (rnd() - 0.5) * 2.6
    ring.push(`${i ? 'L' : 'M'}${(50 + r * Math.cos(ang)).toFixed(1)} ${(50 + r * Math.sin(ang)).toFixed(1)}`)
  }
  const sil = silhouette(night)
  const pts = sil.map(p => ({ x: 26 + p.x * 48, y: 34 + p.y * 32 }))
  const tiles = Array.from({ length: 5 }, () => ({ x: 30 + rnd() * 36, y: 28 + rnd() * 40, o: 0.35 + rnd() * 0.5 }))
  return (
    <svg className={`rc-stamp${className ? ` ${className}` : ''}`} width={size} height={size} viewBox="0 0 100 100" style={style} aria-hidden="true">
      <defs>
        <radialGradient id={`g${uid}`} cx="38%" cy="32%" r="75%">
          <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.95" />
          <stop offset="22%" stopColor={b} />
          <stop offset="62%" stopColor={a} />
          <stop offset="100%" stopColor="#0B0620" />
        </radialGradient>
        <clipPath id={`c${uid}`}>
          <circle cx="50" cy="50" r="33" />
        </clipPath>
      </defs>
      <g transform={`rotate(${tilt} 50 50)`}>
        <path d={ring.join('') + 'Z'} fill="none" stroke={c} strokeWidth="4.2" strokeLinejoin="round" opacity="0.92" />
        <circle cx="50" cy="50" r="39.5" fill="none" stroke={a} strokeWidth="1.2" strokeDasharray="2 3.2" opacity="0.8" />
        <circle cx="50" cy="50" r="33" fill={`url(#g${uid})`} />
        <g clipPath={`url(#c${uid})`} stroke="rgba(11,6,32,.42)" strokeWidth="1.1" fill="none">
          <ellipse cx="50" cy="50" rx="33" ry="11" />
          <ellipse cx="50" cy="50" rx="33" ry="23" />
          <path d="M17 50h66" />
          <ellipse cx="50" cy="50" rx="11" ry="33" />
          <ellipse cx="50" cy="50" rx="23" ry="33" />
          <path d="M50 17v66" />
          {tiles.map((t, i) => (
            <rect key={i} x={t.x} y={t.y} width="6" height="5" fill="#fff" stroke="none" opacity={t.o} />
          ))}
        </g>
        {pts.length > 1 ? (
          <polyline points={pts.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')} fill="none" stroke="#FFF6D8" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" opacity="0.95" />
        ) : null}
        {pts.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r="2.6" fill="#FFF6D8" />
        ))}
      </g>
    </svg>
  )
}

// ---------------------------------------------------------------- misc

/** "−2" / "+1" / original, from a key shift. */
export function keyText(shift: number, t: (k: string, v?: Record<string, string | number>) => string): string {
  if (!shift) return t('face.keyOrig')
  return shift < 0 ? t('face.keyDown', { n: Math.abs(shift) }) : t('face.keyUp', { n: shift })
}

export const FACE_STATES: FaceState[] = ['sketch', 'neon', 'mirror', 'prism']
