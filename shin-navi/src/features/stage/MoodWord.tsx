// The mood word (SPEC B-2 1.6 s, E-4, I-2): the room's air in one big gradient word instead of
// a number. Letters fade and rise 40 ms apart whenever the word changes. Tapping it opens the
// mood mixer. After three passes in a row a small "tune the read?" pill offers the mixer too.
// QA OWNER#7 / DEMO#13: the hero answers every reservation within a second — when Navi's read of
// where the air is heading (forecastMood: NOW + the next two, like selForecast) points to another colour, the word shows that forecast
// ("about to lift…") in a dashed "hypothesis" frame until the real word is recomputed at the next song
// end; an all-know ask overrides it for ~3 s with "everyone knew it!".
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { AuroraKey, MoodWordId } from '../../core/types'
import { naviApi, useNavi } from '../../core/store'
import { auroraFor } from '../../core/rules'
import { bus } from '../../core/events'
import { introPending, introWait } from '../../core/intro'
import { sound } from '../../core/sound'
import { common } from '../../i18n/common'
import { S } from './strings'
import { MOOD_INK, forecastKey, forecastMood } from './model'
import { presentOf } from './parts'
import { SONG_BY_ID } from '../../data/songs'
import './stage.css'

type MoodKey = Parameters<typeof common.t>[0]

/** How long "everyone knew it!" holds the word after an all-know ask. */
export const ALL_KNOW_MS = 3000
const GOLD_INK: [string, string, string] = ['#FFF6D8', '#FFD36B', '#FF9F5A']

type Display = { mode: 'real' | 'forecast' | 'all'; text: string; ink: [string, string, string]; fc: AuroraKey | null }

/**
 * Which word the hero shows. The forecast is "armed" by a reservation (queue/added) and disarmed
 * when a song ends (the real word is recomputed then); the all-know override wins for ~3 s.
 */
function useDisplay(): Display {
  const tc = common.useT()
  const t = S.useT()
  const word = useNavi(s => s.room.moodWord)
  // a primitive so zustand never loops: "word|bucket|rising" or '' (Navi's read, see forecastMood)
  const fcRaw = useNavi(s => {
    const r = s.room
    const upcoming = [...(r.now ? [r.now.item.songId] : []), ...r.queue.slice(0, 2).map(q => q.songId)]
    const f = upcoming.length ? forecastMood(r.heat, r.sung.map(e => SONG_BY_ID[e.item.songId]?.energy ?? 0.5), upcoming, presentOf(r.members)) : null
    return f ? `${f.word}|${f.bucket}|${f.rising ? 1 : 0}` : ''
  })
  const [armed, setArmed] = useState(false)
  const [allUntil, setAllUntil] = useState(0)
  useEffect(() => {
    const offs = [
      bus.on('queue/added', () => setArmed(true)),
      bus.on('song/ended', () => setArmed(false)),
      bus.on('know/complete', e => {
        if (e.view.all) setAllUntil(Date.now() + ALL_KNOW_MS)
      }),
      bus.on('night/started', () => {
        setArmed(false)
        setAllUntil(0)
      }),
    ]
    return () => offs.forEach(f => f())
  }, [])
  const allOn = allUntil > Date.now()
  useEffect(() => {
    if (!allUntil) return
    const id = setTimeout(() => setAllUntil(0), Math.max(0, allUntil - Date.now()) + 20)
    return () => clearTimeout(id)
  }, [allUntil])

  const current = auroraFor(word)
  if (allOn) return { mode: 'all', text: t('allKnowWord'), ink: GOLD_INK, fc: null }
  if (armed && fcRaw) {
    const [fw, bucket, rising] = fcRaw.split('|') as [MoodWordId, AuroraKey, string]
    // a different colour ahead, or the very first read of a still-blank room
    if (bucket !== current || (word === 'blank' && fw !== 'blank')) return { mode: 'forecast', text: t(forecastKey(fw, rising === '1')), ink: MOOD_INK[bucket], fc: bucket }
  }
  return { mode: 'real', text: tc(`mood.${word}` as MoodKey), ink: MOOD_INK[current], fc: null }
}

