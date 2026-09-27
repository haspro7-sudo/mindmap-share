// Planning lens (SPEC H-1..H-3): a blueprint layer for the pitch room. It finds every visible
// [data-anchor] (MutationObserver, throttled to 200 ms), frames it with a dashed cyan line and
// a label "5-2 <measure> | <ways> | <metric>". A label opens the detail panel: the measure's
// concrete initiatives, how this element serves it, the metric with the value measured right now,
// the evidence-vs-hypothesis note and the future note. The bottom legend lights the measures and
// ways to win present on screen, never as percentages. Off by default; not persisted.
// All visible text comes from the planner strings (ja + en).
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from 'react'
import { useNavi } from '../../core/store'
import { useNaviStable } from '../../core/useStable'
import { useViewMode } from '../../core/layout'
import type { DeckCard, PolicyAnchor, PolicyId, Source } from '../../core/types'
import { useLocale, useTr } from '../../i18n'
import { planner } from './strings'
import { POLICY_MAP, POLICIES, WAYS, INITIATIVES, IMPLICIT_ANCHORS, evidenceFor, measure, elementName, shortMetric, hereText, policyName, wayName, tonightLit } from './policyMap'
import './planner.css'

type Item = { key: string; anchor: PolicyAnchor; x: number; y: number; w: number; h: number; n: number }

const SAMPLE: [number, number][] = [
  [0.5, 0.5],
  [0.2, 0.25],
  [0.8, 0.25],
  [0.2, 0.8],
  [0.8, 0.8],
]

/** Is the element really on screen (not hidden, faded out, off-screen or under a sheet)? */
function visibleRect(el: HTMLElement, root: HTMLElement | null): DOMRect | null {
  const r = el.getBoundingClientRect()
  const vw = window.innerWidth
  const vh = window.innerHeight
  if (r.width < 8 || r.height < 8 || r.bottom <= 0 || r.right <= 0 || r.top >= vh || r.left >= vw) return null
  const cv = (el as HTMLElement & { checkVisibility?: (o: Record<string, boolean>) => boolean }).checkVisibility
  if (cv && !cv.call(el, { checkOpacity: true, checkVisibilityCSS: true, opacityProperty: true, visibilityProperty: true })) return null
  for (const [fx, fy] of SAMPLE) {
    const x = Math.min(vw - 1, Math.max(1, r.left + r.width * fx))
    const y = Math.min(vh - 1, Math.max(1, r.top + r.height * fy))
    const hit = document.elementFromPoint(x, y)
    if (!hit) continue
    if (el.contains(hit) || hit.contains(el) || (root && root.contains(hit))) return r
  }
  return null
}

function collect(root: HTMLElement | null): Item[] {
  const found: { el: HTMLElement; anchor: string; r: DOMRect }[] = []
  const explicit = new Set<string>()
  document.querySelectorAll<HTMLElement>('[data-anchor]').forEach(el => {
    const a = el.dataset.anchor
    if (!a || (root && root.contains(el))) return
    const r = visibleRect(el, root)
    if (!r) return
    found.push({ el, anchor: a, r })
    explicit.add(a)
  })
  for (const [sel, a] of IMPLICIT_ANCHORS) {
    if (explicit.has(a)) continue
    for (const el of Array.from(document.querySelectorAll<HTMLElement>(sel))) {
      const r = visibleRect(el, root)
      if (r) {
        found.push({ el, anchor: a, r })
        break
      }
    }
  }
  // an anchor nested in another with the same id is the same element for the lens
  const kept = found.filter(f => !found.some(o => o !== f && o.anchor === f.anchor && o.el.contains(f.el)))
  const count = new Map<string, number>()
  return kept
    .sort((a, b) => a.r.top - b.r.top || a.r.left - b.r.left)
    .map((f, i) => {
      const k = count.get(f.anchor) ?? 0
      count.set(f.anchor, k + 1)
      return { key: `${f.anchor}#${k}`, anchor: f.anchor, x: Math.round(f.r.left), y: Math.round(f.r.top), w: Math.round(f.r.width), h: Math.round(f.r.height), n: i + 1 }
    })
}

