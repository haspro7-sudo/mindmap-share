// The voice check sheet (S5, SPEC C-8 ⑤ / I-4 #6 / L-M7). Two paths — an optional 3-second hum
// or three questions — end in the same reveal: three pillars of light rise, fuse into a colour
// orb, "今回の声は{type}" types itself out, the orb stamps tonight's calendar, and one song to
// try arrives with its key ("−2で予約"). The reading is recorded (col.voices) and "you" takes
// the colour of tonight's voice. Nothing is recorded as audio, ever.
import { useEffect, useRef, useState, type CSSProperties, type MouseEvent } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import type { SongId, VoiceReading } from '../../core/types'
import { naviApi, useNavi } from '../../core/store'
import { reserveAsMe, songColor } from '../../core/actions'
import { bus } from '../../core/events'
import { sound } from '../../core/sound'
import { usePhoneMetrics, useBox } from '../../core/layout'
import { Icon } from '../../core/ui/Icon'
import { SongTitle } from '../../core/ui/SongTitle'
import { SongArt } from '../../ui/SongArt'
import { SONG_BY_ID } from '../../data/songs'
import type { CaptureResult } from '../../lib/pitch'
import { useTr } from '../../i18n'
import {
  buildReading,
  keyAdvice,
  keyBadge,
  noteName,
  partialFeatures,
  reserveLabel,
  shiftText,
  suggestionsFor,
  DEFAULT_RANGE,
  TYPE_COLOR,
  type QuizAnswers,
  type Suggestion,
} from './buildReading'
import { MicCapture } from './MicCapture'
import { Quiz } from './Quiz'
import { RISE_MS, TypeLine, VoiceStage, typeLineMs, type StagePhase } from './Pillars'
import { V, type VoiceKey } from './strings'
import { useLocale } from '../../i18n'
import './voice.css'

// ---------------------------------------------------------------- how the sheet was opened

export type VoiceEntry = 'choose' | 'mic' | 'quiz'
let pendingEntry: VoiceEntry | null = null
/** The card's in-body buttons pick a path before opening the sheet (act('measure')). */
export function requestVoiceEntry(e: VoiceEntry): void {
  pendingEntry = e
}
/** Read (not clear) the requested path: StrictMode may run initialisers twice. */
function peekEntry(): VoiceEntry {
  return pendingEntry ?? 'choose'
}

type Phase = 'choose' | 'listen' | 'quiz' | 'result'
/** reveal steps: 0 pillars rise · 1 fuse into the orb · 2 type name · 3 details · 4 stamped */
type Step = 0 | 1 | 2 | 3 | 4

const MERGE_AT = RISE_MS + 260
const TYPE_AT = MERGE_AT + 640

// ---------------------------------------------------------------- small parts

function CalGlyph() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
      <rect x="2" y="3" width="12" height="11" rx="2.2" />
      <path d="M2 6.6h12M5.3 1.6v2.6M10.7 1.6v2.6" />
    </svg>
  )
}

function QuizGlyph({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 26 26" fill="none" strokeLinecap="round" aria-hidden="true">
      <path d="M6 20V13" stroke="#FF4D4D" strokeWidth="3" />
      <path d="M13 20V7" stroke="#4D8BFF" strokeWidth="3" />
      <path d="M20 20V10" stroke="#FFD84D" strokeWidth="3" />
    </svg>
  )
}

/** −6 … +6 with the original key and tonight's suggestion; the marker slides to the new key. */
function KeyDial({ shift, color, play }: { shift: number; color: string; play: boolean }) {
  const t = V.useT()
  const STEP = 15
  const ticks = Array.from({ length: 13 }, (_, i) => i - 6)
  return (
    <div className="vkd" style={{ ['--tc' as string]: color, width: STEP * 12 + 16 } as CSSProperties} aria-hidden="true">
      <div className="vkd__rail" />
      {ticks.map(k => (
        <span key={k} className={`vkd__tick${k === 0 ? ' is-orig' : ''}${k === shift ? ' is-target' : ''}`} style={{ left: 8 + (k + 6) * STEP }} />
      ))}
      <span className="vkd__lbl vkd__lbl--orig" style={{ left: 8 + 6 * STEP }}>
        {t('key.origShort')}
      </span>
      {shift !== 0 ? (
        <span className="vkd__lbl vkd__lbl--target" style={{ left: 8 + (shift + 6) * STEP }}>
          {shiftText(shift)}
        </span>
      ) : null}
      <motion.span className="vkd__marker" style={{ left: 8 + 6 * STEP }} initial={play ? { x: 0 } : { x: shift * STEP }} animate={{ x: shift * STEP }} transition={{ delay: play ? 0.35 : 0, type: 'spring', stiffness: 160, damping: 16 }} />
    </div>
  )
}

