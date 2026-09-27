// Planning lens (SPEC H-1..H-3): a blueprint layer for the pitch room. It finds every visible
// [data-anchor] (MutationObserver, throttled to 200 ms), frames it with a dashed cyan line and
// a label "5-2 <measure> | <ways> | <metric>". A label opens the detail panel: the measure's
// concrete initiatives, how this element serves it, the metric with the value measured right now,
// the evidence-vs-hypothesis note and the future note. The bottom legend lights the measures and
// ways to win present on screen, never as percentages. Off by default; not persisted.
// All visible text comes from the planner strings (ja + en).
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from 'react'
import { useNavi } from '../../core/store'
import { useNaviStable } from '../../core/useStable'
import { useViewMode } from '../../core/layout'
import type { DeckCard, PolicyAnchor, PolicyId, Source } from '../../core/types'
import { useLocale, useTr } from '../../i18n'
import { planner } from './strings'
import { POLICY_MAP, POLICIES, WAYS, INITIATIVES, IMPLICIT_ANCHORS, evidenceFor, measure, elementName, shortMetric, hereText, policyName, wayName, tonightLit } from './policyMap'
import './planner.css'

type Box = { x: number; y: number; w: number; h: number }
/** `lo`/`hi`: the horizontal span of the screen the anchor lives in (the phone or the room in dual). */
type Item = Box & { key: string; anchor: PolicyAnchor; n: number; lo: number; hi: number }
/** What the anchors pass sees: the anchors, and what labels must keep clear of. */
type Scan = { items: Item[]; avoid: Box[] }

const SAMPLE: [number, number][] = [
  [0.5, 0.5],
  [0.2, 0.25],
  [0.8, 0.25],
  [0.2, 0.8],
  [0.8, 0.8],
]

const round = (b: Box): Box => ({ x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.w), h: Math.round(b.h) })

/**
 * Is the element really on screen (not hidden, faded out, off-screen or under a sheet)? Returns the
 * part of it inside the viewport. A screen taller than the viewport (the record tab is ~2900 px) is
 * sampled — and framed — where it is visible, not at fractions of its full height (QA POLICY#2).
 */
export function visibleRect(el: HTMLElement, root: HTMLElement | null): Box | null {
  const r = el.getBoundingClientRect()
  const vw = window.innerWidth
  const vh = window.innerHeight
  const left = Math.max(0, r.left)
  const top = Math.max(0, r.top)
  const right = Math.min(vw, r.right)
  const bottom = Math.min(vh, r.bottom)
  if (r.width < 8 || r.height < 8 || right - left < 8 || bottom - top < 8) return null
  const cv = (el as HTMLElement & { checkVisibility?: (o: Record<string, boolean>) => boolean }).checkVisibility
  if (cv && !cv.call(el, { checkOpacity: true, checkVisibilityCSS: true, opacityProperty: true, visibilityProperty: true })) return null
  for (const [fx, fy] of SAMPLE) {
    const x = Math.min(vw - 1, Math.max(1, left + (right - left) * fx))
    const y = Math.min(vh - 1, Math.max(1, top + (bottom - top) * fy))
    const hit = document.elementFromPoint(x, y)
    if (!hit) continue
    if (el.contains(hit) || hit.contains(el) || (root && root.contains(hit))) return { x: left, y: top, w: right - left, h: bottom - top }
  }
  return null
}

/** Rects the labels keep clear of: status bars, the presenter panel, the comparison split. */
function obstacles(): Box[] {
  const out: Box[] = []
  const add = (el: Element | null) => {
    if (!el) return
    const r = el.getBoundingClientRect()
    if (r.width > 4 && r.height > 4 && r.bottom > 0 && r.top < window.innerHeight) out.push(round({ x: r.left, y: r.top, w: r.width, h: r.height }))
  }
  document.querySelectorAll('header.status').forEach(add)
  add(document.querySelector('[data-testid="presenter-panel"]'))
  add(document.querySelector('[data-testid="split-view"] .sv-panel'))
  return out
}

