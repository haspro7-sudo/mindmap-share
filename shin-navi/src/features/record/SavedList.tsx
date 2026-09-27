// My Songs (SPEC D-12, 5-3): songs saved on purpose (brought along, taken home from tonight).
// They come back as the first hand of the next visit. Each row can be reserved right here.
import type { MouseEvent } from 'react'
import type { SavedSong } from '../../core/types'
import { naviApi, useNavi } from '../../core/store'
import { reserveAsMe, songColor } from '../../core/actions'
import { bus } from '../../core/events'
import { sound } from '../../core/sound'
import { SongTitle } from '../../core/ui/SongTitle'
import { SONG_BY_ID } from '../../data/songs'
import { useTr } from '../../i18n'
import { palette } from '../../lib/art'
import { R } from './strings'

export function SavedList({ saved }: { saved: SavedSong[] }) {
  const t = R.useT()
  const tr = useTr()
  const queue = useNavi(s => s.room.queue)
  const live = useNavi(s => s.session.phase === 'live')
  const list = [...saved].reverse()
  const reserve = (songId: string, version: SavedSong['version'], e: MouseEvent<HTMLButtonElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const res = reserveAsMe(naviApi, songId, { version, source: 'search' })
    if (!res) return
    sound.play('throw')
    bus.emit({ type: 'fx/flight', from: r, to: 'lane:next', kind: 'reserve', songId, color: songColor(songId) })
  }
  return (
    <ul className="rc-saved">
      {list.map(s => {
        const song = SONG_BY_ID[s.songId]
        if (!song) return null
        const pal = palette(s.songId, song.energy)
        const pos = queue.findIndex(q => q.songId === s.songId)
        return (
          <li key={s.songId} className="rc-saved__row">
            <span className="rc-saved__art" style={{ background: pal.bg }} aria-hidden="true">
              <i style={{ background: pal.a }} />
            </span>
            <div className="rc-saved__txt">
              <SongTitle songId={s.songId} variant="chip" className="rc-saved__title" />
              <span className="rc-saved__meta">
                {song.artist} · {tr({ key: `vocab.version.${s.version}` })} · {t(`saved.from.${s.from}`)}
              </span>
            </div>
            {pos >= 0 ? (
              <span className="rc-saved__pos">{t('face.queued', { n: pos + 1 })}</span>
            ) : (
              <button type="button" className="rc-mini-btn" disabled={!live || !song.reservable} onClick={e => reserve(s.songId, s.version, e)}>
                {t('saved.reserve')}
              </button>
            )}
          </li>
        )
      })}
    </ul>
  )
}
