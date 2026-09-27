// Face detail (SPEC F-1 S12, D-3, D-6, E-6): title, the night it was first stuck on, times sung,
// the suggested key, its marks with the legend, "reserve again", polishing a sleeping face by
// rubbing it three times, and "I'd love someone to sing this" → pick a roommate → request/sent.
// A request never shows a refusal: it simply says it arrived.
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent, type PointerEvent } from 'react'
import type { Face, OtherId, SongId } from '../../core/types'
import { naviApi, useNavi, presentMembers } from '../../core/store'
import { useNaviStable } from '../../core/useStable'
import { reserveAsMe, songColor } from '../../core/actions'
import { bus } from '../../core/events'
import { sound } from '../../core/sound'
import { isSleeping } from '../../core/rules'
import { SongTitle } from '../../core/ui/SongTitle'
import { Icon } from '../../core/ui/Icon'
import { SPRING } from '../../core/ui/motion'
import { SONG_BY_ID } from '../../data/songs'
import { rangeFit } from '../../engine/reading'
import { useLocale, useTr, varText } from '../../i18n'
import { FaceSwatch, MARKS, MarkGlyph, keyText } from './parts'
import { useNightName } from './useNight'
import { R } from './strings'

const RUBS = 3

export function FaceDetailSheet(): JSX.Element {
  const arg = useNavi(s => s.ui.sheet?.arg as { songId?: SongId } | undefined)
  const songId = arg?.songId
  const face = useNavi(s => (songId ? s.col.faces[songId] : undefined))
  if (!songId || !SONG_BY_ID[songId]) return <div className="rc-fs" />
  return <FaceBody songId={songId} face={face} />
}

