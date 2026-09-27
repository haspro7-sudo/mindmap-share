// The voice card body (arch frame, SPEC C-8 ⑤). Before a check: "今夜の声を見てみる？", the two
// paths and "録音は保存しません" under three dim pillars. After: the pillars fused into tonight's
// colour orb, "今回の声は{type}", the evidence line and one song with its key; the primary turns
// into a key-attached reserve ("−2で予約") and a right flick keeps that song.
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { motion } from 'motion/react'
import type { CardBodyComponent, CardBodyProps, VoiceReading } from '../../core/types'
import { useNavi } from '../../core/store'
import { useBox } from '../../core/layout'
import { sound } from '../../core/sound'
import { Icon } from '../../core/ui/Icon'
import { SongTitle } from '../../core/ui/SongTitle'
import { SongArt } from '../../ui/SongArt'
import { SONG_BY_ID } from '../../data/songs'
import { useTr } from '../../i18n'
import { keyAdvice, keyBadge, reserveLabel, TYPE_COLOR } from './buildReading'
import { TypeLine, VoiceStage, RISE_MS, type StagePhase } from './Pillars'
import { requestVoiceEntry } from './VoiceSheet'
import { V } from './strings'
import './voice.css'

function CauseGlyph() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
      <path d="M5 2v5.2a3 3 0 0 0 6 0V2" />
      <path d="M8 10.2V15" />
    </svg>
  )
}

function QuizMini() {
  return (
    <svg width="20" height="20" viewBox="0 0 26 26" fill="none" strokeLinecap="round" aria-hidden="true">
      <path d="M6 20V13" stroke="#FF4D4D" strokeWidth="3.2" />
      <path d="M13 20V7" stroke="#4D8BFF" strokeWidth="3.2" />
      <path d="M20 20V10" stroke="#FFD84D" strokeWidth="3.2" />
    </svg>
  )
}

/** Tonight's newest reading made since this card was dealt (the card's "after" state). */
function useCardReading(dealtAt: number): VoiceReading | null {
  return useNavi(s => {
    const v = s.col.voices
    for (let i = v.length - 1; i >= 0; i--) {
      if (v[i].nightId !== s.session.nightId) continue
      return v[i].at >= dealtAt ? v[i] : null
    }
    return null
  })
}

function VoiceBody({ card, active, act, setPrimary }: CardBodyProps) {
  const t = V.useT()
  const trr = useTr()
  const box = useBox()
  const small = box.h < 760 || box.w < 375
  const reading = useCardReading(card.dealtAt)
  const sheetOpen = useNavi(s => s.ui.sheet != null)
  const reduced = useNavi(s => s.ui.reduced)
  const sug = reading?.suggest
  const song = sug ? SONG_BY_ID[sug.songId] : undefined
  const queued = useNavi(s => !!sug && (s.room.queue.some(q => q.songId === sug.songId && q.by === 'me') || s.room.now?.item.songId === sug.songId))

  useEffect(() => {
    if (reading && sug && song) setPrimary({ action: 'reserve', label: reserveLabel(sug.keyShift), enabled: song.reservable && !queued, arg: { songId: sug.songId, keyShift: sug.keyShift, version: 'original' } })
    else setPrimary({ action: 'measure', label: V.ref('primary.measure'), enabled: true })
  }, [card.id, reading?.at, sug?.songId, sug?.keyShift, queued])

  // The first time the after-state is actually seen (sheet closed, card on top), replay a quick
  // rise → fuse so the card itself shows what just happened.
  const [shownPhase, setShownPhase] = useState<StagePhase>('final')
  const [runId, setRunId] = useState(0)
  const played = useRef<number | null>(null)
  useEffect(() => {
    if (!reading || sheetOpen || !active || played.current === reading.at) return
    played.current = reading.at
    if (reduced) return setShownPhase('final')
    setRunId(x => x + 1)
    setShownPhase('rise')
    const id = window.setTimeout(() => setShownPhase('merge'), RISE_MS + 120)
    return () => clearTimeout(id)
  }, [reading?.at, sheetOpen, active, reduced])

  const open = (e: 'mic' | 'quiz') => {
    sound.play('tap')
    requestVoiceEntry(e)
    act('measure')
  }

  if (!reading) {
    const causeOnly = card.reason.text.key === 'reason.voice'
    return (
      <div className={`vc vc--before${small ? ' is-small' : ''}`} data-private="1">
        <VoiceStage variant="card" small={small} phase="idle" labels={false} className="vc__stage" />
        <div className="vc__reason" data-testid="card-reason">
          <div className="vc__q">{t('card.q')}</div>
          <div className="vc__cause">
            <CauseGlyph />
            <span>
              {causeOnly ? null : `${trr(card.reason.text)} `}
              {card.reason.cause ? trr(card.reason.cause) : null}
            </span>
          </div>
        </div>
        <div className="vc__paths">
          <motion.button type="button" className="vc__path vc__path--mic" data-testid="voice-card-mic" whileTap={{ scale: 0.95 }} onClick={() => open('mic')}>
            <span className="vc__pico">
              <Icon name="sing" size={18} strokeWidth={2} />
            </span>
            <span className="vc__ptext">
              <b>{t('card.mic')}</b>
              <i>{t('card.micSub')}</i>
            </span>
          </motion.button>
          <motion.button type="button" className="vc__path vc__path--quiz" data-testid="voice-card-quiz" whileTap={{ scale: 0.95 }} onClick={() => open('quiz')}>
            <span className="vc__pico">
              <QuizMini />
            </span>
            <span className="vc__ptext">
              <b>{t('card.quiz')}</b>
              <i>{t('card.quizSub')}</i>
            </span>
          </motion.button>
        </div>
        <div className="vc__norec">
          <Icon name="lock" size={12} strokeWidth={2.2} />
          {t('card.noRec')}
        </div>
      </div>
    )
  }

  const tc = TYPE_COLOR[reading.type]
  return (
    <div className={`vc vc--after${small ? ' is-small' : ''}`} data-private="1" data-testid="voice-card-result" data-type={reading.type} style={{ ['--tc' as string]: tc } as CSSProperties}>
      <VoiceStage variant="card" small={small} phase={shownPhase} values={reading} type={reading.type} labels={false} reduced={reduced} runId={runId} className="vc__stage" />
      <TypeLine type={reading.type} play={shownPhase !== 'final'} delayMs={RISE_MS + 380} reduced={reduced} compact key={`tl:${runId}`} />
      <div className="vc__ev" data-testid="card-reason">
        {trr(reading.evidence)}
      </div>
      {sug && song ? (
        <div className="vc__song" data-song-id={song.id} data-key={sug.keyShift}>
          <div className="vc__art">
            <SongArt seed={song.id} energy={song.energy} animate={false} />
          </div>
          <div className="vc__meta">
            <SongTitle songId={song.id} variant="chip" className="vc__title" />
            <span className="vc__keytext">{trr(keyAdvice(sug.keyShift))}</span>
          </div>
          <span className={`vc__key${sug.keyShift === 0 ? ' is-orig' : ''}`}>{sug.keyShift === 0 ? t('key.origShort') : keyBadge(sug.keyShift)}</span>
        </div>
      ) : (
        <div className="vc__ev vc__ev--dim">{t('noSong')}</div>
      )}
    </div>
  )
}

export const VoiceCardBody: CardBodyComponent = (p: CardBodyProps) => <VoiceBody {...p} />
