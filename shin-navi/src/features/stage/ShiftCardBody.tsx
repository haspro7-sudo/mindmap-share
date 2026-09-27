// shift "turning point" (SPEC C-8 #3): a wide band showing tonight's heat as a wave, the blinking
// empty "next" slot at its right end, the cause in one line, and two candidates: ride the flow /
// change the flow. Navi's pick is preselected; choosing one draws Navi's read of the next peak
// as a dotted line (a hypothesis). Primary: "slot in next" -> act('insert'), which proposes slotting
// it in right after NOW; the room answers with lights of agreement.
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useId, useMemo, useState } from 'react'
import type { CardBodyComponent, CardBodyProps, SongId } from '../../core/types'
import { useNavi } from '../../core/store'
import { Tr } from '../../core/ui/Tr'
import { SongTitle } from '../../core/ui/SongTitle'
import { SONG_BY_ID } from '../../data/songs'
import { S } from './strings'
import { forecastHeat, heatPoints, heatRange, heatSeries, shiftRoles, smoothPath } from './model'
import { presentOf } from './parts'
import './stage.css'

const W = 320
const H = 64

function ShiftBody({ card, active, flipped, setPrimary }: CardBodyProps) {
  const t = S.useT()
  const uid = useId().replace(/:/g, '')
  const sung = useNavi(s => s.room.sung)
  const heat = useNavi(s => s.room.heat)
  const members = useNavi(s => s.room.members)
  const present = useMemo(() => presentOf(members), [members])
  const options = useMemo(() => (card.options?.length ? card.options : card.songId ? [card.songId] : []).filter(id => SONG_BY_ID[id]), [card.id])
  const energies = useMemo(() => sung.map(e => SONG_BY_ID[e.item.songId]?.energy ?? 0.5), [sung])
  const roles = useMemo(() => shiftRoles(options, energies, card.songId), [options, energies, card.songId])
  const [pick, setPick] = useState<SongId | undefined>(roles.pick)
  useEffect(() => setPick(roles.pick), [card.id])

  useEffect(() => {
    if (!active) return
    setPrimary({ action: 'insert', label: S.ref('insertNext'), enabled: !!pick, arg: pick ? { songId: pick } : undefined })
  }, [active, pick, card.id])

  // wave geometry: tonight's heat on the left 78 %, the empty "next" slot on the right
  const series = heatSeries(sung, 0.2, 9)
  const vals = series.length > 1 ? series : [0.2, heat]
  const next = pick ? forecastHeat(heat, pick, present) : null
  const all = next != null ? [...vals, next] : vals
  const [lo, hi] = heatRange(all)
  const norm = (v: number) => (v - lo) / (hi - lo)
  const slotX = W * 0.82
  const pts = heatPoints(vals.map(norm), 6, slotX - 16, 8, H - 8)
  const wave = smoothPath(pts)
  const last = pts[pts.length - 1]
  const area = `${wave} L${last.x.toFixed(1)} ${H} L${pts[0].x.toFixed(1)} ${H} Z`
  const ny = next != null ? H - 8 - norm(next) * (H - 16) : null
  const nx = slotX + (W - slotX) / 2 - 2
  const forecast = ny != null ? `M${last.x.toFixed(1)} ${last.y.toFixed(1)} C${(last.x + 22).toFixed(1)} ${last.y.toFixed(1)} ${(nx - 20).toFixed(1)} ${ny.toFixed(1)} ${nx.toFixed(1)} ${ny.toFixed(1)}` : ''

  const choose = (id: SongId) => {
    setPick(id)
  }

  if (flipped) {
    return (
      <div className="sg-shift is-back">
        <div className="sg-shift__kind">
          <span className="sg-lbl">SHIFT</span>
          <span>{t('why')}</span>
        </div>
        <div className="sg-shift__whycause">{card.reason.cause ? <Tr text={card.reason.cause} /> : <Tr text={card.reason.text} />}</div>
        <div className="sg-shift__rule">{t('whyRule', { rule: card.rule })}</div>
        <div className="sg-shift__hyp">
          <i className="sg-shift__hypline" />
          {t('hypothesis')}
        </div>
        <div className="sg-shift__agree">{t('agreeNote')}</div>
      </div>
    )
  }

  return (
    <div className="sg-shift" aria-label={t('shiftKind')}>
      <div className="sg-shift__cause" data-testid="card-reason">
        <span className="sg-shift__glyph" aria-hidden="true">
          <svg viewBox="0 0 16 10">
            <path d="M1 5c2-4 4-4 6 0s4 4 6 0" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </span>
        {card.reason.cause ? <Tr text={card.reason.cause} /> : <Tr text={card.reason.text} />}
      </div>
      <div className="sg-shift__wave">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-label={t('tonightHeat')}>
          <defs>
            <linearGradient id={`sw${uid}`} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor="#5B6CFF" />
              <stop offset="0.55" stopColor="#FF3DA8" />
              <stop offset="1" stopColor="#FFB547" />
            </linearGradient>
            <linearGradient id={`sa${uid}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#FF3DA8" stopOpacity="0.32" />
              <stop offset="1" stopColor="#FF3DA8" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={area} fill={`url(#sa${uid})`} />
          <path d={wave} className="sg-shift__glowline" stroke={`url(#sw${uid})`} />
          <path d={wave} className="sg-shift__line" stroke={`url(#sw${uid})`} />
          {pts.map((p, i) => (
            <circle key={i} cx={p.x} cy={p.y} r={i === pts.length - 1 ? 3 : 1.8} className={i === pts.length - 1 ? 'sg-shift__nowpt' : 'sg-shift__pt'} />
          ))}
          <rect x={slotX} y={5} width={W - slotX - 4} height={H - 10} rx={9} className="sg-shift__slot" />
          <AnimatePresence>
            {forecast ? (
              <motion.g key={pick} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }}>
                <motion.path d={forecast} className="sg-shift__fc" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.45, ease: 'easeOut' }} />
                <circle cx={nx} cy={ny!} r={4.2} className="sg-shift__fcpt" />
              </motion.g>
            ) : null}
          </AnimatePresence>
        </svg>
        <span className="sg-shift__slotlbl" style={{ left: `${(slotX / W) * 100}%`, width: `${((W - slotX - 4) / W) * 100}%` }}>
          {t('next')}
        </span>
        {series.length <= 1 ? <span className="sg-shift__empty">{t('noHistory')}</span> : null}
        <span className="sg-shift__fclbl">{t('flowForecast')}</span>
      </div>
      <div className="sg-shift__opts">
        {(['ride', 'change'] as const).map(role => {
          const id = roles[role]
          if (!id) return null
          const on = pick === id
          const navi = roles.pick === id
          return (
            <motion.button
              key={role}
              type="button"
              className={`sg-shift__opt sg-shift__opt--${role}${on ? ' is-on' : ''}`}
              onClick={e => {
                e.stopPropagation()
                choose(id)
              }}
              onPointerDown={e => e.stopPropagation()}
              aria-pressed={on}
              data-testid="shift-option"
              data-role={role}
              data-song-id={id}
              whileTap={{ scale: 0.96 }}
            >
              <span className="sg-shift__role">
                {role === 'ride' ? (
                  <svg viewBox="0 0 16 10" aria-hidden="true">
                    <path d="M1 7c3-3 5-3 7-1s4 2 7-2" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 16 10" aria-hidden="true">
                    <path d="M1 8c4 0 6-1 7-4 1-2 3-3 7-3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                  </svg>
                )}
                {t(role)}
              </span>
              {navi ? <span className="sg-shift__navi">{t('naviPick')}</span> : null}
              <SongTitle songId={id} variant="lane" className="sg-shift__title" />
              <span className="sg-shift__artist">{SONG_BY_ID[id]?.artist}</span>
              {on ? (
                <motion.span className="sg-shift__check" layoutId={`shift-check-${card.id}`} transition={{ type: 'spring', stiffness: 500, damping: 30 }}>
                  <svg viewBox="0 0 12 12" aria-hidden="true">
                    <path d="M2.5 6.2l2.4 2.4 4.6-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </motion.span>
              ) : null}
            </motion.button>
          )
        })}
      </div>
    </div>
  )
}

export const ShiftCardBody: CardBodyComponent = p => <ShiftBody {...p} />
