// Stage standby (SPEC F-1 S9, E-10, F-2): the phone goes dark, the ball turns slowly, and a
// huge "N songs until your turn" says how long you can just listen. One song before your turn the
// light specks gather to the centre and a soft chime plays; a tap then brings you back.
// While someone else sings, tapping waves a penlight (pentatonic notes, rising lights, no counts).
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useLayoutEffect, useRef, type PointerEvent, type ReactNode, type RefObject } from 'react'
import { naviApi, useNavi, isMine } from '../../core/store'
import { selMyTurnIn } from '../../core/selectors'
import { ticker } from '../../core/ticker'
import { sound } from '../../core/sound'
import { Button } from '../../core/ui/Button'
import { SongTitle } from '../../core/ui/SongTitle'
import { common } from '../../i18n/common'
import { S } from './strings'
import { lightColor, splitAround } from './model'
import { ProgressRing, useMemberName } from './parts'
import { wavePenlight } from './penlight'
import './stage.css'

export function Standby(p: { ball: ReactNode }): JSX.Element {
  const t = S.useT()
  const tc = common.useT()
  const n = useNavi(selMyTurnIn)
  const now = useNavi(s => s.room.now)
  const members = useNavi(s => s.room.members)
  const reduced = useNavi(s => s.ui.reduced)
  const name = useMemberName()
  const host = useRef<HTMLDivElement>(null)
  const ballBox = useRef<HTMLDivElement>(null)
  const gather = n === 1
  const others = !!now && !isMine(now.item)

  // chime once each time I become "next"
  const chimed = useRef(false)
  useEffect(() => {
    if (!gather) {
      chimed.current = false
      return
    }
    if (chimed.current) return
    chimed.current = true
    const id = setTimeout(() => sound.play('standbyChime'), 450)
    return () => clearTimeout(id)
  }, [gather])

  const close = () => {
    sound.play('close')
    naviApi.getState().setOverlay(null)
  }
  const onTap = (e: PointerEvent) => {
    if ((e.target as HTMLElement).closest('button')) return
    if (gather) return close()
    if (others && host.current) wavePenlight(host.current, e.clientX, e.clientY, now?.item.id ?? null)
  }

  const nowColor = now ? lightColor(members[now.item.by], true) : '#fff'

  return (
    <div ref={host} className={`sg-standby${gather ? ' is-gather' : ''}${n === 0 ? ' is-now' : ''}`} data-testid="standby" data-gather={gather ? '1' : '0'} onPointerDown={onTap}>
      <SpeckField gather={gather} reduced={reduced} centre={ballBox} />
      <div className="sg-standby__top">
        {/* the prototype label stays on every full-screen view (QA POLICY#5) */}
        <span className="sg-standby__brand">{tc('brand')}</span>
        <span className="sg-lbl">{t('standbyLabel')}</span>
        {now ? (
          <span className="sg-standby__now" style={{ ['--c' as string]: nowColor }}>
            <ProgressRing now={now} size={22} stroke={2} color={nowColor}>
              <i className="sg-dot" />
            </ProgressRing>
            <span className="sg-lbl sg-lbl--now">NOW</span>
            <SongTitle songId={now.item.songId} variant="lane" />
            <span className="sg-standby__by">{name(now.item.by)}</span>
          </span>
        ) : null}
      </div>
      <div className="sg-standby__ball" ref={ballBox}>
        {p.ball}
      </div>
      <div className="sg-standby__count">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={n ?? 'none'} initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} transition={{ duration: 0.45, ease: [0.2, 0.8, 0.2, 1] }}>
            {n == null ? (
              <div className="sg-standby__none">{t('standbyNone')}</div>
            ) : n === 0 ? (
              <div className="sg-standby__yours" data-testid="standby-turn">
                {t('standbyNow')}
              </div>
            ) : (
              <BigTurn n={n} />
            )}
          </motion.div>
        </AnimatePresence>
        <div className="sg-standby__hint">{gather ? t('standbyGather') : n === 0 ? t('yourTurnLead') : others ? t('penHint') : t('standbyRelax')}</div>
        {gather ? <div className="sg-standby__tap">{t('tapToReturn')}</div> : others ? <div className="sg-standby__tap">{t('penSub')}</div> : null}
      </div>
      <div className="sg-standby__foot">
        {n === 0 ? (
          <Button
            kind="primary"
            size="lg"
            full
            testid="standby-to-stage"
            onClick={() => {
              const s = naviApi.getState()
              s.setOverlay(null)
              s.setTab('discover')
            }}
          >
            {t('toStage')}
          </Button>
        ) : null}
        <Button kind="ghost" size="md" full testid="standby-back" onClick={close}>
          {t('backToFind')}
        </Button>
      </div>
    </div>
  )
}

