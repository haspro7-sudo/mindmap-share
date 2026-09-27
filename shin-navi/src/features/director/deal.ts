// The dealer (SPEC C-9, C-2, C-3, C-10, C-11). A pure function: same input → same output.
// It decides what the user sees next — the "dynamic reading" a static list cannot give:
//   · round 1 follows the entrance order (opener → link after a reserve → ask → gap → import →
//     request → song/visa → breather), later rounds rotate through the kinds with budgets;
//   · room events insert cards by priority (finale > voice > redeal > shift > navMiss > link >
//     invite > coaster), and every event-inserted card says why (reason.cause);
//   · diversity: never the same kind twice in a row, ≥3 kinds in any 5, ≤2 songs in any 4;
//   · the first three cards follow LOCALE_OPENERS for the viewing language (5-1).
import type {
  CardAction,
  CardKind,
  DeckCard,
  DirectorTrigger,
  Face,
  ImportCandidate,
  InviteState,
  KnowTally,
  Link,
  Locale,
  Member,
  MemberId,
  Mood,
  NowPlaying,
  OtherId,
  QueueItem,
  Reason,
  SavedSong,
  Song,
  SongId,
  SungEntry,
  TextRef,
  VoiceReading,
} from '../../core/types'
import type { OfferLog } from '../../core/store/types'
import { gapAreas, SIM_MS_PER_ROOM_MIN } from '../../core/rules'
import { SONG_BY_ID } from '../../data/songs'
import { LOCALE_OPENERS } from '../../data/tables'
import { namespaceStrings } from '../../i18n'
import { hashString } from '../../lib/rng'
import {
  areaSongs,
  expectedShare,
  jitter,
  lastMineSong,
  memberById,
  pickAsk,
  pickDuetSong,
  pickFinale,
  pickLinkOptions,
  pickOpener,
  pickRecover,
  pickRequest,
  pickShift,
  pickSong,
  pickVisa,
  songReason,
  vibeFor,
  type ShiftCause,
} from './selectSongs'

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

/** The hand always shows the top card plus two peeking edges. */
export const MIN_HAND = 3
/** Songs acted on in the last RECENT cards are not dealt again yet. */
const RECENT = 10
/** Discovery cards per round; the breather follows the seventh. */
export const ROUND_SIZE = 7
/** Kinds that count toward the round (mirrors core/actions). */
export const DISCOVERY: ReadonlySet<CardKind> = new Set<CardKind>(['song', 'ask', 'shift', 'link', 'voice', 'gap', 'invite', 'import'])

const NOOP: DirectorOutput = { cards: [], mode: 'append' }
const ref = (key: string, vars?: TextRef['vars']): TextRef => (vars ? { key, vars } : { key })
const causeOf = (key: string, vars?: TextRef['vars']): TextRef => ref(`cause.${key}`, vars)

// ---------------------------------------------------------------- card ids
// Ids carry kind, variant and song/area ("d~song.visa~zankoku~…") so that the deck history — which
// only keeps card ids — still tells the dealer what was shown, passed and dealt this round.

export function parseCardId(id: string): { kv: string; key: string } | null {
  const p = id.split('~')
  return p.length >= 4 && p[0] === 'd' ? { kv: p[1], key: p[2] } : null
}
const kvOf = (c: Pick<DeckCard, 'kind' | 'variant'>) => (c.variant ? `${c.kind}.${c.variant}` : c.kind)

// ---------------------------------------------------------------- diversity (C-9)

/** Can `k` follow `seq` (breathers already removed)? */
export function fits(seq: readonly CardKind[], k: CardKind): boolean {
  if (k === 'breather') return true
  if (seq.length && seq[seq.length - 1] === k) return false
  if (k === 'song' && seq.slice(-3).filter(x => x === 'song').length >= 2) return false
  const win = [...seq.slice(-4), k]
  if (win.length === 5 && new Set(win).size < 3) return false
  return true
}

/** Every C-9 diversity violation in a sequence of kinds (used by the tests and the lens). */
export function diversityViolations(kinds: readonly CardKind[]): string[] {
  const seq = kinds.filter(k => k !== 'breather')
  const out: string[] = []
  for (let i = 0; i < seq.length; i++) if (!fits(seq.slice(0, i), seq[i])) out.push(`${i}:${seq.slice(Math.max(0, i - 4), i + 1).join('>')}`)
  return out
}

// ---------------------------------------------------------------- context

type Ctx = {
  input: DirectorInput
  hand: DeckCard[]
  /** acted kinds tonight, breathers removed (the sequence the user has already walked) */
  tail: CardKind[]
  /** kind.variant acted in the current round (history since the last breather) */
  roundKinds: string[]
  exclude: Set<SongId>
  passed: Set<SongId>
  offers: Partial<OfferLog>
  n: number
  stamp: string
}