function collect(root: HTMLElement | null): Scan {
  const found: { el: HTMLElement; anchor: string; r: Box }[] = []
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
  const items = kept
    .sort((a, b) => a.r.y - b.r.y || a.r.x - b.r.x)
    .map((f, i) => {
      const k = count.get(f.anchor) ?? 0
      count.set(f.anchor, k + 1)
      const shell = f.el.closest('[data-shell="phone"], [data-shell="room"]')?.getBoundingClientRect()
      const lo = Math.round(Math.max(0, shell?.left ?? 0))
      const hi = Math.round(Math.min(window.innerWidth, shell?.right ?? window.innerWidth))
      return { key: `${f.anchor}#${k}`, anchor: f.anchor, ...round(f.r), n: i + 1, lo, hi }
    })
  return { items, avoid: obstacles() }
}

const sameBox = (a: Box, b: Box) => a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h
const sameScan = (a: Scan, b: Scan) =>
  a.items.length === b.items.length &&
  a.items.every((x, i) => x.key === b.items[i].key && sameBox(x, b.items[i]) && x.lo === b.items[i].lo && x.hi === b.items[i].hi) &&
  a.avoid.length === b.avoid.length &&
  a.avoid.every((x, i) => sameBox(x, b.avoid[i]))

// ---------------------------------------------------------------- label sizing and placement

/** Label typography (kept in step with .lens-tag in planner.css). */
export const TAG = { head: 11, metric: 10.5, headLine: 15, metricLine: 14, badge: 24, padL: 6, padR: 8, padY: 3, border: 2, max: 380, gap: 3 }
let mctx: CanvasRenderingContext2D | null | undefined
let monoFamily = ''
/** Text width in the label's monospace font (canvas measure; a per-glyph estimate without canvas). */
function textW(text: string, px: number, weight: number): number {
  if (!text) return 0
  if (mctx === undefined) {
    try {
      mctx = document.createElement('canvas').getContext('2d')
      monoFamily = getComputedStyle(document.documentElement).getPropertyValue('--font-mono').trim() || 'monospace'
    } catch {
      mctx = null
    }
  }
  if (mctx) {
    mctx.font = `${weight} ${px}px ${monoFamily}`
    return Math.ceil(mctx.measureText(text).width)
  }
  let w = 0
  for (const ch of text) w += ch.charCodeAt(0) > 0x2e80 ? px : px * 0.61
  return Math.ceil(w)
}

type LabelText = { pol: string; ways: string; metric: string }
/** Width by content up to min(380, viewport − 16); the metric (and, rarely, the head) wraps to more lines. */
export function tagSize(t: LabelText, vw: number): { w: number; h: number } {
  const head = textW(t.pol, TAG.head, 700) + (t.ways ? 18 + textW(t.ways, TAG.head, 700) : 0)
  const metric = textW(t.metric, TAG.metric, 600)
  const chrome = TAG.badge + TAG.padL + TAG.padR + TAG.border
  const w = Math.min(TAG.max, vw - 16, chrome + Math.max(head, metric) + 2)
  const inner = Math.max(40, w - chrome)
  const lines = (x: number) => Math.max(1, Math.ceil(x / inner))
  const h = TAG.border + TAG.padY * 2 + lines(head) * TAG.headLine + (t.metric ? lines(metric) * TAG.metricLine : 0)
  return { w: Math.ceil(w), h: Math.ceil(h) }
}

type Placed = { item: Item; x: number; y: number; w: number; h: number }

const hits = (a: Box, b: Box, m = 0) => a.x < b.x + b.w + m && b.x < a.x + a.w + m && a.y < b.y + b.h + m && b.y < a.y + a.h + m
const overlapArea = (a: Box, b: Box) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y))

/**
 * Put each label next to its frame — above its top-left corner, else inside it, below it, or the
 * nearest free spot — so that labels never cover each other, the status bars, the presenter
 * panel or the legend (QA ROBUST#5). `floor` is the top of the legend.
 */
