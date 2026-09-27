// Link card body (SPEC C-8 4): a constellation. The face of the song just reserved sits at the
// top; three lines of light run to three mini cards that are "picked together" with it
// (co-occurrence, shown apart from tag picks — that note lives on the evidence side). Tapping a
// mini card selects it and thickens its line; the first one is selected from the start.
// Primary: link & reserve (or "keep on the ball" while I am over my fair share). Right: keep it.
// Layout rows never overlap (ROBUST#10): label · face · "just reserved" line · tiles · reason.
import { useEffect } from 'react'
import { motion } from 'motion/react'
import type { CardBodyComponent, CardBodyProps, SongId } from '../../../core/types'
import { naviApi, useNavi } from '../../../core/store'
import { selReserveBudget } from '../../../core/selectors'
import { KnowDots } from '../../../core/ui/KnowDots'
import { SongTitle } from '../../../core/ui/SongTitle'
import { SONG_BY_ID, GENRES } from '../../../data/songs'
import { palette } from '../../../lib/art'
import { useBox } from '../../../core/layout'
import { ReasonLine } from '../CardShell'
import { FRAMES } from '../frames'
import { S } from '../strings'
import { BudgetLine } from './SongCardBody'

function areaColor(songId?: SongId): string {
  const g = songId ? SONG_BY_ID[songId]?.genre : undefined
  const i = g ? Math.max(0, GENRES.indexOf(g)) : 0
  return `hsl(${(330 + 30 * i) % 360} 85% 62%)`
}

function Mini({ songId, on, onPick, x, y, w, h }: { songId: SongId; on: boolean; onPick: () => void; x: number; y: number; w: number; h: number }) {
  const song = SONG_BY_ID[songId]
  const asked = useNavi(s => !!s.room.knowing[songId])
  const pal = palette(songId, song?.energy ?? 0.5)
  if (!song) return null
  return (
    <motion.button
      type="button"
      className={`lmini${on ? ' is-on' : ''}`}
      style={{ left: x - w / 2, top: y - h / 2, width: w, height: h }}
      animate={{ y: on ? -5 : 0, scale: on ? 1.05 : 1 }}
      transition={{ type: 'spring', stiffness: 420, damping: 24 }}
      whileTap={{ scale: 0.96 }}
      onClick={onPick}
      aria-pressed={on}
      data-testid="link-option"
      data-song-id={songId}
    >
      <span className="lmini__art" style={{ background: pal.bg }} />
      <span className="lmini__ring" aria-hidden="true" />
      <span className="lmini__text">
        <SongTitle songId={songId} variant="chip" className="lmini__title" />
        <span className="lmini__artist">{song.artist}</span>
      </span>
      {asked ? (
        <span className="lmini__dots">
          <KnowDots songId={songId} size={6} />
        </span>
      ) : null}
    </motion.button>
  )
}

/** Row geometry in card pixels (normal 332×296, small 304×260). */
export function linkLayout(small: boolean) {
  const { w, h } = small ? FRAMES.constellation.small : FRAMES.constellation.size
  const center = { x: w / 2, y: small ? 54 : 62 }
  const fromTop = center.y + (small ? 26 : 30)
  const fromH = 22
  const mw = small ? 84 : 94
  const mh = small ? 90 : 104
  const tilesTop = fromTop + fromH + (small ? 8 : 10)
  const sideY = tilesTop + mh / 2
  const midY = sideY + (small ? 10 : 14)
  const spots = [
    { x: w * 0.2, y: sideY },
    { x: w * 0.5, y: midY },
    { x: w * 0.8, y: sideY },
  ]
  return { w, h, center, fromTop, fromH, mw, mh, spots, tilesBottom: midY + mh / 2 }
}

function LinkBody({ card, setPrimary }: CardBodyProps) {
  const t = S.useT()
  const box = useBox()
  const small = box.h < 760 || box.w < 375
  const opts = (card.options ?? []).slice(0, 3)
  const sel = useNavi(s => s.deck.selection[card.id])
  const pick = sel ?? opts[0]
  const over = useNavi(s => selReserveBudget(s).over)
  const pending = useNavi(s => selReserveBudget(s).pending)
  const pickQueued = useNavi(s => !!pick && (s.room.queue.some(q => q.songId === pick) || s.room.now?.item.songId === pick))
  const keepMode = over && !pickQueued

  useEffect(() => {
    if (!sel && opts[0]) naviApi.getState().select(card.id, opts[0])
  }, [card.id])

  useEffect(() => {
    if (keepMode) setPrimary({ action: 'keep', label: S.ref('keepBall'), enabled: !!pick, arg: { songId: pick } })
    else setPrimary({ action: 'reserve', label: S.ref('linkReserve'), enabled: !!pick && !!SONG_BY_ID[pick]?.reservable, arg: { songId: pick } })
  }, [card.id, pick, keepMode])

  const L = linkLayout(small)
  const { center, mh, spots } = L
  const centerSong = card.songId ? SONG_BY_ID[card.songId] : undefined
  return (
    <div className="link" data-keep-mode={keepMode ? '1' : '0'}>
      <svg className="link__lines" width={L.w} height={L.h} viewBox={`0 0 ${L.w} ${L.h}`} aria-hidden="true">
        {opts.map((id, i) => {
          const p = spots[i]
          const on = id === pick
          const x0 = center.x + (i - 1) * 10
          const y0 = center.y + 16
          const d = `M${x0},${y0} Q${(x0 + p.x) / 2 + (i - 1) * 18},${(y0 + p.y) / 2 - 18} ${p.x},${p.y - mh / 2 + 4}`
          return (
            <g key={id}>
              <path d={d} className="link__line" />
              <motion.path d={d} className="link__line link__line--on" initial={false} animate={{ opacity: on ? 1 : 0 }} transition={{ duration: 0.25 }} />
              <motion.path d={d} className="link__line link__line--halo" initial={false} animate={{ opacity: on ? 0.6 : 0 }} transition={{ duration: 0.25 }} />
            </g>
          )
        })}
      </svg>
      <div className="link__center" style={{ left: center.x - 22, top: center.y - 22, ['--area' as string]: areaColor(card.songId) }}>
        <span className="link__face" aria-hidden="true" />
      </div>
      {centerSong ? (
        <div className="link__from" data-testid="link-from" style={{ top: L.fromTop, height: L.fromH }}>
          <span className="link__fromk">{t('link.from')}</span>
          <SongTitle songId={centerSong.id} variant="chip" className="link__fromt" />
        </div>
      ) : null}
      {opts.map((id, i) => (
        <Mini key={id} songId={id} on={id === pick} onPick={() => naviApi.getState().select(card.id, id)} x={spots[i].x} y={spots[i].y} w={L.mw} h={mh} />
      ))}
      <div className="link__foot">{keepMode && !card.reason.cause ? <BudgetLine n={pending} className="link__reason" /> : <ReasonLine reason={card.reason} className="link__reason" />}</div>
    </div>
  )
}

export const LinkCardBody: CardBodyComponent = p => <LinkBody {...p} />
