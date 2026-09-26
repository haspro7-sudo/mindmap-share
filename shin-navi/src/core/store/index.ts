// The single zustand store composed from seven slices (SPEC K-4).
import { create } from 'zustand'
import type { NaviApi, NaviState, UseNavi } from './types'
import { createSessionSlice } from './session'
import { createRoomSlice } from './room'
import { createDeckSlice } from './deck'
import { createCollectionSlice } from './collection'
import { createOrdersSlice, createUiSlice, createMetricsSlice } from './misc'

export const useNavi: UseNavi = create<NaviState>()((...a) => ({
  ...createSessionSlice(...a),
  ...createRoomSlice(...a),
  ...createDeckSlice(...a),
  ...createCollectionSlice(...a),
  ...createOrdersSlice(...a),
  ...createUiSlice(...a),
  ...createMetricsSlice(...a),
}))

/** Same store, typed as the plain StoreApi for installers and tests. */
export const naviApi: NaviApi = useNavi

export type { NaviState, NaviApi } from './types'
export { presentMembers, presentIds, isMine } from './room'
