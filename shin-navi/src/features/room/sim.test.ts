// M5 room-sim acceptance (SPEC L/M5 1–7): the E-2 formula, seeded answers/delays/silence on a
// fake clock, ~15% silence, positive bubbles only, E-3…E-10 behaviour with their probabilities,
// the eleven script steps, "next time" never reaching the sender, and no JSX literals.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

class MemStorage {
  m = new Map<string, string>()
  getItem(k: string) {
    return this.m.has(k) ? this.m.get(k)! : null
  }
  setItem(k: string, v: string) {
    this.m.set(k, String(v))
  }
  removeItem(k: string) {
    this.m.delete(k)
  }
  clear() {
    this.m.clear()
  }
}
;(globalThis as unknown as { localStorage: MemStorage }).localStorage = new MemStorage()

import { naviApi, isMine } from '../../core/store'
import { advanceForTest } from '../../core/clock'
import { bus } from '../../core/events'
import { reserveAsMe } from '../../core/actions'
import { pKnow, roomMinutesLeft, SIM_MS_PER_ROOM_MIN } from '../../core/rules'
import type { DeckCard, Member, MemberId, OtherId, PresenterCmd, SongId } from '../../core/types'
import { SONGS, SONG_BY_ID } from '../../data/songs'
import { MEMBER_PROFILES } from '../../data/members'
import { LOCALE_IDS, namespaceStrings, trIn } from '../../i18n'
import '../../i18n/vocab'
import '../../i18n/reason'
import '../../i18n/core'
import '../../i18n/common'
import { ANSWER_BUBBLE_KEYS, drawAnswer, knowProbability } from './knowModel'
import { allPairs, pairName } from './pairNames'
import { installRoomSim } from './installRoomSim'
import { SCRIPT, runNext } from './script'
import { findTwin, junWants, memberKnows, pickMemberSong, scoreFor, useSim } from './sim'
import './strings'

const api = naviApi
const S = () => api.getState()
const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}
/** Advance real time in small beats (sim time = real × speed), letting microtasks run. */
async function run(realMs: number, beat = 50) {
  advanceForTest(api, 0)
  for (let t = 0; t < realMs; t += beat) {
    advanceForTest(api, beat)
    await flush()
  }
}
async function freshNight(seed: string, o: { script?: boolean; speed?: 1 | 4 | 8 } = {}) {
  S().resetAll()
  S().startNight({ seed })
  if (o.script) S().setScript(true)
  if (o.speed) S().setSpeed(o.speed)
  await flush()
  advanceForTest(api, 0)
}
const fire = (cmd: PresenterCmd) => bus.emit({ type: 'presenter/cmd', cmd })
const member = (id: MemberId): Member => ({ ...MEMBER_PROFILES[id], present: true, arriving: false, joinedAt: 0 }) as Member
function card(p: Partial<DeckCard> & Pick<DeckCard, 'id' | 'kind'>): DeckCard {
  return { reason: { source: 'dare', text: { key: 'reason.twin' } }, trigger: { type: 'refill', at: 0 }, rule: 'test', dealtAt: Date.now(), ...p }
}

let off: () => void
beforeAll(() => {
  off = installRoomSim(api)
})
afterAll(() => off())

// ================================================================ E-2 formula (pure)

