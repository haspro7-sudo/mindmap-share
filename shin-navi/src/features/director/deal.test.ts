// Dealer acceptance (SPEC L/M4 #1–3): C-10 first three per locale, the round-1 order (C-2),
// insertion positions and priority (C-3 / C-9), causes on every event card, diversity over 200
// simulated nights, reservable=false never dealt, reason.* / cause.* keys only, determinism.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { naviApi } from '../../core/store'
import { bus } from '../../core/events'
import type { CardAction, CardKind, DeckCard, DirectorTrigger, Locale, SongId } from '../../core/types'
import type { NaviState } from '../../core/store/types'
import { SONG_BY_ID } from '../../data/songs'
import { LOCALE_OPENERS } from '../../data/tables'
import { namespaceStrings } from '../../i18n'
import '../../i18n/vocab'
import '../../i18n/reason'
import '../../i18n/core'
import { seeded } from '../../lib/rng'
import { deal, diversityViolations, fits, MIN_HAND, parseCardId, rankOf, type DirectorInput } from './deal'
import { inputFrom, installDirector } from './installDirector'
import { staticList } from './staticList'
import { POLICY_MAP, POLICIES, WAYS, measure, tonightLit, evidenceFor } from './policyMap'
import { trIn } from '../../i18n'
import './strings'

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

const api = naviApi
const S = () => api.getState()
const settle = async () => {
  for (let i = 0; i < 6; i++) await Promise.resolve()
}
const trig = (type: DirectorTrigger['type'], extra: Partial<DirectorTrigger> = {}): DirectorTrigger => ({ type, at: S().session.simMs, ...extra })
const input = (t: DirectorTrigger, locale: Locale = 'ja', now = 1_700_000_000_000): DirectorInput => ({ ...inputFrom(S(), t, now), locale })
const NOT_RESERVABLE = new Set(Object.values(SONG_BY_ID).filter(s => !s.reservable).map(s => s.id))
const kv = (c: DeckCard) => (c.variant ? `${c.kind}/${c.variant}` : c.kind)

const hasKey = (key: string) => {
  const [ns, k] = [key.slice(0, key.indexOf('.')), key.slice(key.indexOf('.') + 1)]
  const d = namespaceStrings(ns) as unknown as { ja: Record<string, string>; en?: Record<string, string> } | undefined
  return !!d?.ja[k] && !!d.en?.[k]
}

/** Every card the director deals is checked here. */
function checkCard(c: DeckCard, where: string) {
  expect(c.reason.text.key.startsWith('reason.'), `${where}: ${c.reason.text.key}`).toBe(true)
  expect(hasKey(c.reason.text.key), `${where}: unknown ${c.reason.text.key}`).toBe(true)
  if (c.reason.cause) {
    expect(c.reason.cause.key.startsWith('cause.'), `${where}: ${c.reason.cause.key}`).toBe(true)
    expect(hasKey(c.reason.cause.key), `${where}: unknown ${c.reason.cause.key}`).toBe(true)
  }
  // event-inserted cards always say why (twin/duet invites are discoveries, not C-3 events)
  if ((c.rule.startsWith('insert.') && !/insert\.invite\.(twin|duet)/.test(c.rule)) || c.rule.startsWith('redeal.')) expect(c.reason.cause, `${where}: ${c.rule} has no cause`).toBeTruthy()
  for (const id of [c.songId, ...(c.options ?? [])].filter(Boolean) as SongId[]) {
    expect(SONG_BY_ID[id], `${where}: unknown song ${id}`).toBeDefined()
    if (c.kind !== 'gap') expect(NOT_RESERVABLE.has(id), `${where}: dealt non-reservable ${id} (${c.kind})`).toBe(false)
  }
}

let off: () => void
const dealt: DeckCard[] = []
const offDealt = api.subscribe((s, p) => {
  if (s.deck.cards === p.deck.cards) return
  const before = new Set(p.deck.cards.map(c => c.id))
  for (const c of s.deck.cards) if (!before.has(c.id)) dealt.push(c)
})

beforeAll(() => {
  off = installDirector(api)
})
afterAll(() => {
  off()
  offDealt()
})

async function freshNight(seed: string) {
  S().resetAll()
  S().startNight({ seed })
  await settle()
}

