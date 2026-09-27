// Tonight's recap (SPEC F-1 S10, D-7…D-9, C-4, D-13): five pages opened by a fanfare —
// 1 tonight's faces (the ball with tonight's faces pulsing), 2 tonight's voice and the applause
// light I received, 3 the songs everyone knew, 4 the wall of light with its automatic name and
// tonight's melody, 5 the calendar stamp (press and hold 600 ms). Each page advances on a tap or
// by itself after 4 s. Then two equal-width choices — take it home to My Songs / keep it on this
// device — name and close the night, and the optional five questions follow.
// Nothing here counts days in a row, threatens a loss or hurries anyone.
import { AnimatePresence, motion } from 'motion/react'
import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent, type ReactNode } from 'react'
import type { MemberId, Night, SongId, SungEntry, VoiceReading } from '../../core/types'
import { naviApi, useNavi, presentMembers, isMine } from '../../core/store'
import { useNaviStable } from '../../core/useStable'
import { selTonight } from '../../core/selectors'
import { sound } from '../../core/sound'
import { useBox } from '../../core/layout'
import { SPRING } from '../../core/ui/motion'
import { Icon } from '../../core/ui/Icon'
import { SongTitle } from '../../core/ui/SongTitle'
import { VoiceOrb } from '../../core/ui/VoiceOrb'
import { SONG_BY_ID } from '../../data/songs'
import { useTr } from '../../i18n'
import { FACE_STATES, FaceSwatch, StampArt } from './parts'
import { WallConstellation } from './WallConstellation'
import { Calendar, InkBurst, useHold, useLanded } from './Calendar'
import { MelodyNotes, melodyMs } from './Melody'
import { displayPalette, factsFrom, nightName, weekdayOf } from './nightName'
import { selCommon, takeHomeSongs } from './model'
import { R } from './strings'

export const WRAP_PAGE_MS = 4000
const PAGES = [1, 2, 3, 4, 5] as const
const LABELS = ["TONIGHT'S FACES", "TONIGHT'S VOICE", 'EVERYONE KNEW', 'WALL OF LIGHT', 'STAMP']

