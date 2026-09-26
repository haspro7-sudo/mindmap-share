// ?test=1 exposes the store for Playwright (SPEC K-10).
import type { NaviApi, NaviState } from './store/types'
import type { PresenterCmd } from './types'
import { bus } from './events'

declare global {
  interface Window {
    __navi?: { get: () => NaviState; api: NaviApi; fire(cmd: PresenterCmd): void; soundLog: string[] }
  }
}

export function installTestHook(api: NaviApi): void {
  const soundLog = window.__navi?.soundLog ?? []
  window.__navi = {
    get: () => api.getState(),
    api,
    fire: (cmd: PresenterCmd) => bus.emit({ type: 'presenter/cmd', cmd }),
    soundLog,
  }
}
