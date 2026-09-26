// M6 stage — PHASE-0 STUB (owned by M6 from phase 1). Public API per SPEC L/M6.
// The stub renders a working lane (NOW, #n chips, empty breathing slot, my-turn count), floor
// orbs with the B-2 entrance times, the mood word, and placeholders for the rest.
import { createElement as h, useEffect, useRef, type ReactNode } from 'react'
import { motion } from 'motion/react'
import { useShallow } from 'zustand/react/shallow'
import type { CardBodyComponent, Member, MemberId } from '../../core/types'
import { useNavi, naviApi } from '../../core/store'
import { selMyTurnIn, selQueueView } from '../../core/selectors'
import { registerTarget } from '../../core/targets'
import { introDelay, introPending, type IntroKey } from '../../core/intro'
import { SPRING } from '../../core/ui/motion'
import { SongTitle } from '../../core/ui/SongTitle'
import { StubBox } from '../../core/ui/StubBox'
import { Button } from '../../core/ui/Button'
import { common } from '../../i18n/common'
import { defineStrings } from '../../i18n'
import { Tr } from '../../core/ui/Tr'
import '../../styles/stubs.css'

/** data-* attributes for motion components created without JSX (skips excess-property checks). */
const data = (o: Record<string, string | number | undefined>): object => o

const S = defineStrings('stage', {
  ja: { myTurnIn: 'あなたの番まであと{n}曲', nowEmpty: '最初の1曲が、この部屋の空気をつくる', myTurnNow: 'あなたの番' },
  en: { myTurnIn: '{n} songs until your turn', nowEmpty: 'The first song sets the air in this room', myTurnNow: 'Your turn' },
  zhHant: { myTurnIn: '再{n}首輪到你', nowEmpty: '第一首歌，決定這個包廂的氣氛', myTurnNow: '輪到你了' },
  zhHans: { myTurnIn: '再{n}首轮到你', nowEmpty: '第一首歌，决定这个包厢的气氛', myTurnNow: '轮到你了' },
  ko: { myTurnIn: '{n}곡 뒤에 내 차례', nowEmpty: '첫 곡이 이 방의 분위기를 만들어요', myTurnNow: '내 차례' },
})

function MyTurn({ big }: { big?: boolean }) {
  const t = S.useT()
  const n = useNavi(selMyTurnIn)
  if (n == null) return null
  return h('span', { className: `stub-lane__turn${big ? ' is-big' : ''}`, 'data-testid': 'lane-my-turn' }, n === 0 ? t('myTurnNow') : t('myTurnIn', { n }))
}

