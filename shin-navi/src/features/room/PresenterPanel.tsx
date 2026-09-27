// Presenter panel (SPEC E-14, H-6): triple-tap the brand or press "?". Compact, dark,
// monospace. Script toggle + NEXT with the upcoming step, speed, every room event, the view
// and demo tools, and the live metrics HUD. Everything goes through presenter/cmd so the
// → key, this panel and window.__navi.fire behave the same.
//
// Folded, the panel is a small pill (≤ 340×52: the next step and a → button, QA DEMO#0/#10):
// always while the comparison split (S) or the planning lens (L) is on, so it never covers
// them; bottom-right with a 16 px inset on wide screens; on a phone it rests on the tab bar,
// clear of the status bar, the queue and the card's own buttons, and can be dragged anywhere
// below the queue. Hold it (or tap ⋯) for split / lens / Jun / open / close.
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { AnimatePresence, motion, useDragControls, useMotionValue } from 'motion/react'
import { create } from 'zustand'
import type { CardKind, PresenterCmd, ViewMode } from '../../core/types'
import { naviApi, presentMembers, useNavi } from '../../core/store'
import { useNaviStable } from '../../core/useStable'
import { useBox } from '../../core/layout'
import { bus } from '../../core/events'
import { knowView, roomMinutesLeft } from '../../core/rules'
import { LOCALES, songTitle, useLocale, useTr } from '../../i18n'
import { P, type PresenterKey } from './strings'
import { PRESS_IDS, SCRIPT, nextPressIndex } from './script'
import { useSim } from './sim'
import './room.css'

const fire = (cmd: PresenterCmd) => bus.emit({ type: 'presenter/cmd', cmd })

const KINDS: CardKind[] = ['song', 'ask', 'link', 'gap', 'import', 'invite', 'shift', 'voice', 'coaster', 'finale']

/** Narrower than this, the panel is a phone sheet and its folded form rests on the tab bar. */
const NARROW = 620
const PILL_W = 340
const PILL_H = 48
const INSET = 16

/** Panel UI state that outlives a close/open (the presenter's choice and where the pill sits). */
type PP = { mini: boolean; menu: boolean; offset: Record<'narrow' | 'wide', { x: number; y: number }> }
const usePP = create<PP>(() => ({ mini: false, menu: false, offset: { narrow: { x: 0, y: 0 }, wide: { x: 0, y: 0 } } }))

function Btn({ id, label, onClick, on, tone, disabled, wide }: { id: string; label: string; onClick: () => void; on?: boolean; tone?: 'amber' | 'rose' | 'cyan'; disabled?: boolean; wide?: boolean }) {
  return (
    <motion.button
      type="button"
      className={`pp__btn${on ? ' is-on' : ''}${tone ? ` tone-${tone}` : ''}${wide ? ' is-wide' : ''}`}
      data-testid={`pp-${id}`}
      whileTap={{ scale: 0.95 }}
      disabled={disabled}
      onClick={onClick}
    >
      {label}
    </motion.button>
  )
}

function Section({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="pp__sec">
      <div className="pp__sechead">
        <span>{title}</span>
        <i />
        {right}
      </div>
      {children}
    </section>
  )
}

// ---------------------------------------------------------------- the next → press

type NextStep = { over: boolean; id: string; n: number; total: number; label: string }

/** What the next → press will do, numbered among the → presses only (auto steps pass silently). */
function useNextStep(): NextStep {
  const t = P.useT()
  const locale = useLocale()
  const pos = useSim(u => u.scriptPos)
  const home = useSim(u => u.homeLocale)
  const next = useNavi(s => nextPressIndex(s, pos))
  const over = next >= SCRIPT.length
  const id = over ? '' : SCRIPT[next].id
  const total = PRESS_IDS.length
  if (over) return { over, id, n: total, total, label: t('scriptDone') }
  // beat 10: say so when the exit also brings the demo's language back (QA DEMO#5)
  const back = id === 'exit' && home && home !== locale ? LOCALES.find(l => l.id === home)?.label : null
  const label = back ? t('step.exit.restore', { lang: back }) : t(`step.${id}` as PresenterKey)
  return { over, id, n: PRESS_IDS.indexOf(id) + 1, total, label }
}