describe('C-10 first three per locale (pure deal on entry)', () => {
  it('ja: opener from the reading, then ask and gap', async () => {
    await freshNight('c10-ja')
    const out = deal({ ...input(trig('enter')), deck: { ...input(trig('enter')).deck, cards: [], history: [] } })
    expect(out.cards.slice(0, 3).map(kv)).toEqual(['song/opener', 'ask', 'gap'])
    out.cards.forEach((c, i) => checkCard(c, `ja#${i}`))
  })

  for (const loc of ['en', 'zhHant', 'zhHans', 'ko'] as Locale[]) {
    it(`${loc}: follows LOCALE_OPENERS`, async () => {
      await freshNight(`c10-${loc}`)
      const base = input(trig('enter'), loc)
      const out = deal({ ...base, deck: { ...base.deck, cards: [], history: [] } })
      const rows = LOCALE_OPENERS[loc]
      expect(out.cards.slice(0, 3).map(c => (c.variant === 'visa' ? 'song/visa' : c.kind))).toEqual(rows.map(r => (r.kind === 'song' ? 'song/visa' : r.kind)))
      rows.forEach((r, i) => {
        if (r.kind !== 'gap' && r.songId) expect(out.cards[i].songId).toBe(r.songId)
      })
      expect(out.cards[0].reason.text).toEqual({ key: 'reason.visa', vars: { locale: { locale: loc } } })
      out.cards.forEach((c, i) => checkCard(c, `${loc}#${i}`))
    })
  }

  it('installs on a night that is already running and asks the room about the opener', async () => {
    await freshNight('install')
    const s = S()
    expect(s.deck.cards.length).toBeGreaterThanOrEqual(MIN_HAND)
    expect(kv(s.deck.cards[0])).toBe('song/opener')
    expect(s.room.knowing[s.deck.cards[0].songId!]).toBeDefined()
    expect(s.deck.cards.slice(1, 3).map(c => c.kind)).toEqual(['ask', 'gap'])
  })
})

describe('determinism', () => {
  it('the same input gives the same output', async () => {
    await freshNight('det')
    for (const t of ['enter', 'refill', 'memberJoined', 'moodMixed', 'minutes15', 'navMiss'] as const) {
      const i = input(trig(t, t === 'memberJoined' ? { member: 'jun' } : {}))
      expect(deal(i)).toEqual(deal(i))
    }
  })

  it('the same seed replays the same night', async () => {
    const run = async () => {
      await freshNight('replay')
      const tops: string[] = []
      for (let i = 0; i < 12; i++) {
        const top = S().deck.cards[0]
        tops.push(`${kv(top)}:${top.songId ?? top.area ?? ''}`)
        S().act(top.id, i % 3 === 0 && top.songId ? 'reserve' : top.kind === 'breather' ? 'oneMore' : 'pass')
        await settle()
      }
      return tops
    }
    expect(await run()).toEqual(await run())
  })
})

