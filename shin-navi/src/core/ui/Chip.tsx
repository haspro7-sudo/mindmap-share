// Tag chips. solid = evidence ("根拠", facts about the song); dotted = hypothesis
// ("ナビの見立て", Navi's read) — the dashed outline is the visual promise that it is a guess.
import type { CSSProperties, ReactNode } from 'react'
import './kit.css'

export type ChipProps = {
  children?: ReactNode
  /** evidence style (default) */
  solid?: boolean
  /** hypothesis style: dashed outline, dimmer ink */
  dotted?: boolean
  /** accent colour (member, area, …) for the leading dot */
  color?: string
  size?: 'sm' | 'md'
  active?: boolean
  onClick?: () => void
  className?: string
  style?: CSSProperties
  testid?: string
  title?: string
}

export function Chip({ children, dotted, color, size = 'md', active, onClick, className, style, testid, title }: ChipProps) {
  const cls = ['chip', dotted ? 'chip--dotted' : 'chip--solid', `chip--${size}`, active ? 'is-active' : '', onClick ? 'is-button' : '', className ?? ''].filter(Boolean).join(' ')
  const content = (
    <>
      {color ? <span className="chip__dot" style={{ background: color }} aria-hidden="true" /> : dotted ? <span className="chip__hyp" aria-hidden="true" /> : null}
      <span className="chip__text">{children}</span>
    </>
  )
  if (onClick) {
    return (
      <button type="button" className={cls} style={style} onClick={onClick} data-testid={testid} title={title} aria-pressed={active ?? undefined}>
        {content}
      </button>
    )
  }
  return (
    <span className={cls} style={style} data-testid={testid} title={title}>
      {content}
    </span>
  )
}
