// Transient signals for effects (SPEC K-6). State lives in the store; events only say "something just happened".
import type {
  ActArg,
  CardAction,
  DeckCard,
  FaceState,
  KnowAnswer,
  KnowView,
  Locale,
  MemberId,
  Mood,
  MoodWordId,
  Order,
  OtherId,
  PinId,
  PresenterCmd,
  QueueItem,
  RoomPrompt,
  SongId,
  SungEntry,
  TextRef,
} from './types'

export type TargetId =
  | 'lane:next'
  | 'lane:insert'
  | 'lane:end'
  | 'dock:record'
  | 'hero:ball'
  | 'room:ball'
  | 'room:lane'
  | 'calendar:today'
  | `face:${string}`
  | `orb:${MemberId}`

export type BurstPreset = 'spark12' | 'prism' | 'pin' | 'stamp' | 'area'

export type NaviEvent =
  | { type: 'card/acted'; card: DeckCard; action: CardAction; arg?: ActArg }
  | { type: 'queue/added'; item: QueueItem; source: 'card' | 'search' | 'member' | 'voice' | 'invite' | 'room' }
  | { type: 'song/started'; item: QueueItem }
  | { type: 'song/ended'; entry: SungEntry }
  | { type: 'turn/soon'; songsAhead: number }
  | { type: 'turn/mine'; item: QueueItem }
  | { type: 'know/asked'; songId: SongId }
  | { type: 'know/answered'; songId: SongId; member: MemberId; a: KnowAnswer; index: number }
  | { type: 'know/complete'; songId: SongId; view: KnowView }
  | { type: 'member/arriving'; id: OtherId }
  | { type: 'member/joined'; id: OtherId }
  | { type: 'member/left'; id: OtherId }
  | { type: 'face/changed'; songId: SongId; from?: FaceState; to: FaceState; note: number }
  | { type: 'link/added'; a: SongId; b: SongId }
  | { type: 'pin/earned'; id: PinId }
  | { type: 'mood/mixed'; mood: Mood }
  | { type: 'heat/changed'; heat: number; word: MoodWordId }
  | { type: 'order/status'; order: Order }
  | { type: 'minutes/left'; m: 15 | 5 | 0 }
  | { type: 'deck/redeal'; cause: TextRef }
  | { type: 'prompt/resolved'; prompt: RoomPrompt; result: SongId | 'end' }
  | { type: 'navi/miss'; songId: SongId }
  | { type: 'locale/changed'; locale: Locale }
  | { type: 'request/sent'; to: OtherId; songId: SongId }
  | { type: 'fx/flight'; from: DOMRectReadOnly; to: TargetId; kind: 'reserve' | 'keep' | 'pass' | 'import' | 'pin'; songId?: SongId; color: string }
  | { type: 'fx/landed'; to: TargetId; songId?: SongId }
  | { type: 'fx/burst'; at: TargetId | { x: number; y: number }; preset: BurstPreset }
  | { type: 'fx/flash'; strength: number }
  | { type: 'presenter/cmd'; cmd: PresenterCmd }
  | { type: 'night/started'; nightId: string; visit: number }
  | { type: 'intro/done' }

type Handler = (e: NaviEvent) => void
const handlers = new Map<NaviEvent['type'], Set<Handler>>()
const anyHandlers = new Set<Handler>()

export const bus = {
  emit(e: NaviEvent): void {
    const set = handlers.get(e.type)
    // Copy so handlers may unsubscribe while running; one failing listener must not break the rest.
    if (set) for (const fn of [...set]) safe(fn, e)
    for (const fn of [...anyHandlers]) safe(fn, e)
  },
  on<T extends NaviEvent['type']>(type: T, fn: (e: Extract<NaviEvent, { type: T }>) => void): () => void {
    let set = handlers.get(type)
    if (!set) handlers.set(type, (set = new Set()))
    set.add(fn as Handler)
    return () => set!.delete(fn as Handler)
  },
  onAny(fn: (e: NaviEvent) => void): () => void {
    anyHandlers.add(fn)
    return () => anyHandlers.delete(fn)
  },
  /** test helper */
  clear(): void {
    handlers.clear()
    anyHandlers.clear()
  },
}

function safe(fn: Handler, e: NaviEvent) {
  try {
    fn(e)
  } catch (err) {
    console.warn('[bus]', e.type, err)
  }
}
