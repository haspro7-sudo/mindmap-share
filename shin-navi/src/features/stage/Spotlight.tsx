// "Your turn": a cone of light from above lands on the hero when my song is playing (SPEC E-4).
// It also hosts the one-shot ON STAGE takeover (StageMoment), portalled over the whole phone.
// Static gradient cones (one slowly swaying), a halo behind the ball, a pool of light on the
// floor and a few rising motes; only transform and opacity animate.
import { AnimatePresence, motion } from 'motion/react'
import { useNavi } from '../../core/store'
import { usePhoneMetrics } from '../../core/layout'
import { StageMoment } from './StageMoment'
import './stage.css'

export function Spotlight(): JSX.Element {
  const m = usePhoneMetrics()
  const mine = useNavi(s => !!s.room.now && (s.room.now.item.by === 'me' || s.room.now.item.with === 'me'))
  return (
    <>
      <StageMoment />
      <AnimatePresence>
        {mine ? (
          <motion.div
            key="spot"
            className="sg-spot"
            data-testid="spotlight"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.6 } }}
            transition={{ duration: 0.5, ease: 'easeOut' }}
            aria-hidden="true"
          >
            <motion.span
              className="sg-spot__halo"
              style={{ top: m.ballCy, width: m.ball * 1.7, height: m.ball * 1.7, marginLeft: -m.ball * 0.85, marginTop: -m.ball * 0.85 }}
              initial={{ scale: 0.6, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ duration: 0.8, ease: 'easeOut' }}
            />
            <motion.span className="sg-spot__cone" initial={{ scaleY: 0.35, opacity: 0 }} animate={{ scaleY: 1, opacity: 1 }} transition={{ type: 'spring', stiffness: 120, damping: 16 }} />
            <span className="sg-spot__sway">
              <span className="sg-spot__cone sg-spot__cone--soft" />
            </span>
            <motion.span
              className="sg-spot__pool"
              style={{ top: m.horizon - 22 }}
              initial={{ scale: 0.3, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ duration: 0.7, delay: 0.15, ease: 'easeOut' }}
            />
            <span className="sg-spot__motes">
              <i />
              <i />
              <i />
              <i />
              <i />
              <i />
            </span>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </>
  )
}
