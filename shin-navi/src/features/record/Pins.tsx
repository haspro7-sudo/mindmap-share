// The ten pins (SPEC D-10). Every condition is public from the start: earned pins glow as
// enamel badges, the rest are outlines with their condition written next to them. No deadline,
// rarity, purchase or order link — ever.
import { motion } from 'motion/react'
import type { Pin } from '../../core/types'
import { PIN_IDS } from '../../core/types'
import { useLocale, varText } from '../../i18n'
import { PinBadge } from './parts'
import { R } from './strings'

export function Pins({ pins, reduced }: { pins: Pin[]; reduced: boolean }) {
  const t = R.useT()
  const l = useLocale()
  const got = new Map(pins.map(p => [p.id, p]))
  return (
    <div className="rc-pins">
      {PIN_IDS.map((id, i) => {
        const p = got.get(id)
        return (
          <motion.div
            key={id}
            className={`rc-pin${p ? ' is-earned' : ''}`}
            data-testid="pin"
            data-id={id}
            data-earned={p ? '1' : '0'}
            initial={reduced ? false : { opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '0px 0px -20px 0px' }}
            transition={{ delay: (i % 2) * 0.05 + Math.floor(i / 2) * 0.04, duration: 0.3 }}
          >
            <PinBadge id={id} earned={!!p} size={46} />
            <div className="rc-pin__txt">
              <b className="rc-pin__name">{t(`pin.${id}`)}</b>
              <span className="rc-pin__how">{t(`pinHow.${id}`)}</span>
              {p ? <span className="rc-pin__at">{t('pins.at', { date: varText({ date: p.at }, l) })}</span> : null}
            </div>
          </motion.div>
        )
      })}
    </div>
  )
}
