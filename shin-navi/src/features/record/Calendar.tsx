// Month calendar with night stamps (SPEC D-9). Record mode: stamped nights show their stamp
// (a tiny mirror ball in the night's colours with its constellation); tapping a night opens its
// page. Wrap mode: today's cell is pressed and held for 600 ms to stamp tonight — the ink
// bleeds out, a low "don" sounds and the phone buzzes. There is never a streak or a count of
// consecutive days anywhere.
import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent, type PointerEvent } from 'react'
import type { Night } from '../../core/types'
import { LOCALES, useLocale } from '../../i18n'
import { registerTarget } from '../../core/targets'
import { Icon } from '../../core/ui/Icon'
import { StampArt } from './parts'
import { displayPalette } from './nightName'
import { R } from './strings'

export const STAMP_HOLD_MS = 600

const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()

export type CalendarProps = {
  nights: Night[]
  tonightId: string
  mode: 'record' | 'wrap'
  onOpenNight?(id: string): void
  /** wrap mode: called when the 600 ms hold completes */
  onStamp?(): void
  /** wrap mode: share one hold with another press target (the big stamp) */
  hold?: ReturnType<typeof useHold>
}

type Cell = { day: number; date: Date } | null

function monthCells(y: number, m: number): Cell[] {
  const first = new Date(y, m, 1)
  const days = new Date(y, m + 1, 0).getDate()
  const cells: Cell[] = []
  for (let i = 0; i < first.getDay(); i++) cells.push(null)
  for (let d = 1; d <= days; d++) cells.push({ day: d, date: new Date(y, m, d) })
  while (cells.length % 7) cells.push(null)
  return cells
}

export function Calendar({ nights, tonightId, mode, onOpenNight, onStamp, hold }: CalendarProps) {
  const t = R.useT()
  const locale = useLocale()
  const lang = LOCALES.find(l => l.id === locale)?.htmlLang ?? 'ja'
  const today = useMemo(() => new Date(), [])
  const [view, setView] = useState(() => ({ y: today.getFullYear(), m: today.getMonth() }))
  const cells = useMemo(() => monthCells(view.y, view.m), [view.y, view.m])
  const tonight = nights.find(n => n.id === tonightId)

  const monthLabel = useMemo(() => {
    try {
      return new Intl.DateTimeFormat(lang, { year: 'numeric', month: 'long' }).format(new Date(view.y, view.m, 1))
    } catch {
      return `${view.y}-${view.m + 1}`
    }
  }, [lang, view.y, view.m])
  const weekdays = useMemo(() => {
    const out: string[] = []
    for (let i = 0; i < 7; i++) {
      try {
        out.push(new Intl.DateTimeFormat(lang, { weekday: 'narrow' }).format(new Date(2023, 0, 1 + i)))
      } catch {
        out.push('SMTWTFS'[i])
      }
    }
    return out
  }, [lang])

  // months that hold at least one night (for the arrows)
  const monthsWithNights = useMemo(() => {
    const set = new Set<number>()
    for (const n of nights) {
      const d = new Date(n.startedAt)
      set.add(d.getFullYear() * 12 + d.getMonth())
    }
    set.add(today.getFullYear() * 12 + today.getMonth())
    return [...set].sort((a, b) => a - b)
  }, [nights, today])
  const cur = view.y * 12 + view.m
  const prev = [...monthsWithNights].reverse().find(k => k < cur)
  const next = monthsWithNights.find(k => k > cur)
  const go = (k: number | undefined) => {
    if (k == null) return
    setView({ y: Math.floor(k / 12), m: k % 12 })
  }

  const nightsOn = (d: Date) => nights.filter(n => sameDay(new Date(n.startedAt), d))

  return (
    <div className={`rc-cal rc-cal--${mode}`}>
      <div className="rc-cal__bar">
        {mode === 'record' ? (
          <button type="button" className="rc-cal__nav is-prev" onClick={() => go(prev)} disabled={prev == null} aria-label={t('cal.prev')}>
            <Icon name="chevron" size={16} strokeWidth={2.2} />
          </button>
        ) : null}
        <span className="rc-cal__month">{monthLabel}</span>
        {mode === 'record' ? (
          <button type="button" className="rc-cal__nav" onClick={() => go(next)} disabled={next == null} aria-label={t('cal.next')}>
            <Icon name="chevron" size={16} strokeWidth={2.2} />
          </button>
        ) : null}
      </div>
      <div className="rc-cal__grid" role="grid">
        {weekdays.map((w, i) => (
          <span key={`w${i}`} className={`rc-cal__wd${i === 0 ? ' is-sun' : i === 6 ? ' is-sat' : ''}`}>
            {w}
          </span>
        ))}
        {cells.map((c, i) => {
          if (!c) return <span key={i} className="rc-cal__pad" />
          const isToday = sameDay(c.date, today)
          const on = nightsOn(c.date)
          if (isToday && mode === 'wrap') return <StampCell key={i} day={c.day} night={tonight} onStamp={onStamp} label={t('cal.press')} shared={hold} />
          const stampedNights = on.filter(n => n.stamped)
          const show = stampedNights[stampedNights.length - 1]
          const latest = on[on.length - 1]
          const stamped = stampedNights.length > 0
          return (
            <DayCell
              key={i}
              day={c.day}
              today={isToday}
              stamped={stamped}
              night={show}
              hasNight={!!latest}
              count={stampedNights.length}
              onOpen={latest && onOpenNight ? () => onOpenNight((show ?? latest).id) : undefined}
            />
          )
        })}
      </div>
    </div>
  )
}