export function StageLane(p: { orientation: 'horizontal' | 'vertical'; compact?: boolean }): JSX.Element {
  const t = S.useT()
  const rows = useNavi(useShallow(selQueueView))
  const members = useNavi(s => s.room.members)
  const nextRef = useRef<HTMLDivElement>(null)
  const hasNow = rows.some(r => r.pos === 0)
  useEffect(() => {
    registerTarget(p.orientation === 'vertical' ? 'room:lane' : 'lane:next', nextRef.current)
    return () => registerTarget(p.orientation === 'vertical' ? 'room:lane' : 'lane:next', null)
  })
  const intro = introPending('lane')
  const color = (id: MemberId) => members[id]?.color ?? '#fff'
  const empty = (key: string, now: boolean) =>
    h(
      'div',
      { key, ref: nextRef, className: `stub-lane__slot${now ? ' is-now' : ''}`, 'data-testid': 'lane-slot-empty' },
      h('span', { className: 'stub-lane__label' }, now ? 'NOW' : 'NEXT'),
      now && !p.compact ? h('span', { className: 'stub-lane__hint' }, t('nowEmpty')) : null,
    )
  return h(
    motion.div,
    {
      className: `stub-lane stub-lane--${p.orientation}${p.compact ? ' is-compact' : ''}`,
      ...data({ 'data-testid': 'stage-lane', 'data-orientation': p.orientation, 'data-anchor': 'lane' }),
      initial: intro ? { y: -20, opacity: 0 } : false,
      animate: { y: 0, opacity: 1 },
      transition: { ...SPRING.soft, delay: intro ? introDelay('lane') : 0 },
    },
    h(
      'div',
      { className: 'stub-lane__track' },
      hasNow ? null : empty('now', true),
      rows.map(r =>
        h(
          'div',
          {
            key: r.item.id,
            className: `stub-lane__item${r.pos === 0 ? ' is-now' : ''}${r.mine ? ' is-mine' : ''}`,
            'data-testid': r.pos === 0 ? 'lane-now' : 'lane-item',
            'data-song-id': r.item.songId,
            'data-by': r.item.by,
            'data-tags': r.item.tags.join(' '),
            'data-key': r.item.keyShift,
            style: { ['--c' as string]: color(r.item.by) },
          },
          h('span', { className: 'stub-lane__label' }, r.pos === 0 ? 'NOW' : `#${r.pos}`),
          h(SongTitle, { songId: r.item.songId, variant: 'lane' }),
          r.item.tags.includes('navi') ? h('span', { className: 'stub-lane__navi', title: 'navi' }) : null,
        ),
      ),
      hasNow ? empty('next', false) : null,
    ),
    p.compact ? null : h(MyTurn, { big: p.orientation === 'vertical' }),
    h('span', { className: 'stub-lane__flow', 'aria-hidden': true }),
  )
}

const FLOOR: { id: MemberId; x: number; key: IntroKey }[] = [
  { id: 'minato', x: 9, key: 'orbMinato' },
  { id: 'me', x: 33, key: 'junRing' },
  { id: 'saki', x: 56, key: 'orbSaki' },
  { id: 'jun', x: 77, key: 'junRing' },
]

function Orb({ m, x, k, column }: { m: Member; x: number; k: IntroKey; column: boolean }) {
  const audioOn = useNavi(s => s.session.audioOn)
  const intro = introPending(k)
  const me = m.id === 'me'
  const state = me ? (audioOn ? 'lit' : 'empty') : m.present ? 'lit' : m.arriving ? 'arriving' : 'gone'
  if (state === 'gone' && !column) return null
  return h(
    motion.div,
    {
      className: `stub-orb stub-orb--${state}${me ? ' is-me' : ''}`,
      ...data({ 'data-testid': 'member-orb', 'data-member': m.id, 'data-present': m.present ? '1' : '0', 'data-arriving': m.arriving ? '1' : '0' }),
      style: column ? { ['--c' as string]: m.color } : { left: `${x}%`, ['--c' as string]: m.color },
      initial: intro ? { scale: 0, opacity: 0 } : false,
      animate: { scale: 1, opacity: 1 },
      transition: intro ? { duration: 0.45, delay: introDelay(k), ease: 'easeOut' } : { duration: 0.2 },
    },
    h('span', { className: 'stub-orb__light' }),
    h('span', { className: 'stub-orb__name' }, h(Tr, { text: { key: `vocab.member.${m.id}` } })),
  )
}

export function MemberOrbs(p: { layout: 'floor' | 'column' }): JSX.Element {
  const members = useNavi(s => s.room.members)
  const list = p.layout === 'floor' ? FLOOR : FLOOR.filter(f => f.id !== 'me').concat(FLOOR.filter(f => f.id === 'me'))
  return h(
    'div',
    { className: `stub-orbs stub-orbs--${p.layout}`, 'data-anchor': 'orbs' },
    list.map(f => (members[f.id] ? h(Orb, { key: f.id, m: members[f.id], x: f.x, k: f.key, column: p.layout === 'column' }) : null)),
  )
}

