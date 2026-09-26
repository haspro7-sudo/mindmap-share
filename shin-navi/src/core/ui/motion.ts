// Motion tokens (SPEC I-3). Animate transform and opacity only.
export const SPRING = {
  snappy: { type: 'spring', stiffness: 500, damping: 22 },
  soft: { type: 'spring', stiffness: 260, damping: 18 },
  drop: { type: 'spring', stiffness: 120, damping: 14 },
} as const

export const FADE = { duration: 0.2, ease: 'easeOut' } as const
export const FADE_OVERLAY = { duration: 0.3, ease: 'easeOut' } as const
export const TAB_FADE = { duration: 0.2, ease: 'easeInOut' } as const
