// M3 cards — PHASE-0 STUB (owned by M3 from phase 1). Public API per SPEC L/M3.
// The stub shows the top card with its body and the two peeking edges, and a working action
// bar (pass / primary / keep) so the loop can be exercised before gestures and flights land.
import { createElement as h, useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { useShallow } from 'zustand/react/shallow'
import type { CardBodyComponent, CardKind, DeckCard, PrimarySpec } from '../../core/types'
import { KEEPABLE, FRAME_OF } from '../../core/types'
import { useNavi, naviApi } from '../../core/store'
import { selPeeks, selTopCard, selKnowView } from '../../core/selectors'
import { usePhoneMetrics } from '../../core/layout'
import { introDelay, introPending } from '../../core/intro'
import { SPRING } from '../../core/ui/motion'
import { Icon } from '../../core/ui/Icon'
import { SongTitle } from '../../core/ui/SongTitle'
import { KnowDots } from '../../core/ui/KnowDots'
import { SongArt } from '../../ui/SongArt'
import { SONG_BY_ID } from '../../data/songs'
import { defineStrings, useTr } from '../../i18n'
import { Tr } from '../../core/ui/Tr'
import '../../styles/stubs.css'

/** data-* attributes for motion components created without JSX (skips excess-property checks). */
const data = (o: Record<string, string | number | undefined>): object => o

// G-6 strings for the stub (M3 moves these to strings.ts).
const S = defineStrings('cards', {
  ja: { reserve: '予約', keep: '気になる', pass: 'パス', ask: '部屋に聞く', putDown: 'スマホを置いて聴く', oneMore: 'もう1ラウンド', undo: '戻す' },
  en: { reserve: 'Reserve', keep: 'Keep', pass: 'Pass', ask: 'Ask the room', putDown: 'Put the phone down and listen', oneMore: 'One more round', undo: 'Undo' },
  zhHant: { reserve: '點歌', keep: '收藏', pass: '略過', ask: '問問大家', putDown: '放下手機，好好聽', oneMore: '再來一輪', undo: '復原' },
  zhHans: { reserve: '点歌', keep: '收藏', pass: '跳过', ask: '问问大家', putDown: '放下手机，好好听', oneMore: '再来一轮', undo: '撤销' },
  ko: { reserve: '예약', keep: '찜하기', pass: '패스', ask: '모두에게 묻기', putDown: '폰 내려놓고 듣기', oneMore: '한 라운드 더', undo: '되돌리기' },
})

export function classifyGesture(g: { dx: number; dy: number; vx: number; vy: number; w: number; h: number; ms: number; moved: number }): 'up' | 'right' | 'left' | 'down' | 'tap' | 'long' | null {
  if (g.moved < 8) return g.ms >= 500 ? 'long' : 'tap'
  const ax = Math.abs(g.dx)
  const ay = Math.abs(g.dy)
  if (ay >= ax) {
    if (Math.abs(g.vy) >= 600 || ay >= g.h * 0.35) return g.dy < 0 ? 'up' : 'down'
    return null
  }
  if (Math.abs(g.vx) >= 600 || ax >= g.w * 0.35) return g.dx > 0 ? 'right' : 'left'
  return null
}

const act = (card: DeckCard) => (a: Parameters<CardBodyProps['act']>[0], arg?: Parameters<CardBodyProps['act']>[1]) => naviApi.getState().act(card.id, a, arg)
type CardBodyProps = Parameters<CardBodyComponent>[0]
const setPrimary = (p: PrimarySpec) => naviApi.getState().setPrimary(p)

function Peek({ card, i, w, hgt }: { card: DeckCard; i: number; w: number; hgt: number }) {
  const intro = introPending('peeks')
  const y = i === 0 ? -12 : -22
  const scale = i === 0 ? 0.95 : 0.9
  return h(motion.div, {
    className: `stub-card stub-card--peek stub-frame--${FRAME_OF(card)}`,
    ...data({ 'data-testid': 'card-peek', 'data-kind': card.kind }),
    style: { width: w, height: hgt, zIndex: 2 - i },
    initial: intro ? { y: 0, scale: 0.9, opacity: 0 } : false,
    animate: { y, scale, opacity: 1 - i * 0.25 },
    transition: { ...SPRING.soft, delay: intro ? introDelay('peeks') + i * 0.08 : 0 },
  })
}

export function DeckView(p: { bodies: Record<CardKind, CardBodyComponent> }): JSX.Element {
  const top = useNavi(selTopCard)
  const peeks = useNavi(useShallow((s: Parameters<typeof selPeeks>[0]) => selPeeks(s, 2)))
  const redealing = useNavi(s => (s.deck.redeal && Date.now() - s.deck.redeal.at < 1400 ? '1' : '0'))
  const m = usePhoneMetrics()
  const w = m.cardW
  const hgt = m.cardH
  const Body = top ? p.bodies[top.kind] : null
  const intro = introPending('cardRise')
  return h(
    'div',
    { className: 'stub-deck', 'data-testid': 'deck', 'data-redealing': redealing, 'data-anchor': top ? `card:${top.kind}${top.variant === 'visa' ? '.visa' : ''}` : undefined, 'data-private': '1' },
    h('div', { className: 'stub-deck__stack', style: { width: w, height: hgt } }, [
      ...peeks.map((c, i) => h(Peek, { key: c.id, card: c, i, w, hgt })),
      h(
        AnimatePresence,
        { key: 'top', mode: 'popLayout' },
        top && Body
          ? h(
              motion.div,
              {
                key: top.id,
                className: `stub-card stub-card--top stub-frame--${FRAME_OF(top)}`,
                ...data({ 'data-testid': 'card-top', 'data-kind': top.kind, 'data-variant': top.variant ?? '', 'data-card-id': top.id }),
                style: { width: w, height: hgt, zIndex: 5 },
                initial: intro ? { y: 80, scale: 0.92, opacity: 0 } : { y: 24, scale: 0.96, opacity: 0 },
                animate: { y: 0, scale: 1, opacity: 1 },
                exit: { y: -120, opacity: 0, scale: 0.9, transition: { duration: 0.22 } },
                transition: { ...SPRING.soft, delay: intro ? introDelay('cardRise') : 0 },
              },
              top.songId ? h('div', { className: 'stub-card__art' }, h(SongArt, { seed: top.songId, energy: SONG_BY_ID[top.songId]?.energy ?? 0.5, animate: true })) : null,
              h('div', { className: 'stub-card__shade' }),
              h('div', { className: 'stub-card__content' }, h(Body, { card: top, active: true, flipped: false, act: act(top), setPrimary })),
            )
          : null,
      ),
    ]),
  )
}

export function ActionBar(): JSX.Element {
  const t = S.useT()
  const trr = useTr()
  const top = useNavi(selTopCard)
  const primary = useNavi(s => s.deck.primary)
  if (!top) return h('div', { className: 'stub-actionbar' })
  if (top.kind === 'breather') return h('div', { className: 'stub-actionbar is-hidden' })
  const doAct = (a: Parameters<CardBodyProps['act']>[0], arg?: Parameters<CardBodyProps['act']>[1]) => naviApi.getState().act(top.id, a, arg)
  return h(
    'div',
    { className: 'stub-actionbar' },
    h('button', { type: 'button', className: 'stub-ab stub-ab--pass', 'data-testid': 'btn-pass', onClick: () => doAct('pass') }, h(Icon, { name: 'close', size: 18, strokeWidth: 2.2 }), h('span', null, t('pass'))),
    h(
      motion.button,
      {
        type: 'button',
        className: 'stub-ab stub-ab--primary',
        ...data({ 'data-testid': 'btn-primary' }),
        disabled: primary ? !primary.enabled : false,
        whileTap: { scale: 0.96 },
        onClick: () => (primary ? doAct(primary.action, primary.arg) : doAct('reserve', { songId: top.songId })),
      },
      primary ? trr(primary.label) : t('reserve'),
    ),
    KEEPABLE.has(top.kind)
      ? h('button', { type: 'button', className: 'stub-ab stub-ab--keep', 'data-testid': 'btn-keep', onClick: () => doAct('keep', { songId: top.songId }) }, h(Icon, { name: 'sparkle', size: 18, strokeWidth: 2 }), h('span', null, t('keep')))
      : h('span', { className: 'stub-ab stub-ab--spacer' }),
  )
}

export function FlightLayer(): JSX.Element {
  return h('div', { className: 'stub-layer', 'aria-hidden': true, 'data-stub': 'FlightLayer' })
}

export function UndoToast(): JSX.Element {
  const t = S.useT()
  const undo = useNavi(s => s.deck.undo)
  const [, bump] = useState(0)
  useEffect(() => {
    if (!undo) return
    const id = setTimeout(() => bump(x => x + 1), Math.max(0, undo.at + 3000 - Date.now()) + 20)
    return () => clearTimeout(id)
  }, [undo?.at])
  const fresh = undo && Date.now() - undo.at < 3000
  return h(
    AnimatePresence,
    null,
    fresh
      ? h(
          motion.div,
          { key: undo!.at, className: 'stub-undo', ...data({ 'data-testid': 'undo-toast' }), initial: { y: 20, opacity: 0 }, animate: { y: 0, opacity: 1 }, exit: { y: 20, opacity: 0 } },
          h('button', { type: 'button', 'data-testid': 'undo-button', onClick: () => naviApi.getState().undo() }, h(Icon, { name: 'undo', size: 16 }), t('undo')),
        )
      : null,
  )
}

function SongBody({ card, setPrimary: sp }: CardBodyProps) {
  const asked = useNavi(s => !!selKnowView(card.songId ?? '')(s))
  useEffect(() => {
    sp({ action: 'reserve', label: S.ref('reserve'), enabled: true, arg: { songId: card.songId, navi: card.variant === 'opener' } })
  }, [card.id])
  return h(
    'div',
    { className: 'stub-body stub-body--song' },
    h('div', { className: 'stub-body__kind' }, card.variant === 'opener' ? 'SPARK' : card.variant === 'visa' ? 'VISA' : 'SONG'),
    card.songId ? h(SongTitle, { songId: card.songId, variant: card.variant === 'visa' ? 'visa' : 'card' }) : null,
    card.songId ? h('div', { className: 'stub-body__artist' }, SONG_BY_ID[card.songId]?.artist ?? '') : null,
    h('div', { className: 'stub-body__reason', 'data-testid': 'card-reason' }, h(Tr, { text: card.reason.text }), card.reason.cause ? h(Tr, { text: card.reason.cause, prefix: ' · ' }) : null),
    asked && card.songId ? h(KnowDots, { songId: card.songId, size: 14 }) : null,
  )
}
export const SongCardBody: CardBodyComponent = p => h(SongBody, p)

function AskBody({ card, setPrimary: sp }: CardBodyProps) {
  const asked = useNavi(s => !!s.room.knowing[card.songId ?? ''])
  useEffect(() => {
    sp(asked ? { action: 'reserve', label: S.ref('reserve'), enabled: true, arg: { songId: card.songId } } : { action: 'ask', label: S.ref('ask'), enabled: true, arg: { songId: card.songId } })
  }, [card.id, asked])
  return h(
    'div',
    { className: 'stub-body stub-body--ask' },
    h('div', { className: 'stub-body__kind' }, 'ASK'),
    card.songId ? h(SongTitle, { songId: card.songId, variant: 'card', max: 28 }) : null,
    card.songId ? h(KnowDots, { songId: card.songId, size: 16, label: true }) : null,
    h('div', { className: 'stub-body__reason', 'data-testid': 'card-reason' }, h(Tr, { text: card.reason.text })),
  )
}
export const AskCardBody: CardBodyComponent = p => h(AskBody, p)

function LinkBody({ card, setPrimary: sp }: CardBodyProps) {
  const pick = useNavi(s => s.deck.selection[card.id]) ?? card.options?.[0]
  useEffect(() => {
    sp({ action: 'reserve', label: S.ref('reserve'), enabled: !!pick, arg: { songId: pick } })
  }, [card.id, pick])
  return h(
    'div',
    { className: 'stub-body' },
    h('div', { className: 'stub-body__kind' }, 'LINK'),
    h('div', { className: 'stub-body__reason', 'data-testid': 'card-reason' }, h(Tr, { text: card.reason.text })),
    h(
      'div',
      { className: 'stub-body__opts' },
      (card.options ?? []).map(id =>
        h('button', { key: id, type: 'button', className: `stub-body__opt${id === pick ? ' is-on' : ''}`, onClick: () => naviApi.getState().select(card.id, id) }, h(SongTitle, { songId: id, variant: 'chip' })),
      ),
    ),
  )
}
export const LinkCardBody: CardBodyComponent = p => h(LinkBody, p)

function BreatherBody({ card, setPrimary: sp, act: doAct }: CardBodyProps) {
  const t = S.useT()
  useEffect(() => {
    sp({ action: 'putDown', label: S.ref('putDown'), enabled: true })
  }, [card.id])
  return h(
    'div',
    { className: 'stub-body stub-body--breather' },
    h('div', { className: 'stub-body__kind' }, 'BREATHER'),
    h('button', { type: 'button', className: 'stub-body__big', onClick: () => doAct('putDown') }, t('putDown')),
    h('button', { type: 'button', className: 'stub-body__line', onClick: () => doAct('oneMore') }, t('oneMore')),
  )
}
export const BreatherCardBody: CardBodyComponent = p => h(BreatherBody, p)
