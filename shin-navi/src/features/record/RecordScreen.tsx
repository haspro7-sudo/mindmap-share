// The record tab (SPEC F-1 S6, D-1…D-12; QA OWNER#8): the collection as a toy. The big rotatable
// ball (a slot from the shell) fills most of the first screen, with one line under it and four
// face-state chips that light only those faces on the ball (fxState.ballHighlight). Tonight's
// wall of light, the calendar and the pins share a horizontal pager under it; the dark areas,
// sleeping faces, night pages, voice log and My Songs follow; the legend of marks lives behind ⓘ
// and the settings behind a single row. Everything here is personal (data-private) and never
// shown on the room screen.
import { AnimatePresence, motion } from 'motion/react'
import { cloneElement, isValidElement, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactElement, type ReactNode, type RefObject } from 'react'
import type { AreaKey, Face, FaceState, Night, Pin, Tempo } from '../../core/types'
import { naviApi, useNavi } from '../../core/store'
import { useNaviStable } from '../../core/useStable'
import { selFaceStats } from '../../core/selectors'
import { areaColor, gapAreas, isSleeping } from '../../core/rules'
import { fxState } from '../../core/fxState'
import { sound } from '../../core/sound'
import { useBox, usePhoneMetrics } from '../../core/layout'
import { SPRING } from '../../core/ui/motion'
import { SONGS, type Genre } from '../../data/songs'
import { LOCALES, songTitle, useLocale, useTr, varText } from '../../i18n'
import { SongTitle } from '../../core/ui/SongTitle'
import { Icon } from '../../core/ui/Icon'
import { FACE_STATES, FaceSwatch, SectionHead, StampArt } from './parts'
import { Pins } from './Pins'
import { Calendar } from './Calendar'
import { VoiceLog } from './VoiceLog'
import { SavedList } from './SavedList'
import { Settings } from './Settings'
import { WallConstellation } from './WallConstellation'
import { MelodyNotes } from './Melody'
import { displayPalette } from './nightName'
import { Pager, type PagerPage } from './Pager'
import { Legend } from './Legend'
import { LocalSheet } from './LocalSheet'
import { useNightName } from './useNight'
import { R } from './strings'

/** Chime per state when a chip lights its faces (C5 E5 G5 C6: the chips play a chord). */
const CHIP_NOTE: Record<FaceState, number> = { sketch: 72, neon: 76, mirror: 79, prism: 84 }

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

