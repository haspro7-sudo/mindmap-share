// The record tab (SPEC F-1 S6, D-1…D-12): where the collection is admired. The big rotatable
// ball comes from the shell (slot), then the faces by state with the legend of marks, sleeping
// faces, tonight's wall of light, still-dark areas, the ten pins with public conditions, the
// month calendar with stamps, night pages (seeded demo nights say so), the voice log, My Songs
// and settings. Everything here is personal (data-private) and never shown on the room screen.
import { motion } from 'motion/react'
import { useMemo, useRef, useState, useLayoutEffect, type CSSProperties, type ReactNode, type RefObject } from 'react'
import type { AreaKey, Face, Night, Tempo } from '../../core/types'
import { naviApi, useNavi } from '../../core/store'
import { useNaviStable } from '../../core/useStable'
import { selFaceStats } from '../../core/selectors'
import { areaColor, gapAreas, isSleeping } from '../../core/rules'
import { sound } from '../../core/sound'
import { SONGS, SONG_BY_ID, GENRES, type Genre } from '../../data/songs'
import { useLocale, useTr, varText } from '../../i18n'
import { SongTitle } from '../../core/ui/SongTitle'
import { Icon } from '../../core/ui/Icon'
import { FACE_STATES, FaceSwatch, MARKS, MarkGlyph, SectionHead, StampArt } from './parts'
import { Pins } from './Pins'
import { Calendar } from './Calendar'
import { VoiceLog } from './VoiceLog'
import { SavedList } from './SavedList'
import { Settings } from './Settings'
import { WallConstellation } from './WallConstellation'
import { useNightName } from './useNight'
import { R } from './strings'

const TOTAL = SONGS.length

/** Section wrapper: rises into view once (transform/opacity only). */
function Sec({ children, className, reduced, testid }: { children: ReactNode; className?: string; reduced: boolean; testid?: string }) {
  return (
    <motion.section
      className={`rc-sec${className ? ` ${className}` : ''}`}
      data-testid={testid}
      initial={reduced ? false : { opacity: 0, y: 18 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '0px 0px -30px 0px' }}
      transition={{ duration: 0.42, ease: [0.2, 0.8, 0.2, 1] }}
    >
      {children}
    </motion.section>
  )
}

/** Width of an element, measured once and on resize (for the SVG constellation). */
function useWidth<T extends HTMLElement>(fallback: number): [RefObject<T>, number] {
  const ref = useRef<T>(null)
  const [w, setW] = useState(fallback)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => setW(v => (Math.abs(v - el.clientWidth) > 1 && el.clientWidth > 0 ? el.clientWidth : v))
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, w]
}

