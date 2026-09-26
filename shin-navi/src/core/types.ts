// Shared domain types (SPEC K-3). Feature modules depend on these, never on each other.
import type { Song, Genre, Vibe, Generation, VersionId, Tempo } from '../data/songs'
export type { Song, Genre, Vibe, Generation, VersionId, Tempo }

export type SongId = string
export type Locale = 'ja' | 'en' | 'zhHant' | 'zhHans' | 'ko'
export type MemberId = 'me' | 'minato' | 'saki' | 'jun'
export type OtherId = Exclude<MemberId, 'me'>
export type VoiceTypeId = 'clear' | 'power' | 'groove' | 'emotional'
export type Source = 'dare' | 'tsunagu' | 'yomu' | 'hou' | 'ren' | 'voice'
export type PolicyId = '5-1' | '5-2' | '5-3' | '5-4'

// i18n reference: keep keys, not strings, so a locale switch re-resolves everything.
export type TextVar =
  | string
  | number
  | { song: SongId }
  | { member: MemberId }
  | { genre: Genre }
  | { tempo: Tempo }
  | { locale: Locale }
  | { date: number }
  | { vibe: Vibe }
  | { pair: [VoiceTypeId, VoiceTypeId] }
export type TextRef = { key: string; vars?: Record<string, TextVar> }

// Members
export type Member = {
  id: MemberId
  color: string
  locale: Locale
  generation: Generation
  likes: Partial<Record<Genre, number>>
  voiceType: VoiceTypeId | null
  present: boolean
  arriving: boolean
  joinedAt: number | null
}

// Knowing
export type KnowAnswer = 'know' | 'chorus' | 'none'
export type KnowTally = {
  songId: SongId
  askedAt: number
  by: MemberId
  answers: Partial<Record<MemberId, { a: KnowAnswer; at: number }>>
}
export type KnowView = { dots: ('know' | 'chorus' | 'empty')[]; knows: number; size: number; all: boolean }

// Queue
export type QueueTag = 'navi' | 'request' | 'duet' | 'finale' | 'visa' | 'insert' | 'room'
export type QueueItem = {
  id: string
  songId: SongId
  by: MemberId
  with?: MemberId
  keyShift: number
  version: VersionId
  tags: QueueTag[]
  addedAt: number
}
export type NowPlaying = { item: QueueItem; startedAt: number; durationMs: number } | null
export type SungEntry = {
  item: QueueItem
  endedAt: number
  heatBefore: number
  heatAfter: number
  knowShare: number
  claps: number
  score?: number
}

// Air
export type Companion = 'friends' | 'family' | 'work' | 'date' | 'solo'
export type Mood = { hype: number; fresh: number; companion: Companion; setBy: 'auto' | 'mixer'; setAt: number }
export type MoodWordId = 'blank' | 'loosening' | 'warming' | 'rising' | 'peak' | 'mellow' | 'welcome' | 'back'
export type AuroraKey = 'quiet' | 'mellow' | 'warm' | 'hot'

// Cards
export type CardKind = 'song' | 'ask' | 'shift' | 'link' | 'voice' | 'gap' | 'invite' | 'import' | 'coaster' | 'finale' | 'breather'
export type CardVariant = 'opener' | 'visa' | 'request' | 'twin' | 'duet' | 'welcome'
export type CardFrame =
  | 'portrait'
  | 'passport'
  | 'medallion'
  | 'band'
  | 'constellation'
  | 'arch'
  | 'facet'
  | 'ticket'
  | 'stitch'
  | 'coaster'
  | 'triptych'
  | 'pill'
export type AreaKey = `${Tempo}:${Genre}`
export type Reason = { source: Source; text: TextRef; cause?: TextRef }
export type DirectorTriggerType =
  | 'enter'
  | 'refill'
  | 'reserved'
  | 'memberSongEnded'
  | 'myTurnEnded'
  | 'memberJoined'
  | 'memberLeft'
  | 'minutes15'
  | 'moodMixed'
  | 'passStreak'
  | 'navMiss'
  | 'request'
  | 'twin'
  | 'coaster'
  | 'nextVisit'
export type DirectorTrigger = { type: DirectorTriggerType; songId?: SongId; member?: MemberId; at: number }
export type DeckCard = {
  id: string
  kind: CardKind
  variant?: CardVariant
  songId?: SongId
  options?: SongId[]
  area?: AreaKey
  from?: OtherId
  reason: Reason
  trigger: DirectorTrigger
  rule: string
  dealtAt: number
}
export type CardAction =
  | 'reserve'
  | 'keep'
  | 'pass'
  | 'ask'
  | 'answer'
  | 'flip'
  | 'insert'
  | 'select'
  | 'measure'
  | 'openArea'
  | 'accept'
  | 'decline'
  | 'reveal'
  | 'save'
  | 'showRoom'
  | 'order'
  | 'rest'
  | 'vote'
  | 'putDown'
  | 'oneMore'
export type ActArg = {
  songId?: SongId
  keyShift?: number
  version?: VersionId
  answer?: KnowAnswer
  menuId?: string
  navi?: boolean
  again?: boolean
  passReason?: 'unknown' | 'mood' | 'voice'
  fromRect?: DOMRectReadOnly
}
export type PrimarySpec = { action: CardAction; label: TextRef; enabled: boolean; arg?: ActArg }
export type CardBodyProps = {
  card: DeckCard
  active: boolean
  flipped: boolean
  act: (a: CardAction, arg?: ActArg) => void
  setPrimary: (p: PrimarySpec) => void
}
export type CardBodyComponent = (p: CardBodyProps) => JSX.Element

