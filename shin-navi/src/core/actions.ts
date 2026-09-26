// The one place where a card action becomes store changes and effect events (SPEC K-4 performCardAction).
import type { NaviApi, ReserveOpts, UndoEntry } from './store/types'
import type { ActArg, CardAction, CardKind, DeckCard, Face, FaceMark, QueueItem, QueueTag, SongId } from './types'
import { KEEPABLE } from './types'
import { bus } from './events'
import { SONG_BY_ID } from '../data/songs'
import { palette } from '../lib/art'
import { coreStrings } from '../i18n/core'
import { uid } from './store/initial'

export const UNDO_MS = 3000

/** Kinds that count toward the 7-card round (event cards and the breather do not). */
const DISCOVERY: ReadonlySet<CardKind> = new Set<CardKind>(['song', 'ask', 'shift', 'link', 'voice', 'gap', 'invite', 'import'])
/** Actions that finish a card and take it off the pile. */
const FINISHING: ReadonlySet<CardAction> = new Set<CardAction>(['reserve', 'keep', 'pass', 'insert', 'openArea', 'accept', 'decline', 'rest', 'putDown', 'oneMore'])

function centerRect(): DOMRectReadOnly {
  const w = typeof window === 'undefined' ? 390 : window.innerWidth
  const h = typeof window === 'undefined' ? 844 : window.innerHeight
  return { x: w / 2 - 80, y: h / 2, width: 160, height: 160, top: h / 2, left: w / 2 - 80, right: w / 2 + 80, bottom: h / 2 + 160, toJSON: () => ({}) } as DOMRectReadOnly
}

export const songColor = (songId: SongId | undefined): string => (songId ? palette(songId, SONG_BY_ID[songId]?.energy ?? 0.5).a : '#ffffff')

export type ReserveResult = { item: QueueItem; prevFace: Face | null; noteAdded: boolean; pinAdded?: 'spark'; prevFirst?: number }

/**
 * Reserve a song as "me": queue + neon face + note + my dot + first-reserve metric + spark pin.
 * Shared by cards, search, voice, invites and the record screen so every reserve feels the same.
 */
export function reserveAsMe(api: NaviApi, songId: SongId, o: Omit<ReserveOpts, 'by'> & { marks?: FaceMark[] } = {}): ReserveResult | null {
  const s = api.getState()
  const song = SONG_BY_ID[songId]
  if (!song) return null
  if (!song.reservable) {
    s.toast({ text: coreStrings.ref('notReservable'), kind: 'info', ttl: 2500 })
    return null
  }
  const prevFace = s.col.faces[songId] ?? null
  const prevFirst = s.metrics.firstReserveMs
  const item = s.reserve(songId, { ...o, by: 'me' })
  const r = api.getState().faceEvent(songId, 'reserve', { keyShift: o.keyShift })
  const marks: FaceMark[] = [...(o.marks ?? [])]
  if (o.tags?.includes('navi')) marks.push('navi')
  if (o.tags?.includes('visa')) marks.push('visa')
  for (const m of marks) api.getState().markFace(songId, m)
  if (api.getState().room.knowing[songId]) api.getState().answerKnow(songId, 'me', 'know')
  const pinAdded = api.getState().earnPin('spark') ? ('spark' as const) : undefined
  if (prevFirst == null) {
    const enteredAt = api.getState().session.enteredAt
    api.setState(st => ({ metrics: { ...st.metrics, firstReserveMs: Math.max(0, Date.now() - enteredAt) } }))
  }
  return { item, prevFace, noteAdded: r.from !== r.to, pinAdded, prevFirst }
}

function songFor(api: NaviApi, card: DeckCard, arg: ActArg): SongId | undefined {
  return arg.songId ?? api.getState().deck.selection[card.id] ?? card.songId ?? card.options?.[0]
}

