// The three questions (SPEC L/M7 #2): high notes · the chorus · the way you like to sing.
// One question at a time; every answer lifts its pillar on the stage above (a chime per answer),
// so each tap visibly changes something. Also the automatic fallback when the mic is unavailable.
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { sound } from '../../core/sound'
import { useNavi } from '../../core/store'
import { DEMO_ANSWERS, QUIZ, QUIZ_ORDER, FACTOR_COLOR, type QuizAnswers, type QuizKey } from './buildReading'
import { V, type VoiceKey } from './strings'
import './voice.css'

/** which pillar each question lifts (and its chime: C5 / E5 / G5) */
const PILLAR_OF: Record<QuizKey, { index: number; color: string }> = {
  chorus: { index: 0, color: FACTOR_COLOR.power },
  style: { index: 1, color: FACTOR_COLOR.care },
  high: { index: 2, color: FACTOR_COLOR.bright },
}

/** Small drawings for each answer (a pitch contour, a loudness shape, a way of singing). */
function AnswerGlyph({ q, a }: { q: QuizKey; a: string }) {
  const p = { width: 34, height: 22, viewBox: '0 0 34 22', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true }
  const d: Record<string, string> = {
    'high.easy': 'M2 19 C 10 18, 14 4, 32 3',
    'high.normal': 'M2 18 C 10 17, 16 10, 32 10',
    'high.hard': 'M2 12 C 10 11, 18 16, 32 17',
    'chorus.belt': 'M2 11 L8 11 M12 4 L12 18 M17 1 L17 21 M22 4 L22 18 M27 7 L27 15 M32 11 L32 11',
    'chorus.soft': 'M2 11 C 8 8, 12 14, 17 11 S 26 8, 32 11',
    'chorus.between': 'M2 11 L7 11 M11 7 L11 15 M16 4 L16 18 M21 7 L21 15 M26 9 L26 13 M31 11 L32 11',
    'style.ride': 'M2 17 L7 6 L12 17 L17 6 L22 17 L27 6 L32 17',
    'style.talk': 'M2 14 C 6 6, 9 18, 13 11 S 20 5, 23 13 S 29 9, 32 12',
    'style.sustain': 'M2 11 L32 11 M2 7 L2 15 M32 7 L32 15',
  }
  return (
    <svg {...p}>
      <path d={d[`${q}.${a}`]} />
    </svg>
  )
}

export type QuizProps = {
  fallback: boolean
  reduced?: boolean
  onPreview: (a: Partial<QuizAnswers>) => void
  onDone: (q: QuizAnswers) => void
}

export function Quiz({ fallback, reduced, onPreview, onDone }: QuizProps) {
  const t = V.useT()
  // script mode (the presenter's demo): a quiet ring on the answers that give the scripted reading
  const demo = useNavi(s => s.session.script)
  const [answers, setAnswers] = useState<Partial<QuizAnswers>>({})
  const [step, setStep] = useState(0)
  const [dir, setDir] = useState(1)
  const lock = useRef(false)
  const timer = useRef(0)
  useEffect(() => () => clearTimeout(timer.current), [])

  const key = QUIZ_ORDER[step]
  const choose = (v: string) => {
    if (lock.current) return
    lock.current = true
    const next = { ...answers, [key]: v } as Partial<QuizAnswers>
    setAnswers(next)
    onPreview(next)
    sound.play('pillar', { index: PILLAR_OF[key].index })
    timer.current = window.setTimeout(
      () => {
        lock.current = false
        if (step < QUIZ_ORDER.length - 1) {
          setDir(1)
          setStep(step + 1)
        } else onDone(next as QuizAnswers)
      },
      reduced ? 120 : 300,
    )
  }
  const back = () => {
    if (step === 0 || lock.current) return
    sound.play('tap')
    setDir(-1)
    setStep(step - 1)
  }

  return (
    <div className="vquiz">
      {fallback ? (
        <motion.div className="vquiz__fallback" data-testid="voice-fallback" role="status" initial={reduced ? { opacity: 0 } : { opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
          <span className="vquiz__fbicon" aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
              <path d="M10 2.5a2.6 2.6 0 0 1 2.6 2.6v4.4a2.6 2.6 0 0 1-5.2 0V5.1A2.6 2.6 0 0 1 10 2.5z" />
              <path d="M5 9.5a5 5 0 0 0 10 0M10 14.6v3" />
              <path d="M3.5 3.5l13 13" opacity=".7" />
            </svg>
          </span>
          {t('fallback')}
        </motion.div>
      ) : null}
      <div className="vquiz__top">
        <div className="vquiz__dots" aria-hidden="true">
          {QUIZ_ORDER.map((k, i) => (
            <span key={k} className={`vquiz__dot${i < step || answers[k] ? ' is-done' : ''}${i === step ? ' is-now' : ''}`} style={{ ['--c' as string]: PILLAR_OF[k].color } as CSSProperties} />
          ))}
        </div>
        <span className="vquiz__step">{t('quiz.step', { n: step + 1 })}</span>
        <button type="button" className={`vquiz__back${step === 0 ? ' is-hidden' : ''}`} onClick={back} tabIndex={step === 0 ? -1 : 0}>
          {t('quiz.back')}
        </button>
      </div>
      <div className="vquiz__viewport">
        <AnimatePresence initial={false} mode="popLayout" custom={dir}>
          <motion.div
            key={key}
            className="vquiz__q"
            data-testid="voice-q"
            data-q={key}
            custom={dir}
            initial={reduced ? { opacity: 0 } : { opacity: 0, x: 40 * dir }}
            animate={{ opacity: 1, x: 0 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, x: -40 * dir }}
            transition={{ duration: reduced ? 0.15 : 0.26, ease: [0.2, 0.8, 0.2, 1] }}
          >
            <h3 className="vquiz__qt">{t(`q.${key}` as VoiceKey)}</h3>
            <div className="vquiz__answers" role="group" aria-label={t(`q.${key}` as VoiceKey)}>
              {(QUIZ[key] as string[]).map(a => {
                const on = answers[key] === a
                const hint = demo && !answers[key] && DEMO_ANSWERS[key] === a
                return (
                  <motion.button
                    key={a}
                    type="button"
                    className={`vquiz__a${on ? ' is-on' : ''}${hint ? ' is-demo' : ''}`}
                    data-testid="voice-a"
                    data-a={a}
                    data-demo={hint ? '1' : undefined}
                    aria-pressed={on}
                    style={{ ['--c' as string]: PILLAR_OF[key].color } as CSSProperties}
                    whileTap={{ scale: 0.96 }}
                    transition={{ type: 'spring', stiffness: 500, damping: 22 }}
                    onClick={() => choose(a)}
                  >
                    <span className="vquiz__glyph">
                      <AnswerGlyph q={key} a={a} />
                    </span>
                    <span className="vquiz__alabel">{t(`a.${key}.${a}` as VoiceKey)}</span>
                    <span className="vquiz__tick" aria-hidden="true" />
                  </motion.button>
                )
              })}
            </div>
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  )
}