export function MoodWord(p: { size: 'hero' | 'room' }): JSX.Element {
  const t = common.useT()
  const word = useNavi(s => s.room.moodWord)
  const intro = introPending('moodWord')
  const text = t(`mood.${word}` as Parameters<typeof t>[0])
  const base = intro ? introDelay('moodWord') : 0
  return h(
    'div',
    { className: `stub-mood stub-mood--${p.size}`, 'data-testid': 'mood-word', 'data-word': word, 'data-anchor': 'mood', role: 'button', tabIndex: 0, onClick: () => naviApi.getState().openSheet('mixer') },
    [...text].map((ch, i) =>
      h(motion.span, { key: `${word}-${text}-${i}`, initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.35, delay: base + i * 0.04 } }, ch),
    ),
  )
}

export function Spotlight(): JSX.Element {
  const mine = useNavi(s => s.room.now?.item.by === 'me')
  return mine ? h('div', { className: 'stub-spot', 'data-testid': 'spotlight' }) : h('div', { hidden: true })
}

export function StageScreen(): JSX.Element {
  const t = common.useT()
  return h(
    'div',
    { className: 'stub-screen' },
    h(StageLane, { orientation: 'vertical' }),
    h(Button, { kind: 'secondary', full: true, onClick: () => naviApi.getState().openSheet('exitConfirm') }, t('exit.confirm')),
    h(StubBox, { name: 'StageScreen', module: 'M6', quiet: true }),
  )
}

export function Standby(p: { ball: ReactNode }): JSX.Element {
  return h(
    'div',
    { className: 'stub-standby', onClick: () => naviApi.getState().setOverlay(null) },
    p.ball,
    h(MyTurn, { big: true }),
    h(StubBox, { name: 'Standby', module: 'M6', quiet: true }),
  )
}

export function RoomBoard(): JSX.Element {
  const now = useNavi(s => s.room.now)
  const members = useNavi(s => s.room.members)
  return h(
    'div',
    { className: 'stub-roomboard', 'data-testid': 'room-board', 'data-anchor': 'room-view' },
    h(
      'div',
      { className: 'stub-roomboard__now' },
      h('span', { className: 'stub-lane__label' }, 'NOW'),
      now ? h(SongTitle, { songId: now.item.songId, variant: 'card', max: 56 }) : h('span', { className: 'stub-roomboard__empty' }, '—'),
      now ? h('span', { className: 'stub-roomboard__by', style: { color: members[now.item.by]?.color } }, h(Tr, { text: { key: `vocab.member.${now.item.by}` } })) : null,
    ),
    h(StubBox, { name: 'RoomBoard', module: 'M6', quiet: true, className: 'stub-roomboard__slot' }),
  )
}

export function RoomSidebar(p: { constellation: ReactNode }): JSX.Element {
  return h(
    'div',
    { className: 'stub-roomside', 'data-testid': 'room-sidebar' },
    h(MemberOrbs, { layout: 'column' }),
    h(MoodWord, { size: 'room' }),
    h('div', { className: 'stub-roomside__constellation' }, p.constellation),
    h(StubBox, { name: 'RoomSidebar · QR', module: 'M6', className: 'stub-roomside__qr' }),
  )
}

export function Seam(): JSX.Element {
  return h('div', { className: 'stub-seam', 'aria-hidden': true }, h('span', null))
}

function ShiftBody({ card, setPrimary }: Parameters<CardBodyComponent>[0]) {
  useEffect(() => {
    setPrimary({ action: 'insert', label: { key: 'cards.reserve' }, enabled: !!(card.options?.[0] ?? card.songId), arg: { songId: card.options?.[0] ?? card.songId } })
  }, [card.id])
  return h(
    StubBox,
    { name: 'ShiftCardBody', module: 'M6', className: 'stub-body' },
    h('div', { className: 'stub-body__reason', 'data-testid': 'card-reason' }, h(Tr, { text: card.reason.text }), card.reason.cause ? h(Tr, { text: card.reason.cause, prefix: ' · ' }) : null),
  )
}
export const ShiftCardBody: CardBodyComponent = p => h(ShiftBody, p)
