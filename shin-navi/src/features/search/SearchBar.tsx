// Always-visible search bar (SPEC F-3, y 108–148 on the phone). Tapping it opens the search
// sheet (the shell also opens it on an upward swipe over the hero background). The right end
// is a tiny mood pad showing where the air mixer is set; tapping it opens the mixer.
// Idle cost is zero React commits: the example ticker ("zankoku → 잔혹한 → 紅蓮 …", proof
// that any script works) and the sheen are CSS animations on transform/opacity only.
import { useRef, type CSSProperties } from 'react'
import { useNavi, naviApi } from '../../core/store'
import { Icon } from '../../core/ui/Icon'
import { introPending, introWait } from '../../core/intro'
import { sound } from '../../core/sound'
import { AURORA_PALETTES } from '../../core/rules'
import { S } from './strings'
import { TRY_QUERIES } from './search'
import { auroraAt } from './mixerMath'

const TICK_S = 2.4

export function SearchBar(): JSX.Element {
  const t = S.useT()
  const hype = useNavi(s => s.room.mood.hype)
  const fresh = useNavi(s => s.room.mood.fresh)
  const mixed = useNavi(s => s.room.mood.setBy === 'mixer')
  // the bar arrives with the lane (B-2 2.4 s) so the first seconds belong to the ball and the card
  const entrance = useRef<string | null>(null)
  if (entrance.current == null) entrance.current = introPending('lane') ? `sb-in 520ms var(--ease-out) ${introWait('lane').toFixed(2)}s both` : 'none'
  const pal = AURORA_PALETTES[auroraAt(hype, fresh)]
  const padStyle = { '--x': hype.toFixed(3), '--y': fresh.toFixed(3), '--p1': pal[0], '--p2': pal[1], '--p3': pal[2] } as CSSProperties

  return (
    <div className="sb" data-anchor="search" style={{ animation: entrance.current }}>
      <button
        type="button"
        className="sb__main"
        data-testid="search-bar"
        aria-label={t('bar.open')}
        onClick={() => {
          sound.play('tap')
          naviApi.getState().openSheet('search')
        }}
      >
        <span className="sb__icon">
          <Icon name="search" size={17} strokeWidth={2.3} />
        </span>
        <span className="sb__ph">{t('bar.placeholder')}</span>
        <span className="sb__ticker" aria-hidden="true" style={{ '--n': TRY_QUERIES.length, '--tick': `${TICK_S}s` } as CSSProperties}>
          {TRY_QUERIES.map((w, i) => (
            <i key={w} style={{ animationDelay: `${(i * TICK_S).toFixed(1)}s` }}>
              {w}
            </i>
          ))}
        </span>
        <span className="sb__sheen" aria-hidden="true" />
      </button>
      <button
        type="button"
        className={`sb__mix${mixed ? ' is-mixed' : ''}`}
        aria-label={t('bar.mixer')}
        data-testid="mixer-open"
        onClick={() => {
          sound.play('tap')
          naviApi.getState().openSheet('mixer')
        }}
      >
        <span className="sb__pad" style={padStyle}>
          <i className="sb__grid" />
          <i className="sb__dot" />
        </span>
      </button>
    </div>
  )
}
