// M5 room-sim — PHASE-0 STUB (owned by M5 from phase 1). Public API per SPEC L/M5.
// The stub answers "知ってる？" for present roommates (E-2 formula, seeded, arrival delays),
// handles a few presenter commands, and shows a minimal presenter panel.
import { createElement as h, useEffect } from 'react'
import type { CardBodyComponent, Member, MemberId, OtherId, Song, TextRef, VoiceTypeId } from '../../core/types'
import type { NaviApi } from '../../core/store/types'
import { useNavi, naviApi } from '../../core/store'
import { bus } from '../../core/events'
import { after } from '../../core/clock'
import { pKnow } from '../../core/rules'
import { SONG_BY_ID } from '../../data/songs'
import { seeded } from '../../lib/rng'
import { StubBox } from '../../core/ui/StubBox'
import { SongTitle } from '../../core/ui/SongTitle'
import { Tr } from '../../core/ui/Tr'
import '../../styles/stubs.css'

export function knowProbability(m: Member, s: Song): { know: number; chorus: number } {
  const know = pKnow(m, s)
  let aware = s.knownRate[m.generation] / 100
  if (m.id === 'jun') aware *= s.inboundTitle.ko ? 1 : 0.5
  const chorus = (1 - know) * (s.year >= 2018 ? 0.3 * aware : 0.1 * aware)
  return { know, chorus }
}

export const SCRIPT: { id: string; label: TextRef; run(api: NaviApi): void }[] = []

export function pairName(a: VoiceTypeId, b: VoiceTypeId): TextRef {
  const [x, y] = [a, b].sort()
  return { key: `vocab.pair.${x}_${y}` }
}

export function installRoomSim(api: NaviApi): () => void {
  const cancels: (() => void)[] = []
  const answer = (songId: string, immediate: boolean) => {
    const s = api.getState()
    const song = SONG_BY_ID[songId]
    if (!song) return
    for (const m of Object.values(s.room.members)) {
      if (m.id === 'me' || !m.present || s.room.knowing[songId]?.answers[m.id]) continue
      const r = seeded(`${s.session.seed}|know|${m.id}|${songId}`)
      if (r() < 0.15) continue // 15% never answer: indistinguishable from "don't know"
      const p = knowProbability(m, song)
      const roll = r()
      const a = roll < p.know ? 'know' : roll < p.know + p.chorus ? 'chorus' : 'none'
      const delay = immediate ? 0 : (0.6 + 3.4 * r() ** 2) * 1000
      const run = () => api.getState().answerKnow(songId, m.id as MemberId, a)
      if (delay === 0) run()
      else cancels.push(after(delay, run))
    }
  }
  // tallies that already exist (e.g. the opener asked on entry) are answered at once
  for (const id of Object.keys(api.getState().room.knowing)) answer(id, true)
  const offAsk = bus.on('know/asked', e => answer(e.songId, false))
  const offCmd = bus.on('presenter/cmd', ({ cmd }) => {
    const s = api.getState()
    switch (cmd.t) {
      case 'join':
        s.memberJoin(cmd.id)
        break
      case 'leave':
        s.memberLeave(cmd.id)
        break
      case 'advance':
        if (s.room.now) s.finishNow()
        s.startNext()
        break
      case 'speed':
        s.setSpeed(cmd.v)
        break
      case 'script':
        s.setScript(cmd.on)
        break
      case 'view':
        s.setView(cmd.v)
        break
      case 'minutesLeft':
        s.jumpToMinutesLeft(cmd.m)
        break
      case 'exit':
        s.exitRoom()
        break
      case 'seedNights':
        s.seedPastNights(cmd.n)
        break
      case 'reset':
        s.resetAll()
        break
    }
  })
  return () => {
    offAsk()
    offCmd()
    cancels.forEach(c => c())
  }
}

function InviteBody({ card, setPrimary }: Parameters<CardBodyComponent>[0]) {
  useEffect(() => {
    setPrimary({ action: 'accept', label: { key: 'cards.reserve' }, enabled: true, arg: { songId: card.songId } })
  }, [card.id])
  return h(
    StubBox,
    { name: 'InviteCardBody', module: 'M5', className: 'stub-body' },
    card.songId ? h(SongTitle, { songId: card.songId, variant: 'card', max: 26 }) : null,
    h('div', { className: 'stub-body__reason', 'data-testid': 'card-reason' }, h(Tr, { text: card.reason.text })),
  )
}
export const InviteCardBody: CardBodyComponent = p => h(InviteBody, p)

function FinaleBody({ card, setPrimary }: Parameters<CardBodyComponent>[0]) {
  useEffect(() => {
    setPrimary({ action: 'vote', label: { key: 'cards.reserve' }, enabled: !!card.options?.length, arg: { songId: card.options?.[0] } })
  }, [card.id])
  return h(
    StubBox,
    { name: 'FinaleCardBody', module: 'M5', className: 'stub-body' },
    h('div', { className: 'stub-body__reason', 'data-testid': 'card-reason' }, h(Tr, { text: card.reason.text })),
    h('div', { className: 'stub-body__opts' }, (card.options ?? []).map(id => h('span', { key: id, className: 'stub-body__opt' }, h(SongTitle, { songId: id, variant: 'chip' })))),
  )
}
export const FinaleCardBody: CardBodyComponent = p => h(FinaleBody, p)

const PP: { id: string; label: string; run: () => void }[] = [
  { id: 'next', label: 'Next →', run: () => bus.emit({ type: 'presenter/cmd', cmd: { t: 'next' } }) },
  { id: 'join', label: 'Jun joins', run: () => bus.emit({ type: 'presenter/cmd', cmd: { t: 'join', id: 'jun' as OtherId } }) },
  { id: 'leave', label: 'Jun leaves', run: () => bus.emit({ type: 'presenter/cmd', cmd: { t: 'leave', id: 'jun' as OtherId } }) },
  { id: 'advance', label: 'Advance song', run: () => bus.emit({ type: 'presenter/cmd', cmd: { t: 'advance' } }) },
  { id: 'min15', label: '15 min left', run: () => bus.emit({ type: 'presenter/cmd', cmd: { t: 'minutesLeft', m: 15 } }) },
  { id: 'exit', label: 'Exit', run: () => bus.emit({ type: 'presenter/cmd', cmd: { t: 'exit' } }) },
  { id: 'lens', label: 'Lens (L)', run: () => naviApi.getState().toggleLens() },
  { id: 'split', label: 'Split (S)', run: () => naviApi.getState().toggleSplit() },
  { id: 'view', label: 'View: dual', run: () => bus.emit({ type: 'presenter/cmd', cmd: { t: 'view', v: 'dual' } }) },
  { id: 'reset', label: 'Reset', run: () => bus.emit({ type: 'presenter/cmd', cmd: { t: 'reset' } }) },
]

export function PresenterPanel(): JSX.Element {
  const open = useNavi(s => s.ui.presenter)
  if (!open) return h('div', { hidden: true })
  return h(
    'div',
    { className: 'stub-presenter', 'data-testid': 'presenter-panel' },
    h('div', { className: 'stub-presenter__head' }, 'PresenterPanel · M5', h('button', { type: 'button', onClick: () => naviApi.getState().togglePresenter() }, '×')),
    h('div', { className: 'stub-presenter__grid' }, PP.map(b => h('button', { key: b.id, type: 'button', 'data-testid': `pp-${b.id}`, onClick: b.run }, b.label))),
  )
}
