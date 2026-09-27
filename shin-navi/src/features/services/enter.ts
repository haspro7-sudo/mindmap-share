// Leaving the entrance (S0 → S1, SPEC F-2): the night begins when you walk in, with the full
// intro. When nothing of mine has happened yet, the placeholder night that booted under the
// entrance is replaced by a fresh one (the stage remounts and the whole descent plays). When the
// presenter opened the entrance in the middle of a night, the night is kept and only the
// entrance timeline restarts (the ball replays its descent on its own).
import type { NaviApi } from '../../core/store/types'
import { restartIntro } from '../../core/intro'
import { nightUntouched } from './menu'

export type EntranceMode = 'guest' | 'continue' | 'voucher'

export function enterRoom(api: NaviApi, mode: EntranceMode): 'fresh' | 'resume' {
  const s = api.getState()
  if (nightUntouched(s)) {
    const nightId = s.session.nightId
    const firstVisit = s.session.visit <= 1
    // drop the empty placeholder night so the calendar never shows a night nobody had
    api.setState(st => ({ col: { ...st.col, nights: st.col.nights.filter(n => n.id !== nightId) } }))
    // the new stage reads the intro clock while it renders, so restart it before the remount
    restartIntro()
    // "マイうたの続きから" on a first visit walks in as a returning guest ("おかえり", brought songs)
    api.getState().startNight(mode === 'continue' && firstVisit ? { nextVisit: true } : undefined)
    return 'fresh'
  }
  restartIntro()
  s.setOverlay(null)
  return 'resume'
}
