// Song titles in the viewing language (SPEC G-4). The original title is always visible:
// ja shows it alone; other locales show the local title big and the original (+ romaji) small.
// visa cards show local and original at the same size, on two lines, with romaji underneath.
import { useLayoutEffect, useRef, type CSSProperties, type ReactNode } from 'react'
import { songTitle, useLocale } from '../../i18n'
import { useBox } from '../layout'
import './kit.css'

export type SongTitleVariant = 'card' | 'chip' | 'lane' | 'visa'

export type SongTitleProps = {
  songId: string
  variant?: SongTitleVariant
  /** max font size in px for card/visa (default: clamp(26, 7.5% of the box width, 40)) */
  max?: number
  /** min font size when auto-shrinking */
  min?: number
  className?: string
  style?: CSSProperties
}

/** Shrinks its text until it fits in `lines` lines (measured once per text/width change). */
function FitText({ children, lines, max, min, className }: { children: ReactNode; lines: number; max: number; min: number; className: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const key = typeof children === 'string' ? children : ''
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const fit = () => {
      let size = max
      el.style.fontSize = `${size}px`
      const lh = parseFloat(getComputedStyle(el).lineHeight) / size || 1.12
      while (size > min && el.scrollHeight > Math.ceil(size * lh * lines) + 2) {
        size -= 1
        el.style.fontSize = `${size}px`
      }
    }
    fit()
    if (typeof ResizeObserver === 'undefined') return
    let w = el.clientWidth
    const ro = new ResizeObserver(() => {
      if (el.clientWidth !== w) {
        w = el.clientWidth
        fit()
      }
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [key, lines, max, min])
  return (
    <div ref={ref} className={className} style={{ fontSize: max }}>
      {children}
    </div>
  )
}

export function SongTitle({ songId, variant = 'card', max, min = 18, className, style }: SongTitleProps) {
  const l = useLocale()
  const box = useBox()
  const t = songTitle(songId, l)
  const big = max ?? Math.round(Math.min(40, Math.max(26, box.w * 0.075)))

  if (variant === 'chip' || variant === 'lane') {
    return (
      <span className={`st st--${variant} ${className ?? ''}`} style={style} lang={l === 'ja' ? 'ja' : undefined} title={t.sub ? `${t.main} / ${t.original}` : t.main}>
        {t.main}
      </span>
    )
  }

  if (variant === 'visa') {
    const same = t.main === t.original
    return (
      <div className={`st st--visa ${className ?? ''}`} style={style}>
        <FitText lines={same ? 1 : 2} max={Math.round(big * 0.86)} min={min} className="st__fit st__fit--visa">
          <span className="st__line" lang="ja">
            {t.original}
          </span>
          {!same ? <span className="st__line st__line--local">{t.main}</span> : null}
        </FitText>
        {t.romaji ? <div className="st__romaji">{t.romaji}</div> : null}
      </div>
    )
  }

  // card
  const subParts = l === 'ja' ? [] : [t.sub, l === 'en' ? null : t.romaji].filter((x): x is string => !!x && x !== t.main)
  return (
    <div className={`st st--card ${className ?? ''}`} style={style}>
      <FitText lines={2} max={big} min={min} className="st__fit">
        {t.main}
      </FitText>
      {subParts.length ? (
        <div className="st__sub">
          {subParts.map((s, i) => (
            <span key={i} lang={i === 0 ? 'ja' : undefined}>
              {s}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  )
}
