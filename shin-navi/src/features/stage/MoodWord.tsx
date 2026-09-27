// The mood word (SPEC B-2 1.6 s, E-4, I-2): the room's air in one big gradient word instead of
// a number. Letters fade and rise 40 ms apart whenever the word changes. Tapping it opens the
// mood mixer. After three passes in a row a small "tune the read?" pill offers the mixer too.
import { AnimatePresence, motion } from 'motion/react'
import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { naviApi, useNavi } from '../../core/store'
import { auroraFor } from '../../core/rules'
import { introPending, introWait } from '../../core/intro'
import { sound } from '../../core/sound'
import { common } from '../../i18n/common'
import { S } from './strings'
import { MOOD_INK } from './model'
import './stage.css'

type MoodKey = Parameters<typeof common.t>[0]

export function MoodWord(p: { size: 'hero' | 'room' }): JSX.Element {
  const tc = common.useT()
  const t = S.useT()
  const word = useNavi(s => s.room.moodWord)
  const passStreak = useNavi(s => s.deck.passStreak)
  const text = tc(`mood.${word}` as MoodKey)
  const ink = MOOD_INK[auroraFor(word)]
  const intro = useMemo(() => introPending('moodWord'), [])
  // only the very first word waits for its slot in the entrance timeline
  const firstWord = useRef<string | null>(word)
  if (firstWord.current !== null && firstWord.current !== word) firstWord.current = null
  const base = intro && firstWord.current !== null ? introWait('moodWord') : 0
  const letters = useMemo(() => [...text], [text])
  const base0 = p.size === 'hero' ? 24 : 40
  // long words (English, Korean…) shrink to fit the space instead of running into the ball
  const wordRef = useRef<HTMLDivElement>(null)
  const [fit, setFit] = useState(base0)
  useLayoutEffect(() => {
    const el = wordRef.current
    const host = el?.parentElement
    if (!el || !host || p.size !== 'hero') return // the room word is fitted by a container query
    const avail = Math.min(host.clientWidth, 250)
    el.style.fontSize = `${base0}px`
    const need = el.scrollWidth
    const next = need > avail && avail > 0 ? Math.max(15, Math.floor((base0 * avail) / need)) : base0
    el.style.fontSize = `${next}px`
    setFit(next)
  }, [text, base0, p.size])
  const fontSize = fit
  const open = () => {
    sound.play('open')
    naviApi.getState().openSheet('mixer')
  }
  const grad = `linear-gradient(90deg, ${ink[0]}, ${ink[1]} 55%, ${ink[2]})`
  return (
    <div className={`sg-mood sg-mood--${p.size}`}>
      {p.size === 'hero' ? (
        <motion.span className="sg-mood__label" initial={intro ? { opacity: 0 } : false} animate={{ opacity: 1 }} transition={{ duration: 0.4, delay: base }}>
          {t('moodLabel')}
        </motion.span>
      ) : null}
      <div
        ref={wordRef}
        className="sg-mood__word"
        data-testid="mood-word"
        data-word={word}
        data-anchor="mood"
        role="button"
        tabIndex={0}
        aria-label={`${text} · ${t('moodTap')}`}
        onClick={open}
        onKeyDown={e => (e.key === 'Enter' || e.key === ' ' ? open() : undefined)}
        style={{ fontSize, ['--mg' as string]: grad, ['--mglow' as string]: ink[1] }}
      >
        <AnimatePresence mode="popLayout" initial={false}>
          <span key={`${word}|${text}`} className="sg-mood__run">
            {letters.map((ch, i) => (
              <motion.span
                key={i}
                className="sg-mood__ch"
                initial={{ opacity: 0, y: fontSize * 0.45 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -fontSize * 0.3, transition: { duration: 0.18, delay: i * 0.015 } }}
                transition={{ duration: 0.42, delay: base + i * 0.04, ease: [0.2, 0.8, 0.2, 1] }}
                style={{ ['--i' as string]: i, ['--n' as string]: letters.length }}
                data-ch={ch === ' ' ? '\u00a0' : ch}
              >
                <span className="sg-mood__fill">{ch === ' ' ? '\u00a0' : ch}</span>
              </motion.span>
            ))}
          </span>
        </AnimatePresence>
        <svg className="sg-mood__chev" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M3.5 2l3 3-3 3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      {p.size === 'hero' ? (
        <AnimatePresence>
          {passStreak >= 3 ? (
            <motion.button
              type="button"
              className="sg-mixpill"
              onClick={open}
              initial={{ opacity: 0, scale: 0.7, x: -8 }}
              animate={{ opacity: 1, scale: 1, x: 0 }}
              exit={{ opacity: 0, scale: 0.8 }}
              transition={{ type: 'spring', stiffness: 500, damping: 22 }}
            >
              {t('mixHint')}
            </motion.button>
          ) : null}
        </AnimatePresence>
      ) : null}
    </div>
  )
}
