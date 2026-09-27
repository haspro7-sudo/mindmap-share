// Presenter panel (SPEC E-14, H-6): triple-tap the brand or press "?". Compact, dark,
// monospace. Script toggle + NEXT with the upcoming step, speed, every room event, the view
// and demo tools, and the live metrics HUD. Everything goes through presenter/cmd so the
// → key, this panel and window.__navi.fire behave the same.
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import type { CardKind, PresenterCmd, ViewMode } from '../../core/types'
import { naviApi, presentMembers, useNavi } from '../../core/store'
import { useNaviStable } from '../../core/useStable'
import { useBox } from '../../core/layout'
import { bus } from '../../core/events'
import { knowView, roomMinutesLeft } from '../../core/rules'
import { songTitle, useLocale, useTr } from '../../i18n'
import { P, type PresenterKey } from './strings'
import { SCRIPT, nextStepIndex } from './script'
import { useSim } from './sim'
import './room.css'

const fire = (cmd: PresenterCmd) => bus.emit({ type: 'presenter/cmd', cmd })

const KINDS: CardKind[] = ['song', 'ask', 'link', 'gap', 'import', 'invite', 'shift', 'voice', 'coaster', 'finale']

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

// ---------------------------------------------------------------- script

function ScriptBlock() {
  const t = P.useT()
  const pos = useSim(u => u.scriptPos)
  const last = useSim(u => u.lastStep)
  const script = useNavi(s => s.session.script)
  const speed = useNavi(s => s.session.speed)
  const next = useNavi(s => nextStepIndex(s, pos))
  const over = next >= SCRIPT.length
  const label = over ? t('scriptDone') : t(`step.${SCRIPT[next].id}` as PresenterKey)
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
      <motion.button type="button" className={`pp__next${over ? ' is-over' : ''}`} data-testid="pp-next" data-step={over ? '' : SCRIPT[next].id} disabled={over} whileTap={{ scale: 0.97 }} onClick={() => fire({ t: 'next' })}>
        <span className="pp__nextidx">
          {over ? '--' : String(next + 1).padStart(2, '0')}
          <small>/{SCRIPT.length}</small>
        </span>
        <span className="pp__nexttxt">
          <small>{t('upcoming')}</small>
          <AnimatePresence mode="wait">
            <motion.b key={label} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.16 }}>
              {label}
            </motion.b>
          </AnimatePresence>
        </span>
        <span className="pp__nextkey" aria-hidden="true">
          →
        </span>
        {last ? <span key={last.at} className="pp__nextflash" aria-hidden="true" /> : null}
      </motion.button>
      <ol className="pp__rail" aria-label={t('script')}>
        {SCRIPT.map((s, i) => (
          <li key={s.id} className={i < next && i < pos ? 'is-done' : i === next ? 'is-next' : i < next ? 'is-skip' : ''}>
            <button type="button" data-testid={`pp-step-${s.id}`} title={`${i + 1}. ${t(`step.${s.id}` as PresenterKey)}`} onClick={() => fire({ t: 'step', id: s.id })}>
              <span />
            </button>
          </li>
        ))}
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

// ---------------------------------------------------------------- the panel

function Panel() {
  const t = P.useT()
  const box = useBox()
  const [mini, setMini] = useState(false)
  const minutes = useNavi(s => roomMinutesLeft(s.session.simMs))
  const n = useNavi(s => presentMembers(s).length)
  const seed = useNavi(s => s.session.seed)
  const phase = useNavi(s => s.session.phase)
  const sheet = box.w < 620
  return (
    <motion.aside
      className={`pp${sheet ? ' is-sheet' : ''}${mini ? ' is-mini' : ''}`}
      data-testid="presenter-panel"
      data-mini={mini ? '1' : '0'}
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
        <button type="button" className="pp__icon" data-testid="pp-collapse" aria-label={mini ? t('expand') : t('collapse')} onClick={() => setMini(v => !v)}>
          {mini ? '+' : '–'}
        </button>
        <button type="button" className="pp__icon" data-testid="pp-close" aria-label={t('close')} onClick={() => naviApi.getState().togglePresenter()}>
          ×
        </button>
      </header>
      <div className="pp__scroll">
        <ScriptBlock />
        {mini ? null : (
          <>
            <RoomBlock />
            <ViewBlock />
            <Hud />
          </>
        )}
      </div>
    </motion.aside>
  )
}

export function PresenterPanel(): JSX.Element {
  const open = useNavi(s => s.ui.presenter)
  return <AnimatePresence>{open ? <Panel key="pp" /> : null}</AnimatePresence>
}