describe('round 1 order (C-2) and insertions (C-3)', () => {
  it('opener → link after the reserve → ask → gap → import → request → song → breather', async () => {
    await freshNight('round1')
    const seen: string[] = []
    const step = async (a: CardAction, arg?: Parameters<NaviState['act']>[2]) => {
      const top = S().deck.cards[0]
      seen.push(kv(top))
      S().act(top.id, a, arg)
      await settle()
      expect(S().deck.cards.length).toBeGreaterThanOrEqual(MIN_HAND)
    }
    const opener = S().deck.cards[0]
    await step('reserve', { navi: true })
    const link = S().deck.cards[0]
    expect(link.kind).toBe('link')
    expect(link.songId).toBe(opener.songId)
    expect(link.reason.cause).toEqual({ key: 'cause.reserved', vars: { song: { song: opener.songId } } })
    await step('keep', { songId: link.options![0] })
    await step('ask')
    // asking does not finish the card; reserving it does (the second reserve: no new link)
    await step('reserve')
    await step('pass') // gap
    await step('pass') // import
    await step('decline') // Saki's request
    await step('keep') // song
    expect(S().deck.cards[0].kind).toBe('breather')
    expect(seen).toEqual(['song/opener', 'link', 'ask', 'ask', 'gap', 'import', 'invite/request', 'song'])
    expect(S().deck.consumedInRound).toBe(7)
    await step('oneMore')
    expect(S().deck.round).toBe(2)
  })

  it('link at most once per two reserves; undo takes the link back', async () => {
    await freshNight('links')
    const opener = S().deck.cards[0]
    S().act(opener.id, 'reserve')
    await settle()
    expect(S().deck.cards[0].kind).toBe('link')
    S().undo()
    await settle()
    expect(S().deck.cards[0].id).toBe(opener.id)
    expect(S().deck.cards.some(c => c.rule === 'insert.link.afterReserve')).toBe(false)
    S().act(opener.id, 'reserve')
    await settle()
    expect(S().deck.cards[0].kind).toBe('link')
  })

  it('priority: finale > voice > redeal > shift > navMiss > link > invite > coaster', async () => {
    await freshNight('prio')
    const base = S().deck.cards.slice()
    const at = (t: DirectorTrigger) => deal(input(t))
    // voice on top after my song
    api.setState(s => ({ room: { ...s.room, sung: [{ item: { id: 'q1', songId: 'marigold', by: 'me', keyShift: 0, version: 'original', tags: [], addedAt: 0 }, endedAt: 1, heatBefore: 0.2, heatAfter: 0.4, knowShare: 1, claps: 20 }] } }))
    const v = at(trig('myTurnEnded'))
    expect(v.cards[0].kind).toBe('voice')
    expect(v.cards[0].reason.cause?.key).toBe('cause.myTurn')
    api.setState(s => ({ deck: { ...s.deck, cards: v.cards } }))
    // finale goes above the voice card
    const f = at(trig('minutes15'))
    expect(f.cards.map(c => c.kind).slice(0, 2)).toEqual(['finale', 'voice'])
    expect(f.cards[0].options?.length).toBe(3)
    api.setState(s => ({ deck: { ...s.deck, cards: f.cards } }))
    // a redeal keeps finale and voice in front
    api.getState().memberJoin('jun')
    const r = at(trig('memberJoined', { member: 'jun' }))
    expect(r.mode).toBe('replace')
    expect(r.cause).toEqual({ key: 'cause.joined', vars: { member: { member: 'jun' } } })
    expect(r.cards.map(c => c.kind).slice(0, 3)).toEqual(['finale', 'voice', 'song'])
    expect(r.cards[2].variant).toBe('visa')
    // navMiss: the recovery song is "next", never on top
    api.setState(s => ({ deck: { ...s.deck, cards: base } }))
    const m = at(trig('navMiss', { songId: 'marigold' }))
    const mi = m.cards.findIndex(c => c.rule === 'insert.recover.navMiss')
    expect(mi).toBeGreaterThanOrEqual(1)
    expect(m.cards[mi].reason.cause?.key).toBe('cause.navMiss')
    // rank table mirrors the C-9 order
    const order = ['insert.finale', 'insert.voice', 'insert.shift', 'insert.recover', 'insert.link', 'insert.invite', 'insert.coaster'].map(rule => rankOf({ rule }))
    expect([...order].sort((a, b) => b - a)).toEqual(order)
  })

  it('a strong event goes on top even when the round is complete; the breather follows it', async () => {
    await freshNight('breather-event')
    api.setState(s => ({ deck: { ...s.deck, consumedInRound: 7 } }))
    const cards = deal(input(trig('refill'))).cards
    expect(cards.length).toBe(0) // the hand is full: the refill waits
    api.setState(s => ({ deck: { ...s.deck, cards: s.deck.cards.slice(0, 1) } }))
    const r = deal(input(trig('refill')))
    expect(r.cards[0].kind).toBe('breather')
    api.setState(s => ({ deck: { ...s.deck, cards: [...s.deck.cards, ...r.cards] } }))
    const f = deal(input(trig('minutes15')))
    expect(f.cards.map(c => c.kind).slice(0, 3)).toContain('breather')
    expect(f.cards[0].kind).toBe('finale')
  })

  it('shift after two mellow songs of roommates, with the navi pick changing the flow', async () => {
    await freshNight('shift')
    const e = (songId: string, by: 'saki' | 'minato', t: number) => ({ item: { id: `q${t}`, songId, by, keyShift: 0, version: 'original' as const, tags: [], addedAt: 0 }, endedAt: t, heatBefore: 0.3, heatAfter: 0.3, knowShare: 0.6, claps: 20 })
    api.setState(s => ({ room: { ...s.room, sung: [e('lemon', 'saki', 1), e('dry-flower', 'saki', 2)] } }))
    const out = deal(input(trig('memberSongEnded')))
    const c = out.cards[0]
    expect(c.kind).toBe('shift')
    expect(c.reason.cause?.key).toBe('cause.mellow2')
    expect(c.options).toHaveLength(2)
    expect(c.songId).toBe(c.options![1]) // the navi recommends changing the flow
    expect(SONG_BY_ID[c.options![1]].energy).toBeGreaterThan(SONG_BY_ID[c.options![0]].energy)
    expect(out.offers?.shiftAtSung).toBe(2)
  })

  it('a request from the room becomes the next card with its cause', async () => {
    await freshNight('request')
    S().openInvite({ variant: 'request', from: 'saki', songId: 'marigold' })
    await settle()
    const i = S().deck.cards.findIndex(c => c.kind === 'invite')
    expect(i).toBe(1)
    expect(S().deck.cards[i].reason.cause).toEqual({ key: 'cause.request', vars: { member: { member: 'saki' } } })
  })

  it('Jun joins: the whole hand is re-dealt, the new top is a visa card for Jun', async () => {
    await freshNight('join')
    const before = S().deck.cards.map(c => c.id)
    const causes: unknown[] = []
    const offR = bus.on('deck/redeal', e => causes.push(e.cause))
    S().memberJoin('jun')
    await settle()
    offR()
    const s = S()
    expect(s.deck.cards.some(c => before.includes(c.id))).toBe(false)
    expect(kv(s.deck.cards[0])).toBe('song/visa')
    expect(SONG_BY_ID[s.deck.cards[0].songId!].inboundTitle.ko).toBeTruthy()
    expect(s.deck.cards[0].reason.cause).toEqual({ key: 'cause.joined', vars: { member: { member: 'jun' } } })
    expect(s.deck.cards.every(c => c.reason.cause?.key === 'cause.joined')).toBe(true)
    expect(s.deck.cards[1]).toMatchObject({ kind: 'ask', variant: 'welcome' })
    expect(s.deck.redeal?.cause.key).toBe('cause.joined')
    expect(causes).toHaveLength(1)
  })

  it('15 minutes left: finale on top and a room prompt to vote on', async () => {
    await freshNight('finale')
    S().jumpToMinutesLeft(15)
    await settle()
    const s = S()
    expect(s.deck.cards[0].kind).toBe('finale')
    expect(s.room.prompt?.kind).toBe('finale')
    expect(s.room.prompt?.songIds).toEqual(s.deck.cards[0].options)
  })

  it('the air mixer re-deals with its cause', async () => {
    await freshNight('mixed')
    S().setMood({ hype: 0.95, fresh: 0.8, setBy: 'mixer' })
    await settle()
    expect(S().deck.redeal?.cause.key).toBe('cause.mixed')
    expect(S().deck.cards[0].reason.cause?.key).toBe('cause.mixed')
  })

  it('a presenter coaster cue lands on top with a real cause', async () => {
    await freshNight('coaster')
    bus.emit({ type: 'presenter/cmd', cmd: { t: 'coaster' } })
    await settle()
    expect(S().deck.cards[0].kind).toBe('coaster')
    expect(S().deck.cards[0].reason.cause?.key.startsWith('cause.')).toBe(true)
  })
})