/** The first screen belongs to the ball: ≥ 70 % of what is visible between the lane and the dock. */
function useStageSize(): { stageH: number; ball: number } {
  const box = useBox()
  const m = usePhoneMetrics()
  const visible = Math.max(420, box.h - m.status - m.dock - m.laneCompact)
  const stageH = Math.round(visible * 0.7)
  const ball = Math.round(Math.max(220, Math.min(box.w - 44, stageH - 118, 356)))
  return { stageH, ball }
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
  const root = useRef<HTMLDivElement>(null)
  const { stageH, ball } = useStageSize()
  const sized = isValidElement(p.ball) ? cloneElement(p.ball as ReactElement<{ size?: number }>, { size: ball }) : p.ball

  // the chips light one state on the ball (the ball dims the rest); cleared when the tab goes
  const [sel, setSel] = useState<FaceState | null>(null)
  useEffect(() => {
    fxState.ballHighlight = sel
  }, [sel])
  useEffect(
    () => () => {
      fxState.ballHighlight = null
    },
    [],
  )
  const pick = (st: FaceState) => {
    sound.play('faceChime', { note: CHIP_NOTE[st] })
    setSel(v => (v === st ? null : st))
  }

  const [sheet, setSheet] = useState<'legend' | 'settings' | null>(null)

  const pages: PagerPage[] = [
    { id: 'wall', label: t('pager.wall'), node: <TonightPage night={tonight} faces={faces} /> },
    { id: 'cal', label: t('cal.title'), node: <CalendarPage nights={nights} tonightId={nightId} /> },
    { id: 'pins', label: t('pins.title'), aside: t('pins.got', { n: pins.length }), node: <PinsPage pins={pins} reduced={reduced} /> },
  ]

  return (
    <div className="rc" ref={root} data-testid="record-screen" data-anchor="record" data-private="1" data-sel={sel ?? ''} aria-label={t('screen.aria')}>
      <i className="rc-veil" aria-hidden="true" />
      {phase === 'closed' && tonight ? <Farewell night={tonight} reduced={reduced} /> : null}

      <Stage ball={sized} height={stageH} lit={stats.lit} sel={sel} reduced={reduced} onInfo={() => setSheet('legend')} />
      <HeroLine lit={stats.lit} tonight={tonight?.facesGained.length ?? 0} sel={sel} count={sel ? stats[sel] : 0} reduced={reduced} />
      <div
        className={`rc-chips${sel ? ' has-sel' : ''}`}
        role="group"
        aria-label={t('faces.title')}
        data-testid="record-stats"
        data-sketch={stats.sketch}
        data-neon={stats.neon}
        data-mirror={stats.mirror}
        data-prism={stats.prism}
        data-lit={stats.lit}
      >
        {FACE_STATES.map(st => (
          <motion.button
            key={st}
            type="button"
            className={`rc-chip rc-chip--${st}${sel === st ? ' is-on' : ''}${stats[st] ? '' : ' is-zero'}`}
            data-testid="record-state-chip"
            data-state={st}
            aria-pressed={sel === st}
            onClick={() => pick(st)}
            whileTap={reduced ? undefined : { scale: 0.93 }}
            transition={SPRING.snappy}
          >
            <i className="rc-chip__glow" aria-hidden="true" />
            <span className="rc-chip__top">
              <FaceSwatch state={st} size={20} songId={st === 'neon' ? 'marigold' : undefined} className="rc-chip__sw" />
              <b className="rc-chip__n">{stats[st]}</b>
            </span>
            <span className="rc-chip__name">{t(`state.${st}`)}</span>
          </motion.button>
        ))}
      </div>

      <Pager pages={pages} label={t('pager.label')} reduced={reduced} />

      <Sec reduced={reduced} className="rc-sec--gaps">
        <SectionHead label="DARK AREAS" title={t('gaps.title')} aside={gaps.length ? String(gaps.length) : undefined} sub={gaps.length ? t('gaps.body') : undefined} />
        {gaps.length ? (
          <ul className="rc-list rc-list--gaps">
            {gaps.slice(0, 5).map(a => (
              <GapRow key={a} area={a} />
            ))}
          </ul>
        ) : (
          <p className="rc-empty">{t('gaps.none')}</p>
        )}
      </Sec>

      {sleeping.length ? (
        <Sec reduced={reduced} className="rc-sec--sleep">
          <SectionHead label="SLEEPING" title={t('sleep.title')} aside={String(sleeping.length)} sub={t('sleep.body')} />
          <ul className="rc-moons">
            {sleeping.slice(0, 12).map(f => (
              <SleepRow key={f.songId} face={f} />
            ))}
          </ul>
        </Sec>
      ) : null}

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

      <SettingsRow onOpen={() => setSheet('settings')} />

      <LocalSheet id="legend" anchor={root} open={sheet === 'legend'} onClose={() => setSheet(null)} title={t('legend.open')}>
        <Legend faces={faces} />
      </LocalSheet>
      <LocalSheet id="settings" anchor={root} open={sheet === 'settings'} onClose={() => setSheet(null)} title={t('set.title')}>
        <div className="rc-setsheet">
          <Settings />
        </div>
      </LocalSheet>
    </div>
  )
}

// ---------------------------------------------------------------- the stage (the ball, full-bleed)

function InfoGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="8.6" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M12 10.8v5.6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
      <circle cx="12" cy="7.7" r="1.35" fill="currentColor" />
    </svg>
  )
}

function Stage({ ball, height, lit, sel, reduced, onInfo }: { ball: ReactNode; height: number; lit: number; sel: FaceState | null; reduced: boolean; onInfo(): void }) {
  const t = R.useT()
  return (
    <section className={`rc-stage${sel ? ` is-sel is-sel-${sel}` : ''}${reduced ? ' is-still' : ''}`} style={{ height }} data-testid="record-stage">
      <i className="rc-stage__rays" aria-hidden="true" />
      <i className="rc-stage__beam is-l" aria-hidden="true" />
      <i className="rc-stage__beam is-r" aria-hidden="true" />
      <i className="rc-stage__halo" aria-hidden="true" />
      {FACE_STATES.map(st => (
        <i key={st} className={`rc-stage__tint is-${st}${sel === st ? ' is-on' : ''}`} aria-hidden="true" />
      ))}
      <i className="rc-stage__floor" aria-hidden="true" />
      <div className="rc-stage__top">
        <span className="rc-lbl">MY MIRRORBALL</span>
        <button type="button" className="rc-stage__info" data-testid="record-legend-open" aria-label={t('legend.open')} onClick={onInfo}>
          <InfoGlyph />
        </button>
      </div>
      <div className="rc-stage__ball">{ball}</div>
      <p className={`rc-stage__hint${lit ? '' : ' is-empty'}`}>{lit ? t('hero.hint') : t('hero.empty')}</p>
    </section>
  )
}

