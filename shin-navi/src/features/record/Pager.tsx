// A horizontal pager for the record tab (QA OWNER#8): tonight's wall, the calendar and the pins
// sit side by side under the ball instead of as a stack of panels. Native scroll-snap does the
// swiping (no JS animation); the tabs follow the scroll position and jump to a page on tap.
import { useRef, useState, type ReactNode } from 'react'
import { sound } from '../../core/sound'

export type PagerPage = { id: string; label: string; aside?: string; node: ReactNode }

const GAP = 10

export function Pager({ pages, label, reduced }: { pages: PagerPage[]; label: string; reduced: boolean }) {
  const track = useRef<HTMLDivElement>(null)
  const [at, setAt] = useState(0)
  const step = () => {
    const el = track.current
    const first = el?.firstElementChild as HTMLElement | null
    return first ? first.offsetWidth + GAP : (el?.clientWidth ?? 1)
  }
  const onScroll = () => {
    const el = track.current
    if (!el) return
    const max = el.scrollWidth - el.clientWidth
    // the last page cannot snap to its start: treat "scrolled to the end" as the last page
    const i = el.scrollLeft >= max - 4 ? pages.length - 1 : Math.round(el.scrollLeft / step())
    const next = Math.max(0, Math.min(pages.length - 1, i))
    setAt(v => (v === next ? v : next))
  }
  const go = (i: number) => {
    const el = track.current
    if (!el) return
    if (i !== at) sound.play('flip')
    el.scrollTo({ left: i * step(), behavior: reduced ? 'auto' : 'smooth' })
    setAt(i)
  }
  return (
    <div className="rc-pager" data-testid="record-pager" data-page={pages[at]?.id}>
      <div className="rc-pager__tabs" role="tablist" aria-label={label}>
        {pages.map((p, i) => (
          <button
            key={p.id}
            type="button"
            role="tab"
            aria-selected={i === at}
            className={`rc-pager__tab${i === at ? ' is-on' : ''}`}
            data-testid="record-pager-tab"
            data-page={p.id}
            onClick={() => go(i)}
          >
            <span>{p.label}</span>
            {p.aside ? <b>{p.aside}</b> : null}
          </button>
        ))}
      </div>
      <div className="rc-pager__track" ref={track} onScroll={onScroll}>
        {pages.map((p, i) => (
          <section key={p.id} className={`rc-page rc-page--${p.id}${i === at ? ' is-on' : ''}`} data-testid="record-page" data-page={p.id} aria-label={p.label}>
            {p.node}
          </section>
        ))}
      </div>
      <div className="rc-pager__dots" aria-hidden="true">
        {pages.map((p, i) => (
          <i key={p.id} className={i === at ? 'is-on' : ''} />
        ))}
      </div>
    </div>
  )
}