// ---------------------------------------------------------------- the sheet

export function VoiceSheet(): JSX.Element {
  const t = V.useT()
  const trr = useTr()
  const locale = useLocale()
  const reduced = useNavi(s => s.ui.reduced)
  const cardId = useNavi(s => (s.ui.sheet?.id === 'voice' ? ((s.ui.sheet.arg as { cardId?: string } | undefined)?.cardId ?? null) : null))
  const m = usePhoneMetrics()
  const box = useBox()
  const small = m.small
  const [phase, setPhase] = useState<Phase>(() => {
    const e = peekEntry()
    return e === 'mic' ? 'listen' : e === 'quiz' ? 'quiz' : 'choose'
  })
  useEffect(() => {
    pendingEntry = null
  }, [])
  const [fallback, setFallback] = useState(false)
  const [preview, setPreview] = useState<Partial<QuizAnswers>>({})
  const [reading, setReading] = useState<VoiceReading | null>(null)
  const [alts, setAlts] = useState<Suggestion[]>([])
  const [alt, setAlt] = useState(0)
  const [run, setRun] = useState(0)
  const [step, setStep] = useState<Step>(0)
  const [skipped, setSkipped] = useState(false)
  const [stamped, setStamped] = useState(false)
  const [fly, setFly] = useState<{ x: number; y: number; dx: number; dy: number } | null>(null)
  const root = useRef<HTMLDivElement>(null)
  const orb = useRef<HTMLDivElement>(null)
  const cal = useRef<HTMLSpanElement>(null)
  const timers = useRef<number[]>([])
  const clearTimers = () => {
    timers.current.forEach(clearTimeout)
    timers.current = []
  }
  useEffect(() => clearTimers, [])

  const toFallback = () => {
    setFallback(true)
    setPreview({})
    setPhase('quiz')
  }

  // A mic that is missing or already refused sends us straight to the quiz (no error sound).
  useEffect(() => {
    if (phase !== 'choose') return
    let alive = true
    const md = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined
    if (!md || typeof md.getUserMedia !== 'function') {
      toFallback()
      return
    }
    try {
      navigator.permissions
        ?.query({ name: 'microphone' as PermissionName })
        .then(p => {
          if (alive && p.state === 'denied') toFallback()
        })
        .catch(() => {})
    } catch {
      /* permissions API unavailable: the choice stays open */
    }
    return () => {
      alive = false
    }
  }, [phase])

  const finish = (src: { capture: CaptureResult | null; quiz?: QuizAnswers }) => {
    const s = naviApi.getState()
    const exclude: SongId[] = [...s.room.queue.map(q => q.songId), ...(s.room.now ? [s.room.now.item.songId] : [])]
    const r = buildReading(src, { nightId: s.session.nightId, now: Date.now(), exclude })
    s.recordVoice(r)
    s.setMemberVoice('me', r.type)
    clearTimers()
    setReading(r)
    setAlts(suggestionsFor(r.type, r.range ?? DEFAULT_RANGE, exclude, 3))
    setAlt(0)
    setSkipped(false)
    setStamped(false)
    setFly(null)
    setStep(0)
    setRun(x => x + 1)
    setPhase('result')
  }

  // ---- the reveal timeline (timeouts, never rAF + setState)
  useEffect(() => {
    if (phase !== 'result' || !reading) return
    clearTimers()
    if (reduced) {
      setStep(4)
      setStamped(true)
      sound.play('pillar', { index: 0 })
      sound.play('orbPop')
      return
    }
    const glyphs = Array.from(trr({ key: `vocab.voice.${reading.type}` })).length
    const at = (ms: number, fn: () => void) => timers.current.push(window.setTimeout(fn, ms))
    at(MERGE_AT, () => setStep(1))
    at(TYPE_AT, () => setStep(2))
    at(TYPE_AT + typeLineMs(glyphs) - 120, () => setStep(3))
    at(TYPE_AT + typeLineMs(glyphs) + 260, () => setStep(4))
    return clearTimers
  }, [run])

  // ---- the orb stamps tonight's calendar
  useEffect(() => {
    if (step !== 4 || stamped || !reading) return
    if (skipped || reduced) {
      setStamped(true)
      return
    }
    const r = root.current
    const o = orb.current
    const c = cal.current?.querySelector('.vs__caldot')
    if (!r || !o || !c) {
      setStamped(true)
      return
    }
    const rr = r.getBoundingClientRect()
    const k = r.offsetWidth ? rr.width / r.offsetWidth : 1
    const ob = o.getBoundingClientRect()
    const cb = c.getBoundingClientRect()
    const x = (ob.left + ob.width / 2 - rr.left) / k
    const y = (ob.top + ob.height / 2 - rr.top) / k
    setFly({ x, y, dx: (cb.left + cb.width / 2 - rr.left) / k - x, dy: (cb.top + cb.height / 2 - rr.top) / k - y })
  }, [step])

  const skip = () => {
    if (phase !== 'result' || step >= 3) return
    clearTimers()
    setSkipped(true)
    setStep(4)
  }

  const current = alts.length ? alts[alt % alts.length] : reading?.suggest ? { ...reading.suggest, fit: 1 } : null
  const song = current ? SONG_BY_ID[current.songId] : undefined
  const queued = useNavi(s => !!current && (s.room.queue.some(q => q.songId === current.songId && q.by === 'me') || s.room.now?.item.songId === current.songId))

  const reserve = (e: MouseEvent<HTMLButtonElement>) => {
    if (!current || !song) return
    const rect = e.currentTarget.getBoundingClientRect()
    const s = naviApi.getState()
    const card = cardId ? s.deck.cards.find(c => c.id === cardId && c.kind === 'voice') : undefined
    const arg = { songId: current.songId, keyShift: current.keyShift, version: 'original' as const }
    if (card) s.act(card.id, 'reserve', { ...arg, fromRect: rect })
    else {
      const res = reserveAsMe(naviApi, current.songId, { keyShift: current.keyShift, version: 'original', source: 'voice' })
      if (!res) return
      naviApi.getState().noteVoiceToReserve()
      sound.play('throw')
      sound.haptic(12)
      bus.emit({ type: 'fx/flight', from: rect, to: 'lane:next', kind: 'reserve', songId: current.songId, color: songColor(current.songId) })
    }
    naviApi.getState().closeSheet()
  }

  const again = () => {
    sound.play('tap')
    clearTimers()
    setReading(null)
    setPreview({})
    setFallback(false)
    setStep(0)
    setPhase('choose')
  }

  // ---- layout
  const laneBottom = m.laneBottom
  const minH = Math.max(480, Math.min(700, box.h - laneBottom - 30 - 34))
  const stagePhase: StagePhase =
    phase === 'result' ? (reduced || skipped ? 'final' : step === 0 ? 'rise' : 'merge') : phase === 'quiz' ? 'preview' : 'idle'
  const stageValues = phase === 'result' && reading ? reading : phase === 'quiz' ? partialFeatures(preview) : null
  const tc = reading ? TYPE_COLOR[reading.type] : '#D8DCE8'

  return (
    <div className={`vs vs--${phase}${small ? ' is-small' : ''}`} ref={root} style={{ minHeight: minH, ['--tc' as string]: tc } as CSSProperties} data-private="1">
      <header className="vs__head">
        <span className="vs__code">VOICE</span>
        <span className="vs__label">{t('label')}</span>
        {phase === 'result' ? (
          <span className={`vs__cal${stamped ? ' is-stamped' : ''}`} ref={cal} data-testid="voice-stamp" data-stamped={stamped ? 1 : 0}>
            <CalGlyph />
            <span>{t('stamped')}</span>
            <span className="vs__caldot">{stamped ? <motion.i initial={reduced ? false : { scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 500, damping: 16 }} /> : null}</span>
          </span>
        ) : null}
      </header>

      {phase === 'listen' ? (
        <MicCapture
          small={small}
          reduced={reduced}
          onDone={capture => finish({ capture })}
          onUnavailable={toFallback}
          onQuiz={() => {
            setPreview({})
            setPhase('quiz')
          }}
          onCancel={() => setPhase('choose')}
        />
      ) : (
        <div className="vs__body" data-testid={phase === 'result' ? 'voice-result' : undefined} data-type={phase === 'result' ? reading?.type : undefined} data-method={phase === 'result' ? reading?.method : undefined}>
          <VoiceStage
            variant="sheet"
            small={small}
            phase={stagePhase}
            values={stageValues}
            type={reading?.type ?? null}
            reduced={reduced}
            withSound={phase === 'result' && !reduced}
            orbRef={orb}
            runId={run}
            onTap={skip}
          />
          {phase === 'result' && reading?.range && reading.method === 'mic' ? (
            <div className="vs__range">{t('mic.range', { lo: noteName(reading.range[0], locale), hi: noteName(reading.range[1], locale) })}</div>
          ) : null}
          <AnimatePresence mode="wait" initial={false}>
            {phase === 'choose' ? (
              <motion.div key="choose" className="vs__choose" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.22 }}>
                <h2 className="vs__title">{t('title')}</h2>
                <p className="vs__lead">{t('lead')}</p>
                <div className="vs__paths">
                  <motion.button
                    type="button"
                    className="vpath vpath--mic"
                    data-testid="voice-mic-start"
                    whileTap={{ scale: 0.96 }}
                    onClick={() => {
                      sound.play('tap')
                      setPhase('listen')
                    }}
                  >
                    <span className="vpath__orb">
                      <span className="vpath__pulse" />
                      <Icon name="sing" size={26} strokeWidth={1.8} />
                    </span>
                    <span className="vpath__t">
                      {t('path.mic')}
                      <em>{t('path.micOpt')}</em>
                    </span>
                    <span className="vpath__s">{t('path.micSub')}</span>
                  </motion.button>
                  <motion.button
                    type="button"
                    className="vpath vpath--quiz"
                    data-testid="voice-quiz-start"
                    whileTap={{ scale: 0.96 }}
                    onClick={() => {
                      sound.play('tap')
                      setPreview({})
                      setPhase('quiz')
                    }}
                  >
                    <span className="vpath__orb vpath__orb--quiz">
                      <QuizGlyph />
                    </span>
                    <span className="vpath__t">{t('path.quiz')}</span>
                    <span className="vpath__s">{t('path.quizSub')}</span>
                  </motion.button>
                </div>
                <p className="vs__privacy">
                  <Icon name="lock" size={14} strokeWidth={2} />
                  <span>{t('privacy')}</span>
                </p>
              </motion.div>
            ) : phase === 'quiz' ? (
              <motion.div key="quiz" className="vs__quizwrap" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.22 }}>
                <Quiz fallback={fallback} reduced={reduced} onPreview={setPreview} onDone={quiz => finish({ capture: null, quiz })} />
                <p className="vs__privacy vs__privacy--quiet">
                  <Icon name="lock" size={13} strokeWidth={2} />
                  <span>{t('card.noRec')}</span>
                </p>
              </motion.div>
            ) : reading ? (
              <motion.div key={`result:${run}`} className="vs__result" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} onClick={step < 3 ? skip : undefined}>
                <div className="vs__typeslot">{step >= 2 ? <TypeLine type={reading.type} play={!skipped} reduced={reduced} /> : null}</div>
                {step >= 3 ? (
                  <motion.div className="vs__details" initial={reduced || skipped ? { opacity: 0 } : { opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: reduced ? 0.3 : 0.42, ease: [0.2, 0.8, 0.2, 1] }}>
                    <p className="vs__ev">
                      <span className="vs__method">{t(reading.method === 'mic' ? 'method.mic' : 'method.quiz')}</span>
                      {trr(reading.evidence)}
                    </p>
                    {current && song ? (
                      <>
                        <p className="vs__try">{t(`try.${reading.type}` as VoiceKey)}</p>
                        <AnimatePresence mode="wait" initial={false}>
                          <motion.div key={current.songId} className="vs__songwrap" initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }} transition={{ duration: 0.22 }}>
                            <div className="vs__song" data-testid="voice-song" data-song-id={current.songId} data-key={current.keyShift}>
                              <div className="vs__art">
                                <SongArt seed={song.id} energy={song.energy} animate={false} />
                              </div>
                              <div className="vs__meta">
                                <span className="vs__songlabel">{t('song.label')}</span>
                                <SongTitle songId={song.id} variant="chip" className="vs__songtitle" />
                                <span className="vs__artist">
                                  {song.artist} · {trr({ key: 'vocab.version.original' })}
                                </span>
                              </div>
                              <span className={`vs__keybadge${current.keyShift === 0 ? ' is-orig' : ''}`}>
                                <Icon name="key" size={14} strokeWidth={2} />
                                {current.keyShift === 0 ? t('key.origShort') : keyBadge(current.keyShift)}
                              </span>
                            </div>
                            <KeyDial shift={current.keyShift} color={tc} play={!skipped && !reduced} />
                            <p className="vs__keytext">{trr(keyAdvice(current.keyShift))}</p>
                          </motion.div>
                        </AnimatePresence>
                        <motion.button type="button" className="vbtn vbtn--primary vbtn--big" data-testid="voice-reserve-key" data-key={current.keyShift} disabled={queued || !song.reservable} whileTap={{ scale: 0.96 }} onClick={reserve}>
                          <span className="vbtn__glow" aria-hidden="true" />
                          <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <path d="M10 16V4M5 9l5-5 5 5" />
                          </svg>
                          <span>{trr(reserveLabel(current.keyShift))}</span>
                        </motion.button>
                      </>
                    ) : (
                      <p className="vs__try">{t('noSong')}</p>
                    )}
                    <div className="vs__sec">
                      {alts.length > 1 ? (
                        <button
                          type="button"
                          className="vbtn vbtn--ghost"
                          data-testid="voice-other"
                          onClick={() => {
                            sound.play('flip')
                            setAlt(a => a + 1)
                          }}
                        >
                          {t('other')}
                        </button>
                      ) : null}
                      <button type="button" className="vbtn vbtn--ghost" data-testid="voice-again" onClick={again}>
                        {t('again')}
                      </button>
                    </div>
                    <p className="vs__note">
                      {t('note')} · {t('card.noRec')}
                    </p>
                  </motion.div>
                ) : (
                  <p className="vs__skip">{t('skip')}</p>
                )}
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>
      )}
      {fly && reading ? (
        <motion.span
          className="vs__fly"
          style={{ left: fly.x, top: fly.y }}
          initial={{ x: 0, y: 0, scale: 1, opacity: 1 }}
          animate={{ x: fly.dx, y: fly.dy, scale: 0.3, opacity: 1 }}
          transition={{ x: { duration: 0.62, ease: [0.3, 0, 0.3, 1] }, y: { duration: 0.62, ease: [0.6, -0.4, 0.8, 1] }, scale: { duration: 0.62 } }}
          onAnimationComplete={() => {
            setFly(null)
            setStamped(true)
            sound.play('stamp', { gain: 0.45 })
            sound.haptic(20)
          }}
        >
          <VoiceOrbDot reading={reading} />
        </motion.span>
      ) : null}
    </div>
  )
}

function VoiceOrbDot({ reading }: { reading: VoiceReading }) {
  const bg = `radial-gradient(circle at 35% 30%, #fff, ${TYPE_COLOR[reading.type]} 45%, rgba(0,0,0,0) 72%)`
  return <span className="vs__flydot" style={{ background: bg }} />
}
