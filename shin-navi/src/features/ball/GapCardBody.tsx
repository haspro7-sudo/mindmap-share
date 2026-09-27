// Card kind 6, gap (SPEC C-8): a zoomed-in patch of *your* ball drawn by the ball renderer, the
// dark area's outline blinking, the area as the title ("スローなJ-POP"), one line ("あなたのボール
// で、まだ0曲") and a peek at three songs of the area. Primary action: open the area (search
// filtered by tempo x genre).
import { useEffect, useLayoutEffect, useRef } from 'react'
import type { AreaKey, CardBodyComponent, CardBodyProps } from '../../core/types'
import { useNavi, naviApi } from '../../core/store'
import { gapAreas } from '../../core/rules'
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

function GapBody({ card, active, setPrimary }: CardBodyProps) {
  const area: AreaKey = card.area ?? gapAreas(naviApi.getState().col.faces, SONGS)[0] ?? 'slow:J-POP'
  const t = S.useT()
  const locale = useLocale()
  useEffect(() => {
    // the short label fits the action bar at 360 px in every locale
    setPrimary({ action: 'openArea', label: S.ref('openAreaShort'), enabled: true })
  }, [card.id])
  const { tempo, genre } = parseArea(area)
  const songs = areaSongs(area)
  const lit = useNavi(s => songs.filter(x => !!s.col.faces[x.id]).length)
  // Card-front contract (QA OWNER#6): the area is the title, one short line says how dark it is
  // on *your* ball; the zoomed ball is the picture. The why ("…is still dark", the cause) and
  // the numbers live on the back (CardBack shows reason.text + cause).
  const title = t(`gapTitle.${tempo}` as 'gapTitle.slow', { genre: { genre } })
  // a line break may only fall between the tempo word and the genre (never inside a word)
  const g = varText({ genre }, locale)
  const at = g ? title.indexOf(g) : -1
  const line = lit > 0 ? t('gapSome', { n: lit }) : t('gapNone')
  const peek = songs
    .slice(0, 3)
    .map(x => songTitle(x.id, locale).main)
    .join(' · ')
  return (
    <div className="gap-body" data-area={area} data-lit={lit}>
      <ZoomBall area={area} active={active} />
      <div className="gap-body__text">
        <div className="gap-body__reason" data-testid="card-reason">
          <div className="gap-body__title">
            {at > 0 ? (
              <>
                {title.slice(0, at)}
                <wbr />
                {title.slice(at)}
              </>
            ) : (
              title
            )}
          </div>
          <div className="gap-body__line">
            <i aria-hidden />
            {line}
          </div>
        </div>
        <div className="gap-body__songs" aria-label={t('gapSongs')}>
          {peek}
        </div>
      </div>
    </div>
  )
}

export const GapCardBody: CardBodyComponent = p => <GapBody {...p} />