export function MoodWord(p: { size: 'hero' | 'room'; max?: number }): JSX.Element {
  const t = S.useT()
  const word = useNavi(s => s.room.moodWord)
  const passStreak = useNavi(s => s.deck.passStreak)
  const shown = useDisplay()
  const { text, ink, mode } = shown
  const intro = useMemo(() => introPending('moodWord'), [])
  // only the very first word waits for its slot in the entrance timeline
  const firstWord = useRef<string | null>(word)
  if (firstWord.current !== null && (firstWord.current !== word || mode !== 'real')) firstWord.current = null
  const base = intro && firstWord.current !== null ? introWait('moodWord') : 0
  const letters = useMemo(() => [...text], [text])
  const base0 = p.max ?? (p.size === 'hero' ? 24 : 40)
  // long words (English, Korean…) shrink to fit the space instead of running into the ball
  // (hero) or past the sidebar edge (room, QA ROBUST#9)
  const wordRef = useRef<HTMLDivElement>(null)
  const [fit, setFit] = useState(base0)
  useLayoutEffect(() => {
    const el = wordRef.current
    const host = el?.parentElement
    if (!el || !host) return
    const measure = () => {
      const avail = p.size === 'hero' ? Math.min(host.clientWidth, 250) : host.clientWidth
      const min = p.size === 'hero' ? 15 : 18
      el.style.fontSize = `${base0}px`
      const need = el.scrollWidth
      let next = need > avail && avail > 0 ? Math.max(min, Math.floor((base0 * avail) / need)) : base0
      el.style.fontSize = `${next}px`
      // the chevron and gaps do not scale with the text: settle it exactly
      while (next > min && el.scrollWidth > avail + 0.5) {
        next -= 1
        el.style.fontSize = `${next}px`
      }
      setFit(next)
    }
    measure()
    if (p.size !== 'room' || typeof ResizeObserver === 'undefined') return
    let w = host.clientWidth
    const ro = new ResizeObserver(() => {
      if (host.clientWidth !== w) {
        w = host.clientWidth
        measure()
      }
    })
    ro.observe(host)
    return () => ro.disconnect()
  }, [text, base0, p.size])
  const fontSize = fit
  const open = () => {
    sound.play('open')
    naviApi.getState().openSheet('mixer')
  }
  const grad = `linear-gradient(90deg, ${ink[0]}, ${ink[1]} 55%, ${ink[2]})`
  const label = mode === 'forecast' ? t('flowForecast') : mode === 'all' ? t('allKnowLabel') : t('moodLabel')
  return (
    <div className={`sg-mood sg-mood--${p.size} is-${mode}`}>
      {p.size === 'hero' ? (
        <motion.span className="sg-mood__label" initial={intro ? { opacity: 0 } : false} animate={{ opacity: 1 }} transition={{ duration: 0.4, delay: base }}>
          <AnimatePresence mode="wait" initial={false}>
            <motion.span key={mode} className="sg-mood__labeltxt" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.18 }}>
              {mode === 'forecast' ? <i className="sg-mood__dash" aria-hidden="true" /> : null}
              {label}
            </motion.span>
          </AnimatePresence>
        </motion.span>
      ) : null}
      <div
        ref={wordRef}
        className="sg-mood__word"
        data-testid="mood-word"
        data-word={word}
        data-mode={mode}
        data-forecast={shown.fc ?? undefined}
        data-anchor="mood"
        role="button"
        tabIndex={0}
        aria-label={`${text} · ${t('moodTap')}`}
        onClick={open}
        onKeyDown={e => (e.key === 'Enter' || e.key === ' ' ? open() : undefined)}
        style={{ fontSize, ['--mg' as string]: grad, ['--mglow' as string]: ink[1] }}
      >
        <AnimatePresence mode="popLayout" initial={false}>
          <span key={`${mode}|${text}`} className="sg-mood__run">
            {letters.map((ch, i) => (
              <motion.span
                key={i}
                className="sg-mood__ch"
                initial={{ opacity: 0, y: fontSize * 0.45, scale: mode === 'all' ? 1.35 : 1 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -fontSize * 0.3, transition: { duration: 0.18, delay: i * 0.015 } }}
                transition={{ duration: 0.42, delay: base + i * (mode === 'all' ? 0.03 : 0.04), ease: [0.2, 0.8, 0.2, 1] }}
                style={{ ['--i' as string]: i, ['--n' as string]: letters.length }}
                data-ch={ch === ' ' ? ' ' : ch}
              >
                <span className="sg-mood__fill">{ch === ' ' ? ' ' : ch}</span>
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