// ---------------------------------------------------------------- script

function ScriptBlock() {
  const t = P.useT()
  const pos = useSim(u => u.scriptPos)
  const last = useSim(u => u.lastStep)
  const script = useNavi(s => s.session.script)
  const speed = useNavi(s => s.session.speed)
  const nx = useNextStep()
  const next = nx.over ? SCRIPT.length : SCRIPT.findIndex(s => s.id === nx.id)
  return (
    <div className="pp__script">
      <div className="pp__row">
        <button type="button" className={`pp__toggle${script ? ' is-on' : ''}`} data-testid="pp-script" aria-pressed={script} onClick={() => fire({ t: 'script', on: !script })}>
          <span className="pp__led" />
          {script ? t('scriptOn') : t('scriptOff')}
        </button>
        <div className="pp__seg" role="group" aria-label={t('speed')}>
          {([1, 4, 8] as const).map(v => (
            <button key={v} type="button" className={speed === v ? 'is-on' : ''} data-testid={`pp-speed-${v}`} aria-pressed={speed === v} onClick={() => fire({ t: 'speed', v })}>
              {v}×
            </button>
          ))}
        </div>
      </div>
      <motion.button type="button" className={`pp__next${nx.over ? ' is-over' : ''}`} data-testid="pp-next" data-step={nx.id} disabled={nx.over} whileTap={{ scale: 0.97 }} onClick={() => fire({ t: 'next' })}>
        <span className="pp__nextidx">
          {nx.over ? '--' : String(nx.n).padStart(2, '0')}
          <small>/{String(nx.total).padStart(2, '0')}</small>
        </span>
        <span className="pp__nexttxt">
          <small>{t('upcoming')}</small>
          <AnimatePresence mode="wait">
            <motion.b key={nx.label} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.16 }}>
              {nx.label}
            </motion.b>
          </AnimatePresence>
        </span>
        <span className="pp__nextkey" aria-hidden="true">
          →
        </span>
        {last ? <span key={last.at} className="pp__nextflash" aria-hidden="true" /> : null}
      </motion.button>
      <ol className="pp__rail" aria-label={t('script')}>
        {SCRIPT.map((s, i) => {
          const state = i < next && i < pos ? 'is-done' : i === next ? 'is-next' : i < next ? 'is-skip' : ''
          const title = `${t(`step.${s.id}` as PresenterKey)}${s.auto ? ` ${t('auto')}` : ''}`
          return (
            <li key={s.id} className={`${state}${s.auto ? ' is-auto' : ''}`}>
              <button type="button" data-testid={`pp-step-${s.id}`} title={title} aria-label={title} onClick={() => fire({ t: 'step', id: s.id })}>
                <span />
              </button>
            </li>
          )
        })}
      </ol>
      <LiveLine />
    </div>
  )
}

/** What the room is doing right now, so the presenter never has to look away to know. */
function LiveLine() {
  const t = P.useT()
  const trr = useTr()
  const locale = useLocale()
  const now = useNavi(s => s.room.now?.item.songId ?? null)
  const singer = useNavi(s => (s.room.now ? s.room.members[s.room.now.item.by]?.color ?? '#D8DCE8' : null))
  const waiting = useNavi(s => s.room.queue.length)
  const heat = useNavi(s => Math.round(s.room.heat * 100) / 100)
  const word = useNavi(s => s.room.moodWord)
  return (
    <div className="pp__live" data-testid="pp-live">
      <span className={`pp__livedot${now ? ' is-on' : ''}`} style={{ ['--c' as string]: singer ?? 'rgba(255,255,255,.25)' } as CSSProperties} />
      <span className="pp__livenow">{now ? songTitle(now, locale).main : t('live.idle')}</span>
      <span className="pp__livemeta">{t('live.queue', { n: waiting })}</span>
      <span className="pp__heat" title={t('live.heat')}>
        <i style={{ transform: `scaleX(${heat})` }} />
      </span>
      <span className="pp__livemeta">
        {heat.toFixed(2)} <small>{trr({ key: `common.mood.${word}` })}</small>
      </span>
    </div>
  )
}

