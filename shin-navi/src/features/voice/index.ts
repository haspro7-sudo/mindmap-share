// M7 voice — PHASE-0 STUB (owned by M7 from phase 1). Public API per SPEC L/M7.
import { createElement as h, useEffect } from 'react'
import type { CardBodyComponent, SongId, VoiceReading } from '../../core/types'
import type { CaptureResult } from '../../lib/pitch'
import { voiceType, songsForVoice, rangeFit } from '../../engine/reading'
import { SONG_BY_ID } from '../../data/songs'
import { StubBox } from '../../core/ui/StubBox'
import { VoiceOrb } from '../../core/ui/VoiceOrb'
import { useNavi } from '../../core/store'
import { tr } from '../../i18n'
import '../../styles/stubs.css'

export type QuizAnswers = { high: 'easy' | 'normal' | 'hard'; chorus: 'belt' | 'soft' | 'between'; style: 'ride' | 'talk' | 'sustain' }

export function quizToFeatures(q: QuizAnswers): { power: number; care: number; brightness: number; groove: number; range: [number, number] } {
  const power = q.chorus === 'belt' ? 0.85 : q.chorus === 'between' ? 0.55 : 0.3
  const care = q.style === 'sustain' ? 0.85 : q.style === 'talk' ? 0.35 : 0.55
  const brightness = q.high === 'easy' ? 0.85 : q.high === 'normal' ? 0.55 : 0.3
  const groove = q.style === 'ride' ? 0.9 : 0.35
  const range: [number, number] = q.high === 'easy' ? [55, 76] : q.high === 'normal' ? [52, 72] : [48, 67]
  return { power, care, brightness, groove, range }
}

export function buildReading(src: { capture: CaptureResult | null; quiz?: QuizAnswers }, ctx: { nightId: string; now: number; exclude: SongId[] }): VoiceReading {
  const fromQuiz = quizToFeatures(src.quiz ?? { high: 'normal', chorus: 'between', style: 'ride' })
  const f = src.capture?.features ?? fromQuiz
  const range = src.capture?.range ?? fromQuiz.range
  const type = voiceType(f)
  const pick = songsForVoice(type, range, 6).find(s => !ctx.exclude.includes(s.id))
  const song = pick ? SONG_BY_ID[pick.id] : undefined
  return {
    nightId: ctx.nightId,
    at: ctx.now,
    type,
    power: f.power,
    care: f.care,
    brightness: f.brightness,
    groove: f.groove,
    range,
    method: src.capture ? 'mic' : 'quiz',
    evidence: { key: `vocab.voice.${type}` },
    suggest: song ? { songId: song.id, keyShift: rangeFit(song, range).shift } : undefined,
  }
}

export function VoiceSheet(): JSX.Element {
  const last = useNavi(s => s.col.voices.at(-1) ?? null)
  return h(StubBox, { name: 'VoiceSheet', module: 'M7', className: 'stub-sheetbody' }, h(VoiceOrb, { reading: last, size: 96 }))
}

function VoiceBody({ card, setPrimary }: Parameters<CardBodyComponent>[0]) {
  useEffect(() => {
    setPrimary({ action: 'measure', label: { key: 'common.lang' }, enabled: true })
  }, [card.id])
  return h(
    StubBox,
    { name: 'VoiceCardBody', module: 'M7', className: 'stub-body' },
    h(VoiceOrb, { reading: null, size: 72 }),
    h('div', { className: 'stub-body__reason', 'data-testid': 'card-reason' }, tr(card.reason.text)),
  )
}
export const VoiceCardBody: CardBodyComponent = p => h(VoiceBody, p)
