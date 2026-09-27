// Breather body (SPEC C-8 11, C-6): a capsule between rounds. It only reports what really
// happened this round (faces gained, songs reserved, songs until my turn) and its biggest
// button is "put the phone down and listen". "One more round" is a full-width outlined button
// of the same height, so stopping never feels like the lesser choice.
import { useEffect } from 'react'
import { motion } from 'motion/react'
import type { CardAction, CardBodyComponent, CardBodyProps } from '../../../core/types'
import type { NaviState } from '../../../core/store/types'
import { useNaviStable } from '../../../core/useStable'
import { selMyTurnIn } from '../../../core/selectors'
import { SPRING } from '../../../core/ui/motion'
import { S } from '../strings'

const FACE_ACTIONS: ReadonlySet<CardAction> = new Set<CardAction>(['reserve', 'keep', 'save', 'accept', 'insert'])
const RESERVE_ACTIONS: ReadonlySet<CardAction> = new Set<CardAction>(['reserve', 'accept', 'insert'])

function roundStats(s: NaviState): { faces: number; reserved: number; turn: number | null; listening: boolean } {
  const h = s.deck.history
  let start = 0
  for (let i = h.length - 1; i >= 0; i--) {
    if (h[i].kind === 'breather') {
      start = i + 1
      break
    }
  }
  let faces = 0
  let reserved = 0
  for (let i = start; i < h.length; i++) {
    if (FACE_ACTIONS.has(h[i].action)) faces++
    if (RESERVE_ACTIONS.has(h[i].action)) reserved++
  }
  const turn = selMyTurnIn(s)
  const listening = !!s.room.now && s.room.now.item.by !== 'me' && (turn == null || turn >= 2)
  return { faces, reserved, turn, listening }
}

function BreatherBody({ card, setPrimary, act }: CardBodyProps) {
  const t = S.useT()
  const st = useNaviStable(roundStats)

  useEffect(() => {
    setPrimary({ action: 'putDown', label: S.ref('putDown'), enabled: true })
  }, [card.id])

  const turnVal = st.turn == null ? t('breather.turnNone') : st.turn === 0 ? t('breather.turnNow') : t('breather.turnVal', { n: st.turn })
  const summary = t('breather.summary', { f: st.faces, r: st.reserved, t: st.turn ?? '-' })
  return (
    <div className="breather" aria-label={summary}>
      <div className="breather__title">{st.listening ? t('breather.listen') : t('breather.round')}</div>
      <div className="breather__stats" data-testid="breather-stats">
        <div className="bstat">
          <span className="bstat__k">{t('breather.faces')}</span>
          <span className="bstat__v">{t('breather.facesVal', { n: st.faces })}</span>
        </div>
        <span className="bstat__sep" aria-hidden="true" />
        <div className="bstat">
          <span className="bstat__k">{t('breather.reserved')}</span>
          <span className="bstat__v">{t('breather.reservedVal', { n: st.reserved })}</span>
        </div>
        <span className="bstat__sep" aria-hidden="true" />
        <div className="bstat">
          <span className="bstat__k">{t('breather.turn')}</span>
          <span className="bstat__v">{turnVal}</span>
        </div>
      </div>
      <motion.button type="button" className="breather__down" data-testid="breather-putdown" whileTap={{ scale: 0.96 }} transition={SPRING.snappy} onClick={() => act('putDown')}>
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="6" y="2.5" width="8" height="15" rx="2" />
          <path d="M2.5 12.5c1.5 1 1.5 3 0 4M17.5 12.5c-1.5 1-1.5 3 0 4" />
        </svg>
        <span>{t('putDown')}</span>
      </motion.button>
      <motion.button type="button" className="breather__more" data-testid="breather-onemore" whileTap={{ scale: 0.97 }} transition={SPRING.snappy} onClick={() => act('oneMore')}>
        {t('oneMore')}
      </motion.button>
    </div>
  )
}

export const BreatherCardBody: CardBodyComponent = p => <BreatherBody {...p} />