// ---------------------------------------------------------------- room + view + tools

function RoomBlock() {
  const t = P.useT()
  const jun = useNavi(s => s.room.members.jun.present)
  const mineNow = useNavi(s => !!s.room.now && (s.room.now.item.by === 'me' || s.room.now.item.with === 'me'))
  const live = useNavi(s => s.session.phase === 'live')
  return (
    <Section title={t('room')}>
      <div className="pp__grid">
        <Btn id="join" label={t('cmd.join')} on={jun} onClick={() => fire({ t: 'join', id: 'jun' })} disabled={!live} />
        <Btn id="leave" label={t('cmd.leave')} onClick={() => fire({ t: 'leave', id: 'jun' })} disabled={!live || !jun} />
        <Btn id="advance" label={t('cmd.advance')} onClick={() => fire({ t: 'advance' })} disabled={!live} />
        <Btn id="myturn" label={t('cmd.myturn')} on={mineNow} onClick={() => fire({ t: 'myTurn' })} disabled={!live} />
        <Btn id="finish" label={t('cmd.finish')} onClick={() => fire({ t: 'finishMine' })} disabled={!live} />
        <Btn id="hundred" label={t('cmd.hundred')} tone="amber" onClick={() => fire({ t: 'finishMine', score: 100 })} disabled={!live} />
        <Btn id="request" label={t('cmd.request')} tone="rose" onClick={() => fire({ t: 'request' })} disabled={!live} />
        <Btn id="twin" label={t('cmd.twin')} tone="rose" onClick={() => fire({ t: 'twin' })} disabled={!live} />
        <Btn id="coaster" label={t('cmd.coaster')} tone="cyan" onClick={() => fire({ t: 'coaster' })} disabled={!live} />
        <Btn id="min15" label={t('cmd.min15')} tone="amber" onClick={() => fire({ t: 'minutesLeft', m: 15 })} disabled={!live} />
        <Btn id="exit" label={t('cmd.exit')} onClick={() => fire({ t: 'exit' })} disabled={!live} />
        <Btn id="nextvisit" label={t('cmd.nextvisit')} onClick={() => fire({ t: 'nextVisit' })} />
      </div>
    </Section>
  )
}

function ViewBlock() {
  const t = P.useT()
  const view = useNavi(s => s.session.view)
  const lens = useNavi(s => s.ui.lens)
  const split = useNavi(s => s.ui.split)
  const noDuck = useNavi(s => s.session.noDuck)
  const seeded = useNavi(s => s.col.nights.some(n => n.seeded))
  const views: (ViewMode | 'auto')[] = ['auto', 'phone', 'room', 'dual']
  return (
    <Section title={t('view')}>
      <div className="pp__seg pp__seg--wide" role="group">
        {views.map(v => (
          <button key={v} type="button" className={view === v ? 'is-on' : ''} data-testid={`pp-view-${v}`} aria-pressed={view === v} onClick={() => fire({ t: 'view', v })}>
            {t(`view.${v}` as PresenterKey)}
          </button>
        ))}
      </div>
      <div className="pp__grid pp__grid--tools">
        <Btn id="lang" label={t('cmd.lang')} onClick={() => fire({ t: 'localeCycle' })} />
        <Btn id="lens" label={t('cmd.lens')} on={lens} tone="cyan" onClick={() => naviApi.getState().toggleLens()} />
        <Btn id="split" label={t('cmd.split')} on={split} tone="cyan" onClick={() => naviApi.getState().toggleSplit()} />
        <Btn id="noduck" label={t('cmd.noduck')} on={noDuck} onClick={() => naviApi.getState().setNoDuck(!noDuck)} />
        <Btn id="seed" label={t('cmd.seed')} on={seeded} onClick={() => fire({ t: 'seedNights', n: 2 })} />
        <Btn id="entry" label={t('cmd.entry')} onClick={() => naviApi.getState().setOverlay('entry')} />
        <Btn id="reset" label={t('cmd.reset')} tone="rose" wide onClick={() => fire({ t: 'reset' })} />
      </div>
    </Section>
  )
}