const sameItems = (a: Item[], b: Item[]) => a.length === b.length && a.every((x, i) => x.key === b[i].key && x.x === b[i].x && x.y === b[i].y && x.w === b[i].w && x.h === b[i].h)

/** Rough label width for the monospace chip (CJK glyphs are about twice as wide). */
function textWidth(s: string, px = 11): number {
  let w = 0
  for (const ch of s) w += ch.charCodeAt(0) > 0x2e80 ? px : px * 0.61
  return w
}

type Placed = { item: Item; x: number; y: number; w: number }

/** Put each label at the top-left of its frame, nudging it down when labels would overlap. */
function placeLabels(items: Item[], widths: Map<string, number>, vw: number, vh: number): Placed[] {
  const out: Placed[] = []
  const H = 20
  for (const it of items) {
    const w = Math.min(widths.get(it.key) ?? 160, vw - 8)
    let x = Math.max(4, Math.min(it.x, vw - w - 4))
    let y = it.y - H - 3 >= 2 ? it.y - H - 3 : it.y + 3
    for (let tries = 0; tries < 8; tries++) {
      const clash = out.find(p => x < p.x + p.w + 4 && p.x < x + w + 4 && y < p.y + H + 2 && p.y < y + H + 2)
      if (!clash) break
      y = clash.y + H + 3
      if (y > vh - H - 70) {
        y = it.y + 3
        x = Math.max(4, Math.min(clash.x + clash.w + 6, vw - w - 4))
      }
    }
    out.push({ item: it, x, y, w })
  }
  return out
}

function useAnchors(rootRef: RefObject<HTMLDivElement>): Item[] {
  const [items, setItems] = useState<Item[]>([])
  useEffect(() => {
    let timer = 0
    let last = 0
    const run = () => {
      timer = 0
      last = performance.now()
      const next = collect(rootRef.current)
      setItems(prev => (sameItems(prev, next) ? prev : next))
    }
    const kick = () => {
      if (timer) return
      timer = window.setTimeout(run, Math.max(0, 200 - (performance.now() - last)))
    }
    // wait one frame so the wipe starts on a settled layout
    const first = requestAnimationFrame(run)
    const mo = new MutationObserver(kick)
    mo.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-anchor', 'data-active', 'data-sheet', 'data-testid', 'hidden', 'class', 'aria-hidden'] })
    // springs and sheets move without mutations: a slow poll keeps frames on their elements
    const poll = window.setInterval(kick, 700)
    window.addEventListener('resize', kick)
    return () => {
      cancelAnimationFrame(first)
      mo.disconnect()
      window.clearInterval(poll)
      window.removeEventListener('resize', kick)
      if (timer) window.clearTimeout(timer)
    }
  }, [rootRef])
  return items
}

const pad = (n: number) => String(n).padStart(2, '0')

function Frame({ item, first }: { item: Item; first: boolean }) {
  const known = !!POLICY_MAP[item.anchor]
  return (
    <div className={`lens-frame${known ? '' : ' is-unknown'}`} style={{ left: item.x, top: item.y, width: item.w, height: item.h }}>
      <motion.div
        className="lens-frame__box"
        initial={{ opacity: 0, scale: 1.04 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.28, delay: first ? 0.18 + item.n * 0.035 : 0 }}
      >
        <i className="lens-frame__c lens-frame__c--tl" />
        <i className="lens-frame__c lens-frame__c--tr" />
        <i className="lens-frame__c lens-frame__c--bl" />
        <i className="lens-frame__c lens-frame__c--br" />
        <span className="lens-frame__id">{item.anchor}</span>
      </motion.div>
    </div>
  )
}

function useLabelText() {
  const tr = useTr()
  const t = planner.useT()
  return (anchor: PolicyAnchor) => {
    const e = POLICY_MAP[anchor]
    if (!e) return { pol: anchor, ways: '', metric: '' }
    // the first measure by name, the others by number (keeps labels short on a phone)
    const pol = `${e.policies[0]} ${tr(policyName(e.policies[0]))}${e.policies.slice(1).map(p => ` +${p}`).join('')}`
    const ways = e.ways.map(w => tr(wayName(w))).join(t('lens.join'))
    const sm = shortMetric(anchor)
    return { pol, ways, metric: sm ? `${t('lens.metricPrefix')}${tr(sm)}` : '' }
  }
}