function makeCtx(input: DirectorInput): Ctx {
  const hist = input.deck.history
  let lastBreather = -1
  for (let i = hist.length - 1; i >= 0; i--)
    if (hist[i].kind === 'breather') {
      lastBreather = i
      break
    }
  const exclude = new Set<SongId>()
  const passed = new Set<SongId>()
  // passed songs stay out all night; other songs rest for a while, then may come back with what
  // the room has learned since ("この部屋の3人全員が知ってる" after an ask, a kept face…)
  hist.forEach((h, i) => {
    const p = parseCardId(h.cardId)
    if (!p?.key || !SONG_BY_ID[p.key]) return
    if (h.action === 'pass') passed.add(p.key)
    if (h.action === 'pass' || i >= hist.length - RECENT) exclude.add(p.key)
  })
  for (const p of passed) exclude.add(p)
  for (const q of input.room.queue) exclude.add(q.songId)
  for (const e of input.room.sung) exclude.add(e.item.songId)
  if (input.room.now) exclude.add(input.room.now.item.songId)
  for (const c of input.deck.cards) {
    if (c.songId) exclude.add(c.songId)
    for (const o of c.options ?? []) exclude.add(o)
  }
  const roundKinds = hist.slice(lastBreather + 1).map(h => parseCardId(h.cardId)?.kv ?? h.kind)
  return {
    input,
    hand: input.deck.cards.slice(),
    tail: hist.map(h => h.kind).filter(k => k !== 'breather'),
    roundKinds,
    exclude,
    passed,
    offers: {},
    n: 0,
    stamp: `${input.now.toString(36)}.${(hashString(input.trigger.type) % 1296).toString(36)}${hist.length.toString(36)}`,
  }
}

function mk(ctx: Ctx, part: Omit<DeckCard, 'id' | 'trigger' | 'dealtAt'>, offersOptions = true): DeckCard {
  const key = part.songId ?? part.area ?? ''
  if (part.songId) ctx.exclude.add(part.songId)
  // a gap card's songs are only a preview of the area, not an offer: they stay dealable
  if (offersOptions) for (const o of part.options ?? []) ctx.exclude.add(o)
  return { ...part, id: `d~${kvOf(part)}~${key}~${ctx.stamp}${(ctx.n++).toString(36)}`, trigger: ctx.input.trigger, dealtAt: ctx.input.now }
}

const withCause = (r: Reason, cause?: TextRef): Reason => (cause ? { ...r, cause } : r)

const at = (ctx: Ctx) => ctx.input.trigger.at
const round = (ctx: Ctx) => ctx.input.deck.round
const offer = <K extends keyof OfferLog>(ctx: Ctx, k: K): OfferLog[K] => (k in ctx.offers ? ctx.offers[k] : ctx.input.deck.offers[k]) as OfferLog[K]
const present = (ctx: Ctx, id: MemberId) => ctx.input.room.present.some(m => m.id === id)
/** A roommate who reads another language (Jun): the reason visa cards exist mid-night. */
const visitor = (ctx: Ctx): Member | null => ctx.input.room.present.find(m => m.id !== 'me' && m.locale !== 'ja') ?? null
const energies = (ctx: Ctx) => ctx.input.room.sung.map(e => SONG_BY_ID[e.item.songId]?.energy ?? 0.5)
const isMineItem = (i: QueueItem) => i.by === 'me' || i.with === 'me'
const myReserveCount = (ctx: Ctx) =>
  ctx.input.room.queue.filter(isMineItem).length + (ctx.input.room.now && isMineItem(ctx.input.room.now.item) ? 1 : 0) + ctx.input.room.sung.filter(e => isMineItem(e.item)).length

export function isPeak3(sungEnergies: number[]): boolean {
  const l = sungEnergies.slice(-3)
  return l.length === 3 && l.every(e => e >= 0.8)
}
export function isMellow2(sungEnergies: number[]): boolean {
  const l = sungEnergies.slice(-2)
  return l.length === 2 && l.every(e => e < 0.5)
}

// ---------------------------------------------------------------- builders

function songCard(ctx: Ctx, s: Song, rule: string, cause?: TextRef, avoidReason?: string): DeckCard {
  return mk(ctx, { kind: 'song', songId: s.id, reason: withCause(songReason(ctx.input, s, avoidReason), cause), rule })
}

function visaCard(ctx: Ctx, s: Song, loc: Locale, rule: string, cause?: TextRef): DeckCard {
  return mk(ctx, { kind: 'song', variant: 'visa', songId: s.id, reason: withCause({ source: 'hou', text: ref('reason.visa', { locale: { locale: loc } }) }, cause), rule })
}

function buildAsk(ctx: Ctx, rule: string, welcome: Member | null, cause?: TextRef): DeckCard | null {
  const s = pickAsk(ctx.input, ctx.exclude, ctx.passed, welcome)
  if (!s) return null
  const text = welcome ? ref('reason.welcome', { member: { member: welcome.id } }) : ref('reason.ask')
  return mk(ctx, { kind: 'ask', ...(welcome ? { variant: 'welcome' as const } : {}), songId: s.id, reason: withCause({ source: 'dare', text }, cause), rule })
}

