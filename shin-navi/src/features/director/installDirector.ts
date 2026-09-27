// Wires the pure dealer to the store and the bus (SPEC C-3, C-11).
// Room events become DirectorTriggers; events that land in the same tick are applied lowest
// priority first so the most important card ends on top (finale > voice > redeal > shift >
// navMiss > link > invite > coaster). After every batch the hand is topped up to 3+ cards.
import type { NaviApi, NaviState } from '../../core/store/types'
import type { DeckCard, DirectorTrigger, DirectorTriggerType, MemberId, QueueItem, SongId, TextRef } from '../../core/types'
import { bus } from '../../core/events'
import { presentMembers } from '../../core/store'
import { roomMinutesLeft } from '../../core/rules'
import { SONGS } from '../../data/songs'
import { getLocale } from '../../i18n'
import { deal, MIN_HAND, type DirectorInput, type DirectorOutput } from './deal'

/** Snapshot the store into the dealer's pure input. */
export function inputFrom(s: NaviState, trigger: DirectorTrigger, now = Date.now()): DirectorInput {
  const voice = [...s.col.voices].reverse().find(v => v.nightId === s.session.nightId) ?? null
  return {
    seed: s.session.seed,
    now,
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
    me: { faces: s.col.faces, links: s.col.links, voice, saved: s.col.saved, imports: s.col.imports },
    deck: { cards: s.deck.cards, history: s.deck.history, round: s.deck.round, consumedInRound: s.deck.consumedInRound, offers: s.deck.offers },
    songs: SONGS,
  }
}

/** Order of application inside one batch: lower first, so higher-priority cards end on top. */
const APPLY_ORDER: Record<DirectorTriggerType, number> = {
  enter: -1,
  nextVisit: -1,
  refill: 0,
  passStreak: 0,
  coaster: 1,
  request: 2,
  twin: 2,
  reserved: 3,
  navMiss: 4,
  memberSongEnded: 5,
  memberJoined: 6,
  memberLeft: 6,
  moodMixed: 6,
  myTurnEnded: 7,
  minutes15: 8,
}

const isMineItem = (i: QueueItem) => i.by === 'me' || i.with === 'me'
const myReserveCount = (s: NaviState) =>
  s.room.queue.filter(isMineItem).length + (s.room.now && isMineItem(s.room.now.item) ? 1 : 0) + s.room.sung.filter(e => isMineItem(e.item)).length