/** One line under the ball: "33 faces lit · Tonight +3", or what the chosen chip means. */
function HeroLine({ lit, tonight, sel, count, reduced }: { lit: number; tonight: number; sel: FaceState | null; count: number; reduced: boolean }) {
  const t = R.useT()
  const litText = t('hero.litN', { n: lit })
  const [pre, post] = litText.includes(String(lit)) ? [litText.slice(0, litText.indexOf(String(lit))), litText.slice(litText.indexOf(String(lit)) + String(lit).length)] : ['', litText]
  const anim = reduced ? { initial: false as const, animate: { opacity: 1 }, exit: { opacity: 0 } } : { initial: { opacity: 0, y: 6 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: -6 } }
  return (
    <div className="rc-line" data-testid="record-line" aria-live="polite">
      <AnimatePresence mode="wait" initial={false}>
        {sel ? (
          <motion.p key={sel} className={`rc-line__txt is-sel is-${sel}`} {...anim} transition={{ duration: 0.18 }}>
            <FaceSwatch state={sel} size={16} songId={sel === 'neon' ? 'marigold' : undefined} />
            <b>{t(`state.${sel}`)}</b>
            <span className="rc-line__n">{t('faces.total', { n: count })}</span>
            <span className="rc-line__how">{t(`how.${sel}`)}</span>
          </motion.p>
        ) : (
          <motion.p key="all" className="rc-line__txt" {...anim} transition={{ duration: 0.18 }}>
            <span className="rc-line__lit">
              {pre}
              <b>{lit}</b>
              {post}
            </span>
            {tonight > 0 ? (
              <motion.span
                className="rc-line__tonight"
                initial={reduced ? false : { scale: 0.4, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: 'spring', stiffness: 500, damping: 22, delay: 0.3 }}
              >
                {t('hero.tonight', { n: tonight })}
              </motion.span>
            ) : null}
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  )
}

// ---------------------------------------------------------------- pager pages

function TonightPage({ night, faces }: { night: Night | undefined; faces: Record<string, Face> }) {
  const t = R.useT()
  const tr = useTr()
  const l = useLocale()
  const [ref, w] = useWidth<HTMLDivElement>(320)
  const name = useNightName(night)
  const [playKey, setPlayKey] = useState(0)
  const stop = useRef<(() => void) | null>(null)
  useEffect(() => () => stop.current?.(), [])
  const play = () => {
    if (!night?.melody.length) return
    stop.current?.()
    stop.current = sound.playMelody(night.melody)
    setPlayKey(k => k + 1)
  }
  const points = night?.points.length ?? 0
  const gained = night?.facesGained ?? []
  return (
    <div className="rc-pg rc-pg--wall">
      <p className="rc-pg__sub">{t('tonight.sub')}</p>
      <div className="rc-tonight" ref={ref}>
        {night ? <WallConstellation night={night} width={w} height={Math.round(Math.min(190, w * 0.56))} draw /> : null}
        {points && name ? <span className="rc-tonight__name">{tr(name)}</span> : null}
      </div>
      {night?.melody.length ? (
        <div className="rc-pg__melody">
          <MelodyNotes notes={night.melody} playKey={playKey} palette={displayPalette(night)} />
          <button type="button" className="rc-mini-btn is-play" data-testid="record-melody-play" onClick={play}>
            <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M8 5.5v13l10.5-6.5z" fill="currentColor" />
            </svg>
            {t('night.play')}
          </button>
        </div>
      ) : (
        <p className="rc-pg__note">{t('wrap.noMelody')}</p>
      )}
      {gained.length ? (
        <div className="rc-pg__faces">
          <span className="rc-pg__h">
            {t('wrap.p1')}
            <b>+{gained.length}</b>
          </span>
          <div className="rc-pg__tiles">
            {gained.slice(0, 16).map(id => (
              <button
                key={id}
                type="button"
                className="rc-pg__tile"
                data-testid="record-tonight-face"
                data-song={id}
                aria-label={songTitle(id, l).main}
                onClick={() => {
                  sound.play('tap')
                  naviApi.getState().openSheet('face', { songId: id })
                }}
              >
                <FaceSwatch state={faces[id]?.state ?? 'sketch'} songId={id} size={30} marks={faces[id]?.marks} />
              </button>
            ))}
            {gained.length > 16 ? <span className="rc-pg__more">+{gained.length - 16}</span> : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}

function CalendarPage({ nights, tonightId }: { nights: Night[]; tonightId: string }) {
  const t = R.useT()
  return (
    <div className="rc-pg rc-pg--cal">
      <p className="rc-pg__sub">{t('cal.body')}</p>
      <Calendar nights={nights} tonightId={tonightId} mode="record" onOpenNight={id => naviApi.getState().openSheet('night', { nightId: id })} />
    </div>
  )
}

function PinsPage({ pins, reduced }: { pins: Pin[]; reduced: boolean }) {
  const t = R.useT()
  return (
    <div className="rc-pg rc-pg--pins">
      <p className="rc-pg__sub">{t('pins.body')}</p>
      <Pins pins={pins} reduced={reduced} />
    </div>
  )
}

// ---------------------------------------------------------------- settings: one row, a sheet behind it

function SettingsRow({ onOpen }: { onOpen(): void }) {
  const t = R.useT()
  const locale = useLocale()
  const muted = useNavi(s => s.session.muted)
  const lang = LOCALES.find(l => l.id === locale)?.label ?? locale
  return (
    <button type="button" className="rc-setrow" data-testid="record-settings" onClick={onOpen}>
      <span className="rc-setrow__icon" aria-hidden="true">
        <svg width="20" height="20" viewBox="0 0 24 24">
          <path
            d="M12 8.6a3.4 3.4 0 1 1 0 6.8a3.4 3.4 0 0 1 0-6.8zM10.3 3.5h3.4l.5 2.3 1.6.9 2.2-.8 1.7 2.9-1.8 1.6v1.9l1.8 1.6-1.7 2.9-2.2-.8-1.6.9-.5 2.3h-3.4l-.5-2.3-1.6-.9-2.2.8-1.7-2.9 1.8-1.6v-1.9L4.4 8.8l1.7-2.9 2.2.8 1.6-.9z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
        </svg>
      </span>
      <b className="rc-setrow__k">{t('set.title')}</b>
      <span className="rc-setrow__v">
        {lang} · {t('set.sound')} {muted ? t('set.off') : t('set.on')}
      </span>
      <Icon name="chevron" size={16} className="rc-setrow__go" />
    </button>
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

/** A sleeping face on the moon shelf: tap it to open the face and polish it there. */
function SleepRow({ face }: { face: Face }) {
  const t = R.useT()
  const l = useLocale()
  return (
    <li>
      <button
        type="button"
        className="rc-moon"
        data-testid="record-sleeping"
        data-song={face.songId}
        onClick={() => {
          sound.play('tap')
          naviApi.getState().openSheet('face', { songId: face.songId })
        }}
      >
        <FaceSwatch state={face.state} songId={face.songId} size={40} moon marks={face.marks} />
        <SongTitle songId={face.songId} variant="chip" className="rc-moon__title" />
        <span className="rc-moon__meta">{t('sleep.last', { date: varText({ date: face.lastSungAt ?? face.firstAt }, l) })}</span>
        <span className="rc-moon__go">{t('sleep.polish')}</span>
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
    <li>
      <button
        type="button"
        className="rc-row rc-row--gap"
        data-testid="record-gap-open"
        onClick={() => {
          sound.play('tap')
          naviApi.getState().openSheet('search', { filters: { tempo, genre } })
        }}
      >
        <svg className="rc-gap__globe" width="34" height="34" viewBox="0 0 22 22" aria-hidden="true">
          <circle cx="11" cy="11" r="9.5" fill="#150B2E" stroke="rgba(255,255,255,.18)" />
          <ellipse cx="11" cy="11" rx="4.2" ry="9.5" fill="none" stroke="rgba(255,255,255,.1)" />
          <path d={`M3 ${TEMPO_Y[tempo]}h16`} stroke={c} strokeWidth="3.2" strokeLinecap="round" strokeDasharray="1.5 2.2" className="rc-gap__band" />
        </svg>
        <span className="rc-row__txt">
          <span className="rc-row__title">{t('gaps.area', { tempo: { tempo }, genre: { genre } })}</span>
          <span className="rc-row__meta">
            {t(`tempo.${tempo}`)} · {t('gaps.n', { n })}
          </span>
        </span>
        <span className="rc-gap__open">
          {t('gaps.open')}
          <Icon name="chevron" size={14} strokeWidth={2.4} />
        </span>
      </button>
    </li>
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
