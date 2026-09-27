// One small line glyph per card kind (label strip and peek teasers). Drawn in currentColor so
// the kind accent tints it; the opener keeps its breathing ember instead.
import type { GlyphId } from './frames'

export function KindGlyph({ id, size = 14 }: { id: GlyphId; size?: number }) {
  if (id === 'ember') return <span className="cs__ember" style={{ width: size + 2, height: size + 2 }} aria-hidden="true" />
  const p = { width: size, height: size, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true, className: 'kglyph', 'data-glyph': id }
  switch (id) {
    case 'note':
      return (
        <svg {...p}>
          <path d="M6 12.2V3.4l7-1.4v8.6" />
          <circle cx="4.3" cy="12.3" r="1.9" fill="currentColor" stroke="none" />
          <circle cx="11.3" cy="10.7" r="1.9" fill="currentColor" stroke="none" />
        </svg>
      )
    case 'globe':
      return (
        <svg {...p}>
          <circle cx="8" cy="8" r="6" />
          <path d="M2.2 8h11.6M8 2c1.8 1.7 2.6 3.7 2.6 6S9.8 12.3 8 14c-1.8-1.7-2.6-3.7-2.6-6S6.2 3.7 8 2z" />
        </svg>
      )
    case 'ask':
      return (
        <svg {...p}>
          <circle cx="8" cy="8" r="5.6" strokeDasharray="2.2 2.1" />
          <circle cx="8" cy="8" r="1.8" fill="currentColor" stroke="none" />
        </svg>
      )
    case 'welcome':
      return (
        <svg {...p}>
          <path d="M3 14V6.5a5 5 0 0 1 10 0V14" />
          <path d="M8 8.2v3.2M6.4 9.8h3.2" />
        </svg>
      )
    case 'shift':
      return (
        <svg {...p}>
          <path d="M2.5 11.5c2.2 0 3-1.6 3.9-3.5S8.8 4.5 11 4.5h2.6" />
          <path d="M11.6 2.4l2.1 2.1-2.1 2.1" />
        </svg>
      )
    case 'link':
      return (
        <svg {...p}>
          <circle cx="3.4" cy="11.8" r="1.7" fill="currentColor" stroke="none" />
          <circle cx="12.6" cy="4.2" r="1.7" fill="currentColor" stroke="none" />
          <circle cx="12.4" cy="12.2" r="1.3" fill="currentColor" stroke="none" />
          <path d="M4.8 10.6l6.4-5.2M4.9 12l6 .2" />
        </svg>
      )
    case 'voice':
      return (
        <svg {...p}>
          <path d="M5 2v5.2a3 3 0 0 0 6 0V2" />
          <path d="M8 10.2V14.5" />
        </svg>
      )
    case 'gap':
      return (
        <svg {...p}>
          <path d="M8 1.8l5.6 6.2L8 14.2 2.4 8z" />
          <path d="M8 1.8v12.4L2.4 8z" fill="currentColor" stroke="none" opacity=".35" />
        </svg>
      )
    case 'letter':
      return (
        <svg {...p}>
          <rect x="2" y="3.8" width="12" height="8.8" rx="1.6" />
          <path d="M2.6 4.6L8 9l5.4-4.4" />
        </svg>
      )
    case 'twin':
      return (
        <svg {...p}>
          <path d="M5 2.5l.9 2.2 2.2.9-2.2.9L5 8.7l-.9-2.2-2.2-.9 2.2-.9z" fill="currentColor" stroke="none" />
          <path d="M11 7.3l.9 2.2 2.2.9-2.2.9-.9 2.2-.9-2.2-2.2-.9 2.2-.9z" fill="currentColor" stroke="none" />
        </svg>
      )
    case 'duet':
      return (
        <svg {...p}>
          <path d="M1.8 6.5c1.5-2.6 3-2.6 4.4 0s2.9 2.6 4.4 0 2.6-2.2 3.6-1" />
          <path d="M1.8 10.8c1.5-2.6 3-2.6 4.4 0s2.9 2.6 4.4 0 2.6-2.2 3.6-1" opacity=".6" />
        </svg>
      )
    case 'disc':
      return (
        <svg {...p}>
          <circle cx="8" cy="8" r="6" />
          <circle cx="8" cy="8" r="1.6" />
          <path d="M4.6 5.2a4.2 4.2 0 0 1 2.2-1.6" opacity=".6" />
        </svg>
      )
    case 'glass':
      return (
        <svg {...p}>
          <path d="M4 2.5h8l-1 11H5z" />
          <path d="M4.6 7h6.8" opacity=".6" />
        </svg>
      )
    case 'star':
      return (
        <svg {...p}>
          <path d="M8 1.8l1.8 4 4.4.4-3.3 2.9 1 4.3L8 11.1l-3.9 2.3 1-4.3-3.3-2.9 4.4-.4z" />
        </svg>
      )
    case 'moon':
      return (
        <svg {...p}>
          <path d="M12.8 10.4A5.8 5.8 0 0 1 5.6 3.2a5.8 5.8 0 1 0 7.2 7.2z" />
        </svg>
      )
  }
}
