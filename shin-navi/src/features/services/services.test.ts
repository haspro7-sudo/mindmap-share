// M10 services: the order state machine with duplicate protection and the closed room, the
// breather that orders nothing, no rewards for ordering, explicit-only bring-in saves, the
// entrance that walks into a fresh night, strings and the "no Japanese in JSX" rule (G-2/G-3).
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { naviApi } from '../../core/store'
import { performCardAction } from '../../core/actions'
import { bus } from '../../core/events'
import type { DeckCard } from '../../core/types'
import { LOCALE_IDS, namespaceStrings, trIn } from '../../i18n'
import { IMPORT_DEMO } from '../../data/tables'
import { MENU, MENU_BY_ID, MENU_SECTIONS, coasterDrinks, hhmm, isOrderable, nightUntouched, openCountFor, openOrderFor, trackIndex, versionsFor, voucherCode, voucherGrid } from './menu'
import { saveCandidate, showToRoom, SHOW_MS } from './importActions'
import { enterRoom } from './enter'
import './strings'

const S = () => naviApi.getState()

function fresh() {
  // resetAll wipes everything and starts the first night (visit 1)
  S().resetAll()
}

function card(kind: DeckCard['kind'], extra: Partial<DeckCard> = {}): DeckCard {
  return {
    id: `t-${kind}-${Math.random().toString(36).slice(2, 7)}`,
    kind,
    reason: { source: 'ren', text: { key: 'reason.import' } },
    trigger: { type: 'refill', at: 0 },
    rule: 'test',
    dealtAt: Date.now(),
    ...extra,
  }
}

describe('menu (J-5)', () => {
  it('has the eight items, no prices, and the breather among the drinks', () => {
    expect(MENU.map(m => m.id)).toEqual(['highball', 'oolong', 'ginger', 'cola', 'fries', 'karaage', 'water', 'rest'])
    for (const m of MENU) {
      expect(Object.keys(m).sort()).toEqual(['hue', 'id', 'kind', 'name'])
      expect(m.name.key).toBe(`services.menu.${m.id}`)
    }
    expect(MENU_SECTIONS[0].ids).toEqual(expect.arrayContaining(['water', 'rest']))
    expect(isOrderable('rest')).toBe(false)
    expect(isOrderable('water')).toBe(true)
    const all = LOCALE_IDS.flatMap(l => Object.values((namespaceStrings('services') as unknown as Record<string, Record<string, string>>)[l]))
    for (const s of all) expect(s).not.toMatch(/[¥￥$€]\s?\d|\d+\s?円/)
  })

  it('coaster drinks follow the room: three drinks, never water/rest', () => {
    expect(coasterDrinks(0.2)).toHaveLength(3)
    expect(coasterDrinks(0.9)).toContain('cola')
    for (const h of [0, 0.5, 0.7, 1]) for (const id of coasterDrinks(h)) expect(MENU_BY_ID[id].kind).toBe('drink')
  })

  it('formats the venue time as HH:MM', () => {
    const d = new Date(2026, 8, 27, 21, 4)
    expect(hhmm(d.getTime())).toBe('21:04')
    expect(hhmm(undefined)).toBe('--:--')
  })

  it('versions: original first and always offered', () => {
    expect(versionsFor(['karaoke', 'anime'])).toEqual(['original', 'anime', 'karaoke'])
    expect(versionsFor([])).toEqual(['original'])
  })

  it('voucher code and mark are stable per seed', () => {
    expect(voucherCode('test|voucher')).toBe(voucherCode('test|voucher'))
    expect(voucherCode('test|voucher')).toMatch(/^DEMO-[A-Z0-9]{4}$/)
    const g = voucherGrid('DEMO-A2B3')
    expect(g).toHaveLength(441)
    expect(g[0] && g[6] && g[20 - 6] === g[20 - 6]).toBe(true)
  })
})

