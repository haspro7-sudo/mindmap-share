// Undo toast (SPEC C-1): for 3 s after every reserve / keep / pass / insert, a big undo button
// brings back the queue item, the face, the line and the card. After a pass it also offers an
// optional one-tap reason (never required, never shown to anyone else).
import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { naviApi, useNavi } from '../../core/store'
import { selReservedPos } from '../../core/selectors'
import { SPRING } from '../../core/ui/motion'
import { SongTitle } from '../../core/ui/SongTitle'
import { S } from './strings'

const SHOW_MS = 3000
const UNDOABLE = new Set(['reserve', 'accept', 'keep', 'pass', 'insert'])
const REASONS = ['unknown', 'mood', 'voice'] as const

function UndoIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M7.5 5L3.5 9l4 4" />
      <path d="M4 9h8a4.5 4.5 0 0 1 0 9h-2.5" />
    </svg>
  )
}

export function UndoToast(): JSX.Element {
  const t = S.useT()
  const undo = useNavi(s => s.deck.undo)
  const pos = useNavi(s => (undo?.songId && undo.queueItemId ? selReservedPos(undo.songId)(s) : null))
  const [now, setNow] = useState(() => Date.now())
  const [reason, setReason] = useState<string | null>(null)

  useEffect(() => {
    setReason(null)
    if (!undo) return
    setNow(Date.now())
    const id = window.setTimeout(() => setNow(Date.now()), Math.max(0, undo.at + SHOW_MS - Date.now()) + 20)
    return () => window.clearTimeout(id)
  }, [undo?.at])

  const fresh = !!undo && UNDOABLE.has(undo.action) && now - undo.at < SHOW_MS
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
    <div className="utoast-host" data-private="1">
      <AnimatePresence>
        {fresh && undo ? (
          <motion.div
            key={undo.at}
            className={`utoast utoast--${action}`}
            data-testid="undo-toast"
            initial={{ y: 24, opacity: 0, scale: 0.96 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 16, opacity: 0, transition: { duration: 0.18 } }}
            transition={SPRING.snappy}
            role="status"
          >
            <div className="utoast__row">
              <span className="utoast__dot" aria-hidden="true" />
              <div className="utoast__msg">
                <span className="utoast__what">{msg}</span>
                {undo.songId ? (
                  <span className="utoast__song">
                    <SongTitle songId={undo.songId} variant="chip" />
                  </span>
                ) : null}
              </div>
              <motion.button type="button" className="utoast__undo" data-testid="undo-button" whileTap={{ scale: 0.94 }} onClick={() => naviApi.getState().undo()}>
                <UndoIcon />
                <span>{t('undo')}</span>
              </motion.button>
            </div>
            {action === 'pass' ? (
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
