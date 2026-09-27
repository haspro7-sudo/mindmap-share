// Language sheet (SPEC S11, G-1, L/M8 #5, T06). Five tiles; each shows the language in its own
// script and one song title as that language will see it, so switching feels concrete. A tap
// switches in place (setLocale: no reload, animations and sound keep running), the room lights
// flicker once, and the sheet closes a beat later so the switch is seen happening.
import { useState, type CSSProperties } from 'react'
import { naviApi } from '../../core/store'
import { fxState } from '../../core/fxState'
import { sound } from '../../core/sound'
import { Icon } from '../../core/ui/Icon'
import { LOCALES, LOCALE_IDS, setLocale, songTitle, trIn, useLocale, type Locale } from '../../i18n'
import { S } from './strings'

/** The song whose title differs in all five languages. */
const SAMPLE_SONG = 'zankoku'
const CLOSE_AFTER_MS = 420
const HUE: Record<Locale, number> = { ja: 330, en: 200, zhHant: 18, zhHans: 48, ko: 160 }

export function LangSheet(): JSX.Element {
  const cur = useLocale()
  const t = S.useT()
  const [picked, setPicked] = useState<Locale | null>(null)
  const everyName = LOCALE_IDS.map(l => trIn({ key: 'search.lang.title' }, l)).join(' · ')

  const choose = (l: Locale) => {
    sound.play('tap')
    setPicked(l)
    if (l !== cur) {
      setLocale(l)
      fxState.flash = Math.max(fxState.flash, 0.35)
    }
    window.setTimeout(() => {
      const s = naviApi.getState()
      if (s.ui.sheet?.id === 'lang') s.closeSheet()
    }, CLOSE_AFTER_MS)
  }

  return (
    <div className="lg">
      <header className="lg__head">
        <span className="lg__globe" aria-hidden="true">
          <Icon name="globe" size={20} strokeWidth={1.9} />
        </span>
        <span className="lg__titles">
          <h2 className="lg__title">{t('lang.title')}</h2>
          <small className="lg__every">{everyName}</small>
        </span>
      </header>
      <div className="lg__list" role="radiogroup" aria-label={t('lang.title')}>
        {LOCALES.map((l, i) => {
          const on = l.id === cur
          const title = songTitle(SAMPLE_SONG, l.id).main
          return (
            <button
              key={l.id}
              type="button"
              role="radio"
              aria-checked={on}
              className={`lg-tile${on ? ' is-on' : ''}${picked === l.id ? ' is-picked' : ''}`}
              style={{ '--h': HUE[l.id], '--i': i } as CSSProperties}
              data-testid="lang-chip"
              data-locale={l.id}
              onClick={() => choose(l.id)}
            >
              <span className="lg-tile__code" aria-hidden="true">
                {l.short}
              </span>
              <span className="lg-tile__text">
                <b lang={l.htmlLang}>{l.label}</b>
                <small lang={l.htmlLang}>
                  <i aria-hidden="true" />
                  {title}
                </small>
              </span>
              {on ? (
                <span className="lg-tile__on">
                  <i aria-hidden="true" />
                  {t('lang.current')}
                </span>
              ) : null}
              {picked === l.id ? <i className="lg-tile__flash" aria-hidden="true" /> : null}
            </button>
          )
        })}
      </div>
      <p className="lg__note">{t('lang.note')}</p>
    </div>
  )
}