describe('orders: MO state machine (C-8 ⑨, T08)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    fresh()
  })

  it('sending → accepted HH:MM → preparing → delivered, one song at a time', () => {
    const r = S().placeOrder('highball')
    expect(r.ok).toBe(true)
    expect(S().orders.list[0].status).toBe('sending')
    expect(trackIndex(S().orders.list[0])).toBe(0)
    vi.advanceTimersByTime(1000)
    const o = S().orders.list[0]
    expect(o.status).toBe('accepted')
    expect(hhmm(o.acceptedAt)).toMatch(/^\d\d:\d\d$/)
    expect(trackIndex(o)).toBe(1)
    S().advanceOrders()
    expect(S().orders.list[0].status).toBe('preparing')
    expect(trackIndex(S().orders.list[0])).toBe(2)
    S().advanceOrders()
    expect(S().orders.list[0].status).toBe('delivered')
    expect(trackIndex(S().orders.list[0])).toBe(3)
    vi.useRealTimers()
  })

  it('a re-tap is a duplicate (count stays 1); "one more" adds a second', () => {
    S().placeOrder('cola')
    const dup = S().placeOrder('cola')
    expect(dup.dup).toBe(true)
    expect(S().orders.list).toHaveLength(1)
    expect(S().metrics.mo.dupBlocked).toBe(1)
    expect(openOrderFor(S().orders.list, 'cola')?.id).toBe(dup.order?.id)
    const again = S().placeOrder('cola', { again: true })
    expect(again.ok).toBe(true)
    expect(S().orders.list).toHaveLength(2)
    expect(openCountFor(S().orders.list, 'cola')).toBe(2)
    vi.useRealTimers()
  })

  it('leaving the room closes ordering: open orders close and new ones are blocked', () => {
    S().placeOrder('oolong')
    vi.advanceTimersByTime(1000)
    S().exitRoom()
    expect(S().orders.closed).toBe(true)
    expect(S().orders.list[0].status).toBe('closed')
    expect(trackIndex(S().orders.list[0])).toBe(1)
    const r = S().placeOrder('oolong')
    expect(r.ok).toBe(false)
    expect(S().metrics.mo.afterExitBlocked).toBe(1)
    expect(nightUntouched(S())).toBe(false)
    vi.useRealTimers()
  })

  it('ordering earns nothing: no pin, no face, no note, no stamp', () => {
    const pins = S().col.pins.length
    const melody = S().col.nights.at(-1)!.melody.length
    const c = card('coaster')
    S().dealCards([c], 'top')
    performCardAction(naviApi, c.id, 'order', { menuId: 'highball' })
    performCardAction(naviApi, c.id, 'order', { menuId: 'highball' })
    vi.advanceTimersByTime(1000)
    expect(S().orders.list).toHaveLength(1)
    expect(S().col.pins.length).toBe(pins)
    expect(Object.keys(S().col.faces)).toHaveLength(0)
    expect(S().col.nights.at(-1)!.melody.length).toBe(melody)
    expect(S().col.nights.at(-1)!.stamped).toBe(false)
    // the coaster stays until the user closes it
    expect(S().deck.cards.some(x => x.id === c.id)).toBe(true)
    vi.useRealTimers()
  })

  it('"お水・ひと休み" orders nothing and slows the room for one song', () => {
    const c = card('coaster')
    S().dealCards([c], 'top')
    performCardAction(naviApi, c.id, 'rest')
    expect(S().orders.list).toHaveLength(0)
    expect(S().room.restUntil).toBeGreaterThan(S().session.simMs)
    expect(S().deck.cards.some(x => x.id === c.id)).toBe(false)
    vi.useRealTimers()
  })
})

