// Planner layer placement (QA DEMO#0 / ROBUST#5): the comparison split never sits under the
// presenter's panel or pill, and lens labels never cover each other, the status bars or the legend.
import { describe, expect, it } from 'vitest'
import { placeSplit } from './SplitView'
import { placeLabels, tagSize, TAG } from './PolicyLens'

type R = { left: number; top: number; right: number; bottom: number; width: number; height: number }
const R = (left: number, top: number, width: number, height: number): R => ({ left, top, width, height, right: left + width, bottom: top + height })
const query = (m: Record<string, R>) => (sel: string) => m[sel] ?? null

const PP = '[data-testid="presenter-panel"]'
const CENTRE = '[data-shell="room"] .rs-centre'
const STATUS = '[data-shell="room"] .rs-status'
const ROOM = '[data-shell="room"]'
const HERO = '[data-shell="phone"] [data-testid="hero"]'
const DOCK = '[data-shell="phone"] [data-anchor="dock"]'
const PHONE = '[data-shell="phone"]'

type Box = { x: number; y: number; w: number; h: number }
const boxOf = (st: { left?: unknown; top?: unknown; width?: unknown; right?: unknown; maxHeight?: unknown; height?: unknown }, vw: number): Box => {
  const x = Number(st.left)
  const w = st.width != null ? Number(st.width) : vw - x - Number(st.right)
  return { x, y: Number(st.top), w, h: Number(st.maxHeight ?? st.height) }
}
const inter = (a: Box, b: R) => a.x < b.right && b.left < a.x + a.w && a.y < b.bottom && b.top < a.y + a.h

describe('comparison split placement (handshake 8)', () => {
  // dual at 1366×768: phone 0–376, seam, room 400–1366; room columns 30/45/25
  const dual = { [ROOM]: R(400, 0, 966, 768), [STATUS]: R(400, 0, 966, 48), [CENTRE]: R(690, 48, 435, 720) }

  it('dual: inside the room centre column, clear of the presenter pill (bottom-right)', () => {
    const pill = R(1366 - 16 - 340, 768 - 16 - 52, 340, 52)
    const b = boxOf(placeSplit(true, 1366, 768, query({ ...dual, [PP]: pill })), 1366)
    expect(inter(b, pill)).toBe(false)
    expect(b.x).toBeGreaterThanOrEqual(690)
    expect(b.x + b.w).toBeLessThanOrEqual(1125)
    expect(b.y).toBeGreaterThanOrEqual(48)
    expect(b.w).toBeGreaterThanOrEqual(360)
    expect(b.h).toBeGreaterThanOrEqual(400)
  })

  it('dual: an expanded presenter panel on the right pushes the split left of it', () => {
    const panel = R(1006, 12, 348, 744)
    const b = boxOf(placeSplit(true, 1366, 768, query({ ...dual, [PP]: panel })), 1366)
    expect(inter(b, panel)).toBe(false)
    expect(b.w).toBeGreaterThanOrEqual(320)
    expect(b.x).toBeGreaterThanOrEqual(8)
  })

  it('room 1280×800 and a letterboxed dual (1024×768) stay clear too', () => {
    const room = { [ROOM]: R(0, 0, 1280, 800), [STATUS]: R(0, 0, 1280, 48), [CENTRE]: R(333, 48, 589, 752) }
    const pill = R(1280 - 356, 800 - 68, 340, 52)
    const b = boxOf(placeSplit(true, 1280, 800, query({ ...room, [PP]: pill })), 1280)
    expect(inter(b, pill)).toBe(false)
    expect(b.x).toBeGreaterThanOrEqual(333)
    const s = 0.75
    const small = { [ROOM]: R(300, 96, 966 * s, 768 * s), [STATUS]: R(300, 96, 966 * s, 36), [CENTRE]: R(300 + 290 * s, 132, 435 * s, 540) }
    const pill2 = R(1024 - 356, 768 - 68, 340, 52)
    const c = boxOf(placeSplit(true, 1024, 768, query({ ...small, [PP]: pill2 })), 1024)
    expect(inter(c, pill2)).toBe(false)
    expect(c.x + c.w).toBeLessThanOrEqual(1024 - 8)
  })

  it('phone: ends above the pill docked over the action bar; beside a big panel it takes the larger band', () => {
    const phone = { [PHONE]: R(0, 0, 390, 844), [HERO]: R(0, 150, 390, 330), [DOCK]: R(0, 770, 390, 74) }
    const pill = R(25, 646, 340, 48)
    const b = boxOf(placeSplit(false, 390, 844, query({ ...phone, [PP]: pill })), 390)
    expect(inter(b, pill)).toBe(false)
    expect(b.h).toBeGreaterThanOrEqual(300)
    const panel = R(8, 8, 374, 472)
    const c = boxOf(placeSplit(false, 390, 844, query({ ...phone, [PP]: panel })), 390)
    expect(inter(c, panel)).toBe(false)
    // no presenter at all: over the deck, between the hero and the dock
    const d = boxOf(placeSplit(false, 390, 844, query(phone)), 390)
    expect(d.y).toBe(474)
    expect(d.y + d.h).toBeLessThanOrEqual(770)
  })
})