function BigTurn({ n }: { n: number }) {
  const t = S.useT()
  const [a, b] = splitAround(t(n === 1 ? 'myTurnIn.one' : 'myTurnIn', { n: '\u0001' }), '\u0001')
  // a short counter word sits beside the number; a long phrase goes underneath
  const inline = b.trim().length <= 3
  return (
    <div className={`sg-bigturn${inline ? '' : ' is-stacked'}`} data-testid="standby-turn">
      {a ? <div className="sg-bigturn__pre">{a}</div> : null}
      <div className="sg-bigturn__row">
        <motion.b key={n} className="sg-bigturn__n" initial={{ scale: 1.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', stiffness: 260, damping: 16 }}>
          {n}
        </motion.b>
        {b ? <span className="sg-bigturn__post">{b}</span> : null}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- gathering specks (canvas)

type Speck = { a: number; r: number; w: number; s: number; hue: number; ph: number; jr: number }

function sprite(): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = c.height = 48
  const g = c.getContext('2d')!
  const grad = g.createRadialGradient(24, 24, 0, 24, 24, 24)
  grad.addColorStop(0, 'rgba(255,255,255,1)')
  grad.addColorStop(0.18, 'rgba(255,246,216,0.9)')
  grad.addColorStop(0.45, 'rgba(255,211,107,0.28)')
  grad.addColorStop(1, 'rgba(255,211,107,0)')
  g.fillStyle = grad
  g.fillRect(0, 0, 48, 48)
  return c
}

function SpeckField({ gather, reduced, centre }: { gather: boolean; reduced: boolean; centre: RefObject<HTMLDivElement> }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const gRef = useRef(gather ? 1 : 0)
  const target = useRef(gather ? 1 : 0)
  target.current = gather ? 1 : 0

  useLayoutEffect(() => {
    const cv = ref.current
    const ctx = cv?.getContext('2d')
    if (!cv || !ctx) return
    const img = sprite()
    const dpr = Math.min(1.5, window.devicePixelRatio || 1)
    let w = 0
    let h = 0
    let cx = 0
    let cy = 0
    let ringR = 120
    const resize = () => {
      w = cv.clientWidth
      h = cv.clientHeight
      cv.width = Math.round(w * dpr)
      cv.height = Math.round(h * dpr)
      const holder = centre.current
      const b = ((holder?.firstElementChild as HTMLElement | null) ?? holder)?.getBoundingClientRect()
      const r = cv.getBoundingClientRect()
      const s = r.width > 0 ? w / r.width : 1
      cx = b ? (b.left - r.left + b.width / 2) * s : w / 2
      cy = b ? (b.top - r.top + b.height / 2) * s : h * 0.36
      ringR = b ? (b.width * s) / 2 + 6 : 120
    }
    resize()
    const specks: Speck[] = Array.from({ length: 54 }, (_, i) => ({
      a: (i / 54) * Math.PI * 2 + Math.random() * 0.4,
      r: 0.35 + Math.random() * 0.75,
      w: (Math.random() < 0.5 ? -1 : 1) * (0.03 + Math.random() * 0.06),
      s: 6 + Math.random() * 10,
      hue: Math.random(),
      ph: Math.random() * Math.PI * 2,
      jr: Math.random() * 22 - 6,
    }))
    let time = 0
    const draw = (dt: number) => {
      time += dt / 1000
      const g0 = gRef.current
      const tg = target.current
      gRef.current = g0 + (tg - g0) * Math.min(1, dt / 900)
      const g = gRef.current
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, w, h)
      ctx.globalCompositeOperation = 'lighter'
      const R = Math.max(w, h) * 0.55
      for (const p of specks) {
        const ang = p.a + time * p.w * (1 + g * 2.5)
        const far = p.r * R
        const near = ringR + p.jr + Math.sin(time * 1.3 + p.ph) * 5
        const rad = far + (near - far) * g
        const x = cx + Math.cos(ang) * rad
        const y = cy + Math.sin(ang) * rad * (0.92 + 0.08 * g)
        const tw = 0.55 + 0.45 * Math.sin(time * 2 + p.ph)
        const size = p.s * (0.85 + 0.35 * g) * (0.8 + 0.3 * tw)
        ctx.globalAlpha = Math.min(1, (0.32 + 0.55 * g) * tw + 0.1)
        ctx.drawImage(img, x - size, y - size, size * 2, size * 2)
      }
      ctx.globalAlpha = 1
      ctx.globalCompositeOperation = 'source-over'
    }
    draw(16)
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null
    ro?.observe(cv)
    if (reduced) {
      gRef.current = target.current
      draw(0)
      return () => ro?.disconnect()
    }
    const off = ticker.add(draw, 0)
    return () => {
      off()
      ro?.disconnect()
    }
  }, [reduced, centre, reduced && gather])

  useEffect(() => {
    if (reduced && ref.current) gRef.current = gather ? 1 : 0
  }, [gather, reduced])

  return <canvas ref={ref} className="sg-standby__specks" aria-hidden="true" />
}