export function WrapOverlay(p: { renderBall: (o: { flashSongIds: SongId[] }) => ReactNode }): JSX.Element {
  const t = R.useT()
  const reduced = useNavi(s => s.ui.reduced)
  const raw = useNavi(selTonight)
  // until closeNight stores it, tonight's palette follows its base colour
  const tonight = useMemo(() => ({ ...raw, palette: displayPalette(raw) }), [raw])
  const [page, setPage] = useState(1)
  const [done, setDone] = useState(false)
  const root = useRef<HTMLDivElement>(null)

  // the fanfare opens the recap (the sound installer also cues it; duplicates are merged)
  useEffect(() => {
    sound.play('fanfare')
  }, [])

  // tap or 4 s per page; the melody page waits for the tune to finish (at most 10 s)
  const melodyLen = tonight.melody.length
  useEffect(() => {
    if (page >= 5 || done) return
    // page 4 counts its 4 s from when the wall is drawn and named (≈2.6 s), or waits for the tune
    const ms = page === 4 ? Math.min(10_000, Math.max(WRAP_PAGE_MS + 2600, melodyMs(melodyLen) + 900)) : WRAP_PAGE_MS
    const id = window.setTimeout(() => setPage(x => Math.min(5, x + 1)), ms)
    return () => window.clearTimeout(id)
  }, [page, done])

  const go = (n: number) => {
    const next = Math.max(1, Math.min(5, n))
    if (next !== page) sound.play('flip')
    setPage(next)
  }
  const onTap = (e: MouseEvent<HTMLDivElement>) => {
    const el = e.target as Element | null
    if (!el || el.closest('button, a, input, [data-noadvance]')) return
    const r = root.current?.getBoundingClientRect()
    if (r && e.clientX - r.left < r.width * 0.22) go(page - 1)
    else go(page + 1)
  }

  const [a, b, c] = tonight.palette
  const finish = (linked: boolean) => {
    if (done) return
    setDone(true)
    const s = naviApi.getState()
    const night = selTonight(s)
    s.nameNight(nightName(night, { weekday: weekdayOf(night), facts: factsFrom(s.room.sung, s.col.pins, s.session.nightId) }))
    if (linked) for (const x of takeHomeSongs(s)) s.saveSong(x.songId, x.version, 'wrap')
    sound.play(linked ? 'orbPop' : 'close')
    s.closeNight({ linked })
    s.setTab('record')
    s.openSheet('survey')
  }

  return (
    <div
      ref={root}
      className={`rw${reduced ? ' is-reduced' : ''}`}
      data-testid="wrap"
      data-anchor="wrap"
      data-private="1"
      data-page={page}
      style={{ ['--w1' as string]: a, ['--w2' as string]: b, ['--w3' as string]: c } as CSSProperties}
      onClick={onTap}
    >
      <div className="rw__bg" aria-hidden="true">
        <i className="rw__glow g1" />
        <i className="rw__glow g2" />
        <i className="rw__glow g3" />
        <i className="rw__rays" />
        <Twinkles />
      </div>

      <header className="rw__top">
        <span className="rw__brand">
          <i className="rw__mark" />
          {t('wrap.title')}
        </span>
        <nav className="rw__dots" aria-label={t('wrap.title')}>
          {PAGES.map(n => (
            <button
              key={n}
              type="button"
              className={`rw__dot${n === page ? ' is-on' : n < page ? ' is-past' : ''}`}
              aria-current={n === page ? 'step' : undefined}
              aria-label={t(`wrap.p${n}`)}
              onClick={() => go(n)}
            />
          ))}
        </nav>
        {page < 5 ? (
          <button type="button" className="rw__skip" data-testid="wrap-skip" onClick={() => go(5)}>
            {t('wrap.skip')}
            <Icon name="chevron" size={14} strokeWidth={2.4} />
          </button>
        ) : (
          <span className="rw__skip is-ghost" />
        )}
      </header>

      <main className="rw__main">
        <AnimatePresence mode="wait" initial={false}>
          <motion.section
            key={page}
            className={`rw-page rw-page--${page}`}
            data-testid="wrap-page"
            data-page={page}
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: 26, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, y: -18, scale: 0.99 }}
            transition={reduced ? { duration: 0.2 } : { duration: 0.34, ease: [0.2, 0.8, 0.2, 1] }}
          >
            <PageLabel n={page} />
            <div className="rw-page__body">
              {page === 1 ? <P1Faces night={tonight} renderBall={p.renderBall} reduced={reduced} /> : null}
              {page === 2 ? <P2Voice night={tonight} reduced={reduced} /> : null}
              {page === 3 ? <P3Common reduced={reduced} /> : null}
              {page === 4 ? <P4Wall night={tonight} reduced={reduced} /> : null}
              {page === 5 ? <P5Stamp night={tonight} /> : null}
            </div>
          </motion.section>
        </AnimatePresence>
      </main>

      <footer className="rw__foot">
        {page < 5 ? (
          <span className="rw__tap">
            {t('wrap.tap')}
            <Icon name="chevron" size={14} strokeWidth={2.2} />
          </span>
        ) : (
          <SaveChoice onChoose={finish} disabled={done} />
        )}
      </footer>
    </div>
  )
}

function PageLabel({ n }: { n: number }) {
  const t = R.useT()
  return (
    <div className="rw-label">
      <span className="rw-label__n">{String(n).padStart(2, '0')}</span>
      <span className="rw-label__txt">
        <span className="rc-lbl">{LABELS[n - 1]}</span>
        <b>{t(`wrap.p${n}`)}</b>
      </span>
    </div>
  )
}