function Label({ p, active, onTap, first }: { p: Placed; active: boolean; onTap: () => void; first: boolean }) {
  const text = useLabelText()(p.item.anchor)
  return (
    <motion.button
      type="button"
      className={`lens-tag${active ? ' is-active' : ''}`}
      data-testid="lens-tag"
      data-anchor={p.item.anchor}
      style={{ left: p.x, top: p.y, maxWidth: p.w }}
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, delay: first ? 0.3 + p.item.n * 0.04 : 0 }}
      onClick={onTap}
    >
      <span className="lens-tag__n">{pad(p.item.n)}</span>
      <span className="lens-tag__p">{text.pol}</span>
      {text.ways ? <span className="lens-tag__w">{text.ways}</span> : null}
      {text.metric ? <span className="lens-tag__m">{text.metric}</span> : null}
    </motion.button>
  )
}

function Legend({ items }: { items: Item[] }) {
  const tr = useTr()
  const t = planner.useT()
  const locale = useLocale()
  // after the night (the wrap), the legend lights what really ran tonight instead of the screen
  const closing = useNavi(s => s.session.phase !== 'live')
  const tonight = useNaviStable(s => tonightLit(s, locale))
  const lit = useMemo(() => {
    const p = new Set<PolicyId>()
    const w = new Set<Source>()
    if (closing) {
      tonight.policies.forEach(x => p.add(x))
      tonight.ways.forEach(x => w.add(x))
      return { p, w }
    }
    for (const it of items) {
      const e = POLICY_MAP[it.anchor]
      if (!e) continue
      e.policies.forEach(x => p.add(x))
      e.ways.forEach(x => w.add(x))
    }
    return { p, w }
  }, [items, closing, tonight])
  return (
    <motion.div
      className={`lens-legend${closing ? ' is-closing' : ''}`}
      data-testid="lens-legend"
      data-mode={closing ? 'tonight' : 'screen'}
      initial={{ y: 30, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: 30, opacity: 0 }}
      transition={{ duration: 0.3, delay: 0.25 }}
    >
      <div className="lens-legend__top">
        <div className="lens-legend__brand">
          <b>{t('lens.title')}</b>
          <span>{closing ? t('lens.tonight') : t('lens.count', { n: items.length })}</span>
        </div>
        <div className="lens-legend__row lens-legend__row--ways" aria-label={t('lens.legendWays')}>
          {WAYS.map((w, i) => (
            <motion.span
              key={w}
              className={`lens-way${lit.w.has(w) ? ' is-lit' : ''}`}
              data-way={w}
              data-lit={lit.w.has(w) ? '1' : '0'}
              title={tr({ key: `planner.wayDesc.${w}` })}
              initial={{ scale: 0.6, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: 'spring', stiffness: 500, damping: 22, delay: 0.45 + i * 0.06 }}
            >
              {tr(wayName(w))}
            </motion.span>
          ))}
        </div>
      </div>
      <div className="lens-legend__row lens-legend__row--pol" aria-label={t('lens.legendPolicies')}>
        {POLICIES.map((p, i) => (
          <motion.span
            key={p}
            className={`lens-pol${lit.p.has(p) ? ' is-lit' : ''}`}
            data-policy={p}
            data-lit={lit.p.has(p) ? '1' : '0'}
            initial={{ y: 6, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ duration: 0.25, delay: 0.35 + i * 0.06 }}
          >
            <b>{p}</b>
            {tr(policyName(p))}
          </motion.span>
        ))}
      </div>
    </motion.div>
  )
}

/** The card the lens explains when a card anchor is chosen: the top card of the hand. */
function useTopCard(): Pick<DeckCard, 'rule' | 'trigger' | 'reason' | 'kind'> | null {
  return useNaviStable(s => {
    const c = s.deck.cards[0]
    return c ? { rule: c.rule, trigger: c.trigger, reason: c.reason, kind: c.kind } : null
  })
}

