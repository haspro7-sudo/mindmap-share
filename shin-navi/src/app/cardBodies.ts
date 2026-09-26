// kind → card body component. The only place that knows which feature renders which card.
import type { CardBodyComponent, CardKind } from '../core/types'
import { SongCardBody, AskCardBody, LinkCardBody, BreatherCardBody } from '../features/cards'
import { ShiftCardBody } from '../features/stage'
import { VoiceCardBody } from '../features/voice'
import { GapCardBody } from '../features/ball'
import { InviteCardBody, FinaleCardBody } from '../features/room'
import { ImportCardBody, CoasterCardBody } from '../features/services'

export const CARD_BODIES: Record<CardKind, CardBodyComponent> = {
  song: SongCardBody,
  ask: AskCardBody,
  shift: ShiftCardBody,
  link: LinkCardBody,
  voice: VoiceCardBody,
  gap: GapCardBody,
  invite: InviteCardBody,
  import: ImportCardBody,
  coaster: CoasterCardBody,
  finale: FinaleCardBody,
  breather: BreatherCardBody,
}
