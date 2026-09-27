// The optional five questions after the recap (SPEC H-4, the five evaluation questions): easy to find / something
// unexpected / fun to choose / use again (1–5 each) and why (chips). Skipping is always fine;
// answers go to submitSurvey (metrics) only.
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useState } from 'react'
import type { SurveyAnswers } from '../../core/store/types'
import { naviApi } from '../../core/store'
import { sound } from '../../core/sound'
import { SPRING } from '../../core/ui/motion'
import { R } from './strings'

type Score = 1 | 2 | 3 | 4 | 5
const QS = [
  { id: 'findEase', key: 'sv.q1' },
  { id: 'surprise', key: 'sv.q2' },
  { id: 'fun', key: 'sv.q3' },
  { id: 'again', key: 'sv.q4' },
] as const
const WHY = ['cards', 'know', 'ball', 'voice', 'lang', 'lane', 'order'] as const
// the five buttons from a quiet ring to a full light
const TINT = ['#6E6790', '#8A6BFF', '#2EF2FF', '#FF3DA8', '#FFD36B']

export function SurveySheet(): JSX.Element {
  const t = R.useT()
  const [a, setA] = useState<Partial<Record<(typeof QS)[number]['id'], Score>>>({})
  const [why, setWhy] = useState<string[]>([])
  const [done, setDone] = useState(false)
  const ready = QS.every(q => a[q.id] != null)

  useEffect(() => {
    if (!done) return
    const id = window.setTimeout(() => naviApi.getState().closeSheet(), 1600)
    return () => window.clearTimeout(id)
  }, [done])

  const send = () => {
    if (!ready) return
    const s: SurveyAnswers = { findEase: a.findEase!, surprise: a.surprise!, fun: a.fun!, again: a.again!, why }
    naviApi.getState().submitSurvey(s)
    sound.play('orbPop')
    setDone(true)
  }

  return (
    <div className="rc-sv" data-testid="survey">
      <AnimatePresence mode="wait" initial={false}>
        {done ? (
          <motion.div key="thanks" className="rc-sv__thanks" data-testid="survey-thanks" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={SPRING.soft}>
            <i className="rc-sv__spark" aria-hidden="true" />
            {t('sv.thanks')}
          </motion.div>
        ) : (
          <motion.div key="form" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <h2 className="rc-sv__title">{t('sv.title')}</h2>
            <p className="rc-sv__lead">{t('sv.lead')}</p>
            {QS.map((q, qi) => (
              <div key={q.id} className="rc-sv__q" data-testid="survey-q" data-q={q.id}>
                <span className="rc-sv__qt">
                  <b>{qi + 1}</b>
                  {t(q.key)}
                </span>
                <div className="rc-sv__scale" role="radiogroup" aria-label={t(q.key)}>
                  {([1, 2, 3, 4, 5] as Score[]).map(v => {
                    const on = a[q.id] === v
                    return (
                      <motion.button
                        key={v}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        className={`rc-sv__dot${on ? ' is-on' : ''}${a[q.id] != null && v <= a[q.id]! ? ' is-lit' : ''}`}
                        style={{ ['--tc' as string]: TINT[v - 1] }}
                        data-v={v}
                        whileTap={{ scale: 0.86 }}
                        transition={SPRING.snappy}
                        onClick={() => {
                          sound.play('penlight', { index: v - 1 })
                          setA(x => ({ ...x, [q.id]: v }))
                        }}
                      >
                        {v}
                      </motion.button>
                    )
                  })}
                </div>
                <div className="rc-sv__ends" aria-hidden="true">
                  <span>{t('sv.lo')}</span>
                  <span>{t('sv.hi')}</span>
                </div>
              </div>
            ))}
            <div className="rc-sv__q">
              <span className="rc-sv__qt">
                <b>5</b>
                {t('sv.q5')}
              </span>
              <div className="rc-sv__why">
                {WHY.map(w => {
                  const on = why.includes(w)
                  return (
                    <button key={w} type="button" className={`rc-sv__chip${on ? ' is-on' : ''}`} aria-pressed={on} onClick={() => setWhy(x => (on ? x.filter(y => y !== w) : [...x, w]))}>
                      {t(`sv.why.${w}`)}
                    </button>
                  )
                })}
              </div>
            </div>
            <div className="rc-sv__row">
              <button type="button" className="rc-sv__skip" data-testid="survey-skip" onClick={() => naviApi.getState().closeSheet()}>
                {t('sv.skip')}
              </button>
              <button type="button" className="rc-cta" data-testid="survey-send" disabled={!ready} onClick={send}>
                {t('sv.send')}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