// ---------------------------------------------------------------- metrics HUD (H-6)

const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : '--')

function useLiveMs(): number | null {
  const first = useNavi(s => s.metrics.firstReserveMs)
  const enteredAt = useNavi(s => s.session.enteredAt)
  const live = useNavi(s => s.session.phase === 'live')
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (first != null || !live) return
    const id = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(id)
  }, [first, live])
  if (first != null) return first
  return live ? Math.max(0, now - enteredAt) : null
}

function Hud() {
  const t = P.useT()
  const m = useNavi(s => s.metrics)
  const ttfr = useLiveMs()
  const done = useNavi(s => s.metrics.firstReserveMs != null)
  const allKnow = useNaviStable(s => {
    const ids = presentMembers(s).map(x => x.id)
    const tallies = Object.values(s.room.knowing)
    return { n: tallies.length, all: tallies.filter(x => knowView(x, ids).all).length }
  })
  const secs = ttfr == null ? '--' : (ttfr / 1000).toFixed(1)
  const prog = ttfr == null ? 0 : Math.min(1, ttfr / 180_000)
  return (
    <Section
      title={t('hud')}
      right={
        <button type="button" className="pp__mini" data-testid="pp-metrics-reset" onClick={() => naviApi.getState().resetMetrics()}>
          {t('hud.reset')}
        </button>
      }
    >
      <div className={`pp__ttfr${done ? ' is-done' : ''}`} data-testid="pp-hud-ttfr">
        <span className="pp__k">{t('hud.ttfr')}</span>
        <b>
          {secs}
          <small>s</small>
        </b>
        <span className="pp__k pp__k--dim">{done ? t('hud.target', { s: 180 }) : `${t('hud.timing')} · ${t('hud.target', { s: 180 })}`}</span>
        <span className="pp__bar">
          <i style={{ transform: `scaleX(${prog})` }} />
        </span>
      </div>
      <div className="pp__kinds" aria-label={t('hud.kinds')}>
        {KINDS.map(k => {
          const shown = m.shown[k] ?? 0
          const acted = m.acted[k] ?? 0
          return (
            <span key={k} className={`pp__kind${acted ? ' is-acted' : shown ? ' is-shown' : ''}`}>
              <em>{k}</em>
              <b>
                {shown}/{acted}
              </b>
            </span>
          )
        })}
      </div>
      <dl className="pp__stats">
        <dt>{t('hud.co')}</dt>
        <dd>
          {pct(m.co.picked, m.co.shown)} <small>{m.co.picked}/{m.co.shown}</small>
        </dd>
        <dt>{t('hud.tag')}</dt>
        <dd>
          {pct(m.tag.picked, m.tag.shown)} <small>{m.tag.picked}/{m.tag.shown}</small>
        </dd>
        <dt>{t('hud.allKnow')}</dt>
        <dd>
          {pct(allKnow.all, allKnow.n)} <small>{allKnow.all}/{allKnow.n}</small>
        </dd>
        <dt>{t('hud.mo')}</dt>
        <dd>
          {m.mo.placed} / {m.mo.dupBlocked} / {m.mo.afterExitBlocked}
        </dd>
        <dt>{t('hud.voice')}</dt>
        <dd>
          {pct(m.voiceToReserve, m.shown.voice ?? 0)} <small>{m.voiceToReserve}/{m.shown.voice ?? 0}</small>
        </dd>
        <dt>{t('hud.import')}</dt>
        <dd>
          {pct(m.importSaved, m.shown.import ?? 0)} <small>{m.importSaved}/{m.shown.import ?? 0}</small>
        </dd>
        <dt>{t('hud.search')}</dt>
        <dd>
          {m.search.queries} / {m.search.misses}
        </dd>
        <dt>{t('hud.survey')}</dt>
        <dd>{m.survey ? `${m.survey.findEase} ${m.survey.surprise} ${m.survey.fun} ${m.survey.again}${m.survey.why.length ? ` · ${m.survey.why.join(',')}` : ''}` : '--'}</dd>
      </dl>
      <div className="pp__note">{t('hud.note')}</div>
    </Section>
  )
}

