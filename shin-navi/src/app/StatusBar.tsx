// Status row (SPEC F-3 / F-4): brand (triple-tap → presenter), ROOM 12 + minutes left,
// language button (with the one-time JA→EN→繁→简→KO pulse at 2.8 s), mute.
import { motion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import { common } from '../i18n/common'
import { LOCALES, useLocale } from '../i18n'
import { useNavi, naviApi } from '../core/store'
import { selMinutesLeft, selRoomUnlinked } from '../core/selectors'
import { shellStrings } from '../i18n/shell'
import { introPending, introWait, useIntroMode } from '../core/intro'
import { Icon } from '../core/ui/Icon'
import { sound } from '../core/sound'

const PULSE = LOCALES.map(l => l.short) // JA → EN → 繁 → 简 → KO

export function StatusBar({ variant = 'phone', minimal = false }: { variant?: 'phone' | 'room'; minimal?: boolean }) {
  const t = common.useT()
  const ts = shellStrings.useT()
  const unlinked = useNavi(selRoomUnlinked)
  const locale = useLocale()
  const minutes = useNavi(selMinutesLeft)
  const muted = useNavi(s => s.session.muted)
  const mode = useIntroMode()
  const short = LOCALES.find(l => l.id === locale)?.short ?? 'JA'
  const [pulse, setPulse] = useState<string | null>(null)
  const taps = useRef<number[]>([])

  useEffect(() => {
    if (minimal || mode !== 'full' || !introPending('langPulse')) return
    const start = introWait('langPulse') * 1000
    const timers = PULSE.map((label, i) => setTimeout(() => setPulse(label), start + i * 200))
    timers.push(setTimeout(() => setPulse(null), start + PULSE.length * 200))
    return () => timers.forEach(clearTimeout)
    // runs once per mount: the pulse belongs to the entrance only
  }, [])

  const onBrand = () => {
    const now = performance.now()
    // three taps within 1.5 s (each within 0.7 s of the previous) open the presenter panel
    const prev = taps.current[taps.current.length - 1]
    taps.current = prev != null && now - prev < 700 && now - taps.current[0] < 1500 ? [...taps.current, now] : [now]
    if (taps.current.length >= 3) {
      taps.current = []
      naviApi.getState().togglePresenter()
    }
  }

  const ids = !minimal
  return (
    <header className={`status status--${variant}${unlinked ? ' is-unlinked' : ''}`} data-testid={ids ? 'status-bar' : undefined} data-unlinked={unlinked ? '1' : '0'}>
      <button type="button" className="status__brand" data-testid={ids ? 'brand-label' : undefined} onClick={onBrand}>
        <span className="status__mark" aria-hidden="true" />
        <span className="status__brandtext">{t('brand')}</span>
      </button>
      <div className="status__room">
        <span className="status__roomline">
          <span className="status__live" aria-hidden="true" />
          <span className="status__roomno">{t('roomNo', { n: 12 })}</span>
          {variant === 'room' ? <span className="status__joined">{unlinked ? ts('unlinked') : t('joined')}</span> : null}
        </span>
        {/* after 退室 the clock is frozen: say where we are instead of a stale countdown */}
        <span className="status__min" data-testid={ids ? 'minutes-left' : undefined}>
          {unlinked ? ts('left') : t('minutesLeft', { m: minutes })}
        </span>
      </div>
      {minimal ? null : (
        <div className="status__tools">
          <button
            type="button"
            className={`status__lang${pulse ? ' is-pulsing' : ''}`}
            data-testid="lang-button"
            data-anchor="lang"
            aria-label={t('lang')}
            onClick={() => {
              sound.play('tap')
              naviApi.getState().openSheet('lang')
            }}
          >
            <Icon name="globe" size={16} strokeWidth={1.9} />
            <motion.span key={pulse ?? short} className="status__langcode" initial={pulse ? { opacity: 0.2, y: 3 } : false} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.12 }}>
              {pulse ?? short}
            </motion.span>
          </button>
          <button
            type="button"
            className={`status__mute${muted ? ' is-muted' : ''}`}
            data-testid="mute-button"
            aria-label={muted ? t('unmute') : t('mute')}
            aria-pressed={muted}
            onClick={() => naviApi.getState().setMuted(!muted)}
          >
            <Icon name={muted ? 'mute' : 'speaker'} size={18} strokeWidth={1.9} />
          </button>
        </div>
      )}
    </header>
  )
}
