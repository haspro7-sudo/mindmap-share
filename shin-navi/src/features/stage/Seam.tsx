// The glowing seam between the phone frame and the room screen in the dual view (SPEC F-5, B-6).
// It flashes once at 2.4 s, and every time I reserve on the phone a comet leaves the phone lane,
// arcs over the seam and lands in the room lane (650 ms, a tail of 22 particles).
import { useEffect, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { bus } from '../../core/events'
import { introDelay, introPending } from '../../core/intro'
import { useNavi } from '../../core/store'
import { cometLanded, markSeam } from './parts'
import './stage.css'

type Comet = { id: string; itemId: string; from: { x: number; y: number }; to: { x: number; y: number }; color: string }

const DUR = 0.65
const TAIL = 22
const SAMPLES = 14

function center(r: DOMRect) {
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
}

function findRect(shell: 'phone' | 'room', itemId: string): DOMRect | null {
  const el =
    document.querySelector<HTMLElement>(`[data-shell="${shell}"] [data-testid="stage-lane"] [data-item-id="${itemId}"]`) ??
    document.querySelector<HTMLElement>(`[data-shell="${shell}"] [data-testid="stage-lane"]`)
  if (!el) return null
  const r = el.getBoundingClientRect()
  return r.width > 0 ? r : null
}

/** Points along a quadratic arc that bows upward over the seam. */
function arc(from: { x: number; y: number }, to: { x: number; y: number }) {
  const cx = (from.x + to.x) / 2
  const cy = Math.min(from.y, to.y) - Math.max(60, Math.abs(to.x - from.x) * 0.22)
  const xs: number[] = []
  const ys: number[] = []
  for (let i = 0; i <= SAMPLES; i++) {
    const t = i / SAMPLES
    const u = 1 - t
    xs.push(u * u * from.x + 2 * u * t * cx + t * t * to.x)
    ys.push(u * u * from.y + 2 * u * t * cy + t * t * to.y)
  }
  return { xs, ys }
}

export function Seam(): JSX.Element {
  const [comets, setComets] = useState<Comet[]>([])
  const reduced = useNavi(s => s.ui.reduced)
  const flashIntro = useRef(introPending('lane'))

  useEffect(() => {
    markSeam(true)
    return () => markSeam(false)
  }, [])

  useEffect(() => {
    let n = 0
    return bus.on('queue/added', e => {
      if (e.source === 'member') return
      const itemId = e.item.id
      // leave once the card's flight has landed in the phone lane
      setTimeout(() => {
        const a = findRect('phone', itemId)
        const b = findRect('room', itemId)
        if (!a || !b) {
          cometLanded.emit(itemId)
          return
        }
        const from = center(a)
        const to = { x: b.left + Math.min(b.width / 2, 60), y: b.top + b.height / 2 }
        const id = `c${++n}`
        setComets(cs => [...cs, { id, itemId, from, to, color: '#FFD36B' }])
        setTimeout(() => cometLanded.emit(itemId), DUR * 1000)
        setTimeout(() => setComets(cs => cs.filter(c => c.id !== id)), DUR * 1000 + 600)
      }, 320)
    })
  }, [])

  return (
    <div className="sg-seam" aria-hidden="true">
      <span className="sg-seam__line" />
      <span className="sg-seam__shimmer" />
      <motion.span
        className="sg-seam__flash"
        initial={{ opacity: 0 }}
        animate={flashIntro.current ? { opacity: [0, 1, 0] } : { opacity: 0 }}
        transition={{ duration: 0.9, times: [0, 0.25, 1], delay: flashIntro.current ? introDelay('lane') : 0 }}
      />
      {comets.map(c => (
        <CometFx key={c.id} c={c} reduced={reduced} />
      ))}
    </div>
  )
}

function CometFx({ c, reduced }: { c: Comet; reduced: boolean }) {
  const { xs, ys } = arc(c.from, c.to)
  if (reduced) {
    return (
      <div className="sg-comet" data-testid="seam-comet">
        <motion.span className="sg-comet__head" style={{ x: c.to.x, y: c.to.y }} initial={{ opacity: 0 }} animate={{ opacity: [0, 1, 0] }} transition={{ duration: 0.6 }} />
      </div>
    )
  }
  return (
    <div className="sg-comet" data-testid="seam-comet" data-item-id={c.itemId}>
      {Array.from({ length: TAIL }, (_, i) => {
        const k = 1 - i / TAIL
        return (
          <motion.span
            key={i}
            className="sg-comet__p"
            style={{ width: 3 + 7 * k, height: 3 + 7 * k, marginLeft: -(3 + 7 * k) / 2, marginTop: -(3 + 7 * k) / 2 }}
            initial={{ x: xs[0], y: ys[0], opacity: 0 }}
            animate={{ x: xs, y: ys, opacity: [0, 0.9 * k, 0.9 * k, 0] }}
            transition={{ duration: DUR, delay: i * 0.012, ease: [0.45, 0, 0.25, 1], opacity: { duration: DUR + 0.1, delay: i * 0.012, times: [0, 0.1, 0.8, 1] } }}
          />
        )
      })}
      <motion.span
        className="sg-comet__head"
        initial={{ x: xs[0], y: ys[0], opacity: 0, scale: 0.6 }}
        animate={{ x: xs, y: ys, opacity: [0, 1, 1, 0], scale: [0.6, 1.2, 1, 1.6] }}
        transition={{ duration: DUR, ease: [0.45, 0, 0.25, 1], opacity: { duration: DUR + 0.15, times: [0, 0.08, 0.85, 1] }, scale: { duration: DUR + 0.15 } }}
      />
    </div>
  )
}
