// A bring-in candidate as a translucent silver disc (SPEC C-8 #8). Saved discs keep the song's
// colour and a stitched ring: the same colour they took on when they flew to the ball.
import { motion } from 'motion/react'
import { forwardRef, type CSSProperties } from 'react'
import type { SongId } from '../../core/types'
import { SONG_BY_ID } from '../../data/songs'
import { palette } from '../../lib/art'
import { SPRING } from '../../core/ui/motion'

export type DiscProps = {
  songId: SongId
  size: number
  selected: boolean
  saved: boolean
  /** bump to play the "turns into colour" flash at the moment of saving */
  flash?: number
  showing?: boolean
  reduced?: boolean
  /** on save, a coloured ghost of the disc lifts out toward the ball (used inside the sheet) */
  rise?: boolean
  onClick?: () => void
  label?: string
  testid?: string
}

export const Disc = forwardRef<HTMLButtonElement, DiscProps>(function Disc({ songId, size, selected, saved, flash = 0, showing, reduced, rise, onClick, label, testid = 'import-candidate' }, ref) {
  const pal = palette(songId, SONG_BY_ID[songId]?.energy ?? 0.5)
  const vars = { width: size, height: size, '--a': pal.a, '--b': pal.b, '--c': pal.c } as CSSProperties
  return (
    <motion.button
      ref={ref}
      type="button"
      className={`disc${selected ? ' is-sel' : ''}${saved ? ' is-saved' : ''}${showing ? ' is-showing' : ''}`}
      style={vars}
      data-testid={testid}
      data-song-id={songId}
      data-status={saved ? 'saved' : 'candidate'}
      aria-pressed={selected}
      aria-label={label}
      onClick={onClick}
      animate={reduced ? { y: 0, scale: 1 } : { y: selected ? -5 : 0, scale: selected ? 1.12 : 1 }}
      whileTap={{ scale: selected ? 1.05 : 0.92 }}
      transition={SPRING.snappy}
    >
      <span className="disc__glow" aria-hidden="true" />
      <span className="disc__silver" aria-hidden="true" />
      <span className="disc__tint" aria-hidden="true" />
      <span className="disc__grooves" aria-hidden="true" />
      <span className="disc__sheen" aria-hidden="true" />
      <span className="disc__color" aria-hidden="true" />
      <span className="disc__hole" aria-hidden="true" />
      {saved ? (
        <span className="disc__stitch" aria-hidden="true">
          <svg viewBox="0 0 20 20" width={Math.round(size * 0.34)} height={Math.round(size * 0.34)}>
            <circle cx="10" cy="10" r="9" fill="#fff" />
            <path d="M5.6,10.4 l2.8,2.8 5.8,-6" fill="none" stroke={pal.deep} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      ) : null}
      {flash ? <span key={flash} className="disc__flash" aria-hidden="true" /> : null}
      {flash && rise && !reduced ? <span key={`g${flash}`} className="disc__ghost" aria-hidden="true" /> : null}
    </motion.button>
  )
})
