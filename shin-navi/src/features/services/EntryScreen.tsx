// S0 entrance (SPEC F-1, F-2, 5-1): shown with ?entry=1 or from the presenter panel, never by
// default. A hanging mirror ball over the doorway, the welcome in the viewing language (the
// other four glow behind it), five language chips that switch everything in place, and three
// ways in: as a guest, from My Songs, or with a travel voucher (the travel journal, a mock-up
// that never touches a real booking or payment). Walking in plays the full S1 intro.
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { naviApi, useNavi } from '../../core/store'
import { useBox } from '../../core/layout'
import { sound } from '../../core/sound'
import { Icon } from '../../core/ui/Icon'
import { SPRING } from '../../core/ui/motion'
import { LOCALES, trIn, useLocale, useTr } from '../../i18n'
import { enterRoom, type EntranceMode } from './enter'
import { OtaFlow } from './OtaFlow'
import { LangChips } from './LangChips'
import { S } from './strings'
import './services.css'

// ---------------------------------------------------------------- the hanging ball (static SVG)

type Facet = { d: string; fill: string; lit: boolean }

function buildFacets(): { facets: Facet[]; sparks: [number, number][] } {
  const R = 44
  const cx = 50
  const cy = 50
  const tilt = (-16 * Math.PI) / 180
  const L = (() => {
    const v = [-0.45, -0.75, 0.7]
    const n = Math.hypot(v[0], v[1], v[2])
    return v.map(x => x / n)
  })()
  const P = (lat: number, lon: number) => {
    const la = (lat * Math.PI) / 180
    const lo = (lon * Math.PI) / 180
    const x = Math.cos(la) * Math.sin(lo)
    const y = -Math.sin(la)
    const z = Math.cos(la) * Math.cos(lo)
    const y2 = y * Math.cos(tilt) - z * Math.sin(tilt)
    const z2 = y * Math.sin(tilt) + z * Math.cos(tilt)
    return { x, y: y2, z: z2 }
  }
  const facets: Facet[] = []
  const sparks: [number, number][] = []
  const HUES = [330, 190, 42, 265, 150, 12]
  const bands = 12
  let k = 0
  for (let b = 0; b < bands; b++) {
    const la0 = -80 + (160 / bands) * b
    const la1 = la0 + 160 / bands
    const mid = (la0 + la1) / 2
    const n = Math.max(6, Math.round(22 * Math.cos((mid * Math.PI) / 180)))
    for (let i = 0; i < n; i++) {
      const lo0 = -180 + (360 / n) * i + (b % 2) * (180 / n)
      const lo1 = lo0 + 360 / n
      const c = P(mid, (lo0 + lo1) / 2)
      if (c.z < 0.08) continue
      const g = 0.06
      const pts = [P(la0 + g * 8, lo0 + g * 8), P(la0 + g * 8, lo1 - g * 8), P(la1 - g * 8, lo1 - g * 8), P(la1 - g * 8, lo0 + g * 8)]
      const d = pts.map((p, j) => `${j ? 'L' : 'M'}${(cx + p.x * R).toFixed(2)},${(cy + p.y * R).toFixed(2)}`).join(' ') + ' Z'
      const dot = Math.max(0, c.x * L[0] + c.y * L[1] + c.z * L[2])
      const bright = 0.18 + 0.72 * dot
      k++
      // a few faces are already lit in colour (your songs), a few catch the light in white
      const lit = (k * 37) % 9 === 0 && dot > 0.15
      const glint = !lit && dot > 0.9 && k % 4 === 1
      const hue = HUES[k % HUES.length]
      const fill = lit ? `hsl(${hue} 95% ${48 + bright * 22}%)` : glint ? '#f4f1ff' : `hsl(${252 + Math.round(dot * 26)} ${16 + dot * 26}% ${10 + bright * 64}%)`
      facets.push({ d, fill, lit })
      if (dot > 0.8 && sparks.length < 6 && k % 3 === 0) sparks.push([cx + c.x * R, cy + c.y * R])
    }
  }
  return { facets, sparks }
}

const BALL = buildFacets()

