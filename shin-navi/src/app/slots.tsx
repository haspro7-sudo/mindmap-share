// Which feature component fills which sheet / overlay slot. Assembled here (app/ is the only
// layer allowed to import feature modules) and handed to SheetHost / OverlayHost by the shells.
import type { OverlayId, SheetId } from '../core/types'
import type { ReactNode } from 'react'
import { SearchSheet, MoodMixer, LangSheet } from '../features/search'
import { VoiceSheet } from '../features/voice'
import { ImportSheet, EntryScreen } from '../features/services'
import { FaceDetailSheet, NightSheet, SurveySheet, WrapOverlay } from '../features/record'
import { Standby } from '../features/stage'
import { MirrorBall } from '../features/ball'
import { ExitConfirm } from './ExitConfirm'
import type { SheetDef } from './SheetHost'

export const PHONE_SHEETS: Partial<Record<SheetId, SheetDef>> = {
  search: { C: SearchSheet, full: true },
  mixer: { C: MoodMixer },
  lang: { C: LangSheet },
  voice: { C: VoiceSheet, private: true },
  import: { C: ImportSheet, private: true },
  face: { C: FaceDetailSheet, private: true },
  night: { C: NightSheet, private: true },
  survey: { C: SurveySheet, private: true },
  exitConfirm: { C: ExitConfirm },
}

/** The shared room screen only offers public sheets. */
export const ROOM_SHEETS: Partial<Record<SheetId, SheetDef>> = {
  search: { C: SearchSheet, full: true },
  mixer: { C: MoodMixer },
  lang: { C: LangSheet },
}

export const OVERLAYS: Partial<Record<OverlayId, () => ReactNode>> = {
  standby: () => <Standby ball={<MirrorBall variant="standby" />} />,
  wrap: () => <WrapOverlay renderBall={o => <MirrorBall variant="wrap" flashSongIds={o.flashSongIds} />} />,
  entry: () => <EntryScreen />,
}
