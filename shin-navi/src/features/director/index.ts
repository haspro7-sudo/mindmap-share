// M4 director-planner — PHASE-0 STUB (owned by M4 from phase 1). Public API per SPEC L/M4.
// The stub deals a plausible first hand (opener → ask → gap, C-10 per locale) and keeps the
// hand at 3+ cards so the shell can be exercised. The lens/split overlays are placeholders.
import { createElement as h } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type {
  AreaKey,
  CardAction,
  CardKind,
  Companion,
  DeckCard,
  DirectorTrigger,
  Face,
  ImportCandidate,
  InviteState,
  KnowTally,
  Link,
  Locale,
  Member,
  Mood,
  NowPlaying,
  PolicyAnchor,
  PolicyId,
  QueueItem,
  SavedSong,
  Song,
  SongId,
  Source,
  SungEntry,
  TextRef,
  VoiceReading,
} from '../../core/types'
import type { NaviApi, NaviState } from '../../core/store/types'
import type { OfferLog } from '../../core/store/types'
import { useNavi, presentMembers } from '../../core/store'
import { gapAreas, roomMinutesLeft } from '../../core/rules'
import { SONGS } from '../../data/songs'
import { LOCALE_OPENERS, OPENER_FALLBACK, STATIC_LISTS } from '../../data/tables'
import { getLocale, tr } from '../../i18n'
import { seeded, shuffle } from '../../lib/rng'
import { SongTitle } from '../../core/ui/SongTitle'
import '../../styles/stubs.css'

export type DirectorInput = {
  seed: string
  now: number
  locale: Locale
  trigger: DirectorTrigger
  room: {
    present: Member[]
    heat: number
    trend: -1 | 0 | 1
    mood: Mood
    queue: QueueItem[]
    now: NowPlaying
    sung: SungEntry[]
    knowing: Record<SongId, KnowTally>
    minutesLeft: number
    invites: InviteState[]
  }
  me: { faces: Record<SongId, Face>; links: Link[]; voice: VoiceReading | null; saved: SavedSong[]; imports: ImportCandidate[] }
  deck: { cards: DeckCard[]; history: { cardId: string; kind: CardKind; action: CardAction; at: number }[]; round: number; consumedInRound: number; offers: OfferLog }
  songs: Song[]
}
export type DirectorOutput = { cards: DeckCard[]; mode: 'append' | 'top' | 'at1' | 'replace'; cause?: TextRef; offers?: Partial<OfferLog> }

const reason = (key: string, source: Source, vars?: TextRef['vars']) => ({ source, text: { key: `reason.${key}`, vars } })

/** Stub dealer: opener → ask → gap on entry (C-10 rows for other locales), then a simple rotation. */
export function deal(input: DirectorInput): DirectorOutput {
  const have = input.deck.cards
  const need = Math.max(0, 3 - have.length)
  if (need === 0) return { cards: [], mode: 'append' }
  const used = new Set<SongId>([...have.map(c => c.songId ?? ''), ...input.room.queue.map(q => q.songId), ...input.room.sung.map(e => e.item.songId), ...Object.keys(input.me.faces)])
  const rand = seeded(`${input.seed}|stubdeal|${input.deck.history.length}`)
  const pool = [...OPENER_FALLBACK.filter(id => !used.has(id)), ...shuffle(rand, input.songs.filter(s => s.reservable && !used.has(s.id)).map(s => s.id))]
  const take = () => {
    const id = pool.shift() ?? input.songs[0].id
    used.add(id)
    return id
  }
  const n = input.room.present.length
  const trigger: DirectorTrigger = input.trigger
  const mk = (i: number, kind: CardKind, extra: Partial<DeckCard>, r: DeckCard['reason']): DeckCard => ({
    id: `c-${input.now.toString(36)}-${input.deck.history.length}-${have.length + i}`,
    kind,
    reason: r,
    trigger,
    rule: 'stub.rotation',
    dealtAt: input.now,
    ...extra,
  })
  const gap = (i: number): DeckCard => {
    const area: AreaKey = gapAreas(input.me.faces, input.songs)[0] ?? 'slow:J-POP'
    const [tempo, genre] = area.split(':') as [Song['tempo'], Song['genre']]
    return mk(i, 'gap', { area }, reason('gap', 'yomu', { tempo: { tempo }, genre: { genre } }))
  }
  const cards: DeckCard[] = []
  const fresh = input.deck.history.length === 0 && have.length === 0
  if (fresh) {
    const rows = LOCALE_OPENERS[input.locale] ?? LOCALE_OPENERS.ja
    rows.forEach((r, i) => {
      if (r.kind === 'gap') return cards.push(gap(i))
      const songId = r.songId ?? take()
      used.add(songId)
      if (r.kind === 'ask') return cards.push(mk(i, 'ask', { songId }, reason('ask', 'dare')))
      if (r.variant === 'visa') return cards.push(mk(i, 'song', { variant: 'visa', songId }, reason('visa', 'hou', { locale: { locale: input.locale } })))
      cards.push(mk(i, 'song', { variant: 'opener', songId }, reason('opener', 'yomu')))
    })
    return { cards, mode: 'append' }
  }
  const ROT: CardKind[] = ['song', 'ask', 'song', 'link', 'gap']
  for (let i = 0; i < need; i++) {
    const kind = ROT[(input.deck.history.length + have.length + i) % ROT.length]
    if (kind === 'gap') cards.push(gap(i))
    else if (kind === 'link') {
      const opts = [take(), take(), take()]
      cards.push(mk(i, 'link', { options: opts }, reason('link', 'tsunagu')))
    } else if (kind === 'ask') cards.push(mk(i, 'ask', { songId: take() }, reason('ask', 'dare')))
    else cards.push(mk(i, 'song', { songId: take() }, n > 1 ? reason('mostKnow', 'dare', { n, k: Math.max(1, n - 1) }) : reason('opener', 'yomu')))
  }
  return { cards, mode: 'append' }
}