function buildGap(ctx: Ctx, rule: string, cause?: TextRef): DeckCard | null {
  const areas = gapAreas(ctx.input.me.faces, ctx.input.songs)
  if (!areas.length) return null
  const shown = new Set(ctx.input.deck.history.filter(h => h.kind === 'gap').map(h => parseCardId(h.cardId)?.key))
  for (const c of [...ctx.input.deck.cards, ...ctx.hand]) if (c.kind === 'gap') shown.add(c.area)
  // one of the three largest dark areas not offered yet, chosen by the night's seed
  const fresh = areas.filter(a => !shown.has(a)).slice(0, 3)
  const pool = fresh.length ? fresh : areas
  const area = pool[Math.floor(jitter(ctx.input.seed, `gap|${ctx.tail.length}|${ctx.input.deck.round}`, 1) * pool.length) % pool.length]
  const [tempo, genre] = area.split(':') as [Song['tempo'], Song['genre']]
  return mk(ctx, { kind: 'gap', area, options: areaSongs(ctx.input, tempo, genre), reason: withCause({ source: 'yomu', text: ref('reason.gap', { tempo: { tempo }, genre: { genre } }) }, cause), rule }, false)
}

function buildImport(ctx: Ctx, rule: string): DeckCard | null {
  const cands = ctx.input.me.imports.filter(i => i.status === 'candidate' && SONG_BY_ID[i.songId])
  if (!cands.length) return null
  const ids = cands.map(c => c.songId)
  const card = mk(ctx, { kind: 'import', songId: ids[0], options: ids, reason: { source: 'ren', text: ref('reason.import') }, rule })
  ctx.offers.importShown = true
  return card
}

function buildRequest(ctx: Ctx, rule: string): DeckCard | null {
  if (Object.keys(ctx.input.me.faces).length < 2) return null
  const saki = memberById(ctx.input, 'saki')
  if (!saki) return null
  const s = pickRequest(ctx.input, saki, ctx.exclude)
  if (!s) return null
  ctx.offers.requestRound = round(ctx)
  return mk(ctx, { kind: 'invite', variant: 'request', from: 'saki', songId: s.id, reason: { source: 'dare', text: ref('reason.request', { member: { member: 'saki' }, song: { song: s.id } }) }, rule })
}

function buildDuet(ctx: Ctx, rule: string): DeckCard | null {
  const mine = ctx.input.me.voice?.type
  if (!mine || offer(ctx, 'duetDone')) return null
  const partner = ctx.input.room.present.filter(m => m.id !== 'me' && m.voiceType).sort((a, b) => hashString(`${ctx.input.seed}|duet|${a.id}`) - hashString(`${ctx.input.seed}|duet|${b.id}`))[0]
  if (!partner?.voiceType) return null
  const s = pickDuetSong(ctx.input, ctx.exclude, ctx.passed, mine)
  if (!s) return null
  ctx.offers.duetDone = true
  return mk(ctx, {
    kind: 'invite',
    variant: 'duet',
    from: partner.id as OtherId,
    songId: s.id,
    reason: { source: 'voice', text: ref('reason.duet', { member: { member: partner.id }, pair: { pair: [mine, partner.voiceType] } }) },
    rule,
  })
}

/** Centre of a "つながる" card: my latest reservation, else my latest kept face. */
function linkCenter(ctx: Ctx): SongId | undefined {
  const mine = lastMineSong(ctx.input)
  if (mine) return mine
  const kept = Object.values(ctx.input.me.faces).sort((a, b) => b.firstAt - a.firstAt)[0]
  return kept?.songId ?? ctx.input.room.now?.item.songId ?? ctx.input.room.sung.at(-1)?.item.songId
}

function buildLink(ctx: Ctx, rule: string, center: SongId | undefined, cause?: TextRef): DeckCard | null {
  if (!center) return null
  const options = pickLinkOptions(ctx.input, center, ctx.exclude, ctx.passed)
  if (options.length < 2) return null
  const card = mk(ctx, { kind: 'link', songId: center, options, reason: withCause({ source: 'tsunagu', text: ref('reason.co', { song: { song: center } }) }, cause), rule })
  // the centre is my own song: it is not "offered" again, but it may still anchor later links
  return card
}

function coasterDue(ctx: Ctx, posInRound: number, roundNo: number): boolean {
  if (posInRound < 5 || posInRound > ROUND_SIZE) return false
  if (offer(ctx, 'coasterRound') === roundNo) return false
  if (offer(ctx, 'coasterDismissedRound') === roundNo - 1) return false
  const last = offer(ctx, 'coasterAtSim') ?? 0
  return isPeak3(energies(ctx)) || at(ctx) - last >= 20 * SIM_MS_PER_ROOM_MIN
}

function buildCoaster(ctx: Ctx, rule: string, roundNo: number, cause?: TextRef): DeckCard {
  ctx.offers.coasterRound = roundNo
  ctx.offers.coasterAtSim = at(ctx)
  return mk(ctx, { kind: 'coaster', reason: withCause({ source: 'yomu', text: ref('reason.coaster') }, cause), rule })
}

function buildBreather(ctx: Ctx): DeckCard {
  return mk(ctx, { kind: 'breather', reason: { source: 'yomu', text: ref('reason.breather') }, rule: 'round.breather.after7' })
}

