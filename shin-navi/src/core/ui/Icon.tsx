// Inline SVG icon set (no image assets). Stroke icons on a 24 grid, coloured by currentColor.
import type { CSSProperties } from 'react'

export type IconName =
  | 'search'
  | 'sing'
  | 'record'
  | 'order'
  | 'lock'
  | 'globe'
  | 'speaker'
  | 'mute'
  | 'key'
  | 'glass'
  | 'sparkle'
  | 'undo'
  | 'chevron'
  | 'close'
  | 'people'
  | 'plus'

const PATHS: Record<IconName, string[]> = {
  search: ['M10.5 4a6.5 6.5 0 1 1 0 13a6.5 6.5 0 0 1 0-13z', 'M15.4 15.4L20 20'],
  sing: ['M12 3a3 3 0 0 1 3 3v5a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3z', 'M6 11a6 6 0 0 0 12 0', 'M12 17v4', 'M9 21h6'],
  record: ['M12 4a8 8 0 1 1 0 16a8 8 0 0 1 0-16z', 'M4.6 9h14.8', 'M4.6 15h14.8', 'M12 4c-2.6 2.3-2.6 13.7 0 16', 'M12 4c2.6 2.3 2.6 13.7 0 16'],
  order: ['M6 5h12l-1.5 13.3a2 2 0 0 1-2 1.7H9.5a2 2 0 0 1-2-1.7L6 5z', 'M6.6 10h10.8', 'M13.5 5l2.2-3'],
  lock: ['M7 11h10a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2z', 'M8 11V8a4 4 0 0 1 8 0v3'],
  globe: ['M12 3.5a8.5 8.5 0 1 1 0 17a8.5 8.5 0 0 1 0-17z', 'M12 3.5c-2.7 2.4-2.7 14.6 0 17', 'M12 3.5c2.7 2.4 2.7 14.6 0 17', 'M3.9 9.5h16.2', 'M3.9 14.5h16.2'],
  speaker: ['M4 9.5h3.5L12 5.5v13l-4.5-4H4z', 'M15.5 9.2a4 4 0 0 1 0 5.6', 'M18 6.7a7.5 7.5 0 0 1 0 10.6'],
  mute: ['M4 9.5h3.5L12 5.5v13l-4.5-4H4z', 'M16 9.5l5 5', 'M21 9.5l-5 5'],
  key: ['M8 8.5a3.5 3.5 0 1 1 0 7a3.5 3.5 0 0 1 0-7z', 'M11.5 12H20', 'M17 12v3', 'M20 12v2.5'],
  glass: ['M8 3h8l-.6 5.2a3.4 3.4 0 0 1-6.8 0L8 3z', 'M12 11.6V20', 'M8.5 20.5h7'],
  sparkle: ['M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z', 'M18.5 16l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z'],
  undo: ['M9 6.5L4.5 11 9 15.5', 'M5 11h9.5a4.5 4.5 0 0 1 0 9H11'],
  chevron: ['M9 5.5l6.5 6.5L9 18.5'],
  close: ['M6.5 6.5l11 11', 'M17.5 6.5l-11 11'],
  people: ['M9 5.3a3.2 3.2 0 1 1 0 6.4a3.2 3.2 0 0 1 0-6.4z', 'M3.5 19c.6-3.3 2.8-5 5.5-5s4.9 1.7 5.5 5', 'M16.4 7a2.6 2.6 0 1 1 0 5.2', 'M16.2 14.2c2.4-.1 4.2 1.4 4.8 4.3'],
  plus: ['M12 5v14', 'M5 12h14'],
}

export type IconProps = {
  name: IconName
  size?: number
  strokeWidth?: number
  className?: string
  style?: CSSProperties
  /** accessible label; icons are decorative (aria-hidden) when omitted */
  title?: string
}

export function Icon({ name, size = 20, strokeWidth = 1.8, className, style, title }: IconProps) {
  return (
    <svg
      className={className ? `icon ${className}` : 'icon'}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={style}
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
      aria-label={title}
      data-icon={name}
    >
      {PATHS[name].map((d, i) => (
        <path key={i} d={d} />
      ))}
    </svg>
  )
}
