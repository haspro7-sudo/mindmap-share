// Store contract (SPEC K-4). Seven slices composed into one zustand store.
import type { StoreApi, UseBoundStore } from 'zustand'
import type {
  ActArg,
  AuroraKey,
  CardAction,
  CardKind,
  DeckCard,
  Face,
  FaceEvent,
  FaceMark,
  FaceState,
  ImportCandidate,
  InviteState,
  KnowAnswer,
  KnowTally,
  Link,
  Member,
  MemberId,
  Mood,
  MoodWordId,
  Night,
  NowPlaying,
  Order,
  OtherId,
  OverlayId,
  Pin,
  PinId,
  PrimarySpec,
  QueueItem,
  QueueTag,
  RoomPrompt,
  SavedSong,
  SheetId,
  SongId,
  SungEntry,
  Tab,
  TextRef,
  VersionId,
  ViewMode,
  VoiceReading,
  VoiceTypeId,
  WallMarker,
  WallPoint,
  Bubble,
} from '../types'

export type Phase = 'live' | 'wrap' | 'closed'
export type IntroMode = 'full' | 'short' | 'none'

export type SessionState = {
  nightId: string
  seed: string
  phase: Phase
  intro: IntroMode
  introStartedAt: number
  enteredAt: number
  simMs: number
  speed: 1 | 4 | 8
  audioOn: boolean
  muted: boolean
  noDuck: boolean
  script: boolean
  view: ViewMode | 'auto'
  visit: number
  linked: boolean
}

export type SessionSlice = {
  session: SessionState
  startNight(o?: { seed?: string; nextVisit?: boolean }): void
  /** called by core/clock every 250ms of real time (stopped when the tab is hidden) */
  tick(realDtMs: number): void
  setSpeed(s: 1 | 4 | 8): void
  jumpToMinutesLeft(m: number): void
  markIntroDone(): void
  unlockAudio(): void
  setMuted(m: boolean): void
  setNoDuck(on: boolean): void
  setScript(on: boolean): void
  setView(v: ViewMode | 'auto'): void
  /** phase→wrap, close orders, unlink the shared screen */
  exitRoom(): void
  /** finish the wrap: commit the night, phase→closed */
  closeNight(o: { linked: boolean }): void
  resetAll(): void
}

export type RoomState = {
  members: Record<MemberId, Member>
  heat: number
  trend: -1 | 0 | 1
  mood: Mood
  moodWord: MoodWordId
  queue: QueueItem[]
  now: NowPlaying
  sung: SungEntry[]
  knowing: Record<SongId, KnowTally>
  bubbles: Bubble[]
  prompt: RoomPrompt | null
  invites: InviteState[]
  /** sim ms until which the aurora flows at half speed ("お水・ひと休み") */
  restUntil: number
  /** sim ms when the moodWord 'welcome' / 'back' override ends */
  wordOverrideUntil: number
}

export type ReserveOpts = {
  by?: MemberId
  keyShift?: number
  version?: VersionId
  tags?: QueueTag[]
  insertAt?: number
  with?: MemberId
  source?: 'card' | 'search' | 'member' | 'voice' | 'invite' | 'room'
}

export type RoomSlice = {
  room: RoomState
  memberArrive(id: OtherId): void
  memberJoin(id: OtherId): void
  memberLeave(id: OtherId): void
  reserve(songId: SongId, o?: ReserveOpts): QueueItem
  cancelReserve(itemId: string): void
  moveMine(itemId: string, dir: -1 | 1): void
  startNext(): void
  finishNow(o?: { claps?: number; score?: number }): void
  askRoom(songId: SongId, by?: MemberId): void
  answerKnow(songId: SongId, member: MemberId, a: KnowAnswer): void
  setMood(m: Partial<Mood>): void
  pushBubble(b: Omit<Bubble, 'id' | 'at'>): void
  setMemberVoice(id: MemberId, t: VoiceTypeId): void
  setPrompt(p: RoomPrompt | null): void
  votePrompt(member: MemberId, songId: SongId): void
  agreePrompt(member: MemberId, ok: boolean): void
  openInvite(i: Omit<InviteState, 'id' | 'status' | 'at'>): string
  resolveInvite(id: string, s: InviteState['status']): void
  /** "お水・ひと休み": slow the aurora for one song */
  restOneSong(): void
}

export type OfferLog = {
  coasterRound?: number
  coasterDismissedRound?: number
  coasterAtSim?: number
  finaleDone?: boolean
  importShown?: boolean
  gapRound?: number
  requestRound?: number
  askRound?: number
  twinHalves?: (0 | 1)[]
  duetDone?: boolean
  shiftAtSung?: number
  linkAtReserve?: number
  reservesSinceLink?: number
  voiceForSung?: number
}

export type UndoEntry = {
  card: DeckCard
  action: CardAction
  at: number
  songId?: SongId
  prevFace: Face | null
  queueItemId?: string
  linkAdded?: boolean
  noteAdded?: boolean
  prevFirstReserveMs?: number
  pinAdded?: PinId
}

export type DeckHistoryEntry = { cardId: string; kind: CardKind; action: CardAction; at: number }

