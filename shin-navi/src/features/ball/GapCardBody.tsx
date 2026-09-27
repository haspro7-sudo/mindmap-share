// Card kind 6, gap (SPEC C-8): a zoomed-in patch of *your* ball drawn by the ball renderer,
// the dark area's outline blinking, "your ball: south (slow) x J-POP is still dark" and three
// songs of the area. Primary action: open the area (search filtered by tempo x genre).
import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react'
import type { AreaKey, CardBodyComponent, CardBodyProps } from '../../core/types'
import { useNavi, naviApi } from '../../core/store'
import { gapAreas } from '../../core/rules'
import { Tr } from '../../core/ui/Tr'
import { SONGS } from '../../data/songs'
import { songTitle, useLocale, varText } from '../../i18n'
import { BallController } from './controller'
import { areaSongs, parseArea } from './layout'
import { S } from './strings'
import './ball.css'

function ZoomBall({ area, active }: { area: AreaKey; active: boolean }) {
  const box = useRef<HTMLDivElement>(null)
  const cv = useRef<HTMLCanvasElement>(null)
  const ctl = useRef<BallController | null>(null)

  useLayoutEffect(() => {
    const el = box.current
    const canvas = cv.current
    if (!el || !canvas) return
    const c = new BallController({ variant: 'zoom', size: 200, reduced: naviApi.getState().ui.reduced })
    ctl.current = c
    c.attach(canvas)
    const measure = () => {
      const w = el.clientWidth
      const h = el.clientHeight
      if (w > 0 && h > 0 && (w !== c.cw || h !== c.ch)) c.setCanvasBox(w, h)
    }
    measure()
    c.setZoomArea(area)
    let ro: ResizeObserver | null = null
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(measure)
      ro.observe(el)
    }
    return () => {
      ro?.disconnect()
      c.destroy()
      ctl.current = null
    }
  }, [])
  useEffect(() => ctl.current?.setZoomArea(area), [area])
  useEffect(() => {
    const c = ctl.current
    if (!c) return
    c.paused = !active
    if (!active) c.frame(performance.now(), 0)
  }, [active])

  return (
    <div ref={box} className="gap-body__view" data-private="1">
      <canvas ref={cv} data-testid="gap-ball" aria-hidden />
    </div>
  )
}

/** Wraps the {region} and {genre} parts of the headline so they can glow. */
function headline(text: string, parts: string[]): ReactNode[] {
  const out: ReactNode[] = []
  let rest = text
  let k = 0
  while (rest.length) {
    let at = -1
    let hit = ''
    for (const p of parts) {
      const i = p ? rest.indexOf(p) : -1
      if (i >= 0 && (at < 0 || i < at)) {
        at = i
        hit = p
      }
    }
    if (at < 0) {
      out.push(rest)
      break
    }
    if (at > 0) out.push(rest.slice(0, at))
    out.push(<b key={k++}>{hit}</b>)
    rest = rest.slice(at + hit.length)
  }
  return out
}

function WaveGlyph() {
  return (
    <svg width="16" height="10" viewBox="0 0 16 10" aria-hidden>
      <path d="M1 5c2-4 4-4 6 0s4 4 6 0" fill="none" stroke="#7DF9FF" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}

function GapBody({ card, active, setPrimary }: CardBodyProps) {
  const area: AreaKey = card.area ?? gapAreas(naviApi.getState().col.faces, SONGS)[0] ?? 'slow:J-POP'
  const t = S.useT()
  const locale = useLocale()
  useEffect(() => {
    setPrimary({ action: 'openArea', label: S.ref('openArea'), enabled: true })
  }, [card.id])
  const { tempo, genre } = parseArea(area)
  const songs = areaSongs(area)
  const dark = useNavi(s => songs.filter(x => !s.col.faces[x.id]).length)
  const region = t(`region.${tempo}` as 'region.slow')
  const genreText = varText({ genre }, locale)
  const head = t('gapHead', { region, genre: { genre } })
  return (
    <div className="gap-body" data-area={area}>
      <ZoomBall area={area} active={active} />
      <div className="gap-body__text">
        <div className="gap-body__reason" data-testid="card-reason">
          <div className="gap-body__head">{headline(head, [region, genreText])}</div>
          {card.reason.cause ? (
            <div className="gap-body__cause">
              <WaveGlyph />
              <Tr text={card.reason.cause} />
            </div>
          ) : null}
        </div>
        <div className="gap-body__count">
          <i aria-hidden />
          {t('areaLit', { n: songs.length, k: songs.length - dark })}
        </div>
        <div className="gap-body__songs" aria-label={t('gapSongs')}>
          {songs.slice(0, 3).map(s => (
            <span key={s.id} className="gap-body__song">
              {songTitle(s.id, locale).main}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}

export const GapCardBody: CardBodyComponent = p => <GapBody {...p} />