function DayCell({ day, today, stamped, night, hasNight, count, onOpen }: { day: number; today: boolean; stamped: boolean; night?: Night; hasNight: boolean; count: number; onOpen?: () => void }) {
  const ref = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!today || !ref.current) return
    registerTarget('calendar:today', ref.current)
    return () => registerTarget('calendar:today', null)
  }, [today])
  return (
    <button
      ref={ref}
      type="button"
      className={`rc-cal__cell${today ? ' is-today' : ''}${stamped ? ' is-stamped' : ''}${hasNight ? ' has-night' : ''}`}
      data-testid="stamp-cell"
      data-today={today ? '1' : '0'}
      data-stamped={stamped ? '1' : '0'}
      onClick={onOpen}
      disabled={!onOpen}
    >
      <span className="rc-cal__day">{day}</span>
      {night ? <StampArt night={night} size={40} className="rc-cal__stamp" /> : hasNight ? <i className="rc-cal__dot" /> : null}
      {count > 1 ? <b className="rc-cal__count">{count}</b> : null}
    </button>
  )
}

/** Press-and-hold for 600 ms (the stamp). Cancels when the finger lifts or leaves early. */
export function useHold(onDone: (() => void) | undefined, disabled: boolean) {
  const timer = useRef<number | null>(null)
  const [press, setPress] = useState(false)
  useEffect(
    () => () => {
      if (timer.current != null) window.clearTimeout(timer.current)
    },
    [],
  )
  const cancel = () => {
    if (timer.current != null) window.clearTimeout(timer.current)
    timer.current = null
    setPress(false)
  }
  const down = (e: PointerEvent<HTMLElement>) => {
    e.stopPropagation()
    if (disabled || timer.current != null) return
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      /* synthetic pointer */
    }
    setPress(true)
    timer.current = window.setTimeout(() => {
      timer.current = null
      setPress(false)
      onDone?.()
    }, STAMP_HOLD_MS)
  }
  return {
    press,
    handlers: {
      onPointerDown: down,
      onPointerUp: cancel,
      onPointerCancel: cancel,
      onPointerLeave: cancel,
      onClick: (e: MouseEvent) => e.stopPropagation(),
      onKeyDown: (e: KeyboardEvent) => {
        if ((e.key === 'Enter' || e.key === ' ') && !disabled) {
          e.preventDefault()
          onDone?.()
        }
      },
      onContextMenu: (e: MouseEvent) => e.preventDefault(),
    },
  }
}

/** True once `stamped` flips to true while mounted (plays the landing only for a live stamp). */
export function useLanded(stamped: boolean): boolean {
  const [landed, setLanded] = useState(false)
  const was = useRef(stamped)
  useEffect(() => {
    if (stamped && !was.current) setLanded(true)
    was.current = stamped
  }, [stamped])
  return landed
}

/** Ink bleeding out from under a stamp, and a few droplets thrown by the thump. */
export function InkBurst({ palette, spread = 34 }: { palette: [string, string, string]; spread?: number }) {
  const drops = Array.from({ length: 10 }, (_, i) => {
    const a = (i / 10) * Math.PI * 2 + 0.3
    const d = spread * (0.9 + (i % 3) * 0.28)
    return { x: Math.cos(a) * d, y: Math.sin(a) * d, c: palette[i % 3], s: 4 + (i % 2) * 3 }
  })
  return (
    <>
      <span className="rc-ink" aria-hidden="true" style={{ ['--i1' as string]: palette[0], ['--i2' as string]: palette[1], ['--i3' as string]: palette[2] } as CSSProperties}>
        <i className="rc-ink__blob b1" />
        <i className="rc-ink__blob b2" />
        <i className="rc-ink__blob b3" />
        <i className="rc-ink__blob b4" />
      </span>
      {drops.map((d, i) => (
        <i
          key={i}
          className="rc-ink__drop"
          style={{ ['--dx' as string]: `${d.x.toFixed(1)}px`, ['--dy' as string]: `${d.y.toFixed(1)}px`, background: d.c, width: d.s, height: d.s } as CSSProperties}
        />
      ))}
    </>
  )
}

/** Wrap mode: today's cell. Hold 600 ms → the stamp lands with an ink bleed. */
function StampCell({ day, night, onStamp, label, shared }: { day: number; night?: Night; onStamp?: () => void; label: string; shared?: ReturnType<typeof useHold> }) {
  const ref = useRef<HTMLButtonElement>(null)
  const stamped = !!night?.stamped
  const own = useHold(onStamp, stamped)
  const hold = shared ?? own
  const landed = useLanded(stamped)
  useEffect(() => {
    if (!ref.current) return
    registerTarget('calendar:today', ref.current)
    return () => registerTarget('calendar:today', null)
  }, [])
  const pal = night ? displayPalette(night) : (['#8A6BFF', '#FF3DA8', '#2EF2FF'] as [string, string, string])
  return (
    <button
      ref={ref}
      type="button"
      className={`rc-cal__cell is-today is-stampable${hold.press ? ' is-press' : ''}${stamped ? ' is-stamped' : ''}${landed ? ' is-landed' : ''}`}
      data-testid="stamp-cell"
      data-today="1"
      data-stamped={stamped ? '1' : '0'}
      data-noadvance="1"
      style={{ ['--i1' as string]: pal[0], ['--i2' as string]: pal[1], ['--i3' as string]: pal[2] } as CSSProperties}
      {...hold.handlers}
    >
      <span className="rc-cal__day">{day}</span>
      {!stamped ? (
        <>
          <i className="rc-cal__halo" />
          <i className="rc-cal__charge" />
          <span className="rc-cal__press">{label}</span>
        </>
      ) : null}
      {stamped && night ? (
        <>
          {landed ? <InkBurst palette={pal} spread={30} /> : null}
          <StampArt night={night} size={46} className={`rc-cal__stamp${landed ? ' is-thump' : ''}`} />
        </>
      ) : null}
    </button>
  )
}
