// "How to read the ball" (QA OWNER#8): the four face states, the marks and the ball's map, moved
// off the record tab into one ⓘ sheet so the tab itself stays a toy, not a manual.
import { useMemo, type CSSProperties } from 'react'
import type { Face } from '../../core/types'
import { areaColor } from '../../core/rules'
import { SONGS, SONG_BY_ID, GENRES, type Genre } from '../../data/songs'
import { useTr } from '../../i18n'
import { FACE_STATES, FaceSwatch, MARKS, MarkGlyph } from './parts'
import { R } from './strings'

export function Legend({ faces }: { faces: Record<string, Face> }) {
  const t = R.useT()
  const tr = useTr()
  const bands = useMemo(() => {
    const total = new Map<Genre, number>()
    const on = new Map<Genre, number>()
    for (const s of SONGS) total.set(s.genre, (total.get(s.genre) ?? 0) + 1)
    for (const id of Object.keys(faces)) {
      const g = SONG_BY_ID[id]?.genre
      if (g) on.set(g, (on.get(g) ?? 0) + 1)
    }
    return GENRES.map(g => ({ g, n: total.get(g) ?? 0, k: on.get(g) ?? 0 }))
  }, [faces])
  return (
    <div className="rc-legend" data-testid="record-legend">
      <h4 className="rc-legend__h">{t('legend.states')}</h4>
      <p className="rc-legend__sub">{t('legend.statesSub')}</p>
      <ul className="rc-legend__states">
        {FACE_STATES.map(st => (
          <li key={st} className={`rc-legend__state is-${st}`}>
            <FaceSwatch state={st} size={30} songId={st === 'neon' ? 'marigold' : undefined} />
            <span className="rc-legend__txt">
              <b>{t(`state.${st}`)}</b>
              <span>{t(`how.${st}`)}</span>
            </span>
          </li>
        ))}
      </ul>

      <h4 className="rc-legend__h">{t('marks.title')}</h4>
      <ul className="rc-marks">
        {MARKS.map(m => (
          <li key={m} className="rc-marks__item">
            <MarkGlyph mark={m} size={24} />
            <span className="rc-marks__txt">
              <b>{t(`mark.${m}`)}</b>
              <span>{t(`markHow.${m}`)}</span>
            </span>
          </li>
        ))}
      </ul>

      <h4 className="rc-legend__h">{t('legend.map')}</h4>
      <p className="rc-legend__sub">{t('legend.mapBody')}</p>
      <div className="rc-bands" role="img" aria-label={bands.map(b => `${tr({ key: `vocab.genre.${b.g}` })} ${b.k}/${b.n}`).join(', ')}>
        {bands.map(b => (
          <span key={b.g} className="rc-bands__seg" style={{ flexGrow: Math.max(1, b.n), ['--c' as string]: areaColor(b.g) } as CSSProperties}>
            <i style={{ transform: `scaleX(${b.n ? Math.min(1, b.k / b.n) : 0})` }} />
          </span>
        ))}
      </div>
      <div className="rc-legend__genres">
        {bands.map(b => (
          <span key={b.g} className={`rc-legend__genre${b.k ? ' is-lit' : ''}`}>
            <i style={{ background: areaColor(b.g) }} />
            {tr({ key: `vocab.genre.${b.g}` })}
            <b>
              {b.k}/{b.n}
            </b>
          </span>
        ))}
      </div>
      <p className="rc-legend__hint">{t('hero.hint')}</p>
    </div>
  )
}