// ---------------------------------------------------------------- choosing the next discovery card

type Slot = { roundNo: number; pos: number; kinds: string[] }

/** Round 1 after the first three: import → request → song (visa when a visitor is here). */
const ROUND1_TEMPLATE = ['ask', 'gap', 'import', 'invite.request', 'song'] as const

function lastSongReason(planned: DeckCard[]): string | undefined {
  for (let i = planned.length - 1; i >= 0; i--) if (planned[i].kind === 'song') return planned[i].reason.text.key
  return undefined
}

/** Choose and build the card for the next position. `planned` is the whole hand before it. */
function nextDiscovery(ctx: Ctx, seq: CardKind[], slot: Slot, planned: DeckCard[], cause?: TextRef, rulePrefix = 'refill'): DeckCard {
  const has = (kv: string) => slot.kinds.includes(kv) || slot.kinds.some(k => k.startsWith(kv + '.'))
  const vis = visitor(ctx)
  const visaLoc: Locale | null = ctx.input.locale !== 'ja' ? ctx.input.locale : vis?.locale ?? null
  const j = (k: string, amp = 0.6) => jitter(ctx.input.seed, `kind|${k}|${ctx.tail.length}|${slot.pos}|${slot.roundNo}|${planned.length}`, amp)
  const r = `${rulePrefix}.r${slot.roundNo}`

  type Cand = { kind: CardKind; score: number; build: () => DeckCard | null }
  const cands: Cand[] = []
  const song = (): DeckCard | null => {
    const s = pickSong(ctx.input, ctx.exclude, ctx.passed, `${slot.roundNo}.${slot.pos}.${planned.length}`)
    return s ? songCard(ctx, s, `${r}.song`, cause, lastSongReason(planned)) : null
  }
  const visa = (): DeckCard | null => {
    if (!visaLoc) return null
    const s = pickVisa(ctx.input, ctx.exclude, ctx.passed, visaLoc, vis, `${slot.roundNo}.${slot.pos}`)
    return s ? visaCard(ctx, s, visaLoc, `${r}.visa`, cause) : null
  }
  const ask = (): DeckCard | null => {
    const c = buildAsk(ctx, `${r}.ask`, null, cause)
    if (c) ctx.offers.askRound = slot.roundNo
    return c
  }
  const gap = (): DeckCard | null => {
    const c = buildGap(ctx, `${r}.gap`, cause)
    if (c) ctx.offers.gapRound = slot.roundNo
    return c
  }
  const link = (): DeckCard | null => (planned.some(c => c.kind === 'link') ? null : buildLink(ctx, `${r}.link`, linkCenter(ctx), cause))
  const request = (): DeckCard | null => (offer(ctx, 'requestRound') === slot.roundNo || !present(ctx, 'saki') ? null : buildRequest(ctx, `${r}.request`))
  const imports = (): DeckCard | null => {
    const shownCount = ctx.input.deck.history.filter(h => h.kind === 'import').length + planned.filter(c => c.kind === 'import').length
    if (slot.roundNo === 1 ? offer(ctx, 'importShown') : shownCount >= 2) return null
    return buildImport(ctx, `${r}.import`)
  }

  // Round 1 follows the entrance order until the template is used up.
  if (slot.roundNo === 1) {
    const songs = slot.kinds.filter(k => k === 'song' || k.startsWith('song.')).length
    for (const step of ROUND1_TEMPLATE) {
      if (step === 'song' ? songs >= 2 : has(step)) continue
      const kind = step.split('.')[0] as CardKind
      if (!fits(seq, kind)) break
      const c =
        step === 'ask' ? ask() : step === 'gap' ? gap() : step === 'import' ? imports() : step === 'invite.request' ? request() : vis && !has('song.visa') ? visa() ?? song() : song()
      if (c) return c
    }
  }

  const unused = (kv: string) => !has(kv)
  if (coasterDue(ctx, slot.pos, slot.roundNo) && ctx.input.room.sung.length > 0)
    cands.push({ kind: 'coaster', score: 6 + j('coaster'), build: () => buildCoaster(ctx, `${r}.coaster`, slot.roundNo, isPeak3(energies(ctx)) ? causeOf('peak3') : cause) })
  cands.push({ kind: 'song', score: 4.5 + j('song'), build: song })
  if (visaLoc && unused('song.visa')) cands.push({ kind: 'song', score: 5 + j('visa'), build: visa })
  // Saki's requests belong to the room sim; the dealer only stands in while the sim sends none
  const simRequests = ctx.input.room.invites.some(i => i.variant === 'request')
  if (present(ctx, 'saki') && offer(ctx, 'requestRound') !== slot.roundNo && !simRequests) cands.push({ kind: 'invite', score: 4.7 + j('request'), build: request })
  if (ctx.input.me.voice && !offer(ctx, 'duetDone')) cands.push({ kind: 'invite', score: 4.6 + j('duet'), build: () => buildDuet(ctx, `${r}.duet`) })
  cands.push({ kind: 'ask', score: (offer(ctx, 'askRound') === slot.roundNo || has('ask') ? 1.2 : 4.4) + j('ask'), build: ask })
  cands.push({ kind: 'gap', score: (offer(ctx, 'gapRound') === slot.roundNo || has('gap') ? 1.0 : 4.2) + j('gap'), build: gap })
  cands.push({ kind: 'import', score: 3.9 + j('import'), build: imports })
  cands.push({ kind: 'link', score: (has('link') ? 1.4 : 3.6) + j('link'), build: link })
  cands.sort((a, b) => b.score - a.score)

  for (const c of cands) {
    if (!fits(seq, c.kind)) continue
    const card = c.build()
    if (card) return card
  }
  // Nothing fits (should not happen): the least-bad available card.
  for (const c of cands) {
    const card = c.build()
    if (card) return card
  }
  return song() ?? mk(ctx, { kind: 'breather', reason: { source: 'yomu', text: ref('reason.breather') }, rule: 'fallback.breather' })
}

