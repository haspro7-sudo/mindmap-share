// Room slice: who is here, the queue, what is playing, heat and the shared prompts.
import type { StateCreator } from 'zustand'
import type { NaviState, RoomSlice } from './types'
import type { Member, MemberId, QueueItem, SungEntry, FaceMark, PinId, OtherId } from '../types'
import { freshRoom, uid } from './initial'
import { bus } from '../events'
import { SONG_BY_ID } from '../../data/songs'
import { SIM_MS_PER_ROOM_MIN, SONG_SIM_MS, heatAfter, isSleeping, knowView, moodWordFor, pKnow } from '../rules'
import { coreStrings } from '../../i18n/core'

export function presentMembers(s: Pick<NaviState, 'room'>): Member[] {
  const order: MemberId[] = ['me', 'minato', 'saki', 'jun']
  return order.map(id => s.room.members[id]).filter(m => m.present)
}
export const presentIds = (s: Pick<NaviState, 'room'>): MemberId[] => presentMembers(s).map(m => m.id)
export const isMine = (i: QueueItem) => i.by === 'me' || i.with === 'me'

export const createRoomSlice: StateCreator<NaviState, [], [], RoomSlice> = (set, get) => ({
  room: freshRoom(),

  memberArrive(id) {
    set(s => ({ room: { ...s.room, members: { ...s.room.members, [id]: { ...s.room.members[id], arriving: true, present: false } } } }))
    bus.emit({ type: 'member/arriving', id })
  },

  memberJoin(id) {
    const m = get().room.members[id]
    if (!m || m.present) return
    set(s => ({
      room: {
        ...s.room,
        members: { ...s.room.members, [id]: { ...m, present: true, arriving: false, joinedAt: s.session.simMs } },
        moodWord: 'welcome',
        wordOverrideUntil: Date.now() + 3000,
      },
    }))
    get().addMarker('join')
    bus.emit({ type: 'member/joined', id })
    bus.emit({ type: 'heat/changed', heat: get().room.heat, word: 'welcome' })
  },

  memberLeave(id) {
    const m = get().room.members[id]
    if (!m || !m.present) return
    set(s => ({ room: { ...s.room, members: { ...s.room.members, [id]: { ...m, present: false, arriving: false } } } }))
    bus.emit({ type: 'member/left', id })
  },

  reserve(songId, o) {
    const s = get()
    const item: QueueItem = {
      id: uid('q'),
      songId,
      by: o?.by ?? 'me',
      ...(o?.with ? { with: o.with } : {}),
      keyShift: o?.keyShift ?? 0,
      version: o?.version ?? 'original',
      tags: o?.tags ?? [],
      addedAt: s.session.simMs,
    }
    const queue = s.room.queue.slice()
    const at = o?.insertAt == null ? queue.length : Math.max(0, Math.min(queue.length, o.insertAt))
    queue.splice(at, 0, item)
    set({ room: { ...s.room, queue } })
    bus.emit({ type: 'queue/added', item, source: o?.source ?? (item.by === 'me' ? 'card' : 'member') })
    announceTurn(get)
    return item
  },

  cancelReserve(itemId) {
    set(s => {
      if (s.room.now?.item.id === itemId) return { room: { ...s.room, now: null } }
      return { room: { ...s.room, queue: s.room.queue.filter(q => q.id !== itemId) } }
    })
  },

  moveMine(itemId, dir) {
    set(s => {
      const q = s.room.queue.slice()
      const i = q.findIndex(x => x.id === itemId)
      const j = i + dir
      if (i < 0 || j < 0 || j >= q.length || !isMine(q[i])) return {}
      ;[q[i], q[j]] = [q[j], q[i]]
      return { room: { ...s.room, queue: q } }
    })
  },

  startNext() {
    const s = get()
    if (s.room.now || !s.room.queue.length || s.session.phase !== 'live') return
    const [head, ...rest] = s.room.queue
    set({ room: { ...s.room, queue: rest, now: { item: head, startedAt: s.session.simMs, durationMs: SONG_SIM_MS } } })
    bus.emit({ type: 'song/started', item: head })
    if (isMine(head)) bus.emit({ type: 'turn/mine', item: head })
    announceTurn(get)
  },

  finishNow(o) {
    const s = get()
    const now = s.room.now
    if (!now) return
    const item = now.item
    const song = SONG_BY_ID[item.songId]
    const present = presentMembers(s)
    const ids = present.map(m => m.id)
    const tally = s.room.knowing[item.songId]
    const view = tally ? knowView(tally, ids) : null
    const knowShare = view && view.size ? view.knows / view.size : present.reduce((a, m) => a + (song ? pKnow(m, song) : 0.5), 0) / Math.max(1, present.length)
    const memberClaps = present.filter(m => m.id !== 'me' && m.id !== item.by).reduce((a) => a + Math.round(10 + 20 * s.room.heat), 0)
    const claps = memberClaps + (o?.claps ?? 0)
    const heatBefore = s.room.heat
    const heat = heatAfter(heatBefore, { energy: song?.energy ?? 0.5, knowShare, claps })
    const trend: -1 | 0 | 1 = heat > heatBefore + 0.01 ? 1 : heat < heatBefore - 0.01 ? -1 : 0
    const entry: SungEntry = { item, endedAt: s.session.simMs, heatBefore, heatAfter: heat, knowShare, claps, ...(o?.score != null ? { score: o.score } : {}) }
    const sung = [...s.room.sung, entry]
    const override = s.room.wordOverrideUntil > Date.now() ? s.room.moodWord : null
    const moodWord = moodWordFor({ heat, trend, started: true, recentEnergies: sung.map(e => SONG_BY_ID[e.item.songId]?.energy ?? 0.5), override })
    set({ room: { ...s.room, now: null, sung, heat, trend, moodWord } })

    // The singer's own collection. Roommates' songs never enter "my" record.
    if (isMine(item) && song) {
      const allKnow = !!view?.all
      const face = get().col.faces[song.id]
      const wasSleeping = face ? isSleeping(face, Date.now()) || face.polishedAt != null : false
      get().faceEvent(song.id, allKnow ? 'sungAllKnow' : 'sung')
      const marks: FaceMark[] = []
      if (item.tags.includes('finale') || (o?.score ?? 0) >= 100) marks.push('gold')
      if (item.with || item.tags.includes('duet')) marks.push('duet')
      if (item.tags.includes('request')) marks.push('seal')
      for (const m of marks) get().markFace(song.id, m)
      const pins: PinId[] = []
      if (allKnow) pins.push('allKnow')
      if (item.tags.includes('visa')) pins.push('crossing')
      if (item.with || item.tags.includes('duet')) pins.push('harmony')
      if (item.tags.includes('request')) pins.push('answer')
      if ((o?.score ?? 0) >= 100) pins.push('hundred')
      if (wasSleeping) pins.push('polish')
      if (item.tags.includes('insert') && heat - heatBefore >= 0.05) pins.push('airRead')
      for (const p of pins) get().earnPin(p)
      set(st => ({
        col: {
          ...st.col,
          nights: st.col.nights.map(n =>
            n.id === st.session.nightId ? { ...n, claps: n.claps + claps, shared: allKnow && !n.shared.includes(song.id) ? [...n.shared, song.id] : n.shared } : n,
          ),
        },
      }))
      if (allKnow) get().addMarker('allKnow')
    }
    if (item.tags.includes('navi')) get().addMarker('navi')
    get().addWallPoint({ t: entry.endedAt / SIM_MS_PER_ROOM_MIN, heat, songId: item.songId, by: item.by, claps, markers: [] })

    if (item.tags.includes('navi') && heatBefore - heat >= 0.03) {
      bus.emit({ type: 'navi/miss', songId: item.songId })
      get().toast({ text: coreStrings.ref('excuse'), kind: 'excuse', ttl: 3500 })
    }
    get().advanceOrders()
    bus.emit({ type: 'song/ended', entry })
    bus.emit({ type: 'heat/changed', heat, word: moodWord })
  },

  askRoom(songId, by = 'me') {
    const s = get()
    if (!s.room.knowing[songId]) {
      set({ room: { ...s.room, knowing: { ...s.room.knowing, [songId]: { songId, askedAt: s.session.simMs, by, answers: {} } } } })
    }
    bus.emit({ type: 'know/asked', songId })
  },

  answerKnow(songId, member, a) {
    const s = get()
    const tally = s.room.knowing[songId] ?? { songId, askedAt: s.session.simMs, by: member, answers: {} }
    if (tally.answers[member]) return // one answer per person per night
    const ids = presentIds(s)
    const before = knowView(tally, ids)
    const next = { ...tally, answers: { ...tally.answers, [member]: { a, at: Date.now() } } }
    set({ room: { ...s.room, knowing: { ...s.room.knowing, [songId]: next } } })
    const view = knowView(next, ids)
    const index = view.dots.filter(d => d !== 'empty').length - 1
    bus.emit({ type: 'know/answered', songId, member, a, index: Math.max(0, index) })
    if (view.all && !before.all) bus.emit({ type: 'know/complete', songId, view })
  },

  setMood(m) {
    set(s => ({ room: { ...s.room, mood: { ...s.room.mood, ...m, setAt: s.session.simMs } } }))
    if (m.setBy === 'mixer') bus.emit({ type: 'mood/mixed', mood: get().room.mood })
  },

  pushBubble(b) {
    set(s => ({ room: { ...s.room, bubbles: [...s.room.bubbles, { ...b, id: uid('b'), at: Date.now() }].slice(-8) } }))
  },

  setMemberVoice(id, t) {
    set(s => ({ room: { ...s.room, members: { ...s.room.members, [id]: { ...s.room.members[id], voiceType: t } } } }))
  },

  setPrompt(p) {
    set(s => ({ room: { ...s.room, prompt: p } }))
  },

  votePrompt(member, songId) {
    const s = get()
    const p = s.room.prompt
    if (!p || p.kind !== 'finale') return
    const votes = { ...(p.votes ?? {}), [member]: songId }
    const prompt = { ...p, votes }
    set({ room: { ...s.room, prompt } })
    const ids = presentIds(get())
    if (ids.every(id => votes[id])) {
      const tally = new Map<string, number>()
      for (const id of ids) tally.set(votes[id]!, (tally.get(votes[id]!) ?? 0) + 1)
      const winner = [...p.songIds].sort((a, b) => (tally.get(b) ?? 0) - (tally.get(a) ?? 0))[0]
      get().reserve(winner, { by: 'me', tags: ['finale'], source: 'room' })
      set(st => ({
        room: { ...st.room, prompt: null },
        deck: { ...st.deck, cards: st.deck.cards.filter(c => c.kind !== 'finale'), offers: { ...st.deck.offers, finaleDone: true } },
      }))
      get().toast({ text: coreStrings.ref('finaleFixed'), kind: 'info', ttl: 2500 })
      bus.emit({ type: 'prompt/resolved', prompt, result: winner })
    }
  },

  agreePrompt(member, ok) {
    const s = get()
    const p = s.room.prompt
    if (!p || p.kind !== 'shift') return
    const agree = { ...(p.agree ?? {}), [member]: ok }
    const prompt = { ...p, agree }
    set({ room: { ...s.room, prompt } })
    const others = presentIds(get()).filter(id => id !== 'me')
    if (!others.every(id => agree[id] != null)) return
    const allOk = others.every(id => agree[id])
    if (!allOk) {
      // Move the inserted song to the end; never say who held back.
      set(st => {
        const q = st.room.queue.slice()
        const i = q.findIndex(x => x.songId === p.songIds[0] && x.tags.includes('insert'))
        if (i >= 0) {
          const [it] = q.splice(i, 1)
          q.push({ ...it, tags: it.tags.filter(t => t !== 'insert') })
        }
        return { room: { ...st.room, queue: q } }
      })
      get().toast({ text: coreStrings.ref('queuedEnd'), kind: 'info', ttl: 2500 })
    } else {
      get().toast({ text: coreStrings.ref('inserted'), kind: 'info', ttl: 2000 })
    }
    set(st => ({ room: { ...st.room, prompt: null } }))
    bus.emit({ type: 'prompt/resolved', prompt, result: allOk ? p.songIds[0] : 'end' })
  },

  openInvite(i) {
    const id = uid('inv')
    set(s => ({ room: { ...s.room, invites: [...s.room.invites, { ...i, id, status: 'open', at: Date.now() }] } }))
    return id
  },

  resolveInvite(id, status) {
    set(s => ({ room: { ...s.room, invites: s.room.invites.map(x => (x.id === id ? { ...x, status } : x)) } }))
  },

  restOneSong() {
    set(s => ({ room: { ...s.room, restUntil: s.session.simMs + SONG_SIM_MS } }))
  },
})

/** Tell the singer when they are next (one song ahead). */
function announceTurn(get: () => NaviState) {
  const s = get()
  const q = s.room.queue
  const pos = q.findIndex(isMine)
  if (pos === 0 && s.room.now && !isMine(s.room.now.item)) bus.emit({ type: 'turn/soon', songsAhead: 1 })
}

export type { OtherId }
