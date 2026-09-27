// "Show just this song to the room (10 s)" (SPEC C-8 #8, E-12). While the title is up on the
// shared screen, a thin bar drains under the label (no numbers); when the room screen is busy
// with something everyone is doing together, it waits.
import { naviApi, useNavi } from '../../core/store'
import type { SongId } from '../../core/types'
import { showToRoom, SHOW_MS } from './importActions'
import { S } from './strings'

export function ShowRoomButton({ songId, cardId, className, disabled }: { songId: SongId | undefined; cardId?: string; className?: string; disabled?: boolean }) {
  const t = S.useT()
  const promptId = useNavi(s => (s.room.prompt?.kind === 'show' ? s.room.prompt.id : null))
  const showingSong = useNavi(s => (s.room.prompt?.kind === 'show' ? s.room.prompt.songIds[0] ?? null : null))
  const shownAt = useNavi(s => (s.room.prompt?.kind === 'show' ? s.room.prompt.at : 0))
  const busy = useNavi(s => !!s.room.prompt && s.room.prompt.kind !== 'show')
  const on = !!songId && showingSong === songId
  const elapsed = on ? Math.min(SHOW_MS, Math.max(0, Date.now() - shownAt)) : 0
  return (
    <button
      type="button"
      className={`imp-show${on ? ' is-on' : ''}${className ? ` ${className}` : ''}`}
      data-testid="import-show"
      disabled={disabled || !songId || busy || (!!showingSong && !on)}
      onClick={() => songId && showToRoom(naviApi, songId, cardId)}
    >
      <span className="imp-show__icon" aria-hidden="true">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <rect x="1.5" y="2.5" width="13" height="8.5" rx="1.6" />
          <path d="M5.5 14h5M8 11v3" />
        </svg>
      </span>
      <span className="imp-show__text">{on ? t('import.showing') : busy ? t('import.showBusy') : t('import.show')}</span>
      {on ? <span key={promptId ?? ''} className="imp-show__bar" style={{ animationDuration: `${SHOW_MS}ms`, animationDelay: `-${elapsed}ms` }} aria-hidden="true" /> : null}
    </button>
  )
}
