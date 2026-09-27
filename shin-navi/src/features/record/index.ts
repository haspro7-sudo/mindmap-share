// M9 record-wrap — public API (SPEC L/M9): the record tab, the face and night sheets, the wall
// constellation (also shown publicly on the room screen), tonight's recap overlay, the optional
// survey and the night-naming function. Each part lives in its own file; this index re-exports.
import './strings'
import './record.css'

export { RecordScreen } from './RecordScreen'
export { FaceDetailSheet } from './FaceDetailSheet'
export { NightSheet } from './NightSheet'
export { WallConstellation } from './WallConstellation'
export { WrapOverlay } from './Wrap'
export { SurveySheet } from './SurveySheet'
export { nightName } from './nightName'

// ?test=1: let the e2e spec see what this module put on the bus (request/sent has no store trace).
import { params } from '../../core/params'
import { bus } from '../../core/events'
if (params.test && typeof window !== 'undefined') {
  const w = window as unknown as { __recordEvents?: { type: string; to: string; songId: string }[] }
  const log = (w.__recordEvents ??= [])
  bus.on('request/sent', e => {
    log.push({ type: e.type, to: e.to, songId: e.songId })
  })
}
