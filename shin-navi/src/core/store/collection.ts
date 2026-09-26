// Collection slice: the mirror ball (faces), links, nights, pins, voice log, saved songs.
import type { StateCreator } from 'zustand'
import type { CollectionSlice, NaviState } from './types'
import type { Face, Night, WallMarker } from '../types'
import { freshCollection } from './initial'
import { bus } from '../events'
import { SONGS, SONG_BY_ID } from '../../data/songs'
import { faceNote, nextFaceState, AURORA_PALETTES } from '../rules'
import { mulberry32, hashString } from '../../lib/rng'

const MELODY_MAX = 32
let pendingMarkers: WallMarker[] = []

function tonightOf(s: NaviState): Night | undefined {
  return s.col.nights.find(n => n.id === s.session.nightId)
}
function withTonight(s: NaviState, fn: (n: Night) => Night): Night[] {
  return s.col.nights.map(n => (n.id === s.session.nightId ? fn(n) : n))
}

export const createCollectionSlice: StateCreator<NaviState, [], [], CollectionSlice> = (set, get) => ({
  col: freshCollection(),

  faceEvent(songId, ev, o) {
    const s = get()
    const song = SONG_BY_ID[songId]
    if (!song) return {}
    const cur = s.col.faces[songId]
    const to = nextFaceState(cur?.state, ev)
    const isNew = !cur
    const face: Face = cur
      ? { ...cur, marks: [...cur.marks] }
      : { songId, state: to, marks: [], firstNightId: s.session.nightId, firstAt: Date.now(), sungCount: 0 }
    face.state = to
    if (o?.mark && !face.marks.includes(o.mark)) face.marks.push(o.mark)
    if (o?.keyShift != null && o.keyShift !== 0) {
      face.keyShift = o.keyShift
      if (!face.marks.includes('key')) face.marks.push('key')
    }
    if (ev === 'sung' || ev === 'sungAllKnow') {
      face.sungCount += 1
      face.lastSungAt = Date.now()
    }
    const changed = isNew || cur.state !== to
    set(st => ({
      col: {
        ...st.col,
        faces: { ...st.col.faces, [songId]: face },
        nights: isNew ? withTonight(st, n => ({ ...n, facesGained: n.facesGained.includes(songId) ? n.facesGained : [...n.facesGained, songId] })) : st.col.nights,
      },
    }))
    if (changed) {
      const note = faceNote(song)
      get().pushNote(note)
      bus.emit({ type: 'face/changed', songId, from: cur?.state, to, note })
      if (Object.keys(get().col.faces).length >= 30) get().earnPin('faces30')
    }
    return { from: cur?.state, to }
  },

  markFace(songId, mark) {
    const f = get().col.faces[songId]
    if (!f || f.marks.includes(mark)) return
    set(st => ({ col: { ...st.col, faces: { ...st.col.faces, [songId]: { ...f, marks: [...f.marks, mark] } } } }))
  },

  addLink(a, b) {
    if (a === b) return
    const s = get()
    if (s.col.links.some(l => (l.a === a && l.b === b) || (l.a === b && l.b === a))) return
    set(st => ({ col: { ...st.col, links: [...st.col.links, { a, b, nightId: st.session.nightId, at: Date.now() }] } }))
    bus.emit({ type: 'link/added', a, b })
  },

  addWallPoint(p) {
    const markers = [...new Set([...p.markers, ...pendingMarkers])]
    pendingMarkers = []
    set(st => ({ col: { ...st.col, nights: withTonight(st, n => ({ ...n, points: [...n.points, { ...p, markers }] })) } }))
  },

  addMarker(m) {
    if (!pendingMarkers.includes(m)) pendingMarkers.push(m)
  },

  pushNote(midi) {
    set(st => ({
      col: {
        ...st.col,
        nights: withTonight(st, n => {
          const melody = [...n.melody, midi]
          return { ...n, melody: melody.length > MELODY_MAX ? [...melody.slice(0, 16), ...melody.slice(-16)] : melody }
        }),
      },
    }))
  },

  popNote() {
    set(st => ({ col: { ...st.col, nights: withTonight(st, n => ({ ...n, melody: n.melody.slice(0, -1) })) } }))
  },

  earnPin(id) {
    const s = get()
    if (s.col.pins.some(p => p.id === id)) return false
    set(st => ({ col: { ...st.col, pins: [...st.col.pins, { id, at: Date.now(), nightId: st.session.nightId }] } }))
    bus.emit({ type: 'pin/earned', id })
    return true
  },

  removePin(id) {
    set(st => ({ col: { ...st.col, pins: st.col.pins.filter(p => p.id !== id) } }))
  },

  recordVoice(r) {
    set(st => ({ col: { ...st.col, voices: [...st.col.voices, r] } }))
  },

  saveSong(songId, version, from) {
    set(st => ({
      col: {
        ...st.col,
        saved: [...st.col.saved.filter(x => x.songId !== songId), { songId, version, at: Date.now(), from }],
        imports: st.col.imports.map(i => (i.songId === songId ? { ...i, status: 'saved' as const } : i)),
      },
    }))
  },

  setImport(songId, status) {
    set(st => ({ col: { ...st.col, imports: st.col.imports.map(i => (i.songId === songId ? { ...i, status } : i)) } }))
  },

  polishFace(songId) {
    const f = get().col.faces[songId]
    if (!f) return
    set(st => ({ col: { ...st.col, faces: { ...st.col.faces, [songId]: { ...f, polishedAt: Date.now() } } } }))
  },

  nameNight(name) {
    set(st => ({ col: { ...st.col, nights: withTonight(st, n => ({ ...n, name })) } }))
  },

  stampNight() {
    set(st => ({ col: { ...st.col, nights: withTonight(st, n => ({ ...n, stamped: true })) } }))
  },

  notePassReason(r) {
    set(st => ({ col: { ...st.col, passReasons: { ...st.col.passReasons, [r]: (st.col.passReasons[r] ?? 0) + 1 } } }))
  },

  seedPastNights(n) {
    // Clearly labelled demo data (Night.seeded) so the collection is not empty in a pitch.
    const s = get()
    if (s.col.nights.some(x => x.seeded)) return
    const rand = mulberry32(hashString('seed-nights'))
    const day = 24 * 3600 * 1000
    const now = Date.now()
    const nights: Night[] = []
    const faces: Record<string, Face> = { ...s.col.faces }
    const pool = SONGS.filter(x => x.reservable).slice()
    const perNight = Math.ceil(30 / Math.max(1, n))
    for (let k = 0; k < Math.max(1, n); k++) {
      const startedAt = now - (70 - k * 45) * day
      const id = `seed-${k + 1}`
      const gained: string[] = []
      const points: Night['points'] = []
      let heat = 0.3
      for (let i = 0; i < perNight && pool.length; i++) {
        const song = pool.splice(Math.floor(rand() * pool.length), 1)[0]
        const r = rand()
        const state: Face['state'] = r < 0.35 ? 'sketch' : r < 0.6 ? 'neon' : r < 0.9 ? 'mirror' : 'prism'
        const sung = state === 'mirror' || state === 'prism'
        if (!faces[song.id]) {
          faces[song.id] = {
            songId: song.id,
            state,
            marks: rand() < 0.15 ? ['navi'] : [],
            firstNightId: id,
            firstAt: startedAt,
            sungCount: sung ? 1 : 0,
            ...(sung ? { lastSungAt: startedAt + i * 5 * 60_000 } : {}),
          }
          gained.push(song.id)
        }
        if (sung) {
          heat = Math.min(1, Math.max(0.1, heat + (song.energy - 0.5) * 0.4))
          points.push({ t: i * 5, heat, songId: song.id, by: 'me', claps: 20 + Math.round(rand() * 30), markers: [] })
        }
      }
      nights.push({
        id,
        startedAt,
        endedAt: startedAt + 90 * 60_000,
        points,
        melody: gained.slice(0, 16).map(gid => faceNote(SONG_BY_ID[gid])),
        facesGained: gained,
        shared: gained.slice(0, 3),
        claps: 120,
        stamped: true,
        palette: [...(k % 2 ? AURORA_PALETTES.hot : AURORA_PALETTES.warm)] as [string, string, string],
        seeded: true,
      })
    }
    set(st => ({ col: { ...st.col, faces, nights: [...nights, ...st.col.nights] } }))
  },

  wipe() {
    pendingMarkers = []
    set(st => ({ col: { ...freshCollection(), nights: st.col.nights.filter(n => n.id === st.session.nightId).map(n => ({ ...n, points: [], melody: [], facesGained: [], shared: [] })) } }))
  },

  restoreFace(songId, prev) {
    set(st => {
      const faces = { ...st.col.faces }
      if (prev) faces[songId] = prev
      else delete faces[songId]
      const nights = prev ? st.col.nights : withTonight(st, n => ({ ...n, facesGained: n.facesGained.filter(x => x !== songId) }))
      return { col: { ...st.col, faces, nights } }
    })
  },

  removeLastLink() {
    set(st => ({ col: { ...st.col, links: st.col.links.slice(0, -1) } }))
  },
})

export { tonightOf }
