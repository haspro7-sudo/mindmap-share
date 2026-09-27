// Song card body (SPEC C-8 1): full-bleed generated art, a big title (visa: original and local
// title stacked at the same size, romaji under), the reason line with its source glyph, up to
// three evidence chips, the know-dots once the room has been asked (else the long-press hint)
// and the "add as a Navi pick" toggle (on by default for the opener).
import { useEffect, useState } from 'react'
import { motion } from 'motion/react'
import type { CardBodyComponent, CardBodyProps } from '../../../core/types'
import { useNavi } from '../../../core/store'
import { KnowDots } from '../../../core/ui/KnowDots'
import { SongTitle } from '../../../core/ui/SongTitle'
import { Chip } from '../../../core/ui/Chip'
import { SongArt } from '../../../ui/SongArt'
import { SONG_BY_ID, decadeOf, type Song } from '../../../data/songs'
import { useBox } from '../../../core/layout'
import { useLocale, useTr } from '../../../i18n'
import { ReasonLine } from '../CardShell'
import { S } from '../strings'

function versionChip(song: Song): string | null {
  if (song.versions.includes('anime')) return 'anime'
  if (song.versions.includes('artistMv')) return 'artistMv'
  return 'original'
}

function LongPressIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
      <circle cx="8" cy="8" r="2.4" fill="currentColor" stroke="none" />
      <circle cx="8" cy="8" r="5.6" strokeDasharray="2.2 2" />
    </svg>
  )
}

function SongBody({ card, active, setPrimary }: CardBodyProps) {
  const t = S.useT()
  const trr = useTr()
  const locale = useLocale()
  const box = useBox()
  const songId = card.songId ?? ''
  const song = SONG_BY_ID[songId]
  const opener = card.variant === 'opener'
  const visa = card.variant === 'visa'
  const [navi, setNavi] = useState(opener)
  const asked = useNavi(s => !!s.room.knowing[songId])
  const queuedPos = useNavi(s => {
    if (s.room.now?.item.songId === songId) return 0
    const i = s.room.queue.findIndex(q => q.songId === songId)
    return i < 0 ? null : i + 1
  })
  const queued = queuedPos != null

  useEffect(() => {
    if (!song) return
    if (queued) setPrimary({ action: 'reserve', label: S.ref('queuedN', { n: queuedPos ?? 0 }), enabled: false, arg: { songId } })
    else setPrimary({ action: 'reserve', label: S.ref('reserve'), enabled: song.reservable, arg: { songId, navi } })
  }, [card.id, navi, queued, queuedPos])

  if (!song) return <div className="sbody" />
  const vchip = versionChip(song)
  const small = box.h < 760 || box.w < 375
  const titleMax = visa ? (small ? 26 : 30) : small ? 30 : 36
  // the stamp shows the language the song crosses into (from the reason), else the viewing language
  const v = card.reason.text.vars?.locale
  const stampLocale = v && typeof v === 'object' && 'locale' in v ? v.locale : locale
  const localeCode = stampLocale === 'zhHant' ? 'TW' : stampLocale === 'zhHans' ? 'CN' : stampLocale.toUpperCase()
  return (
    <div className={`sbody${opener ? ' sbody--opener' : ''}${visa ? ' sbody--visa' : ''}`}>
      <div className="sbody__art">
        <SongArt seed={song.id} energy={song.energy} animate={active} />
      </div>
      <div className="sbody__shade" />
      {opener ? <div className="sbody__goldrim" aria-hidden="true" /> : null}
      <div className="sbody__topright">
        {asked || queued ? (
          <KnowDots songId={song.id} size={small ? 11 : 12} className="sbody__dots" />
        ) : (
          <span className="sbody__askhint">
            <LongPressIcon />
            {t('askHint')}
          </span>
        )}
      </div>
      {visa ? (
        <div className="sbody__visa" aria-hidden="true">
          <span className="sbody__visa-in">
            <b>VISA</b>
            <i>{localeCode}</i>
          </span>
        </div>
      ) : null}
      <div className="sbody__main">
        <SongTitle songId={song.id} variant={visa ? 'visa' : 'card'} max={titleMax} min={18} className="sbody__title" />
        <div className="sbody__artist">{song.artist}</div>
        <ReasonLine reason={card.reason} className="sbody__reason" />
        <div className="sbody__chips">
          <Chip size="sm">{t('decade', { d: decadeOf(song).replace('s', '') })}</Chip>
          <Chip size="sm">{trr({ key: `vocab.tempo.${song.tempo}` })}</Chip>
          {vchip ? <Chip size="sm">{trr({ key: `vocab.version.${vchip}` })}</Chip> : null}
        </div>
        <motion.button
          type="button"
          role="switch"
          aria-checked={navi}
          className={`navi-toggle${navi ? ' is-on' : ''}`}
          data-testid="navi-toggle"
          data-anchor="navi-tag"
          onClick={() => setNavi(v => !v)}
          whileTap={{ scale: 0.95 }}
        >
          <span className="navi-toggle__knob" aria-hidden="true" />
          <span className="navi-toggle__text">{t('naviToggle')}</span>
        </motion.button>
      </div>
    </div>
  )
}

export const SongCardBody: CardBodyComponent = p => <SongBody {...p} />
