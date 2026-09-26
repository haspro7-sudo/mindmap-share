// Phone portrait layout (SPEC F-3, 390×844 base; 360×740 variant; safe areas added).
// status 44 · lane 64 · search 40 · hero 244 (ball Ø196 at y≈250, floor horizon y=340) ·
// deck 308 · action bar 56 · dock 80. The lane stays fixed while sheets rise under it (F-6).
// Tabs crossfade 200 ms; the discover layer stays mounted so the hero ball never moves.
import { AnimatePresence, motion } from 'motion/react'
import { useRef, type CSSProperties, type PointerEvent } from 'react'
import { useNavi, naviApi } from '../core/store'
import { usePhoneMetrics } from '../core/layout'
import { TAB_FADE } from '../core/ui/motion'
import type { AreaKey, Tab } from '../core/types'
import { BackgroundCanvas, SpeckCanvas, BurstLayer } from '../features/fx'
import { MirrorBall } from '../features/ball'
import { DeckView, ActionBar, FlightLayer, UndoToast } from '../features/cards'
import { StageLane, MemberOrbs, MoodWord, Spotlight, StageScreen } from '../features/stage'
import { SearchBar } from '../features/search'
import { RecordScreen } from '../features/record'
import { OrderScreen } from '../features/services'
import { CARD_BODIES } from './cardBodies'
import { StatusBar } from './StatusBar'
import { Dock } from './Dock'
import { SheetHost } from './SheetHost'
import { OverlayHost } from './OverlayHost'
import { Toasts } from './Toasts'
import { PHONE_SHEETS, OVERLAYS } from './slots'

const openFace = (songId: string) => naviApi.getState().openSheet('face', { songId })
const openArea = (area: AreaKey) => {
  const [tempo, genre] = area.split(':')
  naviApi.getState().openSheet('search', { filters: { tempo, genre } })
}

/** Background swipes on the hero: up → search sheet, down → record tab (SPEC C-1). */
function useHeroSwipe() {
  const start = useRef<{ x: number; y: number; t: number } | null>(null)
  return {
    onPointerDown: (e: PointerEvent) => {
      start.current = { x: e.clientX, y: e.clientY, t: performance.now() }
    },
    onPointerUp: (e: PointerEvent) => {
      const s = start.current
      start.current = null
      if (!s) return
      const dx = e.clientX - s.x
      const dy = e.clientY - s.y
      if (Math.abs(dy) < 48 || Math.abs(dy) < Math.abs(dx) * 1.4 || performance.now() - s.t > 900) return
      if (dy < 0) naviApi.getState().openSheet('search')
      else naviApi.getState().setTab('record')
    },
    onPointerCancel: () => {
      start.current = null
    },
  }
}

function Hero() {
  const m = usePhoneMetrics()
  const swipe = useHeroSwipe()
  return (
    <div className="hero" data-testid="hero" style={{ height: m.hero }} {...swipe}>
      <div className="hero__spot">
        <Spotlight />
      </div>
      <div className="hero__ball" data-anchor="hero-ball" style={{ top: m.ballCy - m.ball / 2, width: m.ball, height: m.ball, marginLeft: -m.ball / 2 }}>
        <MirrorBall variant="hero" size={m.ball} interactive onFaceTap={openFace} onAreaTap={openArea} />
      </div>
      <div className="hero__floor" style={{ top: m.horizon }}>
        <MemberOrbs layout="floor" />
      </div>
      <div className="hero__mood" style={{ bottom: m.hero - m.horizon + 8 }}>
        <MoodWord size="hero" />
      </div>
    </div>
  )
}

function DiscoverLayer({ active }: { active: boolean }) {
  const m = usePhoneMetrics()
  return (
    <motion.div
      className="ps-tab ps-tab--discover"
      style={{ paddingTop: m.lane }}
      initial={false}
      animate={active ? { opacity: 1, visibility: 'visible' } : { opacity: 0, transitionEnd: { visibility: 'hidden' } }}
      transition={TAB_FADE}
      aria-hidden={!active}
      data-active={active ? '1' : '0'}
    >
      <div className="ps-search" style={{ height: m.search }}>
        <SearchBar />
      </div>
      <Hero />
      <div className="ps-deck" style={{ minHeight: m.cardH + 4 }}>
        <DeckView bodies={CARD_BODIES} />
      </div>
      <div className="ps-action" style={{ height: m.action }}>
        <ActionBar />
      </div>
    </motion.div>
  )
}

function OtherTab({ tab }: { tab: Exclude<Tab, 'discover'> }) {
  const m = usePhoneMetrics()
  return (
    <motion.div
      key={tab}
      className={`ps-tab ps-tab--${tab}`}
      style={{ paddingTop: tab === 'sing' ? 0 : m.laneCompact }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={TAB_FADE}
    >
      {tab === 'sing' ? <StageScreen /> : tab === 'record' ? <RecordScreen ball={<MirrorBall variant="record" interactive onFaceTap={openFace} onAreaTap={openArea} />} /> : <OrderScreen />}
    </motion.div>
  )
}

export function PhoneShell() {
  const m = usePhoneMetrics()
  const tab = useNavi(s => s.ui.tab)
  const laneH = tab === 'sing' ? 0 : tab === 'discover' ? m.lane : m.laneCompact
  const vars = {
    '--status-h': `${m.status}px`,
    '--lane-h': `${m.lane}px`,
    '--search-h': `${m.search}px`,
    '--hero-h': `${m.hero}px`,
    '--action-h': `${m.action}px`,
    '--dock-h': `${m.dock}px`,
    '--card-w': `${m.cardW}px`,
    '--card-h': `${m.cardH}px`,
    '--lane-bottom': `calc(${m.status + laneH}px + var(--sat))`,
    '--horizon-y': `calc(${m.status + m.lane + m.search + m.horizon}px + var(--sat))`,
    '--ball-cy': `calc(${m.status + m.lane + m.search + m.ballCy}px + var(--sat))`,
  } as CSSProperties
  return (
    <div className={`phone-shell${m.small ? ' is-small' : ''}`} data-shell="phone" style={vars}>
      <div className="ps-bg">
        <BackgroundCanvas variant="phone" />
      </div>
      <div className="ps-specks">
        <SpeckCanvas />
      </div>
      <div className="ps-main">
        <div className="ps-status" style={{ height: m.status }}>
          <StatusBar variant="phone" />
        </div>
        <div className="ps-body">
          <DiscoverLayer active={tab === 'discover'} />
          <AnimatePresence initial={false}>{tab !== 'discover' ? <OtherTab key={tab} tab={tab} /> : null}</AnimatePresence>
          <div className={`ps-lane${tab === 'sing' ? ' is-hidden' : ''}`} style={{ height: tab === 'discover' ? m.lane : m.laneCompact }}>
            <StageLane orientation="horizontal" compact={tab === 'record' || tab === 'order'} />
          </div>
        </div>
        <div className="ps-dock" style={{ height: `calc(${m.dock}px + var(--sab))` }}>
          <Dock ball={<MirrorBall variant="mini" size={m.small ? 26 : 30} />} />
        </div>
      </div>
      <div className="ps-fx">
        <FlightLayer />
        <BurstLayer />
      </div>
      <div className="ps-toasts">
        <UndoToast />
        <Toasts />
      </div>
      <SheetHost sheets={PHONE_SHEETS} />
      <OverlayHost overlays={OVERLAYS} />
    </div>
  )
}