export function RecordScreen(p: { ball: ReactNode }): JSX.Element {
  const t = R.useT()
  const reduced = useNavi(s => s.ui.reduced)
  const stats = useNaviStable(selFaceStats)
  const faces = useNavi(s => s.col.faces)
  const pins = useNavi(s => s.col.pins)
  const nights = useNavi(s => s.col.nights)
  const voices = useNavi(s => s.col.voices)
  const saved = useNavi(s => s.col.saved)
  const nightId = useNavi(s => s.session.nightId)
  const phase = useNavi(s => s.session.phase)
  const tonight = nights.find(n => n.id === nightId)
  const gaps = useMemo(() => gapAreas(faces, SONGS), [faces])
  const now = Date.now()
  const sleeping = useMemo(() => Object.values(faces).filter(f => isSleeping(f, now)), [faces])

  return (
    <div className="rc" data-testid="record-screen" data-anchor="record" data-private="1" aria-label={t('screen.aria')}>
      <i className="rc-veil" aria-hidden="true" />
      {phase === 'closed' && tonight ? <Farewell night={tonight} reduced={reduced} /> : null}

      <Hero ball={p.ball} lit={stats.lit} faces={faces} reduced={reduced} tonight={tonight?.facesGained.length ?? 0} />

      <Sec reduced={reduced} className="rc-sec--faces">
        <SectionHead label="FACES" title={t('faces.title')} aside={t('faces.total', { n: stats.total })} />
        <div className="rc-states" data-testid="record-stats" data-sketch={stats.sketch} data-neon={stats.neon} data-mirror={stats.mirror} data-prism={stats.prism} data-lit={stats.lit}>
          {FACE_STATES.map(st => (
            <div key={st} className={`rc-state rc-state--${st}`}>
              <FaceSwatch state={st} size={38} songId={st === 'neon' ? 'marigold' : undefined} />
              <b className="rc-state__n">{stats[st]}</b>
              <span className="rc-state__name">{t(`state.${st}`)}</span>
              <span className="rc-state__how">{t(`how.${st}`)}</span>
            </div>
          ))}
        </div>
        <h4 className="rc-sub">{t('marks.title')}</h4>
        <ul className="rc-marks">
          {MARKS.map(m => (
            <li key={m} className="rc-marks__item">
              <MarkGlyph mark={m} size={24} />
              <span className="rc-marks__txt">
                <b>{t(`mark.${m}`)}</b>
                <span>{t(`markHow.${m}`)}</span>
              </span>
            </li>
          ))}
        </ul>
      </Sec>

      {sleeping.length ? (
        <Sec reduced={reduced} className="rc-sec--sleep">
          <SectionHead label="SLEEPING" title={t('sleep.title')} aside={String(sleeping.length)} sub={t('sleep.body')} />
          <ul className="rc-list">
            {sleeping.slice(0, 6).map(f => (
              <SleepRow key={f.songId} face={f} />
            ))}
          </ul>
        </Sec>
      ) : null}

      {tonight && tonight.points.length ? (
        <Sec reduced={reduced} className="rc-sec--tonight">
          <SectionHead label="TONIGHT" title={t('tonight.title')} sub={t('tonight.sub')} />
          <TonightWall night={tonight} />
        </Sec>
      ) : null}

      <Sec reduced={reduced} className="rc-sec--gaps">
        <SectionHead label="DARK AREAS" title={t('gaps.title')} aside={gaps.length ? String(gaps.length) : undefined} sub={gaps.length ? t('gaps.body') : undefined} />
        {gaps.length ? (
          <ul className="rc-list">
            {gaps.slice(0, 5).map(a => (
              <GapRow key={a} area={a} />
            ))}
          </ul>
        ) : (
          <p className="rc-empty">{t('gaps.none')}</p>
        )}
      </Sec>

      <Sec reduced={reduced} className="rc-sec--pins">
        <SectionHead label="PINS" title={t('pins.title')} aside={t('pins.got', { n: pins.length })} sub={t('pins.body')} />
        <Pins pins={pins} reduced={reduced} />
      </Sec>

      <Sec reduced={reduced} className="rc-sec--cal">
        <SectionHead label="CALENDAR" title={t('cal.title')} sub={t('cal.body')} />
        <Calendar nights={nights} tonightId={nightId} mode="record" onOpenNight={id => naviApi.getState().openSheet('night', { nightId: id })} />
      </Sec>

      <Sec reduced={reduced} className="rc-sec--nights">
        <SectionHead label="NIGHTS" title={t('nights.title')} aside={String(nights.length)} />
        <ul className="rc-nights">
          {[...nights].reverse().map(n => (
            <NightRow key={n.id} night={n} tonight={n.id === nightId} />
          ))}
        </ul>
      </Sec>

      {voices.length ? (
        <Sec reduced={reduced} className="rc-sec--voice">
          <SectionHead label="VOICE" title={t('voice.title')} />
          <VoiceLog voices={voices} />
        </Sec>
      ) : null}

      {saved.length ? (
        <Sec reduced={reduced} className="rc-sec--saved">
          <SectionHead label="MY SONGS" title={t('saved.title')} aside={String(saved.length)} sub={t('saved.body')} />
          <SavedList saved={saved} />
        </Sec>
      ) : null}

      <Sec reduced={reduced} className="rc-sec--set">
        <SectionHead label="SETTINGS" title={t('set.title')} />
        <Settings />
      </Sec>
    </div>
  )
}

// ---------------------------------------------------------------- hero

