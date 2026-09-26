// Maps ui.overlay → full-screen overlays (standby, wrap, entry). Fade 300 ms (SPEC F-2).
import { AnimatePresence, motion } from 'motion/react'
import type { ReactNode } from 'react'
import type { OverlayId } from '../core/types'
import { useNavi } from '../core/store'
import { FADE_OVERLAY } from '../core/ui/motion'

export function OverlayHost({ overlays }: { overlays: Partial<Record<OverlayId, () => ReactNode>> }) {
  const id = useNavi(s => s.ui.overlay)
  const render = id ? overlays[id] : undefined
  return (
    <AnimatePresence>
      {id && render ? (
        <motion.div key={id} className={`overlay overlay--${id}`} data-overlay={id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={FADE_OVERLAY}>
          {render()}
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}