describe('bring-in (C-8 ⑧)', () => {
  beforeEach(fresh)

  it('candidates wait as candidates: nothing is saved until an explicit save', () => {
    expect(S().col.imports.map(i => i.songId)).toEqual([...IMPORT_DEMO])
    expect(S().col.imports.every(i => i.status === 'candidate')).toBe(true)
    expect(S().col.saved).toHaveLength(0)
  })

  it('saving from the card: version kept, stitch sketch face, one flight from the disc', () => {
    const c = card('import', { songId: IMPORT_DEMO[0], options: [...IMPORT_DEMO] })
    S().dealCards([c], 'top')
    const flights: string[] = []
    const off = bus.on('fx/flight', e => flights.push(`${e.kind}:${e.to}`))
    const el = { getBoundingClientRect: () => ({ left: 10, top: 20, width: 40, height: 40, x: 10, y: 20, right: 50, bottom: 60 }) } as unknown as Element
    saveCandidate(naviApi, 'hakujitsu', 'karaoke', el, c.id)
    off()
    expect(S().col.saved).toEqual([expect.objectContaining({ songId: 'hakujitsu', version: 'karaoke', from: 'import' })])
    expect(S().col.imports.find(i => i.songId === 'hakujitsu')?.status).toBe('saved')
    expect(S().col.faces.hakujitsu.state).toBe('sketch')
    expect(S().col.faces.hakujitsu.marks).toContain('stitch')
    expect(flights).toEqual(['import:face:hakujitsu'])
    // saving the same song again does nothing
    saveCandidate(naviApi, 'hakujitsu', 'original', el, c.id)
    expect(S().col.saved).toHaveLength(1)
  })

  it('saving from the sheet without a card does the same store work; three saves earn the pin', () => {
    for (const id of IMPORT_DEMO.slice(0, 3)) saveCandidate(naviApi, id, 'original', null)
    expect(S().col.saved.map(x => x.songId)).toEqual(IMPORT_DEMO.slice(0, 3))
    expect(S().metrics.importSaved).toBe(3)
    expect(S().col.pins.map(p => p.id)).toContain('importer')
  })

  it('the import card closes with "done" (decline) without touching anything else', () => {
    const c = card('import', { songId: IMPORT_DEMO[0], options: [...IMPORT_DEMO] })
    S().dealCards([c], 'top')
    const pins = S().col.pins.length
    performCardAction(naviApi, c.id, 'decline')
    expect(S().deck.cards.some(x => x.id === c.id)).toBe(false)
    expect(S().col.saved).toHaveLength(0)
    expect(S().col.pins.length).toBe(pins)
    expect(S().deck.passStreak).toBe(0)
  })

  it('shows one title on the room screen for ten seconds, never over a room vote', () => {
    vi.useFakeTimers()
    expect(showToRoom(naviApi, 'ditto')).toBe(true)
    expect(S().room.prompt).toEqual(expect.objectContaining({ kind: 'show', songIds: ['ditto'] }))
    vi.advanceTimersByTime(SHOW_MS + 10)
    expect(S().room.prompt).toBeNull()
    S().setPrompt({ id: 'p-fin', kind: 'finale', songIds: ['marigold'], votes: {}, at: Date.now() })
    expect(showToRoom(naviApi, 'ditto')).toBe(false)
    expect(S().room.prompt?.kind).toBe('finale')
    vi.useRealTimers()
  })
})

describe('entrance (S0 → S1)', () => {
  beforeEach(fresh)

  it('walking in replaces the untouched placeholder night with a fresh one (full intro)', () => {
    S().setOverlay('entry')
    const before = S().session.nightId
    const nights = S().col.nights.length
    expect(nightUntouched(S())).toBe(true)
    expect(enterRoom(naviApi, 'guest')).toBe('fresh')
    expect(S().ui.overlay).toBeNull()
    expect(S().session.nightId).not.toBe(before)
    expect(S().session.intro === 'full' || S().session.intro === 'none').toBe(true)
    expect(S().session.visit).toBe(1)
    expect(S().col.nights).toHaveLength(nights)
    expect(S().col.nights.some(n => n.id === before)).toBe(false)
  })

  it('"continue from My Songs" on a first visit walks in as a returning guest', () => {
    S().setOverlay('entry')
    enterRoom(naviApi, 'continue')
    expect(S().session.visit).toBe(2)
    expect(S().room.moodWord).toBe('back')
  })

  it('opened mid-night (presenter), it keeps the night and just closes', () => {
    S().placeOrder('water')
    S().setOverlay('entry')
    const id = S().session.nightId
    expect(enterRoom(naviApi, 'voucher')).toBe('resume')
    expect(S().session.nightId).toBe(id)
    expect(S().ui.overlay).toBeNull()
    expect(S().orders.list).toHaveLength(1)
  })
})

