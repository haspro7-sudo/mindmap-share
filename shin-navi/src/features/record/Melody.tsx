// Tonight's melody drawn as a row of notes (SPEC D-8). Each face change added one pentatonic
// note; when the melody plays (112 BPM eighth notes), the notes light up in time with it.
import type { CSSProperties } from 'react'

/** One eighth note at 112 BPM, and the synth's start offset (lib/audio playMelody). */
export const NOTE_MS = 60000 / 112 / 2
const START_MS = 80

export const melodyMs = (n: number) => START_MS + n * NOTE_MS + 800

export function MelodyNotes({ notes, playKey, palette, big = false }: { notes: number[]; playKey: number; palette: [string, string, string]; big?: boolean }) {
  if (!notes.length) return null
  const lo = Math.min(...notes)
  const hi = Math.max(...notes)
  const span = Math.max(1, hi - lo)
  return (
    <div key={playKey} className={`rc-mel${playKey > 0 ? ' is-playing' : ''}${big ? ' is-big' : ''}`} aria-hidden="true">
      {notes.map((m, i) => (
        <i
          key={i}
          className="rc-mel__n"
          style={
            {
              ['--y' as string]: `${(1 - (m - lo) / span) * 100}%`,
              ['--d' as string]: `${Math.round(START_MS + i * NOTE_MS)}ms`,
              ['--c' as string]: palette[i % 3],
            } as CSSProperties
          }
        />
      ))}
    </div>
  )
}