export function installDirector(api: NaviApi): () => void {
  type Job = { type: DirectorTriggerType; songId?: SongId; member?: MemberId }
  let jobs: Job[] = []
  let scheduled = false
  let flushing = false
  let uniq = 0
  const dealtInvites = new Set<string>()
  const offs: (() => void)[] = []

  const live = () => api.getState().session.phase === 'live'

  const schedule = (j: Job) => {
    jobs.push(j)
    if (!scheduled) {
      scheduled = true
      queueMicrotask(flush)
    }
  }

  /** Replace the hand; when the top card stays the same, its primary action and flip survive. */
  const replaceHand = (cards: DeckCard[], cause?: TextRef) => {
    const s = api.getState()
    const prevTop = s.deck.cards[0]?.id
    const { primary, flippedId } = s.deck
    s.dealCards(cards, 'replace', cause)
    const st = api.getState()
    if (prevTop && cards[0]?.id === prevTop) {
      if (primary && !st.deck.primary) st.setPrimary(primary)
      if (flippedId === prevTop && st.deck.flippedId !== prevTop) st.flip(prevTop)
    }
  }

  const apply = (out: DirectorOutput) => {
    const s = api.getState()
    if (out.offers && Object.keys(out.offers).length) s.noteOffer(out.offers)
    const before = new Set(s.deck.cards.map(c => c.id))
    // ids are deterministic; if one ever collides with a different card in the hand, make it unique
    const cards = out.cards.map(c => (before.has(c.id) && !s.deck.cards.includes(c) ? { ...c, id: `${c.id}.${(uniq++).toString(36)}` } : c))
    if (out.mode === 'replace') {
      if (!cards.length && !s.deck.cards.length) return
      replaceHand(cards, out.cause)
    } else if (cards.length) s.dealCards(cards, out.mode, out.cause)
    // the closing song needs a room prompt so everyone can vote (C-8 ⑩)
    const fin = cards.find(c => c.kind === 'finale' && !before.has(c.id))
    const st = api.getState()
    if (fin?.options?.length && st.room.prompt?.kind !== 'finale') st.setPrompt({ id: `p-${fin.id}`, kind: 'finale', songIds: fin.options, votes: {}, at: Date.now() })
  }

  const run = (j: Job) => {
    const s = api.getState()
    if (s.session.phase !== 'live') return
    const trigger: DirectorTrigger = { type: j.type, at: s.session.simMs, ...(j.songId ? { songId: j.songId } : {}), ...(j.member ? { member: j.member } : {}) }
    const out = deal(inputFrom(s, trigger))
    apply(out)
    if (j.type === 'enter' || j.type === 'nextVisit') askAboutOpener()
  }

  /** The navi asks the room about the first card during the intro, so the dots light (B-2). */
  const askAboutOpener = () => {
    const s = api.getState()
    const first = s.deck.cards[0]
    if (first?.kind === 'song' && first.songId && !s.room.knowing[first.songId]) s.askRoom(first.songId, 'me')
  }

  /** A "つながる" card whose centre is no longer reserved (undo, cancel) goes away. */
  const cleanupLinks = () => {
    const s = api.getState()
    const liveSongs = new Set([...s.room.queue.map(q => q.songId), ...(s.room.now ? [s.room.now.item.songId] : []), ...s.room.sung.map(e => e.item.songId)])
    const stale = s.deck.cards.filter(c => c.rule === 'insert.link.afterReserve' && c.songId && !liveSongs.has(c.songId))
    if (!stale.length) return
    for (const c of stale) api.getState().dropCard(c.id)
    const last = api.getState().deck.offers.linkAtReserve
    if (last != null && myReserveCount(api.getState()) < last) api.getState().noteOffer({ linkAtReserve: undefined })
  }

  const flush = () => {
    scheduled = false
    if (flushing) return
    flushing = true
    try {
      let guard = 0
      while (jobs.length && guard++ < 6) {
        const batch = jobs.sort((a, b) => APPLY_ORDER[a.type] - APPLY_ORDER[b.type])
        jobs = []
        if (!live()) continue
        for (const j of batch) if (j.type !== 'refill') run(j)
      }
      if (live()) {
        cleanupLinks()
        // a fresh night always starts with the entrance hand, whichever signal arrives first
        if (!enterIfFresh() && api.getState().deck.cards.length < MIN_HAND) run({ type: 'refill' })
      }
    } finally {
      flushing = false
    }
  }

  const enterIfFresh = (): boolean => {
    const s = api.getState()
    if (s.session.phase !== 'live' || s.deck.cards.length || s.deck.history.length) return false
    run({ type: s.session.visit > 1 ? 'nextVisit' : 'enter' })
    return true
  }

  // ---- install: the night may already be running (boot loads or starts it before we mount)
  for (const i of api.getState().room.invites) dealtInvites.add(i.id)
  enterIfFresh()
  if (live() && api.getState().deck.cards.length < MIN_HAND) schedule({ type: 'refill' })

  offs.push(
    bus.on('night/started', () => {
      dealtInvites.clear()
      for (const i of api.getState().room.invites) dealtInvites.add(i.id)
      queueMicrotask(() => void enterIfFresh())
    }),
    bus.on('card/acted', e => {
      const s = api.getState()
      if (e.card.kind === 'coaster' && (e.action === 'pass' || e.action === 'rest')) s.noteOffer({ coasterDismissedRound: s.deck.round })
      schedule({ type: 'refill' })
    }),
    bus.on('queue/added', e => {
      const it = e.item
      if (!isMineItem(it) || it.tags.includes('finale') || it.tags.includes('insert')) return
      // performCardAction removes the card after reserving: the link is dealt once that is done
      schedule({ type: 'reserved', songId: it.songId })
    }),
    bus.on('song/ended', e => schedule({ type: isMineItem(e.entry.item) ? 'myTurnEnded' : 'memberSongEnded', songId: e.entry.item.songId })),
    bus.on('member/joined', e => schedule({ type: 'memberJoined', member: e.id })),
    bus.on('member/left', e => schedule({ type: 'memberLeft', member: e.id })),
    bus.on('minutes/left', e => {
      if (e.m === 15) schedule({ type: 'minutes15' })
    }),
    bus.on('mood/mixed', () => schedule({ type: 'moodMixed' })),
    bus.on('navi/miss', e => schedule({ type: 'navMiss', songId: e.songId })),
    bus.on('presenter/cmd', e => {
      if (e.cmd.t === 'coaster') schedule({ type: 'coaster' })
    }),
  )

  offs.push(
    api.subscribe((s, p) => {
      if (s.session.phase !== 'live') return
      if (s.room.invites !== p.room.invites) {
        for (const i of s.room.invites) {
          if (i.status !== 'open' || dealtInvites.has(i.id)) continue
          dealtInvites.add(i.id)
          schedule({ type: i.variant === 'twin' ? 'twin' : 'request', songId: i.songId, member: i.from })
        }
      }
      const handChanged = s.deck.cards !== p.deck.cards
      if (s.room.queue !== p.room.queue || s.room.now !== p.room.now || handChanged) {
        const linkStale = s.deck.cards.some(c => c.rule === 'insert.link.afterReserve')
        if ((linkStale || s.deck.cards.length < MIN_HAND) && !flushing) schedule({ type: 'refill' })
      }
    }),
  )

  return () => {
    offs.forEach(f => f())
    jobs = []
  }
}
