// Fresh-state builders shared by slices, startNight and resetAll.
import { MEMBER_PROFILES } from '../../data/members'
import type { Member, MemberId, Night } from '../types'
import type { DeckState, MetricsState, OrdersState, RoomState, SessionState, UiState, CollectionState } from './types'
import { AURORA_PALETTES } from '../rules'

let counter = 0
/** Unique ids for queue items, cards, toasts… (not part of seeded behaviour). */
export function uid(prefix: string): string {
  counter = (counter + 1) % 1e9
  return `${prefix}-${Date.now().toString(36)}-${counter.toString(36)}`
}

export function todayKey(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`
}

export function freshMembers(): Record<MemberId, Member> {
  const mk = (id: MemberId, present: boolean, arriving: boolean): Member => {
    const p = MEMBER_PROFILES[id]
    return { id, color: p.color, locale: p.locale, generation: p.generation, likes: { ...p.likes }, voiceType: p.voiceType, present, arriving, joinedAt: present ? 0 : null }
  }
  return { me: mk('me', true, false), minato: mk('minato', true, false), saki: mk('saki', true, false), jun: mk('jun', false, true) }
}

export function freshSession(seed: string, visit: number, nightId: string): SessionState {
  return {
    nightId,
    seed,
    phase: 'live',
    intro: 'full',
    introStartedAt: Date.now(),
    enteredAt: Date.now(),
    simMs: 0,
    speed: 1,
    audioOn: false,
    muted: false,
    noDuck: false,
    script: false,
    view: 'auto',
    visit,
    linked: false,
  }
}

export function freshRoom(): RoomState {
  return {
    members: freshMembers(),
    heat: 0.2,
    trend: 0,
    mood: { hype: 0.5, fresh: 0.4, companion: 'friends', setBy: 'auto', setAt: 0 },
    moodWord: 'blank',
    queue: [],
    now: null,
    sung: [],
    knowing: {},
    bubbles: [],
    prompt: null,
    invites: [],
    restUntil: 0,
    wordOverrideUntil: 0,
  }
}

export function freshDeck(): DeckState {
  return {
    cards: [],
    history: [],
    round: 1,
    consumedInRound: 0,
    passStreak: 0,
    flippedId: null,
    primary: null,
    selection: {},
    undo: null,
    redeal: null,
    offers: {},
  }
}

export function freshCollection(): CollectionState {
  return { faces: {}, links: [], nights: [], pins: [], voices: [], saved: [], imports: [], passReasons: {} }
}

export function freshOrders(): OrdersState {
  return { list: [], closed: false }
}

export function freshUi(): UiState {
  return {
    tab: 'discover',
    sheet: null,
    overlay: null,
    toast: null,
    presenter: false,
    lens: false,
    split: false,
    coach: { ghostHand: false, mixHint: false },
    reduced: false,
  }
}

export function freshMetrics(): MetricsState {
  return {
    shown: {},
    acted: {},
    actions: {},
    co: { shown: 0, picked: 0 },
    tag: { shown: 0, picked: 0 },
    search: { queries: 0, misses: 0, msToReserve: [] },
    mo: { placed: 0, dupBlocked: 0, afterExitBlocked: 0 },
    voiceToReserve: 0,
    importSaved: 0,
  }
}

export function freshNight(id: string): Night {
  return { id, startedAt: Date.now(), points: [], melody: [], facesGained: [], shared: [], claps: 0, stamped: false, palette: [...AURORA_PALETTES.quiet] as [string, string, string] }
}