/** Where the hand stands in the round: the round number, position and kinds dealt so far. */
function slotAfter(ctx: Ctx, cards: DeckCard[]): Slot {
  let roundNo = round(ctx)
  let pos = ctx.input.deck.consumedInRound
  let kinds = ctx.roundKinds.slice()
  for (const c of cards) {
    if (c.kind === 'breather') {
      roundNo += 1
      pos = 0
      kinds = []
      continue
    }
    kinds.push(kvOf(c))
    if (DISCOVERY.has(c.kind)) pos += 1
  }
  return { roundNo, pos: pos + 1, kinds }
}

const seqOf = (ctx: Ctx, cards: DeckCard[]) => [...ctx.tail, ...cards.map(c => c.kind).filter(k => k !== 'breather')]

/** Append cards after `base` until the hand has `target` cards (breather after every 7th). */
function extend(ctx: Ctx, base: DeckCard[], target: number, cause?: TextRef, rulePrefix?: string): DeckCard[] {
  const out: DeckCard[] = []
  let guard = 0
  while (base.length + out.length < target && guard++ < 12) {
    const all = [...base, ...out]
    const slot = slotAfter(ctx, all)
    const breatherAhead = all.some(c => c.kind === 'breather')
    if (!breatherAhead && slot.pos > ROUND_SIZE) {
      out.push(buildBreather(ctx))
      continue
    }
    out.push(nextDiscovery(ctx, seqOf(ctx, all), slot, all, cause, rulePrefix))
  }
  return out
}

/**
 * Keep `fixed` in place, then order `flex` greedily — earliest listed first, as long as the
 * whole hand satisfies the diversity rules. Cards that fit nowhere are dropped (the refill
 * replaces them), except `must` cards (events), which are placed as early as they can be.
 * The breather is re-placed right after the round's seventh discovery card.
 */
function arrange(ctx: Ctx, fixed: DeckCard[], flex: DeckCard[], must: ReadonlySet<DeckCard> = new Set(), eventFirst = false): DeckCard[] {
  const out = fixed.slice()
  const breather = [...fixed, ...flex].find(c => c.kind === 'breather')
  let rest = flex.filter(c => c.kind !== 'breather')
  const placeBreather = () => {
    if (out.some(c => c.kind === 'breather')) return
    const pos = ctx.input.deck.consumedInRound + out.filter(c => DISCOVERY.has(c.kind)).length
    if (pos >= ROUND_SIZE) out.push(breather ?? buildBreather(ctx))
  }
  // a strong event (finale, voice, shift) goes on top even when the round is complete
  if (!eventFirst) placeBreather()
  while (rest.length) {
    const seq = seqOf(ctx, out)
    let i = rest.findIndex(c => fits(seq, c.kind))
    if (i < 0) i = rest.findIndex(c => must.has(c))
    if (i < 0) break
    out.push(rest[i])
    rest = rest.filter((_, k) => k !== i)
    placeBreather()
  }
  return out
}

// ---------------------------------------------------------------- events

/** How strongly a card holds its place at the front against a newer event (C-9 priority). */
const RANK: [string, number][] = [
  ['insert.finale', 8],
  // a toast the presenter cues (script step 9) is asked for right now: it goes on top
  ['insert.coaster.cue', 7.5],
  ['insert.voice', 7],
  ['insert.shift', 5],
  ['insert.recover', 4],
  ['insert.link', 3],
  ['insert.invite', 2],
  ['insert.coaster', 1],
]
export const rankOf = (c: Pick<DeckCard, 'rule'>): number => RANK.find(([p]) => c.rule.startsWith(p))?.[1] ?? 0

/**
 * Insert an event card by priority: 'top' events go first, 'next' events right behind the card
 * the user is looking at. Earlier events with a higher priority stay in front. When the rules
 * forbid a spot (e.g. a second voice card right after the last one), the card slides back.
 */