describe('knowProbability (E-2)', () => {
  it('follows pKnow = clamp(0.15 + 0.6·taste + 0.35·aware, 0, 0.97)', () => {
    for (const id of ['minato', 'saki', 'jun'] as const) {
      const m = member(id)
      for (const s of SONGS.slice(0, 60)) {
        const taste = m.likes[s.genre] ?? 0.2
        let aware = s.knownRate[m.generation] / 100
        if (id === 'jun') aware *= s.inboundTitle.ko ? 1 : 0.5
        const know = Math.min(0.97, Math.max(0, 0.15 + 0.6 * taste + 0.35 * aware))
        const p = knowProbability(m, s)
        expect(p.know).toBeCloseTo(know, 10)
        expect(p.know).toBeCloseTo(pKnow(m, s), 10) // the same number the core uses for hidden heat
        const chorusIfNot = (s.year >= 2018 ? 0.3 : 0.1) * aware
        expect(p.chorus).toBeCloseTo((1 - know) * chorusIfNot, 10)
      }
    }
  })

  it('Jun: ×1.0 with a Korean title, ×0.5 without', () => {
    const jun = member('jun')
    const withKo = SONGS.find(s => s.inboundTitle.ko && s.genre === 'J-POP')!
    const noKo = SONGS.find(s => !s.inboundTitle.ko && s.genre === 'J-POP')!
    expect(knowProbability(jun, withKo).know).toBeCloseTo(0.15 + 0.6 * 0.2 + 0.35 * (withKo.knownRate[20] / 100), 10)
    expect(knowProbability(jun, noKo).know).toBeCloseTo(0.15 + 0.6 * 0.2 + 0.35 * (noKo.knownRate[20] / 100) * 0.5, 10)
  })

  it('draws are seeded per member and song: same seed, same answer, delay, silence, bubble', () => {
    const m = member('saki')
    for (const s of SONGS.slice(0, 40)) {
      expect(drawAnswer('night-a', m, s)).toEqual(drawAnswer('night-a', m, s))
    }
    const differs = SONGS.slice(0, 40).some(s => JSON.stringify(drawAnswer('night-a', m, s)) !== JSON.stringify(drawAnswer('night-b', m, s)))
    expect(differs).toBe(true)
  })

  it('delay = 0.6 + 3.4·r² s (early-biased), +2 s for ~6%', () => {
    const delays: number[] = []
    let ponder = 0
    for (let i = 0; i < 1500; i++) {
      const d = drawAnswer(`d${i}`, member('minato'), SONGS[i % SONGS.length])
      delays.push(d.delayMs - (d.ponder ? 2000 : 0))
      if (d.ponder) ponder++
    }
    expect(Math.min(...delays)).toBeGreaterThanOrEqual(600)
    expect(Math.max(...delays)).toBeLessThanOrEqual(4000)
    const median = [...delays].sort((a, b) => a - b)[delays.length >> 1]
    expect(median).toBeLessThan(2300) // r² pulls answers early (a uniform delay would sit at 2.3 s)
    expect(ponder / 1500).toBeGreaterThan(0.03)
    expect(ponder / 1500).toBeLessThan(0.09)
  })
})