function Hero({ ball, lit, faces, reduced, tonight }: { ball: ReactNode; lit: number; faces: Record<string, Face>; reduced: boolean; tonight: number }) {
  const t = R.useT()
  const tr = useTr()
  const bands = useMemo(() => {
    const total = new Map<Genre, number>()
    const on = new Map<Genre, number>()
    for (const s of SONGS) total.set(s.genre, (total.get(s.genre) ?? 0) + 1)
    for (const id of Object.keys(faces)) {
      const g = SONG_BY_ID[id]?.genre
      if (g) on.set(g, (on.get(g) ?? 0) + 1)
    }
    return GENRES.map(g => ({ g, n: total.get(g) ?? 0, k: on.get(g) ?? 0 }))
  }, [faces])
  const top = [...bands]
    .filter(b => b.k > 0)
    .sort((a, b) => b.k - a.k)
    .slice(0, 4)
  return (
    <section className="rc-hero">
      <div className="rc-hero__head">
        <span className="rc-lbl">MY MIRRORBALL</span>
        <h2 className="rc-hero__title">{t('hero.title')}</h2>
      </div>
      <div className="rc-hero__stage">
        <i className={`rc-hero__rays${reduced ? ' is-still' : ''}`} aria-hidden="true" />
        <i className="rc-hero__halo" aria-hidden="true" />
        <div className="rc-hero__ball">{ball}</div>
        <i className="rc-hero__floor" aria-hidden="true" />
      </div>
      <div className="rc-hero__count">
        <b className="rc-hero__lit">{lit}</b>
        <span className="rc-hero__of">
          <span className="rc-hero__litrow">
            {t('hero.lit')}
            {tonight > 0 ? (
              <motion.span
                className="rc-hero__tonight"
                initial={reduced ? false : { scale: 0.4, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: 'spring', stiffness: 500, damping: 22, delay: 0.3 }}
              >
                {t('hero.tonight', { n: tonight })}
              </motion.span>
            ) : null}
          </span>
          <span className="rc-hero__total">{t('hero.of', { total: TOTAL })}</span>
        </span>
      </div>
      <div className="rc-bands" role="img" aria-label={bands.map(b => `${tr({ key: `vocab.genre.${b.g}` })} ${b.k}/${b.n}`).join(', ')}>
        {bands.map(b => (
          <span key={b.g} className="rc-bands__seg" style={{ flexGrow: Math.max(1, b.n), ['--c' as string]: areaColor(b.g) } as CSSProperties}>
            <i style={{ transform: `scaleX(${b.n ? Math.min(1, b.k / b.n) : 0})` }} />
          </span>
        ))}
      </div>
      {top.length ? (
        <div className="rc-bands__legend">
          {top.map(b => (
            <span key={b.g} className="rc-bands__chip">
              <i style={{ background: areaColor(b.g) }} />
              {tr({ key: `vocab.genre.${b.g}` })} <b>{b.k}</b>
            </span>
          ))}
        </div>
      ) : null}
      <p className="rc-hero__hint">{lit ? t('hero.hint') : t('hero.empty')}</p>
    </section>
  )
}

// ---------------------------------------------------------------- farewell (closed phase)

