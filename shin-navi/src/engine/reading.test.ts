import { describe, expect, it } from 'vitest'
import { SONGS, SONG_BY_ID } from '../data/songs'
import { coOccur, knownBy, rangeFit, readRoom, targetEnergy, voiceType, songsForVoice, type Person } from './reading'
import { karaokeNote, detectPitch } from '../lib/pitch'

const me: Person = { id: 'me', generation: 20, likes: { 'J-POP': 0.9, アニメ: 0.7 } }
const room: Person[] = [
  { id: 'a', generation: 20, likes: { ボカロ: 0.8 } },
  { id: 'b', generation: 30, likes: { ロック: 0.8 } },
  { id: 'c', generation: 20, likes: { 'K-POP': 0.9 } },
]

describe('song seed', () => {
  it('has unique ids and sane fields', () => {
    const ids = new Set(SONGS.map(s => s.id))
    expect(ids.size).toBe(SONGS.length)
    expect(SONGS.length).toBeGreaterThanOrEqual(100)
    for (const s of SONGS) {
      expect(s.range[0]).toBeLessThan(s.range[1])
      expect(s.energy).toBeGreaterThanOrEqual(0)
      expect(s.energy).toBeLessThanOrEqual(1)
      expect(s.vibes.length).toBeGreaterThan(0)
    }
  })
})

describe('reading engine', () => {
  it('knownBy is deterministic', () => {
    const s = SONG_BY_ID['gurenge']
    expect(knownBy([me, ...room], s)).toEqual(knownBy([me, ...room], s))
  })

  it('opens with high energy and asks for a finale near the end', () => {
    expect(targetEnergy([], 90)).toBeGreaterThan(0.8)
    expect(targetEnergy([SONG_BY_ID['lemon']], 5)).toBeGreaterThan(0.9)
  })

  it('breathes after three peaks', () => {
    const peaks = ['gurenge', 'idol', 'kick-back'].map(id => SONG_BY_ID[id])
    expect(targetEnergy(peaks, 60)).toBeLessThan(0.6)
  })

  it('ranks without repeating sung or passed songs and gives reasons', () => {
    const history = [SONG_BY_ID['gurenge']]
    const ranked = readRoom({ me, room, history, minutesLeft: 60, kept: new Set(), passed: new Set(['idol']) })
    expect(ranked.find(r => r.song.id === 'gurenge')).toBeUndefined()
    expect(ranked.find(r => r.song.id === 'idol')).toBeUndefined()
    expect(ranked[0].score).toBeGreaterThanOrEqual(ranked[ranked.length - 1].score)
    expect(ranked.slice(0, 10).some(r => r.reasons.length > 0)).toBe(true)
  })

  it('co-occurrence returns other songs', () => {
    const co = coOccur('pretender', 5)
    expect(co).toHaveLength(5)
    expect(co.map(s => s.id)).not.toContain('pretender')
  })

  it('suggests lowering the key when the song sits above the singer', () => {
    const r = rangeFit(SONG_BY_ID['kurenai'], [48, 67])
    expect(r.shift).toBeLessThan(0)
    expect(r.note).toContain('下げる')
  })

  it('maps features to a type and suggests songs', () => {
    expect(voiceType({ power: 0.95, care: 0.4, brightness: 0.5, groove: 0.3 })).toBe('power')
    expect(voiceType({ power: 0.2, care: 0.95, brightness: 0.9, groove: 0.2 })).toBe('clear')
    expect(songsForVoice('groove', [50, 70], 3)).toHaveLength(3)
  })
})

describe('pitch', () => {
  it('names karaoke octaves', () => {
    expect(karaokeNote(69)).toBe('hiA')
    expect(karaokeNote(67)).toBe('mid2G')
    expect(karaokeNote(60)).toBe('mid2C')
    expect(karaokeNote(55)).toBe('mid1G')
  })

  it('detects a sine tone', () => {
    const sr = 44100
    const buf = new Float32Array(2048)
    for (let i = 0; i < buf.length; i++) buf[i] = 0.5 * Math.sin((2 * Math.PI * 220 * i) / sr)
    const hz = detectPitch(buf, sr)
    expect(hz).not.toBeNull()
    expect(Math.abs((hz as number) - 220)).toBeLessThan(3)
  })
})
