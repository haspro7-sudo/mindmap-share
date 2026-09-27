// Action bar (SPEC C-1, F-3): the button twin of every flick. [left] [primary, 50%, biggest]
// [keep]. The primary label comes from the card body (setPrimary). Keep is hidden for kinds that
// cannot become a face; the bar empties for the breather. The three buttons ALWAYS stay — also
// while my own song is on (the demo "done singing" control lives in the lane's NOW chip, stage).
// On the first visit the bar fades in with the lane (B-2 2.4 s), never before the card rises.
import { useLayoutEffect, useMemo, useRef } from 'react'
import { motion } from 'motion/react'
import type { CardAction } from '../../core/types'
import { KEEPABLE } from '../../core/types'
import { useNavi } from '../../core/store'
import { selTopCard } from '../../core/selectors'
import { introPending, introWait } from '../../core/intro'
import { SPRING } from '../../core/ui/motion'
import { useTr } from '../../i18n'
import { deckCtl, type CommitDir } from './DeckView'
import { leftKey } from './frames'
import { S } from './strings'

const TONE: Partial<Record<CardAction, string>> = {
  ask: 'ask',
  insert: 'amber',
  openArea: 'lime',
  measure: 'violet',
  save: 'silver',
  order: 'amber',
  vote: 'gold',
  reveal: 'violet',
  accept: 'hot',
  putDown: 'mint',
  keep: 'silver',
}

function PassIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M12.5 4.5L7 10l5.5 5.5" />
    </svg>
  )
}
function KeepIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true">
      <path d="M10 2.5l4.6 3v9L10 17.5l-4.6-3v-9z" />
      <path d="M10 2.5v15M5.4 5.5l9.2 9M14.6 5.5l-9.2 9" opacity=".45" />
    </svg>
  )
}
function UpIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10 16V4M5 9l5-5 5 5" />
    </svg>
  )
}

export function ActionBar(): JSX.Element {
  const t = S.useT()
  const trr = useTr()
  const top = useNavi(selTopCard)
  const primary = useNavi(s => s.deck.primary)
  const ref = useRef<HTMLDivElement>(null)
  // decided once at mount: a first-visit intro keeps the bar dark until the lane arrives
  const entrance = useMemo(() => (introPending('lane') ? { delay: introWait('lane') } : null), [])

  useLayoutEffect(() => {
    deckCtl.barEl = ref.current
    return () => {
      if (deckCtl.barEl === ref.current) deckCtl.barEl = null
    }
  })

  const go = (d: CommitDir) => deckCtl.commit?.(d)
  const fade = {
    initial: entrance ? { opacity: 0, y: 10 } : false,
    animate: { opacity: 1, y: 0 },
    transition: entrance ? { duration: 0.3, ease: 'easeOut' as const, delay: entrance.delay } : { duration: 0 },
  } as const

  if (!top || top.kind === 'breather') return <motion.div className="abar is-empty" ref={ref} aria-hidden="true" {...fade} />

  const keepable = KEEPABLE.has(top.kind)
  const fallbackOk = top.kind === 'song' || top.kind === 'ask' || top.kind === 'link'
  const label = primary ? trr(primary.label) : fallbackOk ? t('reserve') : String.fromCharCode(0x2026)
  const enabled = primary ? primary.enabled : false
  const tone = primary ? TONE[primary.action] ?? 'hot' : 'hot'
  const passLabel = t(leftKey(top))
  return (
    <motion.div className="abar" ref={ref} data-kind={top.kind} data-testid="action-bar" {...fade}>
      <motion.button type="button" className={`abar__btn abar__btn--side abar__btn--pass${passLabel.length > 6 ? ' is-long' : ''}`} data-testid="btn-pass" whileTap={{ scale: 0.94 }} transition={SPRING.snappy} onClick={() => go('left')}>
        <PassIcon />
        <span className="abar__label">{passLabel}</span>
      </motion.button>
      <motion.button
        type="button"
        className={`abar__btn abar__btn--primary tone-${tone}${label.length > 12 ? ' is-long' : ''}`}
        data-testid="btn-primary"
        data-action={primary?.action ?? ''}
        disabled={!enabled}
        aria-disabled={!enabled}
        whileTap={enabled ? { scale: 0.95 } : undefined}
        transition={SPRING.snappy}
        onClick={() => go('up')}
      >
        <span className="abar__glow" aria-hidden="true" />
        <UpIcon />
        <span className="abar__label">{label}</span>
      </motion.button>
      {keepable ? (
        <motion.button type="button" className="abar__btn abar__btn--side abar__btn--keep" data-testid="btn-keep" whileTap={{ scale: 0.94 }} transition={SPRING.snappy} onClick={() => go('right')}>
          <KeepIcon />
          <span className="abar__label">{t('keep')}</span>
        </motion.button>
      ) : (
        <span className="abar__btn abar__btn--side abar__btn--spacer" aria-hidden="true" />
      )}
    </motion.div>
  )
}