/** Soft twinkling points on the wall (CSS opacity only). */
function Twinkles() {
  const stars = useMemo(
    () =>
      Array.from({ length: 22 }, (_, i) => {
        const r = (k: number) => {
          const x = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453
          return x - Math.floor(x)
        }
        return { x: r(1) * 100, y: r(2) * 100, s: 1.5 + r(3) * 2.5, d: r(4) * 4, p: 2.4 + r(5) * 3 }
      }),
    [],
  )
  return (
    <>
      {stars.map((s, i) => (
        <i key={i} className="rw__star" style={{ left: `${s.x}%`, top: `${s.y}%`, width: s.s, height: s.s, animationDelay: `${s.d}s`, animationDuration: `${s.p}s` }} />
      ))}
    </>
  )
}

// ---------------------------------------------------------------- page 1: tonight's faces

function P1Faces({ night, renderBall, reduced }: { night: Night; renderBall: (o: { flashSongIds: SongId[] }) => ReactNode; reduced: boolean }) {
  const t = R.useT()
  const faces = useNavi(s => s.col.faces)
  const gained = night.facesGained
  const counts = FACE_STATES.map(st => ({ st, n: gained.filter(id => faces[id]?.state === st).length })).filter(x => x.n > 0)
  const ball = useMemo(() => renderBall({ flashSongIds: gained }), [gained.join(',')])
  const box = useBox()
  const k = Math.max(0.86, Math.min(1.28, (box.h - 540) / 230))
  return (
    <div className="rw-p1" style={{ ['--ball-k' as string]: k.toFixed(3) } as CSSProperties}>
      <div className="rw-p1__ball">
        <i className="rw-p1__ring" aria-hidden="true" />
        {ball}
      </div>
      <div className="rw-big">
        {gained.length ? (
          <>
            <motion.b className="rw-big__n" initial={reduced ? false : { scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ ...SPRING.snappy, delay: 0.25 }}>
              +{gained.length}
            </motion.b>
            <span className="rw-big__t">{t('wrap.facesHead', { n: gained.length })}</span>
          </>
        ) : (
          <span className="rw-big__t">{t('wrap.facesNone')}</span>
        )}
      </div>
      {counts.length ? (
        <div className="rw-p1__states">
          {counts.map(({ st, n }, i) => (
            <motion.span key={st} className={`rw-chip is-${st}`} initial={reduced ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.45 + i * 0.08 }}>
              <FaceSwatch state={st} size={18} songId={st === 'neon' ? gained.find(id => faces[id]?.state === 'neon') : undefined} />
              {t(`state.${st}`)} <b>{n}</b>
            </motion.span>
          ))}
        </div>
      ) : null}
      {gained.length ? (
        <ul className="rw-p1__list">
          {gained.slice(0, 6).map((id, i) => (
            <motion.li
              key={id}
              className={`rw-face is-${faces[id]?.state ?? 'sketch'}`}
              initial={reduced ? false : { scale: 0.5, opacity: 0, y: 10 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              transition={{ ...SPRING.snappy, delay: 0.7 + i * 0.09 }}
            >
              <FaceSwatch state={faces[id]?.state ?? 'sketch'} songId={id} size={22} marks={faces[id]?.marks} />
              <SongTitle songId={id} variant="chip" className="rw-face__t" />
            </motion.li>
          ))}
          {gained.length > 6 ? <li className="rw-face is-more">+{gained.length - 6}</li> : null}
        </ul>
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------- page 2: tonight's voice

const TYPE_COLOR: Record<VoiceReading['type'], string> = { clear: '#7FE7FF', power: '#FF5A36', groove: '#C6FF3D', emotional: '#C77DFF' }

function P2Voice({ night, reduced }: { night: Night; reduced: boolean }) {
  const t = R.useT()
  const tr = useTr()
  const voice = useNavi(s => [...s.col.voices].reverse().find(v => v.nightId === s.session.nightId) ?? null)
  const mine = useNaviStable(s => [...new Set(s.room.sung.filter((e: SungEntry) => isMine(e.item)).map(e => e.item.songId))])
  const claps = night.claps
  const crystals = claps > 0 ? Math.min(30, Math.max(8, Math.round(claps / 3))) : 0
  const vc = voice ? TYPE_COLOR[voice.type] : '#D8DCE8'
  return (
    <div className="rw-p2" style={{ ['--vc' as string]: vc } as CSSProperties}>
      <div className="rw-p2__stage">
        {crystals ? <Crystals n={crystals} reduced={reduced} /> : null}
        <i className="rw-p2__pulse" aria-hidden="true" />
        <i className="rw-p2__pulse is-late" aria-hidden="true" />
        <motion.div initial={reduced ? false : { scale: 0.3, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ ...SPRING.soft, delay: 0.15 }}>
          <VoiceOrb reading={voice} size={128} />
        </motion.div>
      </div>
      {voice ? (
        <>
          <p className="rw-p2__type">{t('wrap.voiceType', { type: tr({ key: `vocab.voice.${voice.type}` }) })}</p>
          <p className="rw-sub">{tr(voice.evidence)}</p>
        </>
      ) : (
        <>
          <p className="rw-p2__type is-none">{t('wrap.voiceNone')}</p>
          <p className="rw-sub">{t('wrap.voiceNoneSub')}</p>
        </>
      )}
      <p className="rw-p2__claps">
        <i aria-hidden="true" />
        {claps > 0 ? t('wrap.claps') : t('wrap.clapsNone')}
      </p>
      {mine.length ? (
        <div className="rw-p2__songs">
          <span className="rw-p2__h">{t('wrap.sang')}</span>
          <div className="rw-p2__chips">
            {mine.slice(0, 6).map(id => (
              <span key={id} className="rw-song">
                <FaceSwatch state={'mirror'} size={14} />
                <SongTitle songId={id} variant="chip" />
              </span>
            ))}
          </div>
        </div>
      ) : null}
      <p className="rw-note">{t('voice.note')}</p>
    </div>
  )
}

/** Applause light gathering into the orb — never a number. */
function Crystals({ n, reduced }: { n: number; reduced: boolean }) {
  const list = useMemo(
    () =>
      Array.from({ length: n }, (_, i) => {
        const a = (i / n) * Math.PI * 2 + (i % 3) * 0.4
        const d = 110 + (i % 5) * 16
        return { x: Math.cos(a) * d, y: Math.sin(a) * d * 0.8, delay: (i % 10) * 0.16 + Math.floor(i / 10) * 0.07, c: ['#FFF6D8', '#FFD36B', '#FF6FB1', '#2EF2FF'][i % 4] }
      }),
    [n],
  )
  if (reduced) return null
  return (
    <div className="rw-crystals" aria-hidden="true">
      {list.map((k, i) => (
        <i key={i} style={{ ['--sx' as string]: `${k.x.toFixed(0)}px`, ['--sy' as string]: `${k.y.toFixed(0)}px`, animationDelay: `${k.delay}s`, background: k.c } as CSSProperties} />
      ))}
    </div>
  )
}

// ---------------------------------------------------------------- page 3: songs everyone knew

function P3Common({ reduced }: { reduced: boolean }) {
  const t = R.useT()
  const common = useNaviStable(selCommon)
  const members = useNaviStable(s => presentMembers(s).map(m => ({ id: m.id as MemberId, color: m.color })))
  return (
    <div className="rw-p3">
      <div className="rw-p3__who" aria-hidden="true">
        {members.map((m, i) => (
          <motion.i
            key={m.id}
            style={{ background: m.id === 'me' ? '#FFFFFF' : m.color }}
            initial={reduced ? false : { scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ ...SPRING.snappy, delay: 0.1 + i * 0.1 }}
          />
        ))}
      </div>
      {common.ids.length ? (
        <>
          <p className="rw-big__t is-center">{t('wrap.commonHead', { n: common.size })}</p>
          <ul className="rw-p3__list">
            {common.ids.slice(0, 4).map((id, i) => (
              <motion.li key={id} className="rw-common" initial={reduced ? false : { opacity: 0, x: -24 }} animate={{ opacity: 1, x: 0 }} transition={{ ...SPRING.soft, delay: 0.3 + i * 0.14 }}>
                <i className="rw-common__edge" aria-hidden="true" />
                <span className="rw-common__txt">
                  <SongTitle songId={id} variant="chip" className="rw-common__title" />
                  <span className="rw-common__artist">{SONG_BY_ID[id]?.artist}</span>
                </span>
                <span className="rw-common__dots" aria-hidden="true">
                  {Array.from({ length: common.size }, (_, k) => (
                    <motion.i key={k} initial={reduced ? false : { scale: 0 }} animate={{ scale: [0, 1.35, 1] }} transition={{ delay: 0.55 + i * 0.14 + k * 0.12, duration: 0.36 }} />
                  ))}
                </span>
              </motion.li>
            ))}
          </ul>
        </>
      ) : (
        <>
          <p className="rw-big__t is-center">{t('wrap.commonNone')}</p>
          <p className="rw-sub">{t('wrap.commonNoneSub')}</p>
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- page 4: wall of light, name, melody

function P4Wall({ night, reduced }: { night: Night; reduced: boolean }) {
  const t = R.useT()
  const tr = useTr()
  const box = useBox()
  const pins = useNavi(s => s.col.pins)
  const sung = useNavi(s => s.room.sung)
  const name = useMemo(() => nightName(night, { weekday: weekdayOf(night), facts: factsFrom(sung, pins, night.id) }), [night, sung, pins])
  const [playKey, setPlayKey] = useState(0)
  const stop = useRef<(() => void) | null>(null)
  const w = Math.min(box.w - 36, 420)
  const h = Math.round(Math.min(210, w * 0.54))

  const play = () => {
    stop.current?.()
    stop.current = sound.playMelody(night.melody)
    setPlayKey(k => k + 1)
  }
  useEffect(() => {
    naviApi.getState().nameNight(name)
    const id = window.setTimeout(() => {
      if (night.melody.length) play()
    }, 500)
    return () => window.clearTimeout(id)
  }, [])

  const text = tr(name)
  const chars = Array.from(text)
  // CJK names stay on one line; spaced names (en, ko) wrap between words, never inside one
  const words = text.split(' ')
  const offsets: number[] = []
  let at = 0
  for (const w of words) {
    offsets.push(at)
    at += Array.from(w).length + 1
  }
  const spaced = words.length > 1
  const fs = Math.round(Math.max(20, Math.min(32, spaced ? 30 : (box.w - 84) / Math.max(1, chars.length))))
  return (
    <div className="rw-p4">
      <div className="rw-p4__wall">
        <WallConstellation night={night} width={w} height={h} draw />
      </div>
      <p className="rw-p4__lead">{t('wrap.nameLead')}</p>
      <h2 className="rw-p4__name" data-testid="wrap-night-name" style={{ fontSize: fs }}>
        {words.map((w, wi) => (
          <Fragment key={wi}>
            {wi > 0 ? ' ' : null}
            <span className="rw-p4__word">
              {Array.from(w).map((ch, ci) => {
                const i = offsets[wi] + ci
                return (
                  <motion.span
                    key={`${i}${ch}`}
                    initial={reduced ? false : { opacity: 0, y: 16, scale: 0.8 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    transition={{ ...SPRING.soft, delay: 1.0 + i * 0.055 }}
                  >
                    {ch}
                  </motion.span>
                )
              })}
            </span>
          </Fragment>
        ))}
      </h2>
      <div className="rw-p4__melody">
        {night.melody.length ? (
          <>
            <MelodyNotes notes={night.melody} playKey={playKey} palette={night.palette} big />
            <span className="rw-p4__mlabel">{t('wrap.melody', { n: night.melody.length })}</span>
          </>
        ) : (
          <span className="rw-p4__mlabel">{t('wrap.noMelody')}</span>
        )}
        <motion.button type="button" className="rw-play" data-testid="wrap-melody-play" onClick={play} whileTap={{ scale: 0.94 }} transition={SPRING.snappy}>
          <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M8 5.5v13l10.5-6.5z" fill="currentColor" />
          </svg>
          {t('wrap.play')}
        </motion.button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- page 5: the stamp

function P5Stamp({ night }: { night: Night }) {
  const t = R.useT()
  const tr = useTr()
  const nights = useNavi(s => s.col.nights)
  const [shake, setShake] = useState(0)
  const stamp = () => {
    const s = naviApi.getState()
    if (selTonight(s).stamped) return
    sound.play('stamp')
    sound.haptic(30)
    s.stampNight()
    setShake(k => k + 1)
  }
  const hold = useHold(stamp, night.stamped)
  return (
    <div className="rw-p5">
      <StampHero night={night} hold={hold} />
      <p className="rw-p5__head">{night.stamped ? tr(night.name ?? nightName(night, { weekday: weekdayOf(night) })) : t('wrap.stampHead')}</p>
      <motion.div className="rw-p5__cal" data-noadvance="1" animate={shake ? { y: [0, 6, -2, 1, 0] } : undefined} transition={{ duration: 0.34, ease: 'easeOut' }} onClick={e => e.stopPropagation()}>
        <Calendar nights={nights} tonightId={night.id} mode="wrap" onStamp={stamp} hold={hold} />
      </motion.div>
      {night.stamped ? (
        <motion.p className="rw-p5__done" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35 }}>
          {t('wrap.stampDone')}
        </motion.p>
      ) : null}
    </div>
  )
}

/** Tonight's stamp, big: a ghost until it is pressed, then it slams down with the ink. */
function StampHero({ night, hold }: { night: Night; hold: ReturnType<typeof useHold> }) {
  const stamped = night.stamped
  const landed = useLanded(stamped)
  return (
    <button
      type="button"
      className={`rw-stamp${hold.press ? ' is-press' : ''}${stamped ? ' is-stamped' : ''}${landed ? ' is-landed' : ''}`}
      data-testid="wrap-stamp-pad"
      data-noadvance="1"
      aria-hidden={stamped || undefined}
      tabIndex={-1}
      style={{ ['--i1' as string]: night.palette[0], ['--i2' as string]: night.palette[1], ['--i3' as string]: night.palette[2] } as CSSProperties}
      {...hold.handlers}
    >
      <i className="rw-stamp__ring" />
      <i className="rw-stamp__charge" />
      {landed ? <InkBurst palette={night.palette} spread={78} /> : null}
      <span className={`rw-stamp__art${landed ? ' is-thump' : ''}`}>
        <StampArt night={night} size={118} />
      </span>
    </button>
  )
}

// ---------------------------------------------------------------- the two equal choices (D-13)

function SaveChoice({ onChoose, disabled }: { onChoose(linked: boolean): void; disabled: boolean }) {
  const t = R.useT()
  const n = useNavi(s => takeHomeSongs(s).length)
  return (
    <div className="rw-save">
      <motion.button
        type="button"
        className="rw-save__btn is-home"
        data-testid="wrap-save"
        disabled={disabled}
        onClick={() => onChoose(true)}
        whileTap={{ scale: 0.97 }}
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={SPRING.soft}
      >
        <b>{t('wrap.save')}</b>
        <span>{t('wrap.saveSub', { n })}</span>
      </motion.button>
      <motion.button
        type="button"
        className="rw-save__btn is-local"
        data-testid="wrap-nosave"
        disabled={disabled}
        onClick={() => onChoose(false)}
        whileTap={{ scale: 0.97 }}
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...SPRING.soft, delay: 0.05 }}
      >
        <b>{t('wrap.nosave')}</b>
        <span>{t('wrap.nosaveSub')}</span>
      </motion.button>
    </div>
  )
}