describe('diversity (C-9) over 200 simulated nights', () => {
  it('never breaks the rules, keeps 3+ cards, and only deals reservable songs with reason keys', async () => {
    const rulesBroken: string[] = []
    let acted = 0
    const kindsSeen = new Set<string>()
    // SIM_NIGHT=<n> traces one night (debug aid)
    const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {}
    const only = env.SIM_NIGHT ? Number(env.SIM_NIGHT) : -1
    const nights = env.SIM_NIGHTS ? Number(env.SIM_NIGHTS) : 200
    for (let night = 0; night < nights; night++) {
      if (only >= 0 && night !== only) continue
      await freshNight(`sim-${night}`)
      dealt.length = 0
      const rand = seeded(`sim|${night}`)
      const seq: { kind: CardKind; rule: string }[] = []
      const offActed = bus.on('card/acted', e => {
        if (['reserve', 'keep', 'pass', 'insert', 'openArea', 'accept', 'decline', 'rest', 'putDown', 'oneMore'].includes(e.action)) seq.push({ kind: e.card.kind, rule: e.card.rule })
      })
      const junAt = 4 + Math.floor(rand() * 20)
      const finaleAt = 30 + Math.floor(rand() * 10)
      for (let stepN = 0; stepN < 42; stepN++) {
        const s = S()
        // --- the room moves
        const r = rand()
        if (stepN === junAt) s.memberJoin('jun')
        else if (stepN === finaleAt) s.jumpToMinutesLeft(15)
        else if (r < 0.28) {
          const pool = Object.keys(SONG_BY_ID).filter(id => SONG_BY_ID[id].reservable && !s.room.queue.some(q => q.songId === id))
          const by = rand() < 0.5 ? 'minato' : 'saki'
          s.reserve(pool[Math.floor(rand() * pool.length)], { by })
        } else if (r < 0.6) {
          if (S().room.now) S().finishNow({ claps: 10 })
          S().startNext()
        } else if (r < 0.63) S().setMood({ hype: rand(), fresh: rand(), setBy: 'mixer' })
        else if (r < 0.66) bus.emit({ type: 'navi/miss', songId: 'marigold' })
        else if (r < 0.69) {
          const faces = Object.keys(S().col.faces)
          if (faces.length) S().openInvite({ variant: rand() < 0.5 ? 'request' : 'twin', from: 'saki', songId: faces[0] })
        } else if (r < 0.71) bus.emit({ type: 'presenter/cmd', cmd: { t: 'coaster' } })
        else if (r < 0.72 && S().room.members.jun.present) S().memberLeave('jun')
        await settle()
        // --- I act on the top card
        const top = S().deck.cards[0]
        expect(S().deck.cards.length, `night ${night} step ${stepN}: hand`).toBeGreaterThanOrEqual(MIN_HAND)
        kindsSeen.add(kv(top))
        const a = rand()
        let action: CardAction = 'pass'
        if (top.kind === 'breather') action = a < 0.7 ? 'oneMore' : 'putDown'
        else if (top.kind === 'song' || top.kind === 'link' || (top.kind === 'ask' && S().room.knowing[top.songId ?? ''])) action = a < 0.4 ? 'reserve' : a < 0.65 ? 'keep' : 'pass'
        else if (top.kind === 'ask') action = a < 0.6 ? 'ask' : 'pass'
        else if (top.kind === 'shift') action = a < 0.5 ? 'insert' : 'pass'
        else if (top.kind === 'invite') action = a < 0.5 ? 'accept' : 'decline'
        else if (top.kind === 'gap') action = a < 0.5 ? 'openArea' : 'pass'
        else if (top.kind === 'coaster') action = a < 0.3 ? 'rest' : 'pass'
        if (only >= 0) console.log(`#${stepN} r=${r.toFixed(2)} hand=${S().deck.cards.map(c => `${kv(c)}[${c.rule}]`).join(' ')} consumed=${S().deck.consumedInRound} → ${action}`)
        S().act(top.id, action, action === 'keep' && top.kind === 'voice' ? undefined : {})
        if (S().ui.overlay) S().setOverlay(null)
        if (S().ui.sheet) S().closeSheet()
        if (S().room.prompt?.kind === 'shift') for (const m of ['minato', 'saki', 'jun'] as const) S().agreePrompt(m, true)
        acted++
        await settle()
      }
      offActed()
      for (const c of dealt) checkCard(c, `night ${night}`)
      // C-11: the visa card on top of a join re-deal is the spec's explicit exception to "no repeat"
      const v = diversityViolations(seq.map(x => x.kind))
      const real = v.filter(x => {
        const i = Number(x.split(':')[0])
        const noBreather = seq.filter(q => q.kind !== 'breather')
        return !noBreather[i]?.rule.startsWith('redeal.joined')
      })
      if (real.length) rulesBroken.push(`night ${night}: ${real.join(' | ')} :: ${seq.map(x => x.kind).join(',')}`)
    }
    expect(rulesBroken.slice(0, 5)).toEqual([])
    expect(acted).toBeGreaterThan(only >= 0 ? 0 : nights * 40)
    for (const k of ['song/opener', 'song', 'song/visa', 'ask', 'link', 'gap', 'import', 'invite/request', 'breather', 'shift', 'finale', 'coaster']) expect(kindsSeen.has(k), `saw ${k}`).toBe(true)
  }, 180_000)
})