describe('silence and bubbles (E-2, M5 #2)', () => {
  it('about 15% never answer over 1000 draws (10–20%)', () => {
    let silent = 0
    let n = 0
    for (let k = 0; n < 1000; k++) {
      for (const id of ['minato', 'saki', 'jun'] as const) {
        if (n >= 1000) break
        if (drawAnswer(`silence-${k}`, member(id), SONGS[(k * 7 + n) % SONGS.length]).silent) silent++
        n++
      }
    }
    expect(silent / n).toBeGreaterThanOrEqual(0.1)
    expect(silent / n).toBeLessThanOrEqual(0.2)
  })

  it('bubbles only for positive answers, about 60% of them, never a negative word', () => {
    let pos = 0
    let talk = 0
    for (let i = 0; i < 3000; i++) {
      const d = drawAnswer(`b${i}`, member((['minato', 'saki', 'jun'] as const)[i % 3]), SONGS[i % SONGS.length])
      if (d.answer === 'none') expect(d.bubble).toBeNull()
      else {
        pos++
        if (d.bubble) {
          talk++
          expect(ANSWER_BUBBLE_KEYS).toContain(d.bubble.key)
        }
      }
    }
    expect(talk / pos).toBeGreaterThan(0.5)
    expect(talk / pos).toBeLessThan(0.7)
    const room = namespaceStrings('room') as unknown as Record<string, Record<string, string>>
    for (const l of LOCALE_IDS) {
      for (const [k, v] of Object.entries(room[l])) {
        if (!k.startsWith('bubble.')) continue
        expect(v).not.toMatch(/知らない|わからない|無理|微妙|嫌い|don't|never|no idea|모르|不會|不会|不知道/i)
      }
    }
  })
})

// ================================================================ the room on a fake clock

describe('answers on the sim clock (E-2, M5 #1)', () => {
  const ids = ['marigold', 'lemon', 'pretender', 'idol', 'gurenge', 'zankoku']

  async function night(seed: string) {
    await freshNight(seed)
    const log: { member: MemberId; songId: SongId; a: string; at: number }[] = []
    const offA = bus.on('know/answered', e => log.push({ member: e.member, songId: e.songId, a: e.a, at: S().session.simMs }))
    for (const id of ids) S().askRoom(id, 'me')
    await run(7500)
    offA()
    return log
  }

  it('answers arrive at their drawn delays, silent members never answer, and the same seed replays', async () => {
    const a = await night('fake-clock')
    const seed = S().session.seed
    for (const id of ids) {
      for (const m of ['minato', 'saki'] as const) {
        const d = drawAnswer(seed, S().room.members[m], SONG_BY_ID[id])
        const got = a.find(x => x.songId === id && x.member === m)
        if (d.silent) expect(got, `${m} ${id} should stay silent`).toBeUndefined()
        else {
          expect(got?.a).toBe(d.answer)
          expect(Math.abs(got!.at - d.delayMs)).toBeLessThanOrEqual(110)
        }
      }
    }
    const b = await night('fake-clock')
    expect(b.map(x => `${x.member}|${x.songId}|${x.a}`)).toEqual(a.map(x => `${x.member}|${x.songId}|${x.a}`))
  })

  it('speed 8 compresses the same answers into an eighth of the real time', async () => {
    await freshNight('fast', { speed: 8 })
    const got: string[] = []
    const offA = bus.on('know/answered', e => got.push(e.member))
    for (const id of ids) S().askRoom(id, 'me')
    await run(800) // 6.4 s of sim time
    offA()
    const expected = ids.flatMap(id => (['minato', 'saki'] as const).filter(m => !drawAnswer(S().session.seed, S().room.members[m], SONG_BY_ID[id]).silent))
    expect(got.length).toBe(expected.length)
  })

  it('a newcomer answers what the room was asked, 1–3 s after joining (C-11 ⑤)', async () => {
    await freshNight('recount')
    for (const id of ids) S().askRoom(id, 'me')
    await run(6000)
    const times: number[] = []
    const offA = bus.on('know/answered', e => e.member === 'jun' && times.push(S().session.simMs))
    const t0 = S().session.simMs
    fire({ t: 'join', id: 'jun' })
    await run(3300)
    offA()
    const seed = S().session.seed
    const talking = ids.filter(id => !drawAnswer(seed, S().room.members.jun, SONG_BY_ID[id]).silent)
    expect(times.length).toBe(talking.length)
    for (const t of times) {
      expect(t - t0).toBeGreaterThanOrEqual(950)
      expect(t - t0).toBeLessThanOrEqual(3100)
    }
  })
})

// ================================================================ reservations (E-3)

describe('reservations (E-3)', () => {
  it('nobody takes the opener slot before my first song; then Minato reserves within 4–8 s', async () => {
    await freshNight('minato')
    await run(20_000)
    expect(S().room.queue.filter(q => q.by !== 'me').length).toBe(0)
    const times: number[] = []
    const offQ = bus.on('queue/added', e => e.item.by === 'minato' && times.push(S().session.simMs))
    const t0 = S().session.simMs
    reserveAsMe(api, 'marigold')
    await run(8300)
    offQ()
    expect(times.length).toBeGreaterThanOrEqual(1)
    expect(times[0] - t0).toBeGreaterThanOrEqual(3950)
    expect(times[0] - t0).toBeLessThanOrEqual(8150)
    // Minato picks a lively song
    const m = S().room.queue.find(q => q.by === 'minato')!
    expect(SONG_BY_ID[m.songId].energy).toBeGreaterThanOrEqual(0.6)
  })

  it('free play over a long stretch: Minato keeps 2 waiting, Saki every second song, Jun after minute 12, no duplicates', async () => {
    await freshNight('long', { speed: 8 })
    reserveAsMe(api, 'marigold')
    let ends = 0
    const by: Record<string, number> = {}
    const offE = bus.on('song/ended', () => ends++)
    const offQ = bus.on('queue/added', e => (by[e.item.by] = (by[e.item.by] ?? 0) + 1))
    await run(40_000, 250) // 320 s of sim time, 12+ room minutes → Jun arrives
    offE()
    offQ()
    expect(S().room.members.jun.present).toBe(true)
    expect(by.minato ?? 0).toBeGreaterThanOrEqual(2)
    expect(by.saki ?? 0).toBeGreaterThanOrEqual(1)
    expect(by.saki ?? 0).toBeLessThanOrEqual(Math.ceil(ends / 2))
    expect(by.jun ?? 0).toBeGreaterThanOrEqual(1)
    const all = [...S().room.sung.map(e => e.item.songId), ...(S().room.now ? [S().room.now!.item.songId] : []), ...S().room.queue.map(q => q.songId)]
    expect(new Set(all).size).toBe(all.length)
    // my own song finished on its own with a demo score (E-4)
    const mine = S().room.sung.find(e => isMine(e.item))!
    expect(mine.score).toBeGreaterThanOrEqual(78)
    expect(mine.score).toBeLessThanOrEqual(96)
  })

  it('script mode: nothing moves on its own before my first song; nobody walks in', async () => {
    await freshNight('quiet', { script: true, speed: 8 })
    await run(16_000, 250)
    expect(S().room.queue.length).toBe(0)
    expect(S().room.members.jun.present).toBe(false)
  })

  it('script mode: after my first song only the scripted set-up follows (Minato, then Saki’s slow pair)', async () => {
    await freshNight('quiet2', { script: true, speed: 8 })
    reserveAsMe(api, 'marigold')
    await run(400, 50) // 3.2 s of sim time: Minato has not reacted yet
    expect(S().room.queue.filter(q => q.by !== 'me').length).toBe(0)
    await run(16_000, 250)
    const q = S().room.queue
    expect(q.filter(x => x.by === 'minato').length).toBe(1)
    expect(q.filter(x => x.by === 'saki').map(x => x.songId)).toEqual(['lemon', 'dry-flower'])
    expect(q.filter(x => x.by === 'jun').length).toBe(0)
    expect(S().room.now).toBeNull() // songs never start by themselves in script mode
    expect(S().room.members.jun.present).toBe(false)
    expect(useSim.getState().scriptPos).toBe(3)
    expect(runNext(api)).toBe('jun-join') // the presenter's first → (T03)
  })

  it('Jun reserves when his turn is two or more songs away (at most two waiting)', async () => {
    await freshNight('jun-turn')
    const s = () => S()
    fire({ t: 'join', id: 'jun' })
    expect(junWants(s())).toBe(true) // nothing of his yet
    S().reserve('gurenge', { by: 'jun' })
    expect(junWants(s())).toBe(false) // his song is next
    S().reserve('lemon', { by: 'saki' })
    S().reserve('idol', { by: 'minato', insertAt: 0 })
    expect(junWants(s())).toBe(false) // one song away
    S().reserve('marigold', { by: 'saki', insertAt: 0 })
    expect(junWants(s())).toBe(true) // now two songs away
    S().reserve('zankoku', { by: 'jun' })
    expect(junWants(s())).toBe(false) // two waiting is enough
  })

  it('Saki picks gentle songs, Jun songs known in Korean', () => {
    const s = S()
    let gentle = 0
    let ko = 0
    for (let i = 0; i < 20; i++) {
      if ((SONG_BY_ID[pickMemberSong(s, 'saki', i)!]?.energy ?? 1) < 0.6) gentle++
      if (SONG_BY_ID[pickMemberSong(s, 'jun', i)!]?.inboundTitle.ko) ko++
    }
    expect(gentle).toBeGreaterThanOrEqual(15)
    expect(ko).toBeGreaterThanOrEqual(12)
  })
})

// ================================================================ agreement and votes (E-5)

describe('agreement and votes (E-5)', () => {
  it('each roommate answers a shift prompt within 2.5 s (p 0.85 agree); a hold-out still resolves it', async () => {
    let agreed = 0
    let total = 0
    for (let i = 0; i < 40; i++) {
      await freshNight(`agree-${i}`)
      S().reserve('idol', { by: 'me', insertAt: 0, tags: ['insert'] })
      S().setPrompt({ id: `p${i}`, kind: 'shift', songIds: ['idol'], agree: {}, at: 0 })
      let last: Record<string, boolean> = {}
      const offR = bus.on('prompt/resolved', e => (last = e.prompt.agree as Record<string, boolean>))
      await run(2550)
      offR()
      expect(S().room.prompt, `night ${i}: prompt resolved`).toBeNull()
      for (const v of Object.values(last)) {
        total++
        if (v) agreed++
      }
    }
    expect(total).toBe(80)
    expect(agreed / total).toBeGreaterThan(0.72)
    expect(agreed / total).toBeLessThan(0.97)
  })

  it('someone who walks in or goes home mid-decision never leaves a proposal or a vote hanging', async () => {
    await freshNight('mid-join')
    S().reserve('idol', { by: 'me', insertAt: 0, tags: ['insert'] })
    S().setPrompt({ id: 'pj', kind: 'shift', songIds: ['idol'], agree: {}, at: 0 })
    fire({ t: 'join', id: 'jun' })
    await run(2600)
    expect(S().room.prompt).toBeNull()

    await freshNight('mid-leave')
    S().reserve('idol', { by: 'me', insertAt: 0, tags: ['insert'] })
    fire({ t: 'join', id: 'jun' })
    S().setPrompt({ id: 'pl', kind: 'shift', songIds: ['idol'], agree: {}, at: 0 })
    S().agreePrompt('minato', true)
    S().agreePrompt('saki', true)
    fire({ t: 'leave', id: 'jun' }) // the only one who had not answered goes home
    expect(S().room.prompt).toBeNull()

    await freshNight('fin-join')
    const options = ['kick-back', 'lemon', 'marigold']
    S().setPrompt({ id: 'pfj', kind: 'finale', songIds: options, votes: {}, at: 0 })
    S().votePrompt('me', 'lemon')
    bus.emit({ type: 'card/acted', card: card({ id: 'fin2', kind: 'finale', options }), action: 'vote', arg: { songId: 'lemon' } })
    fire({ t: 'join', id: 'jun' })
    await run(5200)
    expect(S().room.prompt).toBeNull()
    expect(useSim.getState().votes.pfj?.map(v => v.member).sort()).toEqual(['jun', 'minato', 'saki'])
    expect(S().room.queue.at(-1)?.tags).toContain('finale')
  })

  it('finale: after my vote the room votes by taste in 0.6–3 s; the fullest lantern is fixed last in gold', async () => {
    await freshNight('finale')
    S().reserve('pretender', { by: 'saki' })
    const options = ['kick-back', 'lemon', 'marigold']
    S().setPrompt({ id: 'pf', kind: 'finale', songIds: options, votes: {}, at: 0 })
    S().votePrompt('me', 'kick-back')
    bus.emit({ type: 'card/acted', card: card({ id: 'fin', kind: 'finale', options }), action: 'vote', arg: { songId: 'kick-back' } })
    await run(2900)
    expect(useSim.getState().votes.pf?.length).toBe(2)
    await run(2000)
    const q = S().room.queue
    expect(q[q.length - 1].tags).toContain('finale')
    expect(S().room.prompt).toBeNull()
    expect(useSim.getState().decided.pf).toBe(q[q.length - 1].songId)
  })
})

// ================================================================ invites (E-6, E-7, E-8)

describe('invites (E-6, E-7, E-8)', () => {
  it('"next time" never reaches the sender: the request stays open, then quietly goes at exit (M5 #6)', async () => {
    await freshNight('decline')
    const id = S().openInvite({ variant: 'request', from: 'saki', songId: 'marigold' })
    S().dealCards([card({ id: 'req', kind: 'invite', variant: 'request', from: 'saki', songId: 'marigold' })], 'top')
    const events: string[] = []
    const offAny = bus.onAny(e => events.push(e.type))
    S().act('req', 'decline')
    await run(4000)
    offAny()
    expect(S().room.invites.find(i => i.id === id)?.status).toBe('open')
    expect(events).not.toContain('request/sent')
    expect(S().room.bubbles.filter(b => b.member === 'saki').length).toBe(0)
    S().exitRoom()
    expect(S().room.invites.find(i => i.id === id)).toBeUndefined()
  })

  it('my request is accepted 3 s later with p 0.6, as that member\'s request reservation', async () => {
    let yes = 0
    for (let i = 0; i < 40; i++) {
      await freshNight(`myreq-${i}`)
      bus.emit({ type: 'request/sent', to: 'minato', songId: 'marigold' })
      await run(2900)
      expect(S().room.queue.length).toBe(0)
      await run(300)
      const it = S().room.queue.find(q => q.songId === 'marigold')
      if (it) {
        yes++
        expect(it.by).toBe('minato')
        expect(it.tags).toContain('request')
      }
    }
    expect(yes / 40).toBeGreaterThan(0.4)
    expect(yes / 40).toBeLessThan(0.8)
  })

  it('Saki requests one of my faces she would love (taste ≥ 0.5 or energy < 0.6)', async () => {
    await freshNight('saki-req')
    for (const id of ['idol', 'kick-back', 'lemon', 'marigold']) S().faceEvent(id, 'keep')
    fire({ t: 'request' })
    const inv = S().room.invites.find(i => i.variant === 'request')!
    expect(inv.from).toBe('saki')
    const song = SONG_BY_ID[inv.songId]
    expect(S().col.faces[song.id]).toBeDefined()
    expect((MEMBER_PROFILES.saki.likes[song.genre] ?? 0) >= 0.5 || song.energy < 0.6).toBe(true)
  })

  it('twin: a song only I and exactly one roommate know; the partner reveals with p 0.8 after 1.5–3 s', async () => {
    let yes = 0
    for (let i = 0; i < 40; i++) {
      await freshNight(`twin-${i}`)
      for (const s of SONGS.filter(x => x.reservable).slice(0, 40)) S().faceEvent(s.id, 'keep')
      const t = findTwin(S())
      expect(t, `night ${i}`).not.toBeNull()
      const knowers = (['minato', 'saki'] as const).filter(m => memberKnows(S(), S().room.members[m], t!.songId))
      expect(knowers).toEqual([t!.partner])
      fire({ t: 'twin' })
      const inv = S().room.invites.find(x => x.variant === 'twin')!
      S().dealCards([card({ id: `tw${i}`, kind: 'invite', variant: 'twin', from: inv.from, songId: inv.songId })], 'top')
      S().act(`tw${i}`, 'reveal')
      expect(useSim.getState().twin[`tw${i}`]).toEqual({ mine: true, them: 'wait' })
      await run(1400)
      expect(useSim.getState().twin[`tw${i}`].them).toBe('wait')
      await run(1700)
      const them = useSim.getState().twin[`tw${i}`].them
      expect(them === 'yes' || them === 'no').toBe(true)
      if (them === 'yes') yes++
    }
    expect(yes / 40).toBeGreaterThan(0.62)
    expect(yes / 40).toBeLessThan(0.95)
  })

  it('duet: the invitation is accepted with p 0.9', async () => {
    let yes = 0
    for (let i = 0; i < 40; i++) {
      await freshNight(`duet-${i}`)
      S().dealCards([card({ id: `du${i}`, kind: 'invite', variant: 'duet', from: 'saki', songId: 'uchiage-hanabi' })], 'top')
      S().act(`du${i}`, 'reveal')
      expect(useSim.getState().duet[`du${i}`]).toBe('asking')
      await run(2100)
      if (useSim.getState().duet[`du${i}`] === 'yes') yes++
    }
    expect(yes / 40).toBeGreaterThan(0.78)
  })

  it('pair names: ten unordered pairs, the E-8 table, symmetric', () => {
    const want: Record<string, string> = {
      clear_clear: '透明なユニゾン',
      clear_power: '光と炎のハーモニー',
      clear_groove: '風と波のハーモニー',
      clear_emotional: '光と影のハーモニー',
      power_power: 'ツインエンジン',
      groove_power: '太鼓と稲妻',
      emotional_power: '炎と月のハーモニー',
      groove_groove: 'ダブルビート',
      emotional_groove: '波と月のハーモニー',
      emotional_emotional: '夜明けのデュエット',
    }
    const pairs = allPairs()
    expect(pairs.length).toBe(10)
    const seen = new Set<string>()
    for (const [a, b] of pairs) {
      const ja = trIn(pairName(a, b), 'ja')
      expect(ja).toBe(trIn(pairName(b, a), 'ja'))
      seen.add(ja)
      for (const l of LOCALE_IDS) expect(trIn(pairName(a, b), l)).not.toMatch(/^vocab\./)
    }
    expect([...seen].sort()).toEqual(Object.values(want).sort())
  })
})

// ================================================================ join / leave / voice (E-9)

describe('join, leave and my voice (E-9)', () => {
  it('Jun arrives on the dotted ring and joins at room minute 12 in free play', async () => {
    await freshNight('jun12', { speed: 8 })
    expect(S().room.members.jun.arriving).toBe(true)
    await run(12 * SIM_MS_PER_ROOM_MIN / 8 - 500, 250)
    expect(S().room.members.jun.present).toBe(false)
    await run(1000, 250)
    expect(S().room.members.jun.present).toBe(true)
  })

  it('someone who leaves takes their waiting songs home', async () => {
    await freshNight('leave')
    fire({ t: 'join', id: 'jun' })
    S().reserve('gurenge', { by: 'jun' })
    S().reserve('lemon', { by: 'saki' })
    fire({ t: 'leave', id: 'jun' })
    expect(S().room.members.jun.present).toBe(false)
    expect(S().room.queue.map(q => q.by)).toEqual(['saki'])
  })

  it('my voice reading colours my light (setMemberVoice)', async () => {
    await freshNight('voice')
    S().recordVoice({ nightId: S().session.nightId, at: Date.now(), type: 'emotional', power: 0.4, care: 0.7, brightness: 0.5, groove: 0.3, range: null, method: 'quiz', evidence: { key: 'reason.voiceFit' } })
    await flush()
    expect(S().room.members.me.voiceType).toBe('emotional')
  })
})

// ================================================================ the script (E-13, M5 #4)

describe('script mode: eleven steps, each builds its state', () => {
  it('runs the demo from the opener to the wrap', async () => {
    await freshNight('demo', { script: true })
    expect(SCRIPT.map(s => s.id)).toEqual(['enter', 'minato-reserve', 'saki-mellow', 'jun-join', 'advance-2', 'my-turn', 'my-song-end', 'request-saki', 'coaster', 'minutes-15', 'exit'])
    expect(useSim.getState().scriptPos).toBe(1)
    reserveAsMe(api, 'marigold', { tags: ['navi'] })
    const events: string[] = []
    const offAny = bus.onAny(e => {
      if (e.type === 'presenter/cmd' && e.cmd.t === 'coaster') events.push('coaster')
      if (e.type === 'minutes/left') events.push(`min${e.m}`)
      if (e.type === 'song/ended') events.push(`end:${e.entry.item.songId}`)
    })

    expect(runNext(api)).toBe('minato-reserve')
    expect(S().room.queue.some(q => q.by === 'minato')).toBe(true)

    expect(runNext(api)).toBe('saki-mellow')
    const saki = S().room.queue.filter(q => q.by === 'saki').map(q => q.songId)
    expect(saki).toEqual(['lemon', 'dry-flower'])

    expect(runNext(api)).toBe('jun-join')
    expect(S().room.members.jun.present).toBe(true)

    expect(runNext(api)).toBe('advance-2')
    await run(2600)
    const last2 = S().room.sung.slice(-2)
    expect(last2.map(e => e.item.songId)).toEqual(['lemon', 'dry-flower'])
    expect(last2.every(e => SONG_BY_ID[e.item.songId].energy < 0.5 && !isMine(e.item))).toBe(true) // mellow2
    expect(S().room.now).toBeNull()

    expect(runNext(api)).toBe('my-turn')
    expect(S().room.now && isMine(S().room.now!.item)).toBe(true)

    expect(runNext(api)).toBe('my-song-end')
    const mine = S().room.sung[S().room.sung.length - 1]
    expect(isMine(mine.item)).toBe(true)
    expect(mine.score).toBeGreaterThanOrEqual(78)
    expect(mine.score).toBeLessThanOrEqual(96)

    expect(runNext(api)).toBe('request-saki')
    expect(S().room.invites.some(i => i.variant === 'request' && i.from === 'saki' && i.status === 'open')).toBe(true)

    expect(runNext(api)).toBe('coaster')
    expect(events).toContain('coaster')

    expect(runNext(api)).toBe('minutes-15')
    expect(roomMinutesLeft(S().session.simMs)).toBeLessThanOrEqual(15)
    expect(events).toContain('min15')

    expect(runNext(api)).toBe('exit')
    expect(S().session.phase).toBe('wrap')
    expect(runNext(api)).toBeNull()
    offAny()
    // nobody moved on their own in between
    expect(S().room.sung.length).toBe(3)
  })

  it('a → press beats the automatic set-up step to it (no double booking)', async () => {
    await freshNight('beat', { script: true, speed: 8 })
    reserveAsMe(api, 'marigold')
    expect(runNext(api)).toBe('minato-reserve')
    await run(4000, 250)
    expect(S().room.queue.filter(q => q.by === 'minato').length).toBe(1)
    expect(S().room.queue.filter(q => q.by === 'saki').length).toBe(2)
    expect(runNext(api)).toBe('jun-join')
  })

  it('a step the presenter already caused by hand is skipped (no wasted → press)', async () => {
    await freshNight('skip', { script: true })
    useSim.setState({ scriptPos: 2 })
    fire({ t: 'join', id: 'jun' })
    expect(runNext(api)).toBe('saki-mellow')
    expect(runNext(api)).toBe('advance-2') // jun-join is already on screen
  })

  it('my-song-end gives me the stage first when my song is not playing', async () => {
    await freshNight('late-mine', { script: true })
    S().reserve('lemon', { by: 'saki' })
    reserveAsMe(api, 'idol')
    fire({ t: 'step', id: 'my-song-end' })
    expect(S().room.now?.item.songId).toBe('idol')
    await run(1000)
    expect(S().room.sung.at(-1)?.item.songId).toBe('idol')
  })
})

// ================================================================ presenter commands (K-3)

describe('presenter commands', () => {
  it('advance, my turn, finish with 100, minutes, exit', async () => {
    await freshNight('cmds', { script: true })
    S().reserve('lemon', { by: 'saki' })
    reserveAsMe(api, 'marigold')
    fire({ t: 'advance' })
    expect(S().room.now?.item.songId).toBe('lemon')
    fire({ t: 'myTurn' })
    expect(S().room.now?.item.songId).toBe('marigold')
    fire({ t: 'finishMine', score: 100 })
    expect(S().room.sung.at(-1)?.score).toBe(100)
    expect(S().col.pins.some(p => p.id === 'hundred')).toBe(true)
    fire({ t: 'minutesLeft', m: 15 })
    expect(roomMinutesLeft(S().session.simMs)).toBe(15)
    fire({ t: 'exit' })
    expect(S().session.phase).toBe('wrap')
  })

  it('reset and next visit keep the presenter\'s setup (script, speed, panel)', async () => {
    await freshNight('keep', { script: true, speed: 4 })
    S().togglePresenter()
    const visit = S().session.visit
    fire({ t: 'nextVisit' })
    expect(S().session.visit).toBe(visit + 1)
    expect(S().session.script).toBe(true)
    expect(S().session.speed).toBe(4)
    expect(S().ui.presenter).toBe(true)
    fire({ t: 'reset' })
    expect(S().session.phase).toBe('live')
    expect(S().session.script).toBe(true)
    expect(S().ui.presenter).toBe(true)
    expect(useSim.getState().scriptPos).toBe(1)
  })

  it('demo scores stay in 78–96', () => {
    for (let i = 0; i < 400; i++) {
      const v = scoreFor(`s${i}`, 'marigold', i % 4)
      expect(v).toBeGreaterThanOrEqual(78)
      expect(v).toBeLessThanOrEqual(96)
    }
  })

  it('every command in K-3 is handled without throwing', async () => {
    await freshNight('all-cmds')
    const cmds: PresenterCmd[] = [
      { t: 'speed', v: 8 },
      { t: 'script', on: true },
      { t: 'join', id: 'jun' as OtherId },
      { t: 'leave', id: 'jun' as OtherId },
      { t: 'advance' },
      { t: 'myTurn' },
      { t: 'finishMine' },
      { t: 'request' },
      { t: 'twin' },
      { t: 'coaster' },
      { t: 'minutesLeft', m: 20 },
      { t: 'seedNights', n: 2 },
      { t: 'view', v: 'dual' },
      { t: 'view', v: 'auto' },
      { t: 'step', id: 'minato-reserve' },
      { t: 'next' },
      { t: 'exit' },
      { t: 'nextVisit' },
      { t: 'reset' },
    ]
    const warn = console.warn
    const warnings: unknown[] = []
    console.warn = (...a: unknown[]) => warnings.push(a)
    for (const c of cmds) fire(c)
    console.warn = warn
    expect(warnings).toEqual([])
    expect(S().col.nights.some(n => n.seeded)).toBe(true)
  })
})

// ================================================================ G-3: no Japanese literals in JSX

describe('no Japanese literals in this module’s components (G-3)', () => {
  const files = import.meta.glob('./*.tsx', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
  it('has the three components', () => expect(Object.keys(files).length).toBe(3))
  for (const [name, src] of Object.entries(files)) {
    it(name, () => expect(src).not.toMatch(/[　-ヿ㐀-鿿＀-￯]/))
  }
})