describe('strings (G-3)', () => {
  it('services has every key in five locales with matching variables', () => {
    const ns = namespaceStrings('services') as unknown as Record<string, Record<string, string>>
    const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort().join(',')
    for (const l of LOCALE_IDS) for (const k of Object.keys(ns.ja)) expect(vars(ns[l][k]), `${l}.${k}`).toBe(vars(ns.ja[k]))
  })

  it('uses the spec wording for the key phrases', () => {
    expect(trIn({ key: 'services.dup', vars: { time: '21:14' } }, 'ja')).toBe('同じ注文は受付済み（21:14）')
    expect(trIn({ key: 'services.dup', vars: { time: '21:14' } }, 'ko')).toBe('같은 주문은 이미 접수됨 (21:14)')
    expect(trIn({ key: 'services.order.price' }, 'ja')).toBe('価格は店舗の表示に従います（デモ）')
    expect(trIn({ key: 'services.entry.mock' }, 'ja')).toBe('模擬。実際の予約・決済にはつながりません')
    expect(trIn({ key: 'services.order.etaCard', vars: { n: 2 } }, 'ja')).toBe('今頼むと2曲後に届く目安（デモ）')
    // the show button: the words plus a small "10秒" chip (so no locale truncates it, ROBUST#12)
    expect(trIn({ key: 'services.import.show' }, 'ja')).toBe('この1曲だけ部屋に見せる')
    expect(trIn({ key: 'services.import.showSec' }, 'ja')).toBe('10秒')
  })

  it('says "1 song", not "1 songs" (singular .one siblings in every locale, ROBUST#16)', () => {
    const ns = namespaceStrings('services') as unknown as Record<string, Record<string, string>>
    const counted = Object.keys(ns.ja).filter(k => !k.endsWith('.one') && /\{n\}/.test(ns.en[k]) && /songs|guests/.test(ns.en[k]))
    expect(counted.length).toBeGreaterThan(4)
    for (const k of counted) for (const l of LOCALE_IDS) expect(ns[l][`${k}.one`], `${l}.${k}.one`).toBeTypeOf('string')
    expect(trIn({ key: 'services.order.eta', vars: { n: 1 } }, 'en')).toBe('Arrives in about 1 song')
    expect(trIn({ key: 'services.order.eta', vars: { n: 2 } }, 'en')).toBe('Arrives in about 2 songs')
    expect(trIn({ key: 'services.order.etaCard', vars: { n: 1 } }, 'en')).toBe('Order now and it arrives in about 1 song (demo)')
    expect(trIn({ key: 'services.import.cardLead', vars: { n: 1 } }, 'en')).toBe('1 favorite to sing here')
    expect(trIn({ key: 'services.ota.peopleN', vars: { n: 1 } }, 'en')).toBe('1 guest')
    expect(trIn({ key: 'services.order.eta', vars: { n: 1 } }, 'ja')).toBe('1曲後に届く目安')
  })

  it('card fronts stay short: the import lead fits one line (card-front contract)', () => {
    for (const l of LOCALE_IDS) {
      const lead = trIn({ key: 'services.import.cardLead', vars: { n: 5 } }, l)
      expect(lead.length, `${l}: ${lead}`).toBeLessThanOrEqual(l === 'en' ? 26 : 18)
    }
  })

  it('never uses streak, scarcity, countdown or reward words (D-15)', () => {
    const ns = namespaceStrings('services') as unknown as Record<string, Record<string, string>>
    for (const l of LOCALE_IDS)
      for (const s of Object.values(ns[l])) {
        expect(s).not.toMatch(/知らない|連続|残り|期間限定|今だけ|ポイント|特典|streak|limited time|reward|points/i)
      }
  })
})

describe('no Japanese literals in this module’s components (G-2)', () => {
  const files = import.meta.glob('./*.tsx', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
  it('has component files to check', () => expect(Object.keys(files).length).toBeGreaterThanOrEqual(7))
  for (const [name, src] of Object.entries(files)) {
    it(name, () => {
      expect(src).not.toMatch(/[　-ヿ㐀-鿿＀-￯]/)
    })
  }
})