function place(ctx: Ctx, card: DeckCard, where: 'top' | 'next'): DeckCard[] {
  // the newer event replaces an older card of its kind (one request per sender at a time)
  const same = (c: DeckCard) => c.kind === card.kind && (c.kind !== 'invite' || (c.variant === card.variant && c.from === card.from))
  const hand = ctx.hand.filter(c => !same(c) || c.kind === 'song')
  const r = rankOf(card)
  let i = 0
  while (i < hand.length && rankOf(hand[i]) > r) i++
  const head = hand.slice(0, i)
  const must = new Set([card, ...head])
  // replacing the card on top (e.g. a newer request from the same sender) takes its place
  const replacesTop = !!ctx.hand[0] && ctx.hand[0].kind !== 'song' && same(ctx.hand[0])
  if (where === 'top' || !hand.length || replacesTop) return arrange(ctx, [], [...head, card, ...hand.slice(i)], must, where === 'top' && r >= 5)
  const top = hand[0]
  return arrange(ctx, [top], [...head.filter(c => c !== top), card, ...hand.slice(i).filter(c => c !== top)], must)
}

function enter(ctx: Ctx): DirectorOutput {
  const input = ctx.input
  const loc = input.locale
  const cards: DeckCard[] = []
  const rows = LOCALE_OPENERS[loc] ?? LOCALE_OPENERS.ja
  const rule = loc === 'ja' ? 'enter' : `enter.locale.${loc}`
  rows.forEach((row, i) => {
    if (row.kind === 'gap') {
      const g = buildGap(ctx, `${rule}.gap`)
      if (g) cards.push(g)
      return
    }
    const given = row.songId && SONG_BY_ID[row.songId]?.reservable && !ctx.exclude.has(row.songId) ? SONG_BY_ID[row.songId] : null
    if (row.kind === 'ask') {
      if (given) cards.push(mk(ctx, { kind: 'ask', songId: given.id, reason: { source: 'dare', text: ref('reason.ask') }, rule: `${rule}.ask` }))
      else {
        const a = buildAsk(ctx, `${rule}.ask`, null)
        if (a) cards.push(a)
      }
      return
    }
    if (row.variant === 'visa') {
      const s = given ?? pickVisa(input, ctx.exclude, ctx.passed, loc, null, `enter.${i}`)
      if (s) cards.push(visaCard(ctx, s, loc, `${rule}.visa`))
      return
    }
    const s = given ?? pickOpener(input, ctx.exclude, ctx.passed)
    if (s) cards.push(mk(ctx, { kind: 'song', variant: 'opener', songId: s.id, reason: { source: 'yomu', text: ref('reason.opener') }, rule: `${rule}.opener` }))
  })
  // next visit: the songs I brought home last time come back in the first hand (B-5, C-4)
  if (input.trigger.type === 'nextVisit') {
    const brought = input.me.saved.map(x => SONG_BY_ID[x.songId]).find(s => s?.reservable && !ctx.exclude.has(s.id))
    if (brought) cards.splice(Math.min(2, cards.length), 0, mk(ctx, { kind: 'song', songId: brought.id, reason: { source: 'ren', text: ref('reason.brought') }, rule: 'enter.brought' }))
  }
  ctx.offers.askRound = 1
  if (cards.some(c => c.kind === 'gap')) ctx.offers.gapRound = 1
  const more = extend(ctx, cards, MIN_HAND)
  return { cards: [...cards, ...more], mode: 'append', offers: ctx.offers }
}

function refill(ctx: Ctx): DirectorOutput {
  const cards = extend(ctx, ctx.hand, MIN_HAND)
  return cards.length ? { cards, mode: 'append', offers: ctx.offers } : NOOP
}

/** "あなたが予約した" → つながる, at most once per two reservations (C-8 ④). */
function afterReserve(ctx: Ctx): DirectorOutput {
  const center = ctx.input.trigger.songId
  if (!center) return NOOP
  // reserving from a "つながる" card already was the connection: no second link right after it
  if (ctx.tail[ctx.tail.length - 1] === 'link') return NOOP
  const mine = myReserveCount(ctx)
  const last = offer(ctx, 'linkAtReserve')
  if (last != null && mine - last < 2) return NOOP
  const card = buildLink(ctx, 'insert.link.afterReserve', center, causeOf('reserved', { song: { song: center } }))
  if (!card) return NOOP
  ctx.offers.linkAtReserve = mine
  return { cards: place(ctx, card, 'top'), mode: 'replace', offers: ctx.offers }
}

export function shiftCause(input: Pick<DirectorInput, 'room'>): ShiftCause | null {
  const e = input.room.sung.map(x => SONG_BY_ID[x.item.songId]?.energy ?? 0.5)
  if (isMellow2(e)) return 'mellow2'
  if (isPeak3(e)) return 'peak3'
  const m = input.room.mood
  if (m.setBy === 'mixer' && m.setAt > 0) {
    const since = input.room.sung.filter(x => x.endedAt >= m.setAt).length
    if (since >= 1 && since <= 1) return 'mixed'
  }
  return null
}