describe('helpers', () => {
  it('fits() encodes the three C-9 rules', () => {
    expect(fits(['song'], 'song')).toBe(false)
    expect(fits(['song', 'ask', 'song'], 'song')).toBe(false)
    expect(fits(['ask', 'song', 'ask', 'song'], 'ask')).toBe(false)
    expect(fits(['ask', 'song', 'gap', 'song'], 'link')).toBe(true)
    expect(fits(['song'], 'breather')).toBe(true)
  })

  it('card ids remember kind, variant and song', () => {
    expect(parseCardId('d~song.visa~zankoku~abc1')).toEqual({ kv: 'song.visa', key: 'zankoku' })
    expect(parseCardId('c-1')).toBeNull()
  })

  it('the static list depends on the companion only', () => {
    expect(staticList('friends')).toEqual(['gurenge', 'marigold', 'idol', 'lemon', 'zankoku'])
    expect(staticList('date', 3)).toHaveLength(3)
  })
})

describe('planner layer (H-3 / H-4 / H-5)', () => {
  const H3 = ['lane', 'search', 'hero-ball', 'orbs', 'mood', 'mixer', 'card:song', 'card:song.visa', 'card:ask', 'card:shift', 'card:link', 'card:voice', 'card:gap', 'card:invite', 'card:import', 'card:coaster', 'card:finale', 'navi-tag', 'dock', 'order', 'record', 'wrap', 'entry-ota', 'lang', 'room-view']

  it('POLICY_MAP covers every H-3 anchor with measures, ways and a resolvable metric', () => {
    for (const a of H3) {
      const e = POLICY_MAP[a]
      expect(e, a).toBeDefined()
      expect(e.policies.length, a).toBeGreaterThan(0)
      for (const p of e.policies) expect(POLICIES).toContain(p)
      for (const w of e.ways) expect(WAYS).toContain(w)
      for (const l of ['ja', 'en'] as const) {
        expect(trIn(e.metric, l)).not.toMatch(/^planner\./)
        if (e.note) expect(trIn(e.note, l)).not.toMatch(/^planner\./)
        expect(trIn({ key: `planner.el.${a}` }, l)).not.toMatch(/^planner\./)
        expect(trIn({ key: `planner.short.${a}` }, l)).not.toMatch(/^planner\./)
        expect(trIn({ key: `planner.here.${a}` }, l)).not.toMatch(/^planner\./)
      }
    }
    expect(POLICY_MAP['orbs'].note && trIn(POLICY_MAP['orbs'].note, 'ja')).toContain('顔認証は構想・未実装')
  })

  it('planner strings: ja and en have the same keys and variables; no competitor, no percentage', () => {
    const d = namespaceStrings('planner') as unknown as { ja: Record<string, string>; en: Record<string, string> }
    const vars = (x: string) => [...x.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort().join(',')
    expect(Object.keys(d.en).sort()).toEqual(Object.keys(d.ja).sort())
    for (const k of Object.keys(d.ja)) expect(vars(d.en[k]), k).toBe(vars(d.ja[k]))
    const all = [...Object.values(d.ja), ...Object.values(d.en)].join('\n')
    for (const rival of ['DAM', 'Spotify', 'YouTube', 'LINE MUSIC']) expect(all).not.toContain(rival)
    expect(all).not.toMatch(/\d\s*%|％/)
  })

  it('measured values come from the store; heat is shown as a hypothesis value', async () => {
    await freshNight('metrics')
    const s = S()
    expect(trIn(measure('card:song', s).main!, 'ja')).toMatch(/計測中 \d+秒/)
    S().act(S().deck.cards[0].id, 'reserve')
    await settle()
    expect(trIn(measure('card:song', S()).main!, 'ja')).toMatch(/^\d+(\.\d)?秒$/)
    expect(trIn(evidenceFor('mood', S())[0], 'ja')).toMatch(/熱 0\.\d\d（仮説値）/)
    expect(trIn(measure('lane', S()).main!, 'ja')).toContain('予約 1曲')
  })

  it('tonight lights only what really happened', async () => {
    await freshNight('tonight')
    expect(tonightLit(S(), 'ja').policies).toEqual([])
    S().act(S().deck.cards[0].id, 'reserve')
    S().memberJoin('jun')
    S().placeOrder('highball')
    await settle()
    const t = tonightLit(S(), 'ja')
    expect(t.policies).toEqual(['5-1', '5-2', '5-3', '5-4'])
    expect(t.ways).toEqual(expect.arrayContaining(['dare', 'hou', 'ren']))
  })
})
