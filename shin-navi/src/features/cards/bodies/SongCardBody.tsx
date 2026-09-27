// Song card body (SPEC C-8 1, card-front contract): full-bleed generated art, a big title, the
// artist, ONE reason line and the know-dots (or the long-press hint). Evidence chips and the
// "Navi pick" toggle live on the evidence side; only the opener keeps its toggle on the front.
// visa: the original title and the title in the language it crosses into, stacked at the same
// size, with the passport stamp in its own column so it can never cover the title.
// Fair share: once my pending songs reach the budget the primary becomes "keep on the ball".
import { useEffect, useLayoutEffect, useRef } from 'react'
import { motion } from 'motion/react'
import type { CardBodyComponent, CardBodyProps, Locale } from '../../../core/types'
import { useNavi } from '../../../core/store'
import { selReserveBudget } from '../../../core/selectors'
import { KnowDots } from '../../../core/ui/KnowDots'
import { SongTitle } from '../../../core/ui/SongTitle'
import { SongArt } from '../../../ui/SongArt'
import { SONG_BY_ID } from '../../../data/songs'
import { patternFor } from '../../../lib/art'
import { useBox } from '../../../core/layout'
import { LOCALES, songTitle, useLocale } from '../../../i18n'
import { ReasonLine } from '../CardShell'
import { setNaviPick, useNaviPick } from '../naviPick'
import { S } from '../strings'

function LongPressIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
      <circle cx="8" cy="8" r="2.4" fill="currentColor" stroke="none" />
      <circle cx="8" cy="8" r="5.6" strokeDasharray="2.2 2" />
    </svg>
  )
}

function WarmIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 14.2c-2.6 0-4.4-1.8-4.4-4.2 0-2.6 2.3-3.8 2.8-6.8 1.6 1 2.2 2.4 2.2 3.6.7-.5 1.1-1.3 1.2-2.1 1.5 1.3 2.6 3 2.6 5.1 0 2.6-1.8 4.4-4.4 4.4z" />
    </svg>
  )
}

/** The calm fair-share line (handshake 5): replaces the reason line while I am over my share. */
export function BudgetLine({ n, className }: { n: number; className?: string }) {
  const t = S.useT()
  return (
    <div className={`reason reason--budget ${className ?? ''}`} data-testid="budget-note">
      <span className="reason__glyph">
        <WarmIcon />
      </span>
      <span className="reason__text">{t('budget.note', { n })}</span>
    </div>
  )
}

