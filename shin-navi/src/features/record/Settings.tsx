// Settings on the record tab (SPEC F-1 S6): language (switches in place), sound effects, the
// My Songs link state, and clearing this device's data — always behind an explicit confirm.
import { AnimatePresence, motion } from 'motion/react'
import { useState } from 'react'
import { naviApi, useNavi } from '../../core/store'
import { sound } from '../../core/sound'
import { Icon } from '../../core/ui/Icon'
import { LOCALES, setLocale, useLocale } from '../../i18n'
import { R } from './strings'

export function Settings() {
  const t = R.useT()
  const locale = useLocale()
  const muted = useNavi(s => s.session.muted)
  const linked = useNavi(s => s.session.linked)
  const [ask, setAsk] = useState(false)

  return (
    <div className="rc-set">
      <div className="rc-set__row">
        <span className="rc-set__k">
          <Icon name="globe" size={18} />
          {t('set.lang')}
        </span>
        <div className="rc-set__langs" role="radiogroup" aria-label={t('set.lang')}>
          {LOCALES.map(l => (
            <button
              key={l.id}
              type="button"
              role="radio"
              aria-checked={locale === l.id}
              className={`rc-set__lang${locale === l.id ? ' is-on' : ''}`}
              lang={l.htmlLang}
              onClick={() => {
                sound.play('tap')
                setLocale(l.id)
              }}
            >
              {l.label}
            </button>
          ))}
        </div>
      </div>

      <div className="rc-set__row is-inline">
        <span className="rc-set__k">
          <Icon name={muted ? 'mute' : 'speaker'} size={18} />
          {t('set.sound')}
        </span>
        <button type="button" role="switch" aria-checked={!muted} className={`rc-switch${muted ? '' : ' is-on'}`} onClick={() => naviApi.getState().setMuted(!muted)} data-testid="record-sound">
          <i className="rc-switch__knob" />
          <span className="rc-switch__txt">{muted ? t('set.off') : t('set.on')}</span>
        </button>
      </div>

      <div className="rc-set__row is-inline">
        <span className="rc-set__k">
          <Icon name="key" size={18} />
          {t('set.link')}
        </span>
        <span className={`rc-set__v${linked ? ' is-linked' : ''}`}>{linked ? t('set.linked') : t('set.local')}</span>
      </div>

      <div className="rc-set__row">
        <AnimatePresence mode="wait" initial={false}>
          {!ask ? (
            <motion.button
              key="wipe"
              type="button"
              className="rc-set__wipe"
              data-testid="record-wipe"
              onClick={() => setAsk(true)}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              {t('set.wipe')}
            </motion.button>
          ) : (
            <motion.div key="ask" className="rc-set__ask" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              <p>{t('set.wipeAsk')}</p>
              <div className="rc-set__askrow">
                <button type="button" className="rc-set__no" onClick={() => setAsk(false)}>
                  {t('set.wipeNo')}
                </button>
                <button
                  type="button"
                  className="rc-set__yes"
                  data-testid="record-wipe-confirm"
                  onClick={() => {
                    const s = naviApi.getState()
                    s.wipe()
                    s.toast({ text: R.ref('set.wiped'), kind: 'info', ttl: 2400 })
                    setAsk(false)
                  }}
                >
                  {t('set.wipeYes')}
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}
