// Info / excuse toasts (the undo toast belongs to M3). Shown just under the lane.
import { AnimatePresence, motion } from 'motion/react'
import { useEffect } from 'react'
import { useTr } from '../i18n'
import { useNavi, naviApi } from '../core/store'
import { Icon } from '../core/ui/Icon'
import { SPRING } from '../core/ui/motion'

export function Toasts() {
  const trr = useTr()
  const toast = useNavi(s => (s.ui.toast && s.ui.toast.kind !== 'undo' ? s.ui.toast : null))
  useEffect(() => {
    if (!toast) return
    const left = Math.max(600, toast.at + toast.ttl - Date.now())
    const id = setTimeout(() => {
      if (naviApi.getState().ui.toast?.id === toast.id) naviApi.getState().dismissToast()
    }, left)
    return () => clearTimeout(id)
  }, [toast?.id])
  return (
    <div className="toasts" aria-live="polite">
      <AnimatePresence>
        {toast ? (
          <motion.div
            key={toast.id}
            className={`toast toast--${toast.kind}`}
            data-testid={`toast-${toast.kind}`}
            initial={{ opacity: 0, y: -12, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8 }}
            transition={SPRING.snappy}
            onClick={() => naviApi.getState().dismissToast()}
          >
            <Icon name={toast.kind === 'excuse' ? 'sparkle' : 'chevron'} size={15} strokeWidth={2} />
            <span>{trr(toast.text)}</span>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  )
}