/** A roommate's song ended: 空気の変わり目 when the flow calls for it (C-8 ③). */
function memberSongEnded(ctx: Ctx): DirectorOutput {
  const sung = ctx.input.room.sung
  const last = sung[sung.length - 1]
  if (!last || isMineItem(last.item)) return NOOP
  const cause = shiftCause(ctx.input)
  if (!cause) return NOOP
  const prev = offer(ctx, 'shiftAtSung')
  if (prev != null && sung.length - prev < 2) return NOOP
  const sh = pickShift(ctx.input, ctx.exclude, ctx.passed, cause)
  if (!sh) return NOOP
  const card = mk(ctx, { kind: 'shift', songId: sh.pick, options: [sh.ride.id, sh.change.id], reason: { source: 'yomu', text: ref('reason.shift'), cause: causeOf(cause) }, rule: `insert.shift.${cause}` })
  ctx.offers.shiftAtSung = sung.length
  return { cards: place(ctx, card, 'top'), mode: 'replace', offers: ctx.offers }
}

/** My song ended: 今夜の声 on top, once per song (C-8 ⑤). */
function myTurnEnded(ctx: Ctx): DirectorOutput {
  const n = ctx.input.room.sung.length
  if (offer(ctx, 'voiceForSung') === n) return NOOP
  const v = ctx.input.me.voice
  const suggest = v?.suggest?.songId && !ctx.exclude.has(v.suggest.songId) ? v.suggest.songId : undefined
  const card = mk(ctx, {
    kind: 'voice',
    ...(suggest ? { songId: suggest } : {}),
    reason: { source: 'voice', text: ref(v ? 'reason.voiceFit' : 'reason.voice'), cause: causeOf('myTurn') },
    rule: 'insert.voice.myTurn',
  })
  ctx.offers.voiceForSung = n
  return { cards: place(ctx, card, 'top'), mode: 'replace', offers: ctx.offers }
}

/**
 * 合流・退出・ミキサー: re-read the whole hand (C-11). Finale and voice cards keep their place;
 * pending invites stay (a request is personal and never silently dropped). The songs of the old
 * hand are left out so the change is visible.
 */
function redeal(ctx: Ctx): DirectorOutput {
  const t = ctx.input.trigger
  const member = t.member && t.member !== 'me' ? memberById(ctx.input, t.member as OtherId) : null
  const cause =
    t.type === 'memberJoined' ? causeOf('joined', { member: { member: t.member ?? 'jun' } }) : t.type === 'memberLeft' ? causeOf('left', { member: { member: t.member ?? 'jun' } }) : causeOf('mixed')
  const keep = ctx.hand.filter(c => c.kind === 'finale' || c.kind === 'voice')
  const invites = ctx.hand.filter(c => c.kind === 'invite')
  // the dealer starts from a clean slate for this hand
  ctx.hand = [...keep]
  const first: DeckCard[] = []
  const prefix = `redeal.${t.type === 'memberJoined' ? 'joined' : t.type === 'memberLeft' ? 'left' : 'mixed'}`
  if (t.type === 'memberJoined' && member) {
    // the newcomer reads another language → a visa card for them on top (C-11 ④)
    const vis = member.locale !== 'ja' ? member : null
    const s = vis ? pickVisa(ctx.input, ctx.exclude, ctx.passed, vis.locale, vis, 'join') : pickSong(ctx.input, ctx.exclude, ctx.passed, 'join')
    if (s) first.push(vis ? visaCard(ctx, s, vis.locale, `${prefix}.visa`, cause) : songCard(ctx, s, `${prefix}.song`, cause))
    const w = buildAsk(ctx, `${prefix}.welcome`, member, cause)
    if (w) first.push(w)
    ctx.offers.askRound = round(ctx)
  } else if (fits(ctx.tail, 'song')) {
    // the re-read song for the new air on top
    const s = pickSong(ctx.input, ctx.exclude, ctx.passed, `${prefix}.${ctx.input.room.mood.hype.toFixed(2)}.${ctx.input.room.mood.fresh.toFixed(2)}`)
    if (s)
      first.push(
        t.type === 'moodMixed'
          ? mk(ctx, { kind: 'song', songId: s.id, reason: { source: 'yomu', text: ref('reason.flow', { vibe: { vibe: vibeFor(ctx.input, s) } }), cause }, rule: `${prefix}.song` })
          : songCard(ctx, s, `${prefix}.song`, cause),
      )
  }
  // C-11: on a join the visa card for the newcomer is the new top (after a pending finale/voice)
  let hand =
    t.type === 'memberJoined' && !keep.length && first[0]
      ? arrange(ctx, [first[0]], [...first.slice(1), ...invites])
      : arrange(ctx, [], [...keep, ...first, ...invites], new Set([...keep, ...first.slice(0, 1)]))
  const more = extend(ctx, hand, Math.max(MIN_HAND, keep.length + MIN_HAND), cause, prefix)
  // every card of the new hand says why it is here (the kept finale/voice/invites keep theirs)
  hand = [...hand, ...more].map(c => (keep.includes(c) || invites.includes(c) || c.reason.cause ? c : { ...c, reason: { ...c.reason, cause } }))
  return { cards: hand, mode: 'replace', cause, offers: ctx.offers }
}

