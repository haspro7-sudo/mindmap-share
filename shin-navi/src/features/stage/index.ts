// M6 stage — public API (SPEC L/M6): the lane, the floor lights, the mood word, the spotlight,
// the sing tab, stage standby, the room screen's board and sidebar, the dual seam and the
// shift card body. Everything is split into its own file; this index only re-exports.
import './strings'
import './stage.css'

export { StageLane } from './StageLane'
export { FlowLine } from './FlowLine'
export { MemberOrbs } from './MemberOrbs'
export { MoodWord } from './MoodWord'
export { Spotlight } from './Spotlight'
export { StageScreen } from './StageScreen'
export { Standby } from './Standby'
export { RoomBoard } from './RoomBoard'
export { RoomSidebar } from './RoomSidebar'
export { Seam } from './Seam'
export { ShiftCardBody } from './ShiftCardBody'

// ?test=1: let the e2e spec drive the drag preview (fxState.drag) without real gestures.
import { params } from '../../core/params'
import { fxState } from '../../core/fxState'
if (params.test && typeof window !== 'undefined') {
  ;(window as unknown as { __stageFx?: typeof fxState }).__stageFx = fxState
}
