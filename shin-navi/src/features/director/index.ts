// M4 director-planner (SPEC L/M4): the dealer that decides what the user sees next, and the
// planner layer (policy lens + comparison split) for the pitch room.
import './strings'

export { deal, type DirectorInput, type DirectorOutput } from './deal'
export { installDirector } from './installDirector'
export { staticList } from './staticList'
export { POLICY_MAP } from './policyMap'
export { PolicyLens } from './PolicyLens'
export { SplitView } from './SplitView'