function FaceBody({ songId, face }: { songId: SongId; face?: Face }) {
  const t = R.useT()
  const tr = useTr()
  const l = useLocale()
  const song = SONG_BY_ID[songId]
  const nights = useNavi(s => s.col.nights)
  const voices = useNavi(s => s.col.voices)
  const live = useNavi(s => s.session.phase === 'live')
  const pos = useNavi(s => (s.room.now?.item.songId === songId ? 0 : s.room.queue.findIndex(q => q.songId === songId) + 1 || null))
  const [polishedNow, setPolishedNow] = useState(false)
  const sleeping = !!face && isSleeping(face, Date.now()) && !polishedNow
  const first = face ? nights.find(n => n.id === face.firstNightId) : undefined
  const firstName = useNightName(first)

  // suggested key: the key I reserved with, else from the latest voice range (hypothesis)
  const key = useMemo(() => {
    if (face?.keyShift) return { text: keyText(face.keyShift, t), from: t('face.keyFromReserve') }
    const v = [...voices].reverse().find(x => x.range)
    if (v?.range) {
      const fit = rangeFit(song, v.range)
      return { text: keyText(fit.shift, t), from: t('face.keyFromVoice') }
    }
    return { text: t('face.keyNone'), from: '' }
  }, [face?.keyShift, voices, songId, l])

  const reserve = (e: MouseEvent<HTMLButtonElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const res = reserveAsMe(naviApi, songId, { keyShift: face?.keyShift, source: 'search' })
    if (!res) return
    sound.play('throw')
    bus.emit({ type: 'fx/flight', from: r, to: 'lane:next', kind: 'reserve', songId, color: songColor(songId) })
  }

  const state = face?.state ?? 'dark'
  return (
    <div className="rc-fs" data-testid="face-detail" data-song-id={songId} data-state={state}>
      <div className="rc-fs__head">
        <div className={`rc-fs__swatch${sleeping ? ' is-sleeping' : ''}`}>
          <FaceSwatch state={state} songId={songId} size={78} marks={face?.marks} moon={sleeping} />
        </div>
        <div className="rc-fs__title">
          <SongTitle songId={songId} variant="card" max={28} min={17} />
          <span className="rc-fs__artist">{song.artist}</span>
          {face ? (
            <span className={`rc-fs__state is-${face.state}`}>
              <i />
              {t(`state.${face.state}`)} · {t(`how.${face.state}`)}
            </span>
          ) : (
            <span className="rc-fs__state is-dark">{t('face.noFace')}</span>
          )}
        </div>
      </div>

      {face ? (
        <dl className="rc-fs__facts">
          <div>
            <dt>{t('face.first')}</dt>
            <dd>
              <b>{varText({ date: face.firstAt }, l)}</b>
              {firstName ? <span>{tr(firstName)}</span> : null}
            </dd>
          </div>
          <div>
            <dt>{t('face.sung')}</dt>
            <dd>
              <b>{t('face.sungN', { n: face.sungCount })}</b>
            </dd>
          </div>
          <div>
            <dt>{t('face.key')}</dt>
            <dd>
              <b>{key.text}</b>
              {key.from ? <span>{key.from}</span> : null}
            </dd>
          </div>
        </dl>
      ) : null}

      {face && (sleeping || polishedNow) ? <Polish face={face} onDone={() => setPolishedNow(true)} done={polishedNow} /> : null}

      <div className="rc-fs__actions">
        {pos != null && pos >= 0 ? (
          <div className="rc-fs__queued" data-testid="face-queued">
            <Icon name="sparkle" size={16} />
            {pos === 0 ? t('face.playing') : t('face.queued', { n: pos })}
          </div>
        ) : (
          <motion.button type="button" className="rc-cta" data-testid="face-reserve" disabled={!live || !song.reservable} onClick={reserve} whileTap={{ scale: 0.96 }} transition={SPRING.snappy}>
            <Icon name="plus" size={18} strokeWidth={2.4} />
            {t('face.again')}
          </motion.button>
        )}
        <AskSomeone songId={songId} />
      </div>

      {face ? (
        <div className="rc-fs__marks">
          <h4 className="rc-sub">
            {t('face.marks')}
            {face.marks.length ? <span className="rc-sub__n">{face.marks.length} / 8</span> : null}
          </h4>
          {face.marks.length ? null : <p className="rc-empty is-small rc-fs__nomarks">{t('face.noMarks')}</p>}
          {/* the full legend, with this face's own marks lit */}
          <ul className="rc-marks is-face" data-testid="face-marks">
            {[...MARKS]
              .sort((x, y) => Number(face.marks.includes(y)) - Number(face.marks.includes(x)))
              .map(m => (
                <li key={m} className={`rc-marks__item${face.marks.includes(m) ? ' is-on' : ''}`} data-mark={m} data-on={face.marks.includes(m) ? '1' : '0'}>
                  <MarkGlyph mark={m} size={22} />
                  <span className="rc-marks__txt">
                    <b>{t(`mark.${m}`)}</b>
                    <span>{t(`markHow.${m}`)}</span>
                  </span>
                </li>
              ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------- polish (rub three times)

function Polish({ face, onDone, done }: { face: Face; onDone(): void; done: boolean }) {
  const t = R.useT()
  const l = useLocale()
  const [rubs, setRubs] = useState(0)
  const [sweep, setSweep] = useState(0)
  const st = useRef<{ x: number; dir: number; travel: number } | null>(null)

  const rubsRef = useRef(0)
  const count = () => {
    if (rubsRef.current >= RUBS) return
    const n = (rubsRef.current += 1)
    setRubs(n)
    setSweep(k => k + 1)
    sound.play('faceChime', { note: [72, 76, 79][n - 1] })
    if (n === RUBS) {
      naviApi.getState().polishFace(face.songId)
      sound.play('orbPop')
      sound.haptic([10, 40, 10])
      onDone()
    }
  }
  const down = (e: PointerEvent<HTMLDivElement>) => {
    if (done) return
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      /* synthetic pointer */
    }
    st.current = { x: e.clientX, dir: 0, travel: 0 }
  }
  const move = (e: PointerEvent<HTMLDivElement>) => {
    const s = st.current
    if (!s || done) return
    const dx = e.clientX - s.x
    if (Math.abs(dx) < 3) return
    const dir = Math.sign(dx)
    if (s.dir !== 0 && dir !== s.dir) {
      // direction flip after a real stroke = one rub
      if (s.travel > 26) count()
      s.travel = 0
    }
    s.dir = dir
    s.travel += Math.abs(dx)
    s.x = e.clientX
  }
  const up = () => {
    const s = st.current
    if (s && s.travel > 40) count()
    st.current = null
  }

  return (
    <div className={`rc-polish${done ? ' is-done' : ''}`} data-testid="face-polish" data-rubs={done ? RUBS : rubs}>
      <p className="rc-polish__lead">
        <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
          <path d="M10.8 2.6a5.6 5.6 0 1 0 2.6 8.1a4.6 4.6 0 0 1-2.6-8.1z" fill="#F6E7B0" />
        </svg>
        {done ? t('face.polished') : t('face.sleeping', { date: varText({ date: face.lastSungAt ?? face.firstAt }, l) })}
      </p>
      <div className="rc-polish__pad" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} style={{ touchAction: 'none' }} data-testid="face-rub">
        <FaceSwatch state={face.state} songId={face.songId} size={96} marks={face.marks} />
        <i className="rc-polish__dust" style={{ opacity: done ? 0 : 1 - rubs / RUBS } as CSSProperties} />
        <AnimatePresence>
          {sweep > 0 ? (
            <motion.i
              key={sweep}
              className="rc-polish__sweep"
              initial={{ x: '-120%', opacity: 1 }}
              animate={{ x: '120%', opacity: 0.2 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.55, ease: 'easeOut' }}
            />
          ) : null}
        </AnimatePresence>
        {done ? <motion.i className="rc-polish__burst" initial={{ scale: 0.3, opacity: 1 }} animate={{ scale: 2.2, opacity: 0 }} transition={{ duration: 0.8, ease: 'easeOut' }} /> : null}
        {!done ? <span className="rc-polish__hint">{t('face.rubHint')}</span> : null}
      </div>
      <div className="rc-polish__dots" aria-hidden="true">
        {Array.from({ length: RUBS }, (_, i) => (
          <i key={i} className={i < (done ? RUBS : rubs) ? 'is-on' : ''} />
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- request someone (E-6)

function AskSomeone({ songId }: { songId: SongId }) {
  const t = R.useT()
  const tr = useTr()
  const others = useNaviStable(s =>
    presentMembers(s)
      .filter(m => m.id !== 'me')
      .map(m => ({ id: m.id as OtherId, color: m.color })),
  )
  const live = useNavi(s => s.session.phase === 'live')
  const [open, setOpen] = useState(false)
  const [sent, setSent] = useState<OtherId | null>(null)
  useEffect(() => {
    setSent(null)
    setOpen(false)
  }, [songId])

  const send = (to: OtherId) => {
    bus.emit({ type: 'request/sent', to, songId })
    sound.play('orbPop')
    setSent(to)
  }

  if (sent)
    return (
      <motion.div className="rc-ask is-sent" data-testid="face-ask-sent" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={SPRING.soft}>
        <span className="rc-ask__sent">
          <Icon name="sparkle" size={16} />
          {t('face.askSent', { member: { member: sent } })}
        </span>
        <span className="rc-ask__note">{t('face.askNote')}</span>
      </motion.div>
    )

  return (
    <div className="rc-ask">
      {!open ? (
        <button type="button" className="rc-ghost-btn" data-testid="face-ask" disabled={!live} onClick={() => setOpen(true)}>
          <Icon name="people" size={18} />
          {t('face.ask')}
        </button>
      ) : (
        <motion.div className="rc-ask__pick" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={SPRING.soft}>
          <span className="rc-ask__who">{t('face.askWho')}</span>
          {others.length ? (
            <div className="rc-ask__members">
              {others.map((m, i) => (
                <motion.button
                  key={m.id}
                  type="button"
                  className="rc-ask__m"
                  data-testid="face-ask-member"
                  data-member={m.id}
                  style={{ ['--mc' as string]: m.color } as CSSProperties}
                  onClick={() => send(m.id)}
                  initial={{ opacity: 0, scale: 0.6 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ ...SPRING.snappy, delay: i * 0.06 }}
                >
                  <i className="rc-ask__orb" />
                  {tr({ key: `vocab.member.${m.id}` })}
                </motion.button>
              ))}
            </div>
          ) : (
            <span className="rc-ask__note">{t('face.nobody')}</span>
          )}
        </motion.div>
      )}
    </div>
  )
}
