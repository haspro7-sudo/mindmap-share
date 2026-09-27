// Ghost hand (SPEC B-2 2.4 s): on the very first visit a translucent finger draws one upward
// stroke from the first card into the breathing lane slot, then fades. Shown once, ever
// (ui.coach.ghostHand), and dismissed by the first touch on the card.
import { useEffect, useState, type RefObject } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { naviApi, useNavi } from '../../core/store'
import { introPending, introWait } from '../../core/intro'
import { resolveTarget } from '../../core/targets'
import { deckCtl } from './DeckView'
import { qbez } from './gestures'
import { S } from './strings'

type Geo = { x0: number; y0: number; x1: number; y1: number; cx: number; cy: number; W: number; H: number }

const DRAW = 0.5
const TRAVEL = 0.62
const LINGER = 1.25

export function GhostHand({ layerRef, scale }: { layerRef: RefObject<HTMLDivElement>; scale: number }) {
  const t = S.useT()
  const eligible = useNavi(s => !s.ui.coach.ghostHand && s.session.intro === 'full' && s.session.visit <= 1 && !s.ui.reduced)
  const [geo, setGeo] = useState<Geo | null>(null)
  const [gone, setGone] = useState(false)

  useEffect(() => {
    if (!eligible || !introPending('ghostHand')) return
    let done = false
    const finish = () => {
      if (done) return
      done = true
      setGone(true)
      naviApi.getState().coachDone('ghostHand')
    }
    const startMs = introWait('ghostHand') * 1000
    const measure = window.setTimeout(() => {
      const layer = layerRef.current
      const card = deckCtl.topEl
      if (!layer || !card) return
      const L = layer.getBoundingClientRect()
      const sc = scale || 1
      const c = card.getBoundingClientRect()
      const slot = resolveTarget('lane:next')
      const x0 = (c.left + c.width * 0.62 - L.left) / sc
      const y0 = (c.top + c.height * 0.58 - L.top) / sc
      const x1 = slot ? (slot.left + slot.width * 0.5 - L.left) / sc : L.width / sc / 2
      const y1 = slot ? (slot.top + slot.height * 0.55 - L.top) / sc : 76
      setGeo({ x0, y0, x1, y1, cx: x0 + (x1 - x0) * 0.1 + 18, cy: y1 + (y0 - y1) * 0.35, W: L.width / sc, H: L.height / sc })
    }, startMs)
    const end = window.setTimeout(finish, startMs + (DRAW + TRAVEL + LINGER + 0.5) * 1000)
    deckCtl.onTouch = finish
    return () => {
      window.clearTimeout(measure)
      window.clearTimeout(end)
      if (deckCtl.onTouch === finish) deckCtl.onTouch = null
    }
  }, [eligible])

  const show = eligible && !gone && geo
  const pts = geo ? Array.from({ length: 13 }, (_, i) => i / 12) : []
  return (
    <AnimatePresence>
      {show && geo ? (
        <motion.div
          key="ghost"
          className="ghost"
          data-testid="ghost-hand"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.35 } }}
          transition={{ duration: 0.2 }}
        >
          <svg className="ghost__trail" width={geo.W} height={geo.H} viewBox={`0 0 ${geo.W} ${geo.H}`}>
            <defs>
              <linearGradient id="ghost-grad" x1={geo.x0} y1={geo.y0} x2={geo.x1} y2={geo.y1} gradientUnits="userSpaceOnUse">
                <stop offset="0" stopColor="#FFFFFF" stopOpacity="0.05" />
                <stop offset="0.6" stopColor="#FFF6D8" stopOpacity="0.7" />
                <stop offset="1" stopColor="#FFD36B" stopOpacity="1" />
              </linearGradient>
            </defs>
            <motion.path
              d={`M${geo.x0},${geo.y0} Q${geo.cx},${geo.cy} ${geo.x1},${geo.y1}`}
              className="ghost__path"
              stroke="url(#ghost-grad)"
              initial={{ pathLength: 0, opacity: 0.9 }}
              animate={{ pathLength: 1, opacity: [0.9, 0.9, 0] }}
              transition={{ pathLength: { duration: DRAW + TRAVEL * 0.6, ease: 'easeInOut' }, opacity: { duration: DRAW + TRAVEL + LINGER, times: [0, 0.7, 1] } }}
            />
          </svg>
          <motion.div
            className="ghost__finger"
            initial={{ x: geo.x0 - 22, y: geo.y0 - 6, opacity: 0, scale: 1 }}
            animate={{
              x: pts.map(p => qbez(geo.x0, geo.cx, geo.x1, p) - 22),
              y: pts.map(p => qbez(geo.y0, geo.cy, geo.y1, p) - 6),
              opacity: pts.map((_, i) => (i === 0 ? 0 : 1)),
            }}
            transition={{ duration: DRAW + TRAVEL, ease: 'easeInOut', delay: 0.05 }}
          >
            <svg width="44" height="52" viewBox="0 0 44 52" aria-hidden="true">
              <path
                d="M17 6.5a3.8 3.8 0 0 1 7.6 0V22l2.6-1.1a3.6 3.6 0 0 1 4.9 2l.3.9 1.9-.6a3.5 3.5 0 0 1 4.3 2.3l.2.6a3.4 3.4 0 0 1 3.2 3.3V36c0 7.2-5.6 13-12.6 13H24c-4.3 0-8-2.3-10.1-6l-7-12.1a3.6 3.6 0 0 1 5.9-4.1L17 31z"
                className="ghost__hand"
              />
            </svg>
            <span className="ghost__tap" />
          </motion.div>
          <motion.div
            className="ghost__caption"
            style={{ left: Math.min(Math.max(12, geo.x1 - 10), geo.W - 160), top: geo.y1 + 30 }}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: [0, 1, 1, 0], y: 0 }}
            transition={{ duration: DRAW + TRAVEL + LINGER, times: [0, 0.3, 0.85, 1], delay: 0.35 }}
          >
            {t('ghost.caption')}
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}