describe('lens labels (QA ROBUST#5)', () => {
  const vw = 1366
  const floor = 720
  const status = [{ x: 400, y: 0, w: 966, h: 48 }, { x: 20, y: 20, w: 336, h: 34 }]
  // twelve anchors like the dual demo: many of them stacked in the narrow phone column
  const items = [
    ['lang', 262, 24, 50, 28, 20, 356],
    ['lane', 20, 58, 336, 38, 20, 356],
    ['search', 30, 114, 316, 34, 20, 356],
    ['hero-ball', 100, 150, 176, 176, 20, 356],
    ['mood', 30, 282, 210, 28, 20, 356],
    ['orbs', 20, 312, 336, 48, 20, 356],
    ['card:song', 20, 362, 336, 262, 20, 356],
    ['dock', 20, 678, 336, 60, 20, 356],
    ['lane', 414, 62, 262, 700, 400, 1366],
    ['room-view', 688, 46, 440, 720, 400, 1366],
    ['orbs', 1138, 84, 214, 150, 400, 1366],
    ['mood', 1138, 262, 200, 32, 400, 1366],
  ].map(([anchor, x, y, w, h, lo, hi], i) => ({ key: `${anchor}#${i}`, anchor: anchor as string, x: x as number, y: y as number, w: w as number, h: h as number, n: i + 1, lo: lo as number, hi: hi as number }))
  const text = { pol: '5-2 Discovery +5-4', ways: 'Read · Who', metric: 'Metric: Choose while watching the queue' }

  it('are sized by content (never cut off) up to 380 px, and wrap when narrower', () => {
    const s = tagSize(text, 1366)
    expect(s.w).toBeLessThanOrEqual(TAG.max)
    expect(s.h).toBeGreaterThanOrEqual(TAG.headLine + TAG.metricLine)
    const n = tagSize(text, 200)
    expect(n.w).toBeLessThanOrEqual(184)
    expect(n.h).toBeGreaterThan(s.h)
  })

  it('never overlap each other, stay on screen above the legend, and keep clear of the status bars', () => {
    const sizes = new Map(items.map(it => [it.key, tagSize(text, vw)]))
    const placed = placeLabels(items, sizes, vw, floor, status)
    expect(placed).toHaveLength(items.length)
    for (const p of placed) {
      expect(p.x).toBeGreaterThanOrEqual(0)
      expect(p.x + p.w).toBeLessThanOrEqual(vw)
      expect(p.y).toBeGreaterThanOrEqual(0)
      expect(p.y + p.h).toBeLessThanOrEqual(floor)
      for (const o of status) expect(p.x < o.x + o.w && o.x < p.x + p.w && p.y < o.y + o.h && o.y < p.y + p.h, `${p.item.key} over a status bar`).toBe(false)
      // a label stays on its own screen (the phone column or the room)
      expect(p.x).toBeGreaterThanOrEqual(p.item.lo)
      expect(p.x + p.w).toBeLessThanOrEqual(p.item.hi)
    }
    for (let i = 0; i < placed.length; i++)
      for (let j = i + 1; j < placed.length; j++) {
        const a = placed[i]
        const b = placed[j]
        expect(a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h, `${a.item.key} × ${b.item.key}`).toBe(false)
      }
  })
})
