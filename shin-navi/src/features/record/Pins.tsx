// The ten pins (SPEC D-10) as a honeycomb pin board: earned pins glow as enamel badges, the rest are
// outlines. Every condition is public: the caption under the board always shows one (the first
// pin still to get, or the one you tap), and each badge says its condition to screen readers.
// No deadline, rarity, purchase or order link — ever. The earned pins also hang on the ball's ring.
import { AnimatePresence, motion } from 'motion/react'
import { useState, type CSSProperties } from 'react'
import type { Pin, PinId } from '../../core/types'
import { PIN_IDS } from '../../core/types'
import { sound } from '../../core/sound'
import { useLocale, varText } from '../../i18n'
import { PinBadge } from './parts'
import { R } from './strings'

/** A 3-4-3 honeycomb of pins on an 8-column grid (each pin spans two columns). */
const cell = (i: number): CSSProperties => {
  const row = i < 3 ? 1 : i < 7 ? 2 : 3
  const start = row === 2 ? 1 + 2 * (i - 3) : 2 + 2 * (row === 1 ? i : i - 7)
  return { gridRow: row, gridColumn: `${start} / span 2` }
}

export function Pins({ pins, reduced }: { pins: Pin[]; reduced: boolean }) {
  const t = R.useT()
  const l = useLocale()
  const got = new Map(pins.map(p => [p.id, p]))
  const [picked, setPicked] = useState<PinId | null>(null)
  const shown: PinId = picked ?? PIN_IDS.find(id => !got.has(id)) ?? PIN_IDS[0]
  const cur = got.get(shown)
  return (
    <div className="rc-pins">
      <div className="rc-pins__board" role="list">
        {PIN_IDS.map((id, i) => {
          const p = got.get(id)
          return (
            <motion.button
              key={id}
              type="button"
              role="listitem"
              className={`rc-pin${p ? ' is-earned' : ''}${shown === id ? ' is-on' : ''}`}
              style={cell(i)}
              data-testid="pin"
              data-id={id}
              data-earned={p ? '1' : '0'}
              aria-label={`${t(`pin.${id}`)}: ${t(`pinHow.${id}`)}`}
              aria-pressed={shown === id}
              onClick={() => {
                sound.play('tap')
                setPicked(id)
              }}
              initial={reduced ? false : { opacity: 0, y: 8 }}
              whileInView={{ opacity: 1, y: 0 }}
              whileTap={reduced ? undefined : { scale: 0.92 }}
              viewport={{ once: true, margin: '0px 0px -20px 0px' }}
              transition={{ delay: (i % 5) * 0.04 + Math.floor(i / 5) * 0.06, duration: 0.3 }}
            >
              <PinBadge id={id} earned={!!p} size={42} />
              <b className="rc-pin__name">{t(`pin.${id}`)}</b>
            </motion.button>
          )
        })}
      </div>
      <div className="rc-pins__cap" data-testid="pin-caption" data-id={shown} aria-live="polite">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={shown}
            className="rc-pins__capin"
            initial={reduced ? false : { opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.16 }}
          >
            <PinBadge id={shown} earned={!!cur} size={30} />
            <span className="rc-pins__captxt">
              <b>{t(`pin.${shown}`)}</b>
              <span className="rc-pin__how">{t(`pinHow.${shown}`)}</span>
              {cur ? <span className="rc-pin__at">{t('pins.at', { date: varText({ date: cur.at }, l) })}</span> : null}
            </span>
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  )
}