export function placeLabels(items: Item[], sizes: Map<string, { w: number; h: number }>, vw: number, floor: number, avoid: Box[]): Placed[] {
  const out: Placed[] = []
  const G = TAG.gap
  for (const it of items) {
    const { w, h } = sizes.get(it.key) ?? { w: 180, h: 36 }
    // stay on the anchor's own screen (the phone or the room in dual) when the label fits there
    const [lo, hi] = it.hi - it.lo >= w + 8 ? [it.lo, it.hi] : [0, vw]
    const cx = (x: number) => Math.max(lo + 4, Math.min(x, hi - w - 4))
    const cy = (y: number) => Math.max(2, Math.min(y, floor - h - 4))
    const xs = [...new Set([cx(it.x), cx(it.x + it.w - w), cx(it.x + 8)])]
    // near the frame's top-left corner first (above it, then inside it); its bottom edge only
    // when the frame is small enough for the bottom to still read as "this frame"
    const tall = it.h > 160 ? 240 : 0
    const edges: [number, number][] = [
      [it.y - h - G, 0],
      [it.y + G, 2],
      [it.y + it.h + G, 4 + tall],
      [it.y + it.h - h - G, 6 + tall],
    ]
    const dist = (y: number) => Math.min(...edges.map(([e, pen]) => Math.abs(y - e) + pen))
    const raw = edges.map(([e]) => e)
    for (let d = 6; d < Math.max(420, floor); d += 6) raw.push(it.y + G + d, it.y - h - G - d)
    const ys = [...new Set(raw.map(cy))].sort((a, b) => dist(a) - dist(b))
    let best: { x: number; y: number; cost: number } | null = null
    search: for (let yi = 0; yi < ys.length; yi++) {
      for (const x of xs) {
        const b = { x, y: ys[yi], w, h }
        let cost = 0
        for (const p of out) if (hits(b, p, 2)) cost += 4 * (overlapArea(b, p) + 40)
        for (const o of avoid) if (hits(b, o)) cost += overlapArea(b, o) + 20
        if (cost === 0) {
          best = { x, y: ys[yi], cost: 0 }
          break search
        }
        // far from the frame costs a little, so a small overlap near it can still win at the end
        const far = cost + Math.abs(ys[yi] - it.y) * 0.5
        if (!best || far < best.cost) best = { x, y: ys[yi], cost: far }
      }
    }
    const pos = best ?? { x: cx(it.x), y: cy(it.y + G) }
    out.push({ item: it, x: pos.x, y: pos.y, w, h })
  }
  return out
}

function useAnchors(rootRef: RefObject<HTMLDivElement>): Scan {
  const [scan, setScan] = useState<Scan>({ items: [], avoid: [] })
  useEffect(() => {
    let timer = 0
    let last = 0
    const run = () => {
      timer = 0
      last = performance.now()
      const next = collect(rootRef.current)
      setScan(prev => (sameScan(prev, next) ? prev : next))
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
    // a scrolled screen (record, order) moves its frame
    window.addEventListener('scroll', kick, true)
    return () => {
      cancelAnimationFrame(first)
      mo.disconnect()
      window.clearInterval(poll)
      window.removeEventListener('resize', kick)
      window.removeEventListener('scroll', kick, true)
      if (timer) window.clearTimeout(timer)
    }
  }, [rootRef])
  return scan
}

const pad = (n: number) => String(n).padStart(2, '0')

function Frame({ item, first, active, vw, vh }: { item: Item; first: boolean; active: boolean; vw: number; vh: number }) {
  const known = !!POLICY_MAP[item.anchor]
  // the dashed line sits 3 px outside the element, but never off the screen's edge
  const x = Math.max(1, item.x - 3)
  const y = Math.max(1, item.y - 3)
  const w = Math.min(vw - 1, item.x + item.w + 3) - x
  const h = Math.min(vh - 1, item.y + item.h + 3) - y
  return (
    <div className={`lens-frame${known ? '' : ' is-unknown'}${active ? ' is-active' : ''}${w < 90 || h < 40 ? ' is-small' : ''}`} style={{ left: x, top: y, width: w, height: h }}>
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
        {/* the frame carries its label's number; the raw anchor id only on the chosen one */}
        <span className="lens-frame__n">{active ? item.anchor : pad(item.n)}</span>
      </motion.div>
    </div>
  )
}

function useLabelText() {
  const tr = useTr()
  const t = planner.useT()
  return (anchor: PolicyAnchor): LabelText => {
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
      style={{ left: p.x, top: p.y, width: p.w, minHeight: p.h }}
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, delay: first ? 0.3 + p.item.n * 0.04 : 0 }}
      onClick={onTap}
    >
      <span className="lens-tag__n">{pad(p.item.n)}</span>
      <span className="lens-tag__body">
        <span className="lens-tag__head">
          <span className="lens-tag__p">{text.pol}</span>
          {text.ways ? <span className="lens-tag__w">{text.ways}</span> : null}
        </span>
        {text.metric ? <span className="lens-tag__m">{text.metric}</span> : null}
      </span>
    </motion.button>
  )
}