// ---------------------------------------------------------------- the full panel

function FullPanel({ sheet }: { sheet: boolean }) {
  const t = P.useT()
  const minutes = useNavi(s => roomMinutesLeft(s.session.simMs))
  const n = useNavi(s => presentMembers(s).length)
  const seed = useNavi(s => s.session.seed)
  const phase = useNavi(s => s.session.phase)
  return (
    <motion.aside
      className={`pp${sheet ? ' is-sheet' : ''}`}
      data-testid="presenter-panel"
      data-mini="0"
      initial={{ opacity: 0, y: sheet ? -40 : -10, scale: sheet ? 1 : 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: sheet ? -40 : -10 }}
      transition={{ type: 'spring', stiffness: 380, damping: 32 }}
      onPointerDown={e => e.stopPropagation()}
    >
      <header className="pp__head">
        <span className="pp__rec" aria-hidden="true" />
        <b>{t('title')}</b>
        <span className="pp__meta">
          {phase === 'live' ? t('meta.left', { m: minutes }) : phase.toUpperCase()} · {t('meta.members', { n })} · {seed}
        </span>
        <button type="button" className="pp__icon" data-testid="pp-collapse" aria-label={t('collapse')} title={t('collapse')} onClick={() => usePP.setState({ mini: true, menu: false })}>
          –
        </button>
        <button type="button" className="pp__icon" data-testid="pp-close" aria-label={t('close')} onClick={() => naviApi.getState().togglePresenter()}>
          ×
        </button>
      </header>
      <div className="pp__scroll">
        <ScriptBlock />
        <RoomBlock />
        <ViewBlock />
        <Hud />
      </div>
    </motion.aside>
  )
}

// ---------------------------------------------------------------- the pill

type Rect = { l: number; t: number; w: number; h: number }
type Place = { base: Rect; bounds: { top: number; bottom: number; left: number; right: number } }

const rectOf = (sel: string): DOMRect | null => {
  const el = typeof document !== 'undefined' ? document.querySelector(sel) : null
  const r = el?.getBoundingClientRect()
  return r && r.width > 2 && r.height > 2 ? r : null
}

/**
 * Where the pill rests and how far it may be dragged. Phone: on the tab bar (the card and its
 * buttons stay free: beat 8's order button, beat 7's quiz), never above the queue and the
 * search bar. Wide: bottom-right, 16 px in, never over the status bar.
 */
function place(narrow: boolean, box: { w: number; h: number }): Place {
  if (narrow) {
    const shell = rectOf('[data-shell=phone]')
    const left0 = shell ? shell.left : 0
    const width0 = shell ? shell.width : box.w
    const w = Math.min(PILL_W, width0 - 2 * 12)
    const dock = rectOf('[data-shell=phone] .dock')
    const top = dock ? dock.top + Math.max(4, (dock.height - PILL_H) / 2 - 4) : box.h - PILL_H - 14
    const lane = rectOf('[data-shell=phone] [data-testid=stage-lane]')
    const search = rectOf('[data-shell=phone] [data-testid=search-bar]')
    const minTop = Math.max(lane?.bottom ?? 110, search?.bottom ?? 0) + 8
    return {
      base: { l: left0 + (width0 - w) / 2, t: Math.min(top, box.h - PILL_H - 4), w, h: PILL_H },
      bounds: { top: minTop, bottom: box.h - 4, left: 4, right: box.w - 4 },
    }
  }
  const status = [...document.querySelectorAll('header.status')].reduce((b, e) => Math.max(b, e.getBoundingClientRect().bottom), 0)
  const w = Math.min(PILL_W, box.w - 2 * INSET)
  return {
    base: { l: box.w - INSET - w, t: box.h - INSET - PILL_H, w, h: PILL_H },
    bounds: { top: (status || 48) + 6, bottom: box.h - 4, left: 4, right: box.w - 4 },
  }
}