const FRAMES: Record<CardKind, CardFrame> = {
  song: 'portrait',
  ask: 'medallion',
  shift: 'band',
  link: 'constellation',
  voice: 'arch',
  gap: 'facet',
  invite: 'ticket',
  import: 'stitch',
  coaster: 'coaster',
  finale: 'triptych',
  breather: 'pill',
}
/** Frame per card (SPEC C-7). The shape, not the colour, tells kinds apart. */
export const FRAME_OF = (c: Pick<DeckCard, 'kind' | 'variant'>): CardFrame => (c.kind === 'song' && c.variant === 'visa' ? 'passport' : FRAMES[c.kind])
/** Kinds where a right flick means "keep as a face". */
export const KEEPABLE: ReadonlySet<CardKind> = new Set<CardKind>(['song', 'ask', 'link', 'voice'])

// Collection
export type FaceState = 'sketch' | 'neon' | 'mirror' | 'prism'
export type FaceMark = 'key' | 'stitch' | 'duet' | 'seal' | 'visa' | 'gold' | 'navi' | 'twin'
export type FaceEvent = 'keep' | 'reserve' | 'sung' | 'sungAllKnow' | 'import'
export type Face = {
  songId: SongId
  state: FaceState
  marks: FaceMark[]
  keyShift?: number
  firstNightId: string
  firstAt: number
  sungCount: number
  lastSungAt?: number
  polishedAt?: number
}
export type Link = { a: SongId; b: SongId; nightId: string; at: number }
export type WallMarker = 'shift' | 'toast' | 'navi' | 'allKnow' | 'join'
export type WallPoint = { t: number; heat: number; songId: SongId; by: MemberId; claps: number; markers: WallMarker[] }
export type VoiceReading = {
  nightId: string
  at: number
  type: VoiceTypeId
  power: number
  care: number
  brightness: number
  groove: number
  range: [number, number] | null
  method: 'mic' | 'quiz'
  evidence: TextRef
  suggest?: { songId: SongId; keyShift: number }
}
export type Night = {
  id: string
  startedAt: number
  endedAt?: number
  points: WallPoint[]
  melody: number[]
  facesGained: SongId[]
  shared: SongId[]
  claps: number
  name?: TextRef
  stamped: boolean
  palette: [string, string, string]
  seeded?: boolean
}
export type PinId = 'spark' | 'allKnow' | 'airRead' | 'crossing' | 'harmony' | 'answer' | 'importer' | 'polish' | 'hundred' | 'faces30'
export const PIN_IDS: readonly PinId[] = ['spark', 'allKnow', 'airRead', 'crossing', 'harmony', 'answer', 'importer', 'polish', 'hundred', 'faces30']
export type Pin = { id: PinId; at: number; nightId: string }
export type SavedSong = { songId: SongId; version: VersionId; at: number; from: 'import' | 'face' | 'wrap' }
export type ImportCandidate = { songId: SongId; versions: VersionId[]; status: 'candidate' | 'saved' | 'shown' }

// Orders
export type OrderStatus = 'sending' | 'accepted' | 'preparing' | 'delivered' | 'closed'
export type Order = {
  id: string
  menuId: string
  qty: number
  status: OrderStatus
  idem: string
  createdAt: number
  acceptedAt?: number
  etaAfterSongs: number
}

// UI and room screen
export type ViewMode = 'phone' | 'room' | 'dual'
export type Tab = 'discover' | 'sing' | 'record' | 'order'
export type SheetId = 'search' | 'mixer' | 'voice' | 'import' | 'lang' | 'face' | 'night' | 'survey' | 'exitConfirm'
export type OverlayId = 'standby' | 'wrap' | 'entry'
export type SearchFilters = { genre?: Genre; tempo?: Tempo; decade?: string; lang?: Song['lang']; vibe?: Vibe }
export type Bubble = { id: string; member: MemberId; text: TextRef; at: number; ttl: number }
export type RoomPrompt = {
  id: string
  kind: 'ask' | 'shift' | 'finale' | 'excuse' | 'show'
  songIds: SongId[]
  votes?: Partial<Record<MemberId, SongId>>
  agree?: Partial<Record<MemberId, boolean>>
  at: number
}
export type InviteState = {
  id: string
  variant: 'request' | 'twin' | 'duet'
  from: OtherId
  songId: SongId
  status: 'open' | 'accepted' | 'declined' | 'revealed' | 'secret'
  at: number
}
export type PolicyAnchor = string
export type PresenterCmd =
  | { t: 'next' }
  | { t: 'step'; id: string }
  | { t: 'speed'; v: 1 | 4 | 8 }
  | { t: 'script'; on: boolean }
  | { t: 'join'; id: OtherId }
  | { t: 'leave'; id: OtherId }
  | { t: 'advance' }
  | { t: 'myTurn' }
  | { t: 'finishMine'; score?: number }
  | { t: 'request' }
  | { t: 'twin' }
  | { t: 'coaster' }
  | { t: 'minutesLeft'; m: number }
  | { t: 'exit' }
  | { t: 'nextVisit' }
  | { t: 'seedNights'; n: number }
  | { t: 'view'; v: ViewMode | 'auto' }
  | { t: 'localeCycle' }
  | { t: 'reset' }
