// The travel journal (SPEC F-1 S0, 5-1 OTA path): a mock-up of the inbound journey in five pages
// (venue guide in your language, OTA booking, voucher, front desk, room guide). Finishing each
// page slams a stamp into the passport strip. It is marked as a mock everywhere: no real booking,
// no payment, no external site. The last page walks into the room with the full intro.
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { naviApi, useNavi } from '../../core/store'
import { sound } from '../../core/sound'
import { Icon } from '../../core/ui/Icon'
import { SPRING } from '../../core/ui/motion'
import { useLocale } from '../../i18n'
import { LangChips } from './LangChips'
import { voucherCode, voucherGrid } from './menu'
import { S, type ServicesKey } from './strings'

type StampDef = { label: string; sub: string; ink: string; rot: number; shape: 'circle' | 'rect' | 'ticket' | 'oct' | 'burst' }

/** Inner width available for the label in each stamp outline (viewBox units). */
const FIT: Record<StampDef['shape'], number> = { circle: 46, rect: 54, ticket: 44, oct: 46, burst: 38 }

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']

function stamps(code: string): StampDef[] {
  const d = new Date()
  const date = `${String(d.getDate()).padStart(2, '0')} ${MONTHS[d.getMonth()]}`
  return [
    { label: 'INFO', sub: '5 LANG', ink: '#2ef2ff', rot: -9, shape: 'circle' },
    { label: 'BOOKED', sub: date, ink: '#ff3da8', rot: 6, shape: 'rect' },
    { label: 'VOUCHER', sub: code.slice(5), ink: '#ffb547', rot: -4, shape: 'ticket' },
    { label: 'CHECK-IN', sub: '20:00', ink: '#c6ff3d', rot: 8, shape: 'oct' },
    { label: 'ROOM 12', sub: '3F', ink: '#b79bff', rot: -6, shape: 'burst' },
  ]
}

const STEP_KEYS: ServicesKey[] = ['ota.s1', 'ota.s2', 'ota.s3', 'ota.s4', 'ota.s5']

function StampArt({ s }: { s: StampDef }) {
  const ink = s.ink
  let frame: ReactNode
  if (s.shape === 'circle')
    frame = (
      <>
        <circle cx="40" cy="40" r="35" fill="none" stroke={ink} strokeWidth="3" />
        <circle cx="40" cy="40" r="29" fill="none" stroke={ink} strokeWidth="1.2" strokeDasharray="2 2.4" />
        <path d="M18 40h44M40 18c-7 6-7 38 0 44M40 18c7 6 7 38 0 44" fill="none" stroke={ink} strokeWidth="1" opacity="0.45" />
      </>
    )
  else if (s.shape === 'rect')
    frame = (
      <>
        <rect x="5" y="15" width="70" height="50" rx="5" fill="none" stroke={ink} strokeWidth="3" />
        <rect x="10" y="20" width="60" height="40" rx="3" fill="none" stroke={ink} strokeWidth="1.1" />
      </>
    )
  else if (s.shape === 'ticket')
    frame = <path d="M8 18h64v14a8 8 0 0 0 0 16v14H8V48a8 8 0 0 0 0-16z" fill="none" stroke={ink} strokeWidth="3" strokeLinejoin="round" />
  else if (s.shape === 'oct')
    frame = (
      <>
        <path d="M27 6h26l20 20v28L53 74H27L7 54V26z" fill="none" stroke={ink} strokeWidth="3" strokeLinejoin="round" />
        <path d="M30 13h20l16 16v22L50 67H30L14 51V29z" fill="none" stroke={ink} strokeWidth="1" />
      </>
    )
  else {
    const pts: string[] = []
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2
      const r = i % 2 ? 31 : 37
      pts.push(`${(40 + Math.cos(a) * r).toFixed(1)},${(40 + Math.sin(a) * r).toFixed(1)}`)
    }
    frame = (
      <>
        <polygon points={pts.join(' ')} fill="none" stroke={ink} strokeWidth="2.6" strokeLinejoin="round" />
        <circle cx="40" cy="40" r="24" fill="none" stroke={ink} strokeWidth="1.1" />
      </>
    )
  }
  return (
    <svg className="stamp-art" viewBox="0 0 80 80" width="100%" height="100%" aria-hidden="true">
      {frame}
      <text
        x="40"
        y={42}
        textAnchor="middle"
        fontSize="12.5"
        fontWeight="900"
        fill={ink}
        {...(s.label.length > 4 ? { textLength: FIT[s.shape], lengthAdjust: 'spacingAndGlyphs' as const } : {})}
      >
        {s.label}
      </text>
      <text x="40" y={54} textAnchor="middle" fontSize="8" fontWeight="800" letterSpacing="1" fill={ink} opacity="0.85">
        {s.sub}
      </text>
    </svg>
  )
}