function PillMenu({ below, forced }: { below: boolean; forced: boolean }) {
  const t = P.useT()
  const lens = useNavi(s => s.ui.lens)
  const split = useNavi(s => s.ui.split)
  const jun = useNavi(s => s.room.members.jun.present)
  const live = useNavi(s => s.session.phase === 'live')
  const close = () => usePP.setState({ menu: false })
  const item = (id: string, label: string, run: () => void, o: { on?: boolean; disabled?: boolean; key?: string } = {}) => (
    <button
      type="button"
      className={`pp-menu__item${o.on ? ' is-on' : ''}`}
      data-testid={`pp-${id}`}
      aria-pressed={o.on}
      disabled={o.disabled}
      onClick={() => {
        close()
        run()
      }}
    >
      <span>{label}</span>
      {o.key ? <kbd>{o.key}</kbd> : null}
    </button>
  )
  return (
    <motion.div
      className={`pp-menu${below ? ' is-below' : ''}`}
      data-testid="pp-menu"
      role="group"
      aria-label={t('more')}
      initial={{ opacity: 0, y: below ? -6 : 6, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: below ? -6 : 6, scale: 0.96 }}
      transition={{ type: 'spring', stiffness: 520, damping: 34 }}
    >
      {item('split', t('cmd.split'), () => naviApi.getState().toggleSplit(), { on: split, key: 'S' })}
      {item('lens', t('cmd.lens'), () => naviApi.getState().toggleLens(), { on: lens, key: 'L' })}
      {item('join', t('cmd.join'), () => fire({ t: 'join', id: 'jun' }), { on: jun, disabled: !live || jun })}
      {forced ? null : item('open', t('open'), () => usePP.setState({ mini: false }))}
      {item('close', t('close'), () => naviApi.getState().togglePresenter())}
    </motion.div>
  )
}