function Detail({ item, onClose, wide }: { item: Item; onClose: () => void; wide: boolean }) {
  const tr = useTr()
  const t = planner.useT()
  const locale = useLocale()
  const e = POLICY_MAP[item.anchor]
  const top = useTopCard()
  const [privateOnRoom, setPrivate] = useState(0)
  useEffect(() => {
    if (item.anchor !== 'room-view') return
    const count = () => {
      const room = document.querySelectorAll('[data-shell="room"] [data-private="1"], [data-testid="room-board"] [data-private="1"]')
      setPrivate(Array.from(room).filter(el => (el as HTMLElement).getClientRects().length > 0).length)
    }
    count()
    const id = window.setInterval(count, 1000)
    return () => window.clearInterval(id)
  }, [item.anchor])
  // live values: re-read on every store change that matters (metrics, room, deck, collection)
  const value = useNaviStable(s => measure(item.anchor, s, { privateOnRoom, locale }))
  const evidence = useNaviStable(s => evidenceFor(item.anchor, s))
  const here = hereText(item.anchor)
  const isCard = item.anchor.startsWith('card:')
  return (
    <motion.aside
      className={`lens-panel${wide ? ' is-wide' : ''}`}
      data-testid="lens-detail"
      data-anchor-detail={item.anchor}
      initial={{ opacity: 0, y: wide ? 0 : 28, x: wide ? 28 : 0 }}
      animate={{ opacity: 1, y: 0, x: 0 }}
      exit={{ opacity: 0, y: wide ? 0 : 28, x: wide ? 28 : 0 }}
      transition={{ type: 'spring', stiffness: 260, damping: 26 }}
    >
      <header className="lens-panel__head">
        <span className="lens-panel__n">{pad(item.n)}</span>
        <div className="lens-panel__title">
          <b>{tr(elementName(item.anchor))}</b>
          <code>{item.anchor}</code>
        </div>
        <button type="button" className="lens-panel__x" onClick={onClose} aria-label={t('lens.close')}>
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
            <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.6" fill="none" />
          </svg>
        </button>
      </header>
      {e ? (
        <div className="lens-panel__chips">
          {e.policies.map(p => (
            <span key={p} className="lens-chip">
              <b>{p}</b>
              {tr(policyName(p))}
            </span>
          ))}
          {e.ways.map(w => (
            <span key={w} className="lens-chip lens-chip--way" title={tr({ key: `planner.wayDesc.${w}` })}>
              {tr(wayName(w))}
            </span>
          ))}
        </div>
      ) : null}
      <div className="lens-panel__body">
        {e ? (
          <section className="lens-sec lens-sec--metric">
            <h4>{t('lens.metric')}</h4>
            <p className="lens-sec__metric">{tr(e.metric)}</p>
            <div className="lens-now">
              <span className="lens-now__label">
                <i className="lens-now__dot" />
                {t('lens.now')}
              </span>
              {value.main ? <strong className="lens-now__v">{tr(value.main)}</strong> : <strong className="lens-now__v">{t('val.none')}</strong>}
              {value.lines.map((l, i) => (
                <span key={i} className="lens-now__line">
                  {tr(l)}
                </span>
              ))}
            </div>
          </section>
        ) : null}
        {here ? (
          <section className="lens-sec">
            <h4>{t('lens.here')}</h4>
            <p>{tr(here)}</p>
          </section>
        ) : null}
        {isCard && top ? (
          <section className="lens-sec lens-sec--why">
            <h4>{t('lens.why')}</h4>
            <p>
              <span className="lens-k">{t('lens.reason')}</span>
              {tr(top.reason.text)}
              {top.reason.cause ? <em className="lens-cause">{tr(top.reason.cause)}</em> : null}
            </p>
            <p>
              <span className="lens-k">{t('lens.trigger')}</span>
              {tr({ key: `planner.trig.${top.trigger.type}` })}
            </p>
            <p>
              <span className="lens-k">{t('lens.rule')}</span>
              <code>{top.rule}</code>
            </p>
          </section>
        ) : null}
        {e ? (
          <section className="lens-sec">
            <h4>{t('lens.initiatives')}</h4>
            {e.policies.map(p => (
              <div key={p} className="lens-init">
                <p className="lens-init__sum">
                  <b>{p}</b> {tr({ key: `planner.policySum.${p}` })}
                </p>
                <ul>
                  {INITIATIVES[p].map(k => (
                    <li key={k}>{t(k)}</li>
                  ))}
                </ul>
              </div>
            ))}
          </section>
        ) : null}
        <section className="lens-sec lens-sec--evi">
          <h4>{t('lens.evidence')}</h4>
          {evidence.map((x, i) => (
            <p key={i}>{tr(x)}</p>
          ))}
        </section>
        {e?.note ? (
          <section className="lens-sec lens-sec--future">
            <h4>{t('lens.future')}</h4>
            <p>{tr(e.note)}</p>
          </section>
        ) : null}
        {e?.ways.length ? (
          <section className="lens-sec">
            <h4>{t('lens.ways')}</h4>
            {e.ways.map(w => (
              <p key={w} className="lens-waydesc">
                <b>{tr(wayName(w))}</b>
                {tr({ key: `planner.wayDesc.${w}` })}
              </p>
            ))}
          </section>
        ) : null}
      </div>
    </motion.aside>
  )
}