/** The passport strip: five slots, a stamp slams into each finished page. */
function Passport({ done, defs, reduced, complete }: { done: number; defs: StampDef[]; reduced: boolean; complete: boolean }) {
  return (
    <div className={`pp-book${complete ? ' is-complete' : ''}`} data-testid="ota-passport" data-stamps={done}>
      {complete && !reduced ? (
        <span className="pp-book__foilwrap" aria-hidden="true">
          <span className="pp-book__foil" />
        </span>
      ) : null}
      <div className="pp-book__head">
        <span>PASSPORT</span>
        <i />
        <span>KARAOKE JOURNEY</span>
      </div>
      <div className="pp-book__slots">
        {defs.map((s, i) => {
          const on = i < done
          return (
            <div key={i} className={`pp-slot${on ? ' is-on' : ''}`} data-testid="ota-stamp" data-step={i + 1} data-done={on ? '1' : '0'}>
              <span className="pp-slot__num">{i + 1}</span>
              <AnimatePresence>
                {on ? (
                  <motion.div
                    key="stamp"
                    className="pp-stamp"
                    style={{ ['--ink' as string]: s.ink } as CSSProperties}
                    initial={reduced ? { opacity: 0, rotate: s.rot } : { opacity: 0, scale: 2.3, rotate: s.rot - 24, y: -18 }}
                    animate={{ opacity: 0.94, scale: 1, rotate: s.rot, y: 0 }}
                    transition={reduced ? { duration: 0.25 } : { type: 'spring', stiffness: 560, damping: 19, mass: 0.9 }}
                  >
                    <span className="pp-stamp__ink" aria-hidden="true" />
                    <StampArt s={s} />
                  </motion.div>
                ) : null}
              </AnimatePresence>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- pages

function Feature({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <li className="ota-feat">
      <span className="ota-feat__icon">{icon}</span>
      <span>{children}</span>
    </li>
  )
}

function Storefront() {
  return (
    <svg className="ota-store" viewBox="0 0 240 110" aria-hidden="true">
      <defs>
        <linearGradient id="otaSky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2a1760" />
          <stop offset="1" stopColor="#0d0824" />
        </linearGradient>
      </defs>
      <rect width="240" height="110" rx="14" fill="url(#otaSky)" />
      {[18, 44, 70, 170, 200, 222].map((x, i) => (
        <circle key={i} cx={x} cy={10 + ((i * 13) % 22)} r={i % 2 ? 0.9 : 1.3} fill="#fff" opacity="0.7" />
      ))}
      <rect x="62" y="30" width="116" height="80" rx="4" fill="#1b1340" stroke="#8a6bff" strokeOpacity="0.6" />
      <rect x="74" y="38" width="92" height="20" rx="10" fill="none" stroke="#ff3da8" strokeWidth="2.4" />
      <text x="120" y="52.5" textAnchor="middle" fontSize="11" fontWeight="900" fill="#ffd1ec" letterSpacing="2">
        KARAOKE
      </text>
      {[0, 1, 2].map(i => (
        <rect key={i} x={76 + i * 30} y="66" width="24" height="16" rx="2" fill={i === 1 ? '#ffb547' : '#2ef2ff'} opacity={i === 1 ? 0.75 : 0.35} />
      ))}
      <rect x="106" y="88" width="28" height="22" rx="2" fill="#ffd36b" opacity="0.85" />
      <line x1="120" y1="0" x2="120" y2="14" stroke="#fff6d8" strokeOpacity="0.5" />
      <circle cx="120" cy="20" r="7" fill="#c9ccd8" />
      <path d="M113 20h14M120 13c-2.5 2-2.5 12 0 14M120 13c2.5 2 2.5 12 0 14" stroke="#6e6790" strokeWidth="0.8" fill="none" />
      <path d="M0 108h240" stroke="#ffb547" strokeOpacity="0.4" />
    </svg>
  )
}

function QrMark({ code, size }: { code: string; size: number }) {
  const n = 21
  const bits = useMemo(() => voucherGrid(code, n), [code])
  const cell = size / (n + 2)
  return (
    <svg className="ota-qr" width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      <rect width={size} height={size} rx="8" fill="#f7f4ff" />
      {bits.map((on, i) =>
        on ? <rect key={i} x={cell * (1 + (i % n))} y={cell * (1 + Math.floor(i / n))} width={cell + 0.2} height={cell + 0.2} fill="#140b30" /> : null,
      )}
    </svg>
  )
}

function RouteMap() {
  return (
    <svg className="ota-route" viewBox="0 0 280 120" aria-hidden="true">
      <rect x="1" y="1" width="278" height="118" rx="14" fill="#120a2c" stroke="#8a6bff" strokeOpacity="0.35" />
      {[0, 1, 2, 3].map(i => (
        <rect key={i} x={70 + i * 46} y="18" width="36" height="26" rx="4" fill="#1d1444" stroke="#ffffff" strokeOpacity="0.12" />
      ))}
      <rect x="18" y="58" width="36" height="46" rx="5" fill="#1d1444" stroke="#2ef2ff" strokeOpacity="0.7" />
      <path d="M36 66v10M31 71l5-5 5 5M31 88l5 5 5-5M36 83v10" stroke="#2ef2ff" strokeWidth="1.6" fill="none" strokeLinecap="round" />
      <text x="36" y="54" textAnchor="middle" fontSize="10" fontWeight="900" fill="#2ef2ff">
        3F
      </text>
      <path className="ota-route__path" d="M56 82 H176 Q196 82 204 70 L214 56" fill="none" stroke="#ffd36b" strokeWidth="2.4" strokeDasharray="2 7" strokeLinecap="round" />
      <rect x="206" y="22" width="56" height="60" rx="6" fill="#2a1250" stroke="#ff3da8" strokeWidth="2" />
      <rect x="214" y="30" width="40" height="46" rx="3" fill="#ffd36b" opacity="0.2" />
      <text x="234" y="96" textAnchor="middle" fontSize="10" fontWeight="900" fill="#ffd1ec" letterSpacing="1">
        ROOM 12
      </text>
      <line x1="234" y1="30" x2="234" y2="40" stroke="#fff6d8" strokeOpacity="0.6" />
      <circle cx="234" cy="46" r="6.5" fill="#c9ccd8" />
      <path d="M227.5 46h13M234 39.5c-2 2-2 11 0 13M234 39.5c2 2 2 11 0 13" stroke="#6e6790" strokeWidth="0.7" fill="none" />
      <circle className="ota-route__me" cx="56" cy="82" r="5" fill="#fff" />
    </svg>
  )
}

// ---------------------------------------------------------------- the flow

export function OtaFlow({ onBack, onDone }: { onBack: () => void; onDone: () => void }): JSX.Element {
  const t = S.useT()
  const l = useLocale()
  const reduced = useNavi(s => s.ui.reduced)
  const code = useMemo(() => voucherCode(`${naviApi.getState().session.seed}|voucher`), [])
  const defs = useMemo(() => stamps(code), [code])
  const [step, setStep] = useState(0)
  const [done, setDone] = useState(0)
  const [busy, setBusy] = useState(false)
  const [checked, setChecked] = useState(false)
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])
  const later = (ms: number, fn: () => void) => {
    timers.current.push(setTimeout(fn, ms))
  }
  useEffect(() => () => timers.current.forEach(clearTimeout), [])

  const stamp = (i: number) => {
    setDone(d => Math.max(d, i + 1))
    sound.play('stamp')
    sound.haptic(30)
  }

  // the front desk checks the voucher on its own, then stamps
  useEffect(() => {
    if (step !== 3 || checked) return
    later(reduced ? 500 : 1500, () => {
      setChecked(true)
      stamp(3)
    })
  }, [step])

  const turn = (to: number, delay: number) => later(reduced ? Math.min(delay, 250) : delay, () => {
    setStep(to)
    setBusy(false)
  })

  const next = () => {
    if (busy) return
    if (step === 0) {
      setBusy(true)
      stamp(0)
      turn(1, 760)
    } else if (step === 1) {
      setBusy(true)
      later(reduced ? 150 : 650, () => stamp(1))
      turn(2, reduced ? 400 : 1450)
    } else if (step === 2) {
      setBusy(true)
      stamp(2)
      turn(3, 760)
    } else if (step === 3) {
      if (!checked) return
      setBusy(true)
      turn(4, 120)
    } else {
      setBusy(true)
      stamp(4)
      later(reduced ? 300 : 1250, onDone)
    }
  }

  const nextLabel: ServicesKey = step === 0 ? 'ota.toBook' : step === 1 ? 'ota.book' : step === 2 ? 'ota.shown' : step === 3 ? 'ota.toRoom' : 'ota.enter'
  const nextDisabled = step === 3 && !checked
  const complete = done >= 5

  let page: ReactNode
  if (step === 0)
    page = (
      <>
        <Storefront />
        <div className="ota-venue">
          <b>{t('ota.venue')}</b>
          <span>{t('ota.venueLine')}</span>
        </div>
        <ul className="ota-feats">
          <Feature icon={<Icon name="globe" size={16} strokeWidth={2} />}>{t('ota.f1')}</Feature>
          <Feature icon={<Icon name="people" size={16} strokeWidth={2} />}>{t('ota.f2')}</Feature>
          <Feature icon={<Icon name="glass" size={16} strokeWidth={2} />}>{t('ota.f3')}</Feature>
        </ul>
        <div className="ota-readin">
          <span>{t('ota.readIn')}</span>
          <LangChips testid="ota-lang" compact />
        </div>
      </>
    )
  else if (step === 1)
    page = (
      <div className="ota-site">
        <div className="ota-site__bar">
          <i />
          <i />
          <i />
          <span>{t('ota.site')}</span>
        </div>
        <div className="ota-site__body">
          <div className="ota-site__venue">
            <Storefront />
            <div>
              <b>{t('ota.venue')}</b>
              <span>{t('ota.venueLine')}</span>
            </div>
          </div>
          <dl className="ota-fields">
            <div>
              <dt>{t('ota.date')}</dt>
              <dd>{t('ota.tonight')}</dd>
            </div>
            <div>
              <dt>{t('ota.time')}</dt>
              <dd>20:00</dd>
            </div>
            <div>
              <dt>{t('ota.people')}</dt>
              <dd>{t('ota.peopleN', { n: 4 })}</dd>
            </div>
            <div>
              <dt>{t('ota.length')}</dt>
              <dd>{t('ota.minutes', { n: 90 })}</dd>
            </div>
          </dl>
          <p className="ota-nopay">
            <Icon name="lock" size={13} strokeWidth={2} />
            {t('ota.noPay')}
          </p>
        </div>
      </div>
    )
  else if (step === 2)
    page = (
      <div className="ota-voucher">
        <div className="ota-voucher__qr">
          <QrMark code={code} size={112} />
        </div>
        <div className="ota-voucher__info">
          <span className="ota-voucher__k">{t('ota.voucher').toUpperCase()}</span>
          <span className="ota-voucher__k2">{t('ota.code')}</span>
          <b className="ota-voucher__code">{code}</b>
          <span className="ota-voucher__line">{t('ota.venue')}</span>
          <span className="ota-voucher__line">
            {t('ota.tonight')} 20:00 · {t('ota.peopleN', { n: 4 })}
          </span>
        </div>
        <div className="ota-voucher__tear" aria-hidden="true" />
        <p className="ota-voucher__hint">{t('ota.showDesk')}</p>
      </div>
    )
  else if (step === 3)
    page = (
      <div className={`ota-desk${checked ? ' is-checked' : ''}`}>
        <div className="ota-desk__scan">
          <QrMark code={code} size={96} />
          {!checked ? <span className="ota-desk__beam" aria-hidden="true" /> : null}
          <span className="ota-desk__corners" aria-hidden="true" />
        </div>
        <AnimatePresence mode="wait" initial={false}>
          {checked ? (
            <motion.div key="ok" className="ota-desk__ok" initial={{ opacity: 0, scale: 0.85 }} animate={{ opacity: 1, scale: 1 }} transition={SPRING.snappy}>
              <span className="ota-desk__check" aria-hidden="true">
                <svg width="26" height="26" viewBox="0 0 26 26">
                  <path d="M6 13.5l4.6 4.6L20 8.5" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
              <b>{t('ota.checked')}</b>
              <span className="ota-desk__key">ROOM 12</span>
            </motion.div>
          ) : (
            <motion.div key="wait" className="ota-desk__wait" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <i className="ord-dots" aria-hidden="true" />
              {t('ota.checking')}
            </motion.div>
          )}
        </AnimatePresence>
        <p className="ota-desk__lang">{t('ota.deskLang', { locale: { locale: l } })}</p>
      </div>
    )
  else
    page = (
      <div className="ota-room">
        <RouteMap />
        <p className="ota-room__way">{t('ota.roomWay')}</p>
        <p className="ota-room__tip">{t('ota.roomTip')}</p>
      </div>
    )

  return (
    <div className={`ota${complete ? ' is-complete' : ''}`} data-testid="ota-flow" data-step={step + 1}>
      <div className="ota-top">
        <button type="button" className="ota-back" data-testid="ota-back" onClick={onBack} aria-label={t('ota.back')} disabled={busy}>
          <Icon name="chevron" size={18} strokeWidth={2.4} style={{ transform: 'scaleX(-1)' }} />
        </button>
        <div className="ota-top__title">
          <span className="svc-eyebrow">TRAVEL JOURNAL</span>
          <b>{t('ota.title')}</b>
        </div>
        <span className="ota-mockbadge">{t('ota.mock')}</span>
      </div>

      <Passport done={done} defs={defs} reduced={reduced} complete={complete} />

      <div className="ota-steps" aria-hidden="true">
        {STEP_KEYS.map((k, i) => (
          <span key={k} className={`ota-steps__dot${i < done ? ' is-done' : ''}${i === step ? ' is-now' : ''}`} />
        ))}
      </div>

      <div className="ota-stage">
        <AnimatePresence mode="wait" initial={false}>
          <motion.section
            key={step}
            className={`ota-page ota-page--${step + 1}`}
            initial={reduced ? { opacity: 0 } : { opacity: 0, x: 60, rotate: 2 }}
            animate={{ opacity: 1, x: 0, rotate: 0, transition: reduced ? { duration: 0.2 } : { x: SPRING.soft, rotate: SPRING.soft, opacity: { duration: 0.22 } } }}
            exit={reduced ? { opacity: 0, transition: { duration: 0.12 } } : { opacity: 0, x: -60, rotate: -2, transition: { duration: 0.2, ease: [0.4, 0, 1, 1] } }}
          >
            <header className="ota-page__head">
              <span className="ota-page__no">STEP {step + 1}</span>
              <h2>{t(STEP_KEYS[step])}</h2>
            </header>
            {page}
          </motion.section>
        </AnimatePresence>
      </div>

      <div className="ota-foot">
        <AnimatePresence>
          {complete ? (
            <motion.div className="ota-complete" initial={{ opacity: 0, y: 10, scale: 0.9 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={SPRING.snappy}>
              <Icon name="sparkle" size={16} strokeWidth={2} />
              {t('ota.complete')}
            </motion.div>
          ) : null}
        </AnimatePresence>
        <motion.button
          type="button"
          className={`ota-next${step === 4 ? ' is-final' : ''}${busy ? ' is-busy' : ''}`}
          data-testid="ota-next"
          disabled={nextDisabled}
          aria-busy={busy}
          whileTap={nextDisabled || busy ? undefined : { scale: 0.96 }}
          transition={SPRING.snappy}
          onClick={next}
        >
          <span className="ota-next__glow" aria-hidden="true" />
          {step === 1 && busy ? <i className="ord-dots" aria-hidden="true" /> : null}
          {t(nextLabel)}
          {step !== 1 || !busy ? <Icon name="chevron" size={18} strokeWidth={2.4} /> : null}
        </motion.button>
        <p className="ota-mock">{t('entry.mock')}</p>
      </div>
    </div>
  )
}
