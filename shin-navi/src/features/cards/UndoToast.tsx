// Undo pill (SPEC C-1 戻す): for ~2.2 s after every reserve / keep / pass / insert a compact
// pill offers to bring back the queue item, the face, the line and the card. It docks in the
// search-bar row right under the lane — where a reservation lands — so it never covers the next
// card (the arrival of that card is the reward), the action bar, the mood word or the peeks.
// Passing stays weightless: the optional one-tap reason only appears on the third pass in a row
// (the moment the "読みを合わせる？" pill appears by the mood word), and only for song-like cards.
// Only the buttons take pointer events; the rest of the pill lets touches through.
import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import type { CardKind } from '../../core/types'
import { naviApi, useNavi } from '../../core/store'
import { selReservedPos } from '../../core/selectors'
import { SPRING } from '../../core/ui/motion'
import { SongTitle } from '../../core/ui/SongTitle'
import { S } from './strings'

export const SHOW_MS = 2200
/** with the optional reason chips there is a little more time to pick one */
export const SHOW_REASON_MS = 3600
const UNDOABLE = new Set(['reserve', 'accept', 'keep', 'pass', 'insert'])
const REASONS = ['unknown', 'mood', 'voice'] as const
/** Reasons make sense for a song somebody could sing, not for events (coaster, import, breather…). */
const REASON_KINDS: ReadonlySet<CardKind> = new Set<CardKind>(['song', 'ask', 'link'])
export const REASON_STREAK = 3

function UndoIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M7.5 5L3.5 9l4 4" />
      <path d="M4 9h8a4.5 4.5 0 0 1 0 9h-2.5" />
    </svg>
  )
}

export function UndoToast(): JSX.Element {
  const t = S.useT()
  const undo = useNavi(s => s.deck.undo)
  const pos = useNavi(s => (undo?.songId && undo.queueItemId ? selReservedPos(undo.songId)(s) : null))
  const streak = useNavi(s => s.deck.passStreak)
  // the breather is a place to stop: nothing sits over it
  const breatherTop = useNavi(s => s.deck.cards[0]?.kind === 'breather')
  const onDiscover = useNavi(s => s.ui.tab === 'discover' && s.ui.overlay == null)
  // an info toast (Toasts, app) uses the same row: step below it instead of stacking on top
  const infoToast = useNavi(s => !!s.ui.toast && s.ui.toast.kind !== 'undo')
  const [now, setNow] = useState(() => Date.now())
  const [reason, setReason] = useState<string | null>(null)

  // once per streak: on exactly the third pass in a row, never again on the 4th, 5th…
  const withReasons = !!undo && undo.action === 'pass' && streak === REASON_STREAK && REASON_KINDS.has(undo.card.kind)
  const life = withReasons ? SHOW_REASON_MS : SHOW_MS

  useEffect(() => {
    setReason(null)
    if (!undo) return
    setNow(Date.now())
    const id = window.setTimeout(() => setNow(Date.now()), Math.max(0, undo.at + life - Date.now()) + 20)
    return () => window.clearTimeout(id)
  }, [undo?.at, life])

  const fresh = !!undo && UNDOABLE.has(undo.action) && now - undo.at < life && !breatherTop && onDiscover
  const action = undo?.action
  const msg =
    action === 'reserve' || action === 'accept'
      ? pos != null && pos > 0
        ? t('toast.reserved', { n: pos })
        : t('toast.reservedPlain')
      : action === 'keep'
        ? t('toast.kept')
        : action === 'insert'
          ? t('toast.inserted')
          : t('toast.passed')

  const pick = (r: (typeof REASONS)[number]) => {
    if (reason) return
    setReason(r)
    naviApi.getState().notePassReason(r)
  }

  return (
    <div className={`utoast-host${infoToast ? ' is-below-info' : ''}`} data-private="1">
      <AnimatePresence>
        {fresh && undo ? (
          <motion.div
            key={undo.at}
            className={`utoast utoast--${action}${withReasons ? ' has-reasons' : ''}`}
            data-testid="undo-toast"
            data-action={action}
            initial={{ y: -10, opacity: 0, scale: 0.94 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: -6, opacity: 0, transition: { duration: 0.16 } }}
            transition={SPRING.snappy}
            role="status"
          >
            <div className="utoast__row">
              <span className="utoast__dot" aria-hidden="true" />
              <span className="utoast__what">{msg}</span>
              {undo.songId ? (
                <span className="utoast__song">
                  <SongTitle songId={undo.songId} variant="chip" />
                </span>
              ) : null}
              <motion.button type="button" className="utoast__undo" data-testid="undo-button" whileTap={{ scale: 0.92 }} onClick={() => naviApi.getState().undo()}>
                <UndoIcon />
                <span>{t('undo')}</span>
              </motion.button>
            </div>
            {withReasons ? (
              <div className="utoast__why">
                {reason ? (
                  <span className="utoast__thanks">{t('toast.thanks')}</span>
                ) : (
                  <>
                    <span className="utoast__q">{t('toast.why')}</span>
                    {REASONS.map(r => (
                      <button key={r} type="button" className="utoast__chip" data-testid="pass-reason" data-reason={r} onClick={() => pick(r)}>
                        {t(`passReason.${r}`)}
                      </button>
                    ))}
                  </>
                )}
              </div>
            ) : null}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  )
}
