// Five language chips (SPEC G-1, S0): switching is instant, in place, and re-resolves every
// string on screen. Shared by the entrance and the travel journal's venue guide.
import { motion } from 'motion/react'
import type { Locale } from '../../core/types'
import { sound } from '../../core/sound'
import { SPRING } from '../../core/ui/motion'
import { LOCALES, setLocale, useLocale } from '../../i18n'

export function LangChips({ testid = 'entry-lang', compact }: { testid?: string; compact?: boolean }) {
  const l = useLocale()
  return (
    <div className={`ent-langs${compact ? ' is-compact' : ''}`} role="radiogroup">
      {LOCALES.map(x => (
        <motion.button
          key={x.id}
          type="button"
          role="radio"
          aria-checked={x.id === l}
          className={`ent-lang${x.id === l ? ' is-on' : ''}`}
          data-testid={testid}
          data-locale={x.id}
          lang={x.htmlLang}
          whileTap={{ scale: 0.92 }}
          onClick={() => {
            if (x.id !== l) sound.play('tap')
            setLocale(x.id as Locale)
          }}
        >
          {x.id === l ? <motion.span layoutId={`${testid}-pill`} className="ent-lang__pill" transition={SPRING.snappy} /> : null}
          <span className="ent-lang__label">{compact ? x.short : x.label}</span>
        </motion.button>
      ))}
    </div>
  )
}
