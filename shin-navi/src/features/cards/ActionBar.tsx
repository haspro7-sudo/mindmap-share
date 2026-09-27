// Action bar (SPEC C-1, F-3): the button twin of every flick. [left] [primary, 50%, biggest]
// [keep]. The primary label comes from the card body (setPrimary). Keep is hidden for kinds that
// cannot become a face; the bar disappears for the breather and turns into a single
// "done singing (demo)" button while my song is on.
import { useLayoutEffect, useRef } from 'react'
import { motion } from 'motion/react'
import type { CardAction } from '../../core/types'
import { KEEPABLE } from '../../core/types'
import { useNavi } from '../../core/store'
import { selTopCard } from '../../core/selectors'
import { bus } from '../../core/events'
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
  const myTurn = useNavi(s => !!s.room.now && s.room.now.item.by === 'me')
  const ref = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    deckCtl.barEl = ref.current
    return () => {
      if (deckCtl.barEl === ref.current) deckCtl.barEl = null
    }
  })

  const go = (d: CommitDir) => deckCtl.commit?.(d)

  if (myTurn) {
    return (
      <div className="abar abar--turn" ref={ref}>
        <motion.button
          type="button"
          className="abar__btn abar__btn--primary abar__btn--wide"
          data-testid="btn-finish"
          whileTap={{ scale: 0.96 }}
          transition={SPRING.snappy}
          onClick={() => bus.emit({ type: 'presenter/cmd', cmd: { t: 'finishMine' } })}
        >
          <span className="abar__label">{t('finishedDemo')}</span>
        </motion.button>
      </div>
    )
  }

  if (!top || top.kind === 'breather') return <div className="abar is-empty" ref={ref} aria-hidden="true" />

  const keepable = KEEPABLE.has(top.kind)
  const fallbackOk = top.kind === 'song' || top.kind === 'ask' || top.kind === 'link'
  const label = primary ? trr(primary.label) : fallbackOk ? t('reserve') : String.fromCharCode(0x2026)
  const enabled = primary ? primary.enabled : false
  const tone = primary ? TONE[primary.action] ?? 'hot' : 'hot'
  return (
    <div className="abar" ref={ref} data-kind={top.kind}>
      <motion.button type="button" className="abar__btn abar__btn--side abar__btn--pass" data-testid="btn-pass" whileTap={{ scale: 0.94 }} transition={SPRING.snappy} onClick={() => go('left')}>
        <PassIcon />
        <span className="abar__label">{t(leftKey(top))}</span>
      </motion.button>
      <motion.button
        type="button"
        className={`abar__btn abar__btn--primary tone-${tone}`}
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
    </div>
  )
}
