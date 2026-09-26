// Bottom sheet (SPEC F-2, F-6). It rises from under the stage lane: the lane (y 44–108 on the
// phone) always stays visible and tappable, so the queue is in view while choosing a song.
// Max height = viewport − lane bottom. Closes on backdrop tap, the close button, Escape, or a
// downward swipe on the handle.
import { AnimatePresence, motion, useDragControls } from 'motion/react'
import type { ReactNode } from 'react'
import { common } from '../../i18n/common'
import { useNavi } from '../store'
import { Icon } from './Icon'
import { SPRING } from './motion'
import './kit.css'

export type SheetProps = {
  /** SheetId (used for data-sheet); required for the test id contract */
  id: string
  open: boolean
  onClose: () => void
  children?: ReactNode
  /** optional heading shown next to the handle */
  title?: ReactNode
  /** fill the whole area under the lane instead of hugging the content */
  full?: boolean
  className?: string
  /** mark personal content (never shown on the shared room screen) */
  private?: boolean
}

export function Sheet({ id, open, onClose, children, title, full, className, private: priv }: SheetProps) {
  const t = common.useT()
  const controls = useDragControls()
  const reduced = useNavi(s => s.ui.reduced)
  return (
    <AnimatePresence>
      {open ? (
        <div className="sheet-layer" key={id}>
          <motion.div
            className="sheet-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
            aria-hidden="true"
          />
          <motion.section
            className={`sheet${full ? ' sheet--full' : ''}${className ? ` ${className}` : ''}`}
            data-testid="sheet"
            data-sheet={id}
            data-private={priv ? '1' : undefined}
            role="dialog"
            aria-modal="true"
            initial={reduced ? { opacity: 0 } : { y: '100%' }}
            animate={reduced ? { opacity: 1 } : { y: 0 }}
            exit={reduced ? { opacity: 0 } : { y: '100%' }}
            transition={reduced ? { duration: 0.2 } : SPRING.soft}
            drag="y"
            dragListener={false}
            dragControls={controls}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0.04, bottom: 0.9 }}
            dragMomentum={false}
            onDragEnd={(_, info) => {
              if (info.offset.y > 90 || info.velocity.y > 600) onClose()
            }}
          >
            <div className="sheet__grab" onPointerDown={e => controls.start(e)} style={{ touchAction: 'none' }}>
              <span className="sheet__handle" aria-label={t('sheetHandle')} />
              {title ? <h2 className="sheet__title">{title}</h2> : <span className="sheet__title" />}
              <button type="button" className="sheet__close" onClick={onClose} aria-label={t('close')}>
                <Icon name="close" size={18} strokeWidth={2} />
              </button>
            </div>
            <div className="sheet__body">{children}</div>
          </motion.section>
        </div>
      ) : null}
    </AnimatePresence>
  )
}