function Legend({ items, legendRef }: { items: Item[]; legendRef: RefObject<HTMLDivElement> }) {
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
      ref={legendRef}
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

function Detail({ item, onClose, wide, bottom }: { item: Item; onClose: () => void; wide: boolean; bottom?: number }) {
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
      style={bottom != null ? { bottom } : undefined}
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

/** On the phone, the presenter's pill (docked above the action bar) must not cover the detail sheet. */
function detailBottomFor(wide: boolean, avoid: Box[], vh: number): number | undefined {
  if (wide) return undefined
  const pill = avoid.find(b => b.h <= 80 && b.y > vh * 0.4)
  return pill ? Math.max(80, Math.round(vh - pill.y + 8)) : undefined
}

function LensLayer() {
  const rootRef = useRef<HTMLDivElement>(null)
  const legendRef = useRef<HTMLDivElement>(null)
  const { items, avoid } = useAnchors(rootRef)
  const view = useViewMode()
  const locale = useLocale()
  const [sel, setSel] = useState<string | null>(null)
  const [first, setFirst] = useState(true)
  const [box, setBox] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }))
  const [floor, setFloor] = useState<number | null>(null)
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
  const wide = view !== 'phone' || box.w >= 700
  // labels stay above the legend: measure its layout box (not its entrance transform)
  useLayoutEffect(() => {
    const el = legendRef.current
    if (!el) return
    const top = el.offsetTop - 4
    setFloor(f => (f === top ? f : top))
  }, [box.w, box.h, locale, items.length, wide])
  const labelText = useLabelText()
  const placed = useMemo(() => {
    const sizes = new Map<string, { w: number; h: number }>()
    for (const it of items) sizes.set(it.key, tagSize(labelText(it.anchor), box.w))
    return placeLabels(items, sizes, box.w, floor ?? box.h - (wide ? 56 : 100), avoid)
    // labelText depends on the locale only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, avoid, box.w, box.h, floor, wide, locale])
  const selected = items.find(i => i.key === sel) ?? null
  const detailBottom = detailBottomFor(wide, avoid, box.h)
  return (
    <motion.div
      ref={rootRef}
      className={`lens-root${wide ? ' is-wide' : ''}${selected ? ' has-detail' : ''}`}
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
        <Frame key={it.key} item={it} first={first} active={it.key === sel} vw={box.w} vh={box.h} />
      ))}
      {placed.map(p => (
        <Label key={p.item.key} p={p} first={first} active={p.item.key === sel} onTap={() => setSel(s => (s === p.item.key ? null : p.item.key))} />
      ))}
      <Legend items={items} legendRef={legendRef} />
      <AnimatePresence>{selected ? <Detail key={selected.key} item={selected} wide={wide} bottom={detailBottom} onClose={() => setSel(null)} /> : null}</AnimatePresence>
    </motion.div>
  )
}

export function PolicyLens(): JSX.Element {
  const on = useNavi(s => s.ui.lens)
  return <AnimatePresence>{on ? <LensLayer key="lens" /> : null}</AnimatePresence>
}