export type DeckState = {
  cards: DeckCard[]
  history: DeckHistoryEntry[]
  round: number
  consumedInRound: number
  passStreak: number
  flippedId: string | null
  primary: PrimarySpec | null
  selection: Record<string, SongId>
  undo: UndoEntry | null
  redeal: { at: number; cause: TextRef } | null
  offers: OfferLog
}

export type DealMode = 'append' | 'top' | 'at1' | 'replace'

export type DeckSlice = {
  deck: DeckState
  dealCards(cards: DeckCard[], mode: DealMode, cause?: TextRef): void
  /** delegates to core/actions.ts performCardAction */
  act(cardId: string, a: CardAction, arg?: ActArg): void
  undo(): void
  flip(cardId: string | null): void
  setPrimary(p: PrimarySpec | null): void
  select(cardId: string, songId: SongId): void
  noteOffer(p: Partial<OfferLog>): void
  /** remove a card without recording an action (used by redeal/undo internals) */
  dropCard(cardId: string): void
}

export type CollectionState = {
  faces: Record<SongId, Face>
  links: Link[]
  nights: Night[]
  pins: Pin[]
  voices: VoiceReading[]
  saved: SavedSong[]
  imports: ImportCandidate[]
  passReasons: Record<string, number>
}

export type CollectionSlice = {
  col: CollectionState
  faceEvent(songId: SongId, ev: FaceEvent, o?: { mark?: FaceMark; keyShift?: number }): { from?: FaceState; to?: FaceState }
  addLink(a: SongId, b: SongId): void
  addWallPoint(p: WallPoint): void
  addMarker(m: WallMarker): void
  pushNote(midi: number): void
  earnPin(id: PinId): boolean
  recordVoice(r: VoiceReading): void
  saveSong(songId: SongId, version: VersionId, from: SavedSong['from']): void
  setImport(songId: SongId, s: ImportCandidate['status']): void
  polishFace(songId: SongId): void
  nameNight(name: TextRef): void
  stampNight(): void
  seedPastNights(n: number): void
  notePassReason(r: string): void
  wipe(): void
  /** restore a face exactly (undo) or delete it when prev is null */
  restoreFace(songId: SongId, prev: Face | null): void
  removeLastLink(): void
  popNote(): void
  removePin(id: PinId): void
  /** add a mark to an existing face (no state change) */
  markFace(songId: SongId, mark: FaceMark): void
}

export type OrdersState = { list: Order[]; closed: boolean }
export type OrdersSlice = {
  orders: OrdersState
  placeOrder(menuId: string, o?: { again?: boolean }): { ok: boolean; dup: boolean; order: Order | null }
  advanceOrders(): void
  closeOrders(): void
}

export type Toast = { id: string; text: TextRef; kind: 'undo' | 'info' | 'excuse'; at: number; ttl: number }

export type UiState = {
  tab: Tab
  sheet: { id: SheetId; arg?: unknown } | null
  overlay: OverlayId | null
  toast: Toast | null
  presenter: boolean
  lens: boolean
  split: boolean
  coach: { ghostHand: boolean; mixHint: boolean }
  reduced: boolean
}

export type UiSlice = {
  ui: UiState
  setTab(t: Tab): void
  openSheet(id: SheetId, arg?: unknown): void
  closeSheet(): void
  setOverlay(o: OverlayId | null): void
  toast(t: Omit<Toast, 'id' | 'at'>): void
  dismissToast(): void
  togglePresenter(): void
  toggleLens(): void
  toggleSplit(): void
  coachDone(k: 'ghostHand' | 'mixHint'): void
  setReduced(r: boolean): void
}

export type SurveyAnswers = {
  findEase: 1 | 2 | 3 | 4 | 5
  surprise: 1 | 2 | 3 | 4 | 5
  fun: 1 | 2 | 3 | 4 | 5
  again: 1 | 2 | 3 | 4 | 5
  why: string[]
}

export type MetricsState = {
  firstReserveMs?: number
  shown: Partial<Record<CardKind, number>>
  acted: Partial<Record<CardKind, number>>
  actions: Partial<Record<CardAction, number>>
  co: { shown: number; picked: number }
  tag: { shown: number; picked: number }
  search: { queries: number; misses: number; msToReserve: number[] }
  mo: { placed: number; dupBlocked: number; afterExitBlocked: number }
  voiceToReserve: number
  importSaved: number
  survey?: SurveyAnswers
}

export type MetricsSlice = {
  metrics: MetricsState
  markShown(k: CardKind): void
  markActed(k: CardKind, a: CardAction): void
  logSearch(e: 'query' | 'miss' | 'reserve', ms?: number): void
  submitSurvey(s: SurveyAnswers): void
  resetMetrics(): void
  noteCo(e: 'shown' | 'picked', which: 'co' | 'tag'): void
  noteMo(e: 'placed' | 'dupBlocked' | 'afterExitBlocked'): void
  noteVoiceToReserve(): void
  noteImportSaved(): void
}

export type NaviState = SessionSlice & RoomSlice & DeckSlice & CollectionSlice & OrdersSlice & UiSlice & MetricsSlice
export type NaviApi = StoreApi<NaviState>
export type UseNavi = UseBoundStore<StoreApi<NaviState>>

export type { AuroraKey }
