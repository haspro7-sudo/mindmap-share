// Root: boots the store, installs the feature services once, and picks the shell by view mode.
// Boot order (lead contract): loadPersisted → persistence, clock, test hook → feature installers.
import { MotionConfig } from 'motion/react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { naviApi, useNavi } from '../core/store'
import { bus } from '../core/events'
import { params } from '../core/params'
import { loadPersisted, installPersistence } from '../core/storage'
import { installClock } from '../core/clock'
import { installTestHook } from '../core/testHook'
import { LayoutProvider, useBox, useViewMode } from '../core/layout'
import { INTRO_SCALE, INTRO_TIMELINE, restartIntro } from '../core/intro'
import { fxState } from '../core/fxState'
import { sound } from '../core/sound'
import { onLocaleChange } from '../i18n'
import { installFx, installSound } from '../features/fx'
import { installDirector, PolicyLens, SplitView } from '../features/director'
import { installRoomSim, PresenterPanel } from '../features/room'
import { PhoneShell } from './PhoneShell'
import { RoomShell } from './RoomShell'
import { DualLayout } from './DualLayout'
import { ErrorBoundary } from './ErrorBoundary'
import { shellStrings } from '../i18n/shell'

let booted = false
/** Synchronous part of the boot: runs before the first render so the intro mode is final. */
function boot(): void {
  if (booted) return
  booted = true
  loadPersisted(naviApi)
  if (params.entry) naviApi.getState().setOverlay('entry')
  try {
    naviApi.getState().setReduced(!!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
  } catch {
    /* matchMedia unavailable */
  }
  restartIntro()
}

function useServices(): void {
  useEffect(() => {
    const api = naviApi
    const offs: (() => void)[] = []
    offs.push(installPersistence(api), installClock(api))
    if (params.test) installTestHook(api)
    offs.push(installFx(api), installSound(api), installDirector(api), installRoomSim(api))
    offs.push(onLocaleChange(locale => bus.emit({ type: 'locale/changed', locale })))

    // prefers-reduced-motion (not a layout query: it only switches animation style)
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    if (mq) {
      const apply = () => api.getState().setReduced(mq.matches)
      mq.addEventListener?.('change', apply)
      offs.push(() => mq.removeEventListener?.('change', apply))
    }

    // keyboard (script mode, capture phase): → and PageDown always mean "next event", wherever the
    // focus is (a flipped card, the search field…) — presenter clickers send exactly these keys.
    // PageUp is swallowed so a clicker's "back" never scrolls a sheet mid-demo.
    const onScriptKey = (e: KeyboardEvent) => {
      if (!api.getState().session.script || e.metaKey || e.ctrlKey || e.altKey) return
      const next = e.key === 'ArrowRight' || e.key === 'PageDown'
      if (!next && e.key !== 'PageUp') return
      const el = e.target as HTMLElement | null
      // an input with a selection being edited keeps its → (collapse the selection first)
      if (e.key === 'ArrowRight' && el instanceof HTMLInputElement && el.selectionStart != null && el.selectionStart !== el.selectionEnd) return
      e.preventDefault()
      e.stopPropagation()
      if (next && !e.repeat) bus.emit({ type: 'presenter/cmd', cmd: { t: 'next' } })
    }
    window.addEventListener('keydown', onScriptKey, true)
    offs.push(() => window.removeEventListener('keydown', onScriptKey, true))

    // keyboard (bubble phase): L lens, S split, ? presenter, → next scripted event
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const s = api.getState()
      if (e.key === 'l' || e.key === 'L') s.toggleLens()
      else if (e.key === 's' || e.key === 'S') s.toggleSplit()
      else if (e.key === '?') s.togglePresenter()
      else if (e.key === 'ArrowRight' && !s.session.script) bus.emit({ type: 'presenter/cmd', cmd: { t: 'next' } })
    }
    window.addEventListener('keydown', onKey)
    offs.push(() => window.removeEventListener('keydown', onKey))

    // first touch anywhere turns the room lights on (SPEC B-4)
    const onFirst = () => {
      window.removeEventListener('pointerdown', onFirst, true)
      const s = api.getState()
      s.unlockAudio()
      sound.unlock()
      sound.play('lightOn')
      fxState.flash = 1
    }
    window.addEventListener('pointerdown', onFirst, true)
    offs.push(() => window.removeEventListener('pointerdown', onFirst, true))

    return () => offs.forEach(f => f())
  }, [])
}

/**
 * The intro clock starts when the stage is first committed (just before its first paint), not at
 * bundle evaluation: parsing and the first render of a 1.4 MB page must not eat into the 3-second
 * choreography (QA OWNER#4 / DEMO#7). A new night (next visit) restarts it the same way.
 * markIntroDone once the timeline reaches `done`.
 */
function useIntroClock(nightId: string, intro: 'full' | 'short' | 'none'): void {
  useLayoutEffect(() => {
    restartIntro()
    const ms = INTRO_TIMELINE.done * INTRO_SCALE[intro]
    const id = setTimeout(() => naviApi.getState().markIntroDone(), ms)
    return () => clearTimeout(id)
    // the intro mode is fixed per night
  }, [nightId])
}

/** A phone turned sideways keeps the phone view; this asks, once, to turn it back upright. */
function RotateHint() {
  const t = shellStrings.useT()
  return (
    <div className="rotate-hint" data-testid="rotate-hint" role="status">
      <span className="rotate-hint__phone" aria-hidden="true" />
      <div className="rotate-hint__title">{t('rotateTitle')}</div>
      <div className="rotate-hint__body">{t('rotateBody')}</div>
    </div>
  )
}

function Root() {
  const view = useViewMode()
  const phase = useNavi(s => s.session.phase)
  const intro = useNavi(s => s.session.intro)
  const nightId = useNavi(s => s.session.nightId)
  const reduced = useNavi(s => s.ui.reduced)
  const ref = useRef<HTMLDivElement>(null)
  useServices()
  useIntroClock(nightId, intro)

  // data-quality mirrors the governor tier without re-rendering React
  useEffect(() => {
    const id = setInterval(() => {
      const el = ref.current
      const q = String(fxState.quality)
      if (el && el.dataset.quality !== q) el.dataset.quality = q
    }, 500)
    return () => clearInterval(id)
  }, [])

  const box = useBox()
  const sideways = view === 'phone' && !params.view && box.w > box.h && box.h < 500

  return (
    <div ref={ref} className="app-root" data-testid="app-root" data-view={view} data-phase={phase} data-intro={intro} data-reduced={reduced ? '1' : '0'} data-quality={String(fxState.quality)}>
      {/* a new night (next visit) remounts the shells so the entrance plays again */}
      <div className="app-stage" key={nightId}>
        {view === 'dual' ? <DualLayout /> : view === 'room' ? <RoomShell /> : <PhoneShell />}
      </div>
      <div className="app-tools">
        <PolicyLens />
        <SplitView />
        <PresenterPanel />
      </div>
      {sideways ? <RotateHint /> : null}
    </div>
  )
}

function AppInner() {
  useState(boot)
  return (
    <MotionConfig reducedMotion="user">
      <LayoutProvider className="layout-root">
        <Root />
      </LayoutProvider>
    </MotionConfig>
  )
}

export function App() {
  return (
    <ErrorBoundary>
      <AppInner />
    </ErrorBoundary>
  )
}