export function performCardAction(api: NaviApi, cardId: string, a: CardAction, arg: ActArg = {}): void {
  const s = api.getState()
  const card = s.deck.cards.find(c => c.id === cardId)
  if (!card) return
  const songId = songFor(api, card, arg)
  const from = arg.fromRect ?? centerRect()
  const color = songColor(songId)
  const now = Date.now()
  let remove = false
  let undo: UndoEntry | null = null

  const doReserve = (extraTags: QueueTag[] = [], withMember?: QueueItem['with'], insertAt?: number): boolean => {
    if (!songId) return false
    const tags: QueueTag[] = [...extraTags]
    if (arg.navi) tags.push('navi')
    if (card.variant === 'visa') tags.push('visa')
    const source = card.kind === 'voice' ? 'voice' : card.kind === 'invite' ? 'invite' : 'card'
    const res = reserveAsMe(api, songId, { keyShift: arg.keyShift, version: arg.version, tags, with: withMember, insertAt, source })
    if (!res) return false
    let linkAdded = false
    if (card.kind === 'link' && card.songId && songId !== card.songId) {
      api.getState().addLink(card.songId, songId)
      linkAdded = true
    }
    noteFrame(api, card.kind, 'picked')
    if (card.kind === 'voice') api.getState().noteVoiceToReserve()
    bus.emit({ type: 'fx/flight', from, to: insertAt === 0 ? 'lane:insert' : 'lane:next', kind: 'reserve', songId, color })
    undo = { card, action: a, at: now, songId, prevFace: res.prevFace, queueItemId: res.item.id, linkAdded, noteAdded: res.noteAdded, prevFirstReserveMs: res.prevFirst, pinAdded: res.pinAdded }
    return true
  }

  switch (a) {
    case 'reserve':
    case 'accept': {
      if (card.kind === 'invite') {
        const inv = api.getState().room.invites.find(i => i.songId === songId && i.from === card.from && (i.status === 'open' || i.status === 'revealed'))
        const tags: QueueTag[] = card.variant === 'request' ? ['request'] : ['duet']
        const ok = doReserve(tags, card.variant === 'request' ? undefined : card.from)
        if (!ok) return
        if (inv) api.getState().resolveInvite(inv.id, 'accepted')
      } else if (!doReserve()) return
      remove = true
      break
    }
    case 'keep': {
      if (!songId || !KEEPABLE.has(card.kind)) return
      const prevFace = s.col.faces[songId] ?? null
      const r = s.faceEvent(songId, 'keep')
      let linkAdded = false
      if (card.kind === 'link' && card.songId && songId !== card.songId) {
        api.getState().addLink(card.songId, songId)
        linkAdded = true
      }
      noteFrame(api, card.kind, 'picked')
      bus.emit({ type: 'fx/flight', from, to: `face:${songId}`, kind: 'keep', songId, color })
      undo = { card, action: a, at: now, songId, prevFace, linkAdded, noteAdded: r.from !== r.to }
      remove = true
      break
    }
    case 'pass': {
      if (arg.passReason) s.notePassReason(arg.passReason)
      bus.emit({ type: 'fx/flight', from, to: 'hero:ball', kind: 'pass', songId, color })
      undo = { card, action: a, at: now, songId, prevFace: null }
      remove = true
      break
    }
    case 'insert': {
      if (!doReserve(['insert'], undefined, 0) || !songId) return
      api.getState().setPrompt({ id: uid('p'), kind: 'shift', songIds: [songId], agree: {}, at: now })
      api.getState().addMarker('shift')
      remove = true
      break
    }
    case 'ask':
      if (songId) s.askRoom(songId, 'me')
      break
    case 'answer':
      if (songId && arg.answer) s.answerKnow(songId, 'me', arg.answer)
      break
    case 'flip':
      s.flip(s.deck.flippedId === card.id ? null : card.id)
      break
    case 'select':
      if (arg.songId) s.select(card.id, arg.songId)
      break
    case 'measure':
      s.openSheet('voice', { cardId: card.id })
      break
    case 'openArea': {
      if (card.area) {
        const [tempo, genre] = card.area.split(':')
        s.openSheet('search', { filters: { tempo, genre } })
      }
      remove = true
      break
    }
    case 'decline': {
      if (card.kind === 'invite' && card.variant === 'twin') {
        const inv = s.room.invites.find(i => i.songId === songId && (i.status === 'open' || i.status === 'revealed'))
        if (inv) s.resolveInvite(inv.id, 'secret')
        if (songId) s.markFace(songId, 'twin')
      }
      // A declined request is never reported back to the sender.
      remove = true
      break
    }
    case 'reveal': {
      const inv = s.room.invites.find(i => i.songId === songId && i.variant === 'twin' && i.status === 'open')
      if (inv) s.resolveInvite(inv.id, 'revealed')
      break
    }
    case 'save': {
      if (!songId) return
      // Saving is an explicit, deliberate step, so it has no 3-second undo.
      s.saveSong(songId, arg.version ?? 'original', 'import')
      api.getState().faceEvent(songId, 'import', { mark: 'stitch' })
      api.getState().noteImportSaved()
      const savedImports = api.getState().col.saved.filter(x => x.from === 'import').length
      if (savedImports >= 3) api.getState().earnPin('importer')
      bus.emit({ type: 'fx/flight', from, to: `face:${songId}`, kind: 'import', songId, color })
      remove = !api.getState().col.imports.some(i => i.status === 'candidate')
      break
    }
    case 'showRoom':
      if (songId) s.setPrompt({ id: uid('p'), kind: 'show', songIds: [songId], at: now })
      break
    case 'order':
      if (arg.menuId) s.placeOrder(arg.menuId, { again: arg.again })
      break
    case 'rest':
      s.restOneSong()
      remove = true
      break
    case 'vote':
      if (songId) s.votePrompt('me', songId)
      break
    case 'putDown':
      s.setOverlay('standby')
      remove = true
      break
    case 'oneMore':
      remove = true
      break
  }

  if (remove && FINISHING.has(a)) {
    const u = undo as UndoEntry | null
    api.setState(st => {
      const isBreather = card.kind === 'breather'
      return {
        deck: {
          ...st.deck,
          cards: st.deck.cards.filter(c => c.id !== card.id),
          round: isBreather ? st.deck.round + 1 : st.deck.round,
          consumedInRound: isBreather ? 0 : st.deck.consumedInRound + (DISCOVERY.has(card.kind) ? 1 : 0),
          passStreak: a === 'pass' ? st.deck.passStreak + 1 : 0,
          flippedId: st.deck.flippedId === card.id ? null : st.deck.flippedId,
          primary: null,
          undo: u,
          history: [...st.deck.history, { cardId: card.id, kind: card.kind, action: a, at: now }].slice(-60),
        },
      }
    })
  }
  api.getState().markActed(card.kind, a)
  bus.emit({ type: 'card/acted', card, action: a, arg })
}