function Pill({ narrow, forced }: { narrow: boolean; forced: { split: boolean; lens: boolean } | null }) {
  const t = P.useT()
  const box = useBox()
  const nx = useNextStep()
  const last = useSim(u => u.lastStep)
  const menu = usePP(u => u.menu)
  const mode = narrow ? 'narrow' : 'wide'
  const stored = usePP.getState().offset[mode]
  const x = useMotionValue(stored.x)
  const y = useMotionValue(stored.y)
  const drag = useDragControls()
  const [pl, setPl] = useState<Place>(() => place(narrow, box))
  const hold = useRef<ReturnType<typeof setTimeout> | null>(null)
  const ref = useRef<HTMLElement>(null)

  // measure once the phone shell has laid out, and again when the box changes
  useLayoutEffect(() => {
    const p = place(narrow, box)
    setPl(p)
    // keep a dragged pill inside the new bounds
    const cx = Math.min(p.bounds.right - (p.base.l + p.base.w), Math.max(p.bounds.left - p.base.l, x.get()))
    const cy = Math.min(p.bounds.bottom - (p.base.t + p.base.h), Math.max(p.bounds.top - p.base.t, y.get()))
    x.set(cx)
    y.set(cy)
  }, [narrow, box.w, box.h])

  // tap outside or Escape closes the menu
  useEffect(() => {
    if (!menu) return
    const down = (e: PointerEvent) => {
      if (ref.current && e.target instanceof Node && ref.current.contains(e.target)) return
      usePP.setState({ menu: false })
    }
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') usePP.setState({ menu: false })
    }
    window.addEventListener('pointerdown', down, true)
    window.addEventListener('keydown', key)
    return () => {
      window.removeEventListener('pointerdown', down, true)
      window.removeEventListener('keydown', key)
    }
  }, [menu])

  const stopHold = () => {
    if (hold.current) clearTimeout(hold.current)
    hold.current = null
  }
  useEffect(() => stopHold, [])
  const onGrip = (e: ReactPointerEvent) => {
    drag.start(e)
    stopHold()
    // the drag may capture the pointer: listen for the release on the window as well
    window.addEventListener('pointerup', stopHold, { once: true })
    window.addEventListener('pointercancel', stopHold, { once: true })
    hold.current = setTimeout(() => {
      hold.current = null
      usePP.setState({ menu: true })
    }, 520)
  }

  const { base, bounds } = pl
  const constraints = { top: bounds.top - base.t, bottom: bounds.bottom - (base.t + base.h), left: bounds.left - base.l, right: bounds.right - (base.l + base.w) }
  const below = base.t + y.get() < 260
  return (
    <motion.aside
      ref={ref}
      className={`pp-pill${narrow ? ' is-narrow' : ''}${forced ? ' is-forced' : ''}${menu ? ' has-menu' : ''}`}
      data-testid="presenter-panel"
      data-mini="1"
      data-pill={forced ? 'forced' : '1'}
      style={{ left: base.l, top: base.t, width: base.w, x, y }}
      drag
      dragListener={false}
      dragControls={drag}
      dragMomentum={false}
      dragElastic={0.05}
      dragConstraints={constraints}
      onDragStart={stopHold}
      onDragEnd={() => usePP.setState(u => ({ offset: { ...u.offset, [mode]: { x: x.get(), y: y.get() } } }))}
      initial={{ opacity: 0, scale: 0.92 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.92 }}
      transition={{ type: 'spring', stiffness: 420, damping: 30 }}
      onPointerDown={e => e.stopPropagation()}
    >
      {/* each → press sweeps a light across the pill, so the presenter sees it landed */}
      <span className="pp-pill__clip" aria-hidden="true">
        {last ? <span key={last.at} className="pp__nextflash" /> : null}
      </span>
      <div className="pp-pill__grip" title={t('grip')} onPointerDown={onGrip} onPointerUp={stopHold} onPointerCancel={stopHold} onContextMenu={e => e.preventDefault()}>
        <span className="pp__rec" aria-hidden="true" />
        <span className="pp-pill__idx">
          {nx.over ? '--' : String(nx.n).padStart(2, '0')}
          <small>/{String(nx.total).padStart(2, '0')}</small>
        </span>
        <span className="pp-pill__txt">
          <AnimatePresence mode="wait" initial={false}>
            <motion.b key={nx.label} initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -5 }} transition={{ duration: 0.14 }}>
              {nx.label}
            </motion.b>
          </AnimatePresence>
        </span>
        {forced ? (
          <span className="pp-pill__why" title={t('forced')}>
            {forced.split ? <i>S</i> : null}
            {forced.lens ? <i>L</i> : null}
          </span>
        ) : null}
      </div>
      <motion.button type="button" className="pp-pill__go" data-testid="pp-next" data-step={nx.id} disabled={nx.over} aria-label={`${t('upcoming')}: ${nx.label}`} whileTap={{ scale: 0.9 }} onClick={() => fire({ t: 'next' })}>
        →
      </motion.button>
      <button type="button" className="pp-pill__icon" data-testid="pp-more" aria-label={t('more')} aria-expanded={menu} onClick={() => usePP.setState(u => ({ menu: !u.menu }))}>
        ⋯
      </button>
      {forced ? null : (
        <button type="button" className="pp-pill__icon" data-testid="pp-collapse" aria-label={t('expand')} title={t('expand')} onClick={() => usePP.setState({ mini: false, menu: false })}>
          +
        </button>
      )}
      <AnimatePresence>{menu ? <PillMenu key="menu" below={below} forced={!!forced} /> : null}</AnimatePresence>
    </motion.aside>
  )
}

// ---------------------------------------------------------------- the panel

function Panel() {
  const box = useBox()
  const narrow = box.w < NARROW
  const mini = usePP(u => u.mini)
  const split = useNavi(s => s.ui.split)
  const lens = useNavi(s => s.ui.lens)
  // the split and the lens are what the audience looks at: the panel steps aside for them
  const forced = split || lens ? { split, lens } : null
  if (mini || forced) return <Pill narrow={narrow} forced={forced} />
  return <FullPanel sheet={narrow} />
}

export function PresenterPanel(): JSX.Element {
  const open = useNavi(s => s.ui.presenter)
  // a fresh open never starts with a stale menu
  useEffect(() => {
    if (!open) usePP.setState({ menu: false })
  }, [open])
  return <AnimatePresence>{open ? <Panel key="pp" /> : null}</AnimatePresence>
}