function inputFrom(s: NaviState, trigger: DirectorTrigger): DirectorInput {
  return {
    seed: s.session.seed,
    now: Date.now(),
    locale: getLocale(),
    trigger,
    room: {
      present: presentMembers(s),
      heat: s.room.heat,
      trend: s.room.trend,
      mood: s.room.mood,
      queue: s.room.queue,
      now: s.room.now,
      sung: s.room.sung,
      knowing: s.room.knowing,
      minutesLeft: roomMinutesLeft(s.session.simMs),
      invites: s.room.invites,
    },
    me: { faces: s.col.faces, links: s.col.links, voice: s.col.voices.at(-1) ?? null, saved: s.col.saved, imports: s.col.imports },
    deck: { cards: s.deck.cards, history: s.deck.history, round: s.deck.round, consumedInRound: s.deck.consumedInRound, offers: s.deck.offers },
    songs: SONGS,
  }
}

export function installDirector(api: NaviApi): () => void {
  let busy = false
  const fill = () => {
    const s = api.getState()
    if (busy || s.session.phase !== 'live' || s.deck.cards.length >= 3) return
    busy = true
    try {
      const fresh = s.deck.history.length === 0 && s.deck.cards.length === 0
      const out = deal(inputFrom(s, { type: fresh ? 'enter' : 'refill', at: s.session.simMs }))
      if (out.cards.length) s.dealCards(out.cards, out.mode, out.cause)
      // the room is asked about the opener on entry, so its dots light during the intro
      const opener = out.cards.find(c => c.variant === 'opener' || c.variant === 'visa')
      if (fresh && opener?.songId && !api.getState().room.knowing[opener.songId]) api.getState().askRoom(opener.songId, 'me')
    } finally {
      busy = false
    }
  }
  fill()
  const unsub = api.subscribe((s, p) => {
    if ((s.deck.cards !== p.deck.cards || s.session.phase !== p.session.phase) && s.deck.cards.length < 3) queueMicrotask(fill)
  })
  return unsub
}

export function staticList(c: Companion, n = 5): SongId[] {
  return (STATIC_LISTS[c] ?? STATIC_LISTS.friends).slice(0, n)
}

export const POLICY_MAP: Record<PolicyAnchor, { policies: PolicyId[]; ways: Source[]; metric: TextRef; note?: TextRef }> = {}

/** Stub lens: outlines every [data-anchor] and names it. */
export function PolicyLens(): JSX.Element {
  const on = useNavi(s => s.ui.lens)
  if (!on) return h('div', { hidden: true })
  return h(
    'div',
    { className: 'stub-lens', 'data-testid': 'lens-overlay' },
    h('style', null, '[data-anchor]{outline:1px dashed var(--lens-line);outline-offset:-1px}'),
    h('span', { className: 'stub-lens__tag' }, 'PolicyLens · M4'),
  )
}

export function SplitView(): JSX.Element {
  const on = useNavi(s => s.ui.split)
  const dyn = useNavi(useShallow(s => s.deck.cards.slice(0, 5).map(c => c.songId ?? c.options?.[0] ?? '')))
  if (!on) return h('div', { hidden: true })
  const list = (ids: string[], testid: string) =>
    h('ol', { className: 'stub-split__col', 'data-testid': testid }, ids.filter(Boolean).map((id, i) => h('li', { key: `${id}-${i}` }, h(SongTitle, { songId: id, variant: 'chip' }))))
  return h('div', { className: 'stub-split' }, list(staticList('friends'), 'split-static'), list(dyn, 'split-dynamic'), h('span', { className: 'stub-lens__tag' }, `SplitView · M4 · ${tr({ key: 'common.tonight' })}`))
}