function Farewell({ night, reduced }: { night: Night; reduced: boolean }) {
  const t = R.useT()
  const tr = useTr()
  const linked = useNavi(s => s.session.linked)
  const name = useNightName(night)!
  return (
    <motion.section className="rc-bye" initial={reduced ? false : { opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
      <StampArt night={night} size={64} className="rc-bye__stamp" />
      <div className="rc-bye__txt">
        <b className="rc-bye__title">{t('bye.title')}</b>
        <span className="rc-bye__name">{tr(name)}</span>
        <p className="rc-bye__body">{t('bye.body')}</p>
        <span className="rc-bye__link">
          <Icon name={linked ? 'key' : 'lock'} size={14} />
          {linked ? t('bye.linked') : t('bye.local')}
        </span>
      </div>
    </motion.section>
  )
}

// ---------------------------------------------------------------- rows

function SleepRow({ face }: { face: Face }) {
  const t = R.useT()
  const l = useLocale()
  return (
    <li className="rc-row">
      <FaceSwatch state={face.state} songId={face.songId} size={34} moon marks={face.marks} />
      <div className="rc-row__txt">
        <SongTitle songId={face.songId} variant="chip" className="rc-row__title" />
        <span className="rc-row__meta">{t('sleep.last', { date: varText({ date: face.lastSungAt ?? face.firstAt }, l) })}</span>
      </div>
      <button
        type="button"
        className="rc-mini-btn is-moon"
        onClick={() => {
          sound.play('tap')
          naviApi.getState().openSheet('face', { songId: face.songId })
        }}
      >
        {t('sleep.polish')}
      </button>
    </li>
  )
}

const TEMPO_Y: Record<Tempo, number> = { fast: 5.5, mid: 11, slow: 16.5 }

function GapRow({ area }: { area: AreaKey }) {
  const t = R.useT()
  const [tempo, genre] = area.split(':') as [Tempo, Genre]
  const n = SONGS.filter(s => s.tempo === tempo && s.genre === genre).length
  const c = areaColor(genre)
  return (
    <li className="rc-row rc-row--gap">
      <svg className="rc-gap__globe" width="34" height="34" viewBox="0 0 22 22" aria-hidden="true">
        <circle cx="11" cy="11" r="9.5" fill="#150B2E" stroke="rgba(255,255,255,.18)" />
        <ellipse cx="11" cy="11" rx="4.2" ry="9.5" fill="none" stroke="rgba(255,255,255,.1)" />
        <path d={`M3 ${TEMPO_Y[tempo]}h16`} stroke={c} strokeWidth="3.2" strokeLinecap="round" strokeDasharray="1.5 2.2" className="rc-gap__band" />
      </svg>
      <div className="rc-row__txt">
        <span className="rc-row__title">{t('gaps.area', { tempo: { tempo }, genre: { genre } })}</span>
        <span className="rc-row__meta">
          {t(`tempo.${tempo}`)} · {t('gaps.n', { n })}
        </span>
      </div>
      <button
        type="button"
        className="rc-mini-btn"
        data-testid="record-gap-open"
        onClick={() => {
          sound.play('tap')
          naviApi.getState().openSheet('search', { filters: { tempo, genre } })
        }}
      >
        {t('gaps.open')}
        <Icon name="chevron" size={14} strokeWidth={2.4} />
      </button>
    </li>
  )
}

function TonightWall({ night }: { night: Night }) {
  const [ref, w] = useWidth<HTMLDivElement>(340)
  const tr = useTr()
  const name = useNightName(night)!
  return (
    <div className="rc-tonight" ref={ref}>
      <WallConstellation night={night} width={w} height={Math.round(Math.min(200, w * 0.5))} draw />
      <span className="rc-tonight__name">{tr(name)}</span>
    </div>
  )
}

function NightRow({ night, tonight }: { night: Night; tonight: boolean }) {
  const t = R.useT()
  const tr = useTr()
  const l = useLocale()
  const name = useNightName(night)!
  const mine = night.points.filter(p => p.by === 'me').length
  return (
    <li>
      <button
        type="button"
        className={`rc-night${tonight ? ' is-tonight' : ''}`}
        data-testid="record-night"
        data-night={night.id}
        onClick={() => naviApi.getState().openSheet('night', { nightId: night.id })}
      >
        <StampArt night={night} size={52} className={`rc-night__stamp${night.stamped ? '' : ' is-faint'}`} />
        <span className="rc-night__txt">
          <span className="rc-night__top">
            <span className="rc-night__date">{varText({ date: night.startedAt }, l)}</span>
            {tonight ? <span className="rc-badge is-tonight">{t('nights.tonight')}</span> : null}
            {night.seeded ? (
              <span className="rc-badge is-demo" data-testid="record-demo-badge">
                {t('nights.demo')}
              </span>
            ) : null}
          </span>
          <b className="rc-night__name">{tr(name)}</b>
          <span className="rc-night__meta">
            {t('nights.faces', { n: night.facesGained.length })} · {t('nights.sung', { n: mine })}
          </span>
        </span>
        <Icon name="chevron" size={16} className="rc-night__go" />
      </button>
    </li>
  )
}