function LensLayer() {
  const rootRef = useRef<HTMLDivElement>(null)
  const items = useAnchors(rootRef)
  const view = useViewMode()
  const locale = useLocale()
  const [sel, setSel] = useState<string | null>(null)
  const [first, setFirst] = useState(true)
  const [box, setBox] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }))
  useEffect(() => {
    const id = window.setTimeout(() => setFirst(false), 1400)
    const onResize = () => setBox({ w: window.innerWidth, h: window.innerHeight })
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSel(null)
    }
    window.addEventListener('resize', onResize)
    window.addEventListener('keydown', onKey)
    return () => {
      window.clearTimeout(id)
      window.removeEventListener('resize', onResize)
      window.removeEventListener('keydown', onKey)
    }
  }, [])
  const labelText = useLabelText()
  const placed = useMemo(() => {
    const widths = new Map<string, number>()
    for (const it of items) {
      const tx = labelText(it.anchor)
      widths.set(it.key, Math.min(box.w >= 700 ? 300 : 250, 28 + textWidth(tx.pol, 10.5) + textWidth(tx.ways, 10.5) + textWidth(tx.metric, 10.5) + (tx.ways ? 13 : 0) + (tx.metric ? 13 : 0)))
    }
    return placeLabels(items, widths, box.w, box.h)
    // labelText depends on the locale only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, box.w, box.h, locale])
  const selected = items.find(i => i.key === sel) ?? null
  const wide = view !== 'phone' || box.w >= 700
  return (
    <motion.div
      ref={rootRef}
      className={`lens-root${wide ? ' is-wide' : ''}`}
      data-testid="lens-overlay"
      style={{ pointerEvents: 'none' } as CSSProperties}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
    >
      <div className="lens-grid" />
      <motion.div className="lens-scan" initial={{ y: '-30vh' }} animate={{ y: '110vh' }} transition={{ duration: 0.42, ease: [0.3, 0, 0.2, 1] }} />
      {items.map(it => (
        <Frame key={it.key} item={it} first={first} />
      ))}
      {placed.map(p => (
        <Label key={p.item.key} p={p} first={first} active={p.item.key === sel} onTap={() => setSel(s => (s === p.item.key ? null : p.item.key))} />
      ))}
      <Legend items={items} />
      <AnimatePresence>{selected ? <Detail key={selected.key} item={selected} wide={wide} onClose={() => setSel(null)} /> : null}</AnimatePresence>
    </motion.div>
  )
}

export function PolicyLens(): JSX.Element {
  const on = useNavi(s => s.ui.lens)
  return <AnimatePresence>{on ? <LensLayer key="lens" /> : null}</AnimatePresence>
}