function EntryBall({ size }: { size: number }) {
  return (
    <div className="ent-ball" style={{ width: size, height: size + 46 }} aria-hidden="true">
      <span className="ent-ball__wire" />
      <div className="ent-ball__swing">
        <svg className="ent-ball__svg" width={size} height={size} viewBox="0 0 100 100">
          <defs>
            <radialGradient id="entBallShade" cx="0.38" cy="0.32" r="0.75">
              <stop offset="0" stopColor="#ffffff" stopOpacity="0.16" />
              <stop offset="0.6" stopColor="#000000" stopOpacity="0" />
              <stop offset="1" stopColor="#05020f" stopOpacity="0.72" />
            </radialGradient>
            <clipPath id="entBallClip">
              <circle cx="50" cy="50" r="44" />
            </clipPath>
          </defs>
          <circle cx="50" cy="50" r="44.6" fill="#140c2c" />
          <g clipPath="url(#entBallClip)">
            {BALL.facets.map((f, i) => (
              <path key={i} d={f.d} fill={f.fill} />
            ))}
          </g>
          <circle cx="50" cy="50" r="44" fill="url(#entBallShade)" />
          <circle cx="50" cy="50" r="44" fill="none" stroke="#2ef2ff" strokeOpacity="0.35" strokeWidth="0.8" />
          <rect x="46" y="3" width="8" height="5" rx="1.5" fill="#cfd3e6" />
        </svg>
        {/* the moving glint is an HTML layer so the faceted SVG is painted once */}
        <span className="ent-ball__glintwrap">
          <span className="ent-ball__glint" />
        </span>
        {BALL.sparks.map(([x, y], i) => (
          <span key={i} className="ent-spark" style={{ left: `${x}%`, top: `${y}%`, ['--d' as string]: `${i * 0.7}s` } as CSSProperties} />
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- door icons

function DoorIcon({ kind }: { kind: EntranceMode }) {
  const common = { width: 30, height: 30, viewBox: '0 0 30 30', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  if (kind === 'guest')
    return (
      <svg {...common}>
        <path d="M8 26V6.5A1.5 1.5 0 0 1 9.5 5h11A1.5 1.5 0 0 1 22 6.5V26" />
        <path d="M8 26l9-2.2V7.4L8 5" fill="currentColor" fillOpacity="0.25" />
        <circle cx="14.5" cy="16" r="1" fill="currentColor" />
        <path d="M4 26h22" />
        <path d="M25 9l2.5-1.5M25.5 13.5h2.8M25 18l2.5 1.5" />
      </svg>
    )
  if (kind === 'continue')
    return (
      <svg {...common}>
        <circle cx="15" cy="16" r="9.5" />
        <path d="M5.8 13.5h18.4M5.8 18.5h18.4M15 6.5c-3 2.8-3 16.2 0 19M15 6.5c3 2.8 3 16.2 0 19" strokeWidth="1.3" />
        <path d="M15 2.5v4" />
        <path d="M22 3.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z" fill="currentColor" strokeWidth="1" />
      </svg>
    )
  return (
    <svg {...common}>
      <rect x="6" y="4" width="15" height="21" rx="2" />
      <circle cx="13.5" cy="12.5" r="4" />
      <path d="M9.5 12.5h8M13.5 8.5c-1.6 1.2-1.6 6.8 0 8" strokeWidth="1.2" />
      <path d="M9.5 20.5h8" />
      <path d="M20 22l7-4.5-1-1.6-3.2 1-3.4-3.4-1.3.6 2 4-2.6 1.4-1.4-.9-.9.5 1.3 2.2z" fill="currentColor" fillOpacity="0.9" strokeWidth="1" />
    </svg>
  )
}

function DoorCard({ kind, title, sub, badge, onGo, index, testid }: { kind: EntranceMode; title: string; sub: ReactNode; badge?: string; onGo: () => void; index: number; testid: string }) {
  const reduced = useNavi(s => s.ui.reduced)
  return (
    <motion.button
      type="button"
      className={`ent-door ent-door--${kind}`}
      data-testid={testid}
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: 22 }}
      animate={{ opacity: 1, y: 0 }}
      transition={reduced ? { duration: 0.3 } : { ...SPRING.soft, delay: 0.5 + index * 0.09 }}
      whileTap={{ scale: 0.97 }}
      onClick={onGo}
    >
      <span className="ent-door__shine" aria-hidden="true" />
      <span className="ent-door__icon">
        <DoorIcon kind={kind} />
        {badge ? <span className="ent-door__badge">{badge}</span> : null}
      </span>
      <span className="ent-door__text">
        <b>{title}</b>
        <small>{sub}</small>
      </span>
      <span className="ent-door__go" aria-hidden="true">
        <Icon name="chevron" size={18} strokeWidth={2.4} />
      </span>
    </motion.button>
  )
}

// ---------------------------------------------------------------- the entrance

export function EntryScreen(): JSX.Element {
  const t = S.useT()
  const tr = useTr()
  const l = useLocale()
  const reduced = useNavi(s => s.ui.reduced)
  const savedCount = useNavi(s => s.col.saved.length)
  const small = useBox().compact
  const [page, setPage] = useState<'doors' | 'ota'>('doors')
  const [leaving, setLeaving] = useState<EntranceMode | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
  }, [])

  const go = (mode: EntranceMode) => {
    if (leaving) return
    sound.play('open')
    if (mode === 'voucher' && page === 'doors') {
      setPage('ota')
      return
    }
    setLeaving(mode)
    timer.current = setTimeout(() => enterRoom(naviApi, mode), reduced ? 60 : 520)
  }

  const others = LOCALES.filter(x => x.id !== l)
  return (
    <div className={`ent${leaving ? ' is-leaving' : ''}`} data-anchor="entry-ota" data-testid="entry-screen" data-page={page}>
      <div className="ent-bg" aria-hidden="true">
        <span className="ent-beam ent-beam--a" />
        <span className="ent-beam ent-beam--b" />
        <span className="ent-beam ent-beam--c" />
        <span className="ent-floor" />
      </div>
      <AnimatePresence mode="wait" initial={false}>
        {page === 'doors' ? (
          <motion.div
            key="doors"
            className="ent-page"
            initial={{ opacity: 0, x: -30 }}
            animate={leaving && !reduced ? { opacity: 0, scale: 1.08 } : { opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: -40, transition: { duration: 0.18 } }}
            transition={leaving ? { duration: 0.5, ease: [0.4, 0, 0.2, 1] } : SPRING.soft}
          >
            <div className="ent-top">
              <span className="ent-brand">
                <i className="ent-brand__dot" aria-hidden="true" />
                {tr({ key: 'common.brand' })}
              </span>
              <span className="ent-room">
                <b>ROOM 12</b>
                <small>{t('entry.qr')}</small>
              </span>
            </div>

            <div className="ent-hero">
              <EntryBall size={small ? 120 : 160} />
              <div className="ent-floorline" aria-hidden="true">
                {(['minato', 'me', 'saki'] as const).map(m => (
                  <span key={m} className={`ent-orb ent-orb--${m}`}>
                    <i />
                    <em>{tr({ key: `vocab.member.${m}` })}</em>
                  </span>
                ))}
              </div>
              <div className="ent-welcome-ring" aria-hidden="true">
                {others.map((x, i) => (
                  <span key={x.id} className={`ent-hello ent-hello--${i}`} lang={x.htmlLang}>
                    {trIn({ key: 'services.entry.welcome' }, x.id)}
                  </span>
                ))}
              </div>
              <motion.h1 key={l} className="ent-welcome" initial={reduced ? { opacity: 0 } : { opacity: 0, y: 12, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={SPRING.soft}>
                {t('entry.welcome')}
              </motion.h1>
              <p className="ent-tag">{t('entry.tagline')}</p>
            </div>

            <div className="ent-bottom">
              <div className="ent-langbox">
                <LangChips />
                <span className="ent-langnote">{t('entry.lang')}</span>
              </div>

              <div className="ent-how">{t('entry.how')}</div>
              <div className="ent-doors">
                <DoorCard kind="guest" index={0} testid="entry-guest" title={t('entry.guest')} sub={t('entry.guestSub')} onGo={() => go('guest')} />
                <DoorCard
                  kind="continue"
                  index={1}
                  testid="entry-continue"
                  title={t('entry.continue')}
                  sub={savedCount ? t('entry.continueSaved', { n: savedCount }) : t('entry.continueSub')}
                  onGo={() => go('continue')}
                />
                <DoorCard kind="voucher" index={2} testid="entry-voucher" title={t('entry.voucher')} sub={t('entry.voucherSub')} badge={t('ota.mock')} onGo={() => go('voucher')} />
              </div>
              <p className="ent-mock">
                <Icon name="lock" size={12} strokeWidth={2} />
                {t('entry.mock')}
              </p>
            </div>
          </motion.div>
        ) : (
          <motion.div
            key="ota"
            className="ent-page ent-page--ota"
            initial={{ opacity: 0, x: 40 }}
            animate={leaving && !reduced ? { opacity: 0, scale: 1.06 } : { opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 40, transition: { duration: 0.18 } }}
            transition={leaving ? { duration: 0.5, ease: [0.4, 0, 0.2, 1] } : SPRING.soft}
          >
            <OtaFlow onBack={() => setPage('doors')} onDone={() => go('voucher')} />
          </motion.div>
        )}
      </AnimatePresence>
      {leaving ? <span className={`ent-flood ent-flood--${leaving}`} aria-hidden="true" /> : null}
    </div>
  )
}