function noteFrame(api: NaviApi, kind: CardKind, e: 'picked') {
  if (kind === 'link') api.getState().noteCo(e, 'co')
  else if (kind === 'song') api.getState().noteCo(e, 'tag')
}

/** Undo the last flick within 3 seconds: queue, face, link, note, pin and the card all come back. */
export function performUndo(api: NaviApi): boolean {
  const s = api.getState()
  const u = s.deck.undo
  if (!u || Date.now() - u.at > UNDO_MS + 400) return false
  if (u.queueItemId) s.cancelReserve(u.queueItemId)
  if (u.action === 'insert' && s.room.prompt?.kind === 'shift') s.setPrompt(null)
  if (u.songId && u.action !== 'pass') s.restoreFace(u.songId, u.prevFace)
  if (u.linkAdded) s.removeLastLink()
  if (u.noteAdded) s.popNote()
  if (u.pinAdded) s.removePin(u.pinAdded)
  api.setState(st => ({
    metrics: { ...st.metrics, firstReserveMs: u.prevFirstReserveMs },
    deck: {
      ...st.deck,
      cards: [u.card, ...st.deck.cards.filter(c => c.id !== u.card.id)],
      consumedInRound: Math.max(0, st.deck.consumedInRound - (DISCOVERY.has(u.card.kind) ? 1 : 0)),
      passStreak: u.action === 'pass' ? Math.max(0, st.deck.passStreak - 1) : st.deck.passStreak,
      history: st.deck.history.slice(0, -1),
      undo: null,
    },
  }))
  return true
}