/** Shrinks the stacked visa lines until the widest fits (then allows wrapping at the minimum). */
function useFitLines(key: string, max: number, min: number) {
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const fit = () => {
      let size = max
      el.classList.remove('is-wrap')
      el.style.fontSize = `${size}px`
      while (size > min && el.scrollWidth > el.clientWidth + 1) {
        size -= 1
        el.style.fontSize = `${size}px`
      }
      if (el.scrollWidth > el.clientWidth + 1) el.classList.add('is-wrap')
    }
    fit()
    if (typeof ResizeObserver === 'undefined') return
    let w = el.clientWidth
    const ro = new ResizeObserver(() => {
      if (el.clientWidth !== w) {
        w = el.clientWidth
        fit()
      }
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [key, max, min])
  return ref
}

function VisaTitle({ songId, stamp, max }: { songId: string; stamp: Locale; max: number }) {
  const l = useLocale()
  const mine = songTitle(songId, l)
  // the viewer reads the original language: the second line is the title where it crosses to (DEMO#12)
  let second: string | null = mine.main !== mine.original ? mine.main : null
  let secondLocale: Locale = l
  if (!second) {
    const there = songTitle(songId, stamp)
    if (there.main !== there.original) {
      second = there.main
      secondLocale = stamp
    }
  }
  const romaji = !second ? mine.romaji : null
  const code = stamp === 'zhHant' ? 'TW' : stamp === 'zhHans' ? 'CN' : stamp.toUpperCase()
  const ref = useFitLines(`${songId}|${l}|${stamp}`, max, 17)
  return (
    <div className="vtitle" data-testid="visa-title">
      <div className="vtitle__text">
        <div ref={ref} className="vtitle__lines" style={{ fontSize: max }}>
          <span className="vtitle__line" lang="ja">
            {mine.original}
          </span>
          {second ? (
            <span className="vtitle__line vtitle__line--local" lang={LOCALES.find(x => x.id === secondLocale)?.htmlLang}>
              {second}
            </span>
          ) : null}
        </div>
        {romaji ? <div className="vtitle__romaji">{romaji}</div> : null}
      </div>
      <div className="sbody__visa" data-testid="visa-stamp" aria-hidden="true">
        <span className="sbody__visa-in">
          <b>VISA</b>
          <i>{code}</i>
        </span>
      </div>
    </div>
  )
}

function SongBody({ card, active, setPrimary }: CardBodyProps) {
  const t = S.useT()
  const locale = useLocale()
  const box = useBox()
  const songId = card.songId ?? ''
  const song = SONG_BY_ID[songId]
  const opener = card.variant === 'opener'
  const visa = card.variant === 'visa'
  const navi = useNaviPick(card.id, opener)
  const asked = useNavi(s => !!s.room.knowing[songId])
  const queuedPos = useNavi(s => {
    if (s.room.now?.item.songId === songId) return 0
    const i = s.room.queue.findIndex(q => q.songId === songId)
    return i < 0 ? null : i + 1
  })
  const queued = queuedPos != null
  const over = useNavi(s => selReserveBudget(s).over)
  const pending = useNavi(s => selReserveBudget(s).pending)
  const keepMode = over && !queued && !!song

  useEffect(() => {
    if (!song) return
    if (queued) setPrimary({ action: 'reserve', label: S.ref('queuedN', { n: queuedPos ?? 0 }), enabled: false, arg: { songId } })
    else if (keepMode) setPrimary({ action: 'keep', label: S.ref('keepBall'), enabled: true, arg: { songId } })
    else setPrimary({ action: 'reserve', label: S.ref('reserve'), enabled: song.reservable, arg: { songId, navi } })
  }, [card.id, navi, queued, queuedPos, keepMode])

  // the long-press hint shares the top strip with the kind label: drop it one row when they would touch
  const hintRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const el = hintRef.current
    const label = el?.closest('.cs')?.querySelector('.cs__label .cs__kname')
    if (!el || !label) return
    el.classList.remove('is-drop')
    const a = label.getBoundingClientRect()
    const b = el.getBoundingClientRect()
    if (b.width && b.left < a.right + 8) el.classList.add('is-drop')
  }, [locale, asked, queued, box.w])

  if (!song) return <div className="sbody" />
  const small = box.h < 760 || box.w < 375
  const titleMax = visa ? (small ? 26 : 30) : small ? 30 : 36
  // the stamp shows the language the song crosses into (from the reason), else the viewing language
  const v = card.reason.text.vars?.locale
  const stampLocale: Locale = v && typeof v === 'object' && 'locale' in v ? v.locale : locale
  // passport cards never use the striped 'sunset' art behind their text (DEMO#12)
  const pattern = visa && patternFor(song.id) === 'sunset' ? 'orbits' : undefined
  const showBudget = keepMode && !card.reason.cause
  return (
    <div className={`sbody${opener ? ' sbody--opener' : ''}${visa ? ' sbody--visa' : ''}`} data-keep-mode={keepMode ? '1' : '0'}>
      <div className="sbody__art">
        <SongArt seed={song.id} energy={song.energy} animate={active} pattern={pattern} />
      </div>
      <div className="sbody__shade" />
      {opener ? <div className="sbody__goldrim" aria-hidden="true" /> : null}
      <div className="sbody__topright" ref={hintRef}>
        {asked || queued ? (
          <KnowDots songId={song.id} size={small ? 11 : 12} className="sbody__dots" />
        ) : (
          <span className="sbody__askhint">
            <LongPressIcon />
            {t('askHint')}
          </span>
        )}
      </div>
      <div className="sbody__main">
        {visa ? <VisaTitle songId={song.id} stamp={stampLocale} max={titleMax} /> : <SongTitle songId={song.id} variant="card" max={titleMax} min={18} className="sbody__title" />}
        <div className="sbody__artist">{song.artist}</div>
        {showBudget ? <BudgetLine n={pending} className="sbody__reason" /> : <ReasonLine reason={card.reason} className="sbody__reason" />}
        {opener ? (
          <motion.button
            type="button"
            role="switch"
            aria-checked={navi}
            className={`navi-toggle${navi ? ' is-on' : ''}`}
            data-testid="navi-toggle"
            data-anchor="navi-tag"
            onClick={() => setNaviPick(card.id, !navi)}
            whileTap={{ scale: 0.95 }}
          >
            <span className="navi-toggle__knob" aria-hidden="true" />
            <span className="navi-toggle__text">{t('naviToggle')}</span>
          </motion.button>
        ) : null}
      </div>
    </div>
  )
}

export const SongCardBody: CardBodyComponent = p => <SongBody {...p} />