/** 残り15分: 締めの1曲 on top, once a night (C-8 ⑩). */
function minutes15(ctx: Ctx): DirectorOutput {
  if (offer(ctx, 'finaleDone') || ctx.hand.some(c => c.kind === 'finale')) return NOOP
  const opts = pickFinale(ctx.input, ctx.exclude, ctx.passed)
  if (opts.length < 2) return NOOP
  const card = mk(ctx, {
    kind: 'finale',
    songId: opts[0].id,
    options: opts.map(s => s.id),
    reason: { source: 'dare', text: ref('reason.finale', { n: ctx.input.room.present.length }), cause: causeOf('minutes15') },
    rule: 'insert.finale.minutes15',
  })
  ctx.offers.finaleDone = true
  return { cards: place(ctx, card, 'top'), mode: 'replace', offers: ctx.offers }
}

/** ナビの読み違い: the song most people know, next (E-11). */
function navMiss(ctx: Ctx): DirectorOutput {
  const s = pickRecover(ctx.input, ctx.exclude, ctx.passed)
  if (!s) return NOOP
  const card = mk(ctx, { kind: 'song', songId: s.id, reason: { source: 'dare', text: ref('reason.recover'), cause: causeOf('navMiss') }, rule: 'insert.recover.navMiss' })
  return { cards: place(ctx, card, 'next'), mode: 'replace', offers: ctx.offers }
}

/** An invite opened by the room (request / twin / duet) becomes the next card. */
function invite(ctx: Ctx): DirectorOutput {
  const t = ctx.input.trigger
  const inv = ctx.input.room.invites.find(i => i.status === 'open' && i.songId === t.songId && (!t.member || i.from === t.member))
  if (!inv || !SONG_BY_ID[inv.songId]) return NOOP
  if (ctx.hand.some(c => c.kind === 'invite' && c.variant === inv.variant && c.songId === inv.songId)) return NOOP
  const from = inv.from
  let reason: Reason
  if (inv.variant === 'request') {
    reason = { source: 'dare', text: ref('reason.request', { member: { member: from }, song: { song: inv.songId } }), cause: causeOf('request', { member: { member: from } }) }
    ctx.offers.requestRound = round(ctx)
  } else if (inv.variant === 'twin') {
    // the partner stays anonymous until both reveal (E-7): the reason never names them
    reason = { source: 'dare', text: ref('reason.twin') }
    const half: 0 | 1 = ctx.input.room.minutesLeft > 45 ? 0 : 1
    ctx.offers.twinHalves = [...(offer(ctx, 'twinHalves') ?? []), half]
  } else {
    const mine = ctx.input.me.voice?.type ?? 'clear'
    const theirs = ctx.input.room.present.find(m => m.id === from)?.voiceType ?? 'clear'
    reason = { source: 'voice', text: ref('reason.duet', { member: { member: from }, pair: { pair: [mine, theirs] } }) }
    ctx.offers.duetDone = true
  }
  const card = mk(ctx, { kind: 'invite', variant: inv.variant, from, songId: inv.songId, reason, rule: `insert.invite.${inv.variant}` })
  return { cards: place(ctx, card, 'next'), mode: 'replace', offers: ctx.offers }
}

/** The best real cause for a toast suggestion that the presenter forces (script step 9). */
function coasterCause(ctx: Ctx): TextRef {
  const e = energies(ctx)
  if (isPeak3(e)) return causeOf('peak3')
  const last = ctx.input.room.sung[ctx.input.room.sung.length - 1]
  if (last && isMineItem(last.item)) return causeOf('myTurn')
  if (isMellow2(e)) return causeOf('mellow2')
  const cause = namespaceStrings('cause') as unknown as { ja?: Record<string, string> } | undefined
  if (cause?.ja?.interval) return causeOf('interval')
  if (!ctx.input.room.sung.length) return causeOf('enter')
  return ctx.input.room.heat >= 0.55 ? causeOf('peak3') : causeOf('mellow2')
}

function forcedCoaster(ctx: Ctx): DirectorOutput {
  const card = buildCoaster(ctx, 'insert.coaster.cue', round(ctx), coasterCause(ctx))
  return { cards: place(ctx, card, 'top'), mode: 'replace', offers: ctx.offers }
}

// ---------------------------------------------------------------- entry point

export function deal(input: DirectorInput): DirectorOutput {
  const ctx = makeCtx(input)
  switch (input.trigger.type) {
    case 'enter':
    case 'nextVisit':
      return enter(ctx)
    case 'reserved':
      return afterReserve(ctx)
    case 'memberSongEnded':
      return memberSongEnded(ctx)
    case 'myTurnEnded':
      return myTurnEnded(ctx)
    case 'memberJoined':
    case 'memberLeft':
    case 'moodMixed':
      return redeal(ctx)
    case 'minutes15':
      return minutes15(ctx)
    case 'navMiss':
      return navMiss(ctx)
    case 'request':
    case 'twin':
      return invite(ctx)
    case 'coaster':
      return forcedCoaster(ctx)
    case 'refill':
    case 'passStreak':
    default:
      return refill(ctx)
  }
}

/** Songs a card offers (top song or options), for the split view and the lens. */
export function cardSongs(c: DeckCard): SongId[] {
  return [...(c.songId ? [c.songId] : []), ...(c.options ?? []).filter(o => o !== c.songId)]
}

export { expectedShare }
