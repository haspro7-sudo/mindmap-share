// The twelve card frames (SPEC C-7). One CardShell, twelve silhouettes: the OUTLINE tells the
// kinds apart even when only the top edge of a card peeks out behind the pile. Every frame is
// an SVG path in card pixels, used both as the CSS clip-path of the face and as the rim stroke.
import type { CardFrame, CardKind, DeckCard } from '../../core/types'
import { FRAME_OF } from '../../core/types'
import type { CardsKey } from './strings'

export type FrameSpec = {
  /** size on the 390-wide phone and on the 360x740 phone */
  size: { w: number; h: number }
  small: { w: number; h: number }
  labelAlign: 'left' | 'center'
  /** body padding (top, sides, bottom) in px at the normal size; scaled on small */
  pad: [number, number, number]
  /** extra right padding reserved for a ticket stub (fraction of the width) */
  stub?: number
}

export const FRAMES: Record<CardFrame, FrameSpec> = {
  portrait: { size: { w: 320, h: 296 }, small: { w: 290, h: 260 }, labelAlign: 'left', pad: [42, 20, 16] },
  passport: { size: { w: 320, h: 296 }, small: { w: 290, h: 260 }, labelAlign: 'left', pad: [44, 24, 22] },
  medallion: { size: { w: 286, h: 286 }, small: { w: 254, h: 254 }, labelAlign: 'center', pad: [52, 34, 34] },
  band: { size: { w: 344, h: 206 }, small: { w: 318, h: 186 }, labelAlign: 'left', pad: [34, 18, 12] },
  constellation: { size: { w: 332, h: 296 }, small: { w: 304, h: 260 }, labelAlign: 'center', pad: [36, 14, 14] },
  arch: { size: { w: 320, h: 296 }, small: { w: 290, h: 260 }, labelAlign: 'center', pad: [58, 22, 16] },
  facet: { size: { w: 332, h: 292 }, small: { w: 304, h: 258 }, labelAlign: 'center', pad: [46, 50, 22] },
  ticket: { size: { w: 334, h: 262 }, small: { w: 306, h: 236 }, labelAlign: 'left', pad: [40, 22, 16], stub: 0.25 },
  stitch: { size: { w: 320, h: 296 }, small: { w: 290, h: 260 }, labelAlign: 'left', pad: [56, 22, 18] },
  coaster: { size: { w: 290, h: 290 }, small: { w: 256, h: 256 }, labelAlign: 'center', pad: [48, 34, 30] },
  triptych: { size: { w: 320, h: 296 }, small: { w: 290, h: 260 }, labelAlign: 'center', pad: [62, 22, 16] },
  pill: { size: { w: 356, h: 256 }, small: { w: 328, h: 232 }, labelAlign: 'center', pad: [40, 34, 20] },
}

export function frameOf(card: Pick<DeckCard, 'kind' | 'variant'>): CardFrame {
  return FRAME_OF(card)
}

export function frameSize(frame: CardFrame, small: boolean): { w: number; h: number } {
  const f = FRAMES[frame]
  return small ? f.small : f.size
}

const n = (v: number) => Math.round(v * 10) / 10

function roundRect(w: number, h: number, r: number, y0 = 0): string {
  const rr = Math.min(r, w / 2, (h - y0) / 2)
  return `M${rr},${y0} H${n(w - rr)} A${rr},${rr} 0 0 1 ${w},${n(y0 + rr)} V${n(h - rr)} A${rr},${rr} 0 0 1 ${n(w - rr)},${h} H${rr} A${rr},${rr} 0 0 1 0,${n(h - rr)} V${n(y0 + rr)} A${rr},${rr} 0 0 1 ${rr},${y0} Z`
}

/** The outline of a frame at a given size (SVG path data, card-local pixels). */
export function framePath(frame: CardFrame, w: number, h: number): string {
  switch (frame) {
    case 'portrait':
      return roundRect(w, h, 24)
    case 'passport':
      return roundRect(w, h, 4)
    case 'band':
      return roundRect(w, h, 20)
    case 'constellation':
      return roundRect(w, h, 30)
    case 'pill':
      return roundRect(w, h, h / 2)
    case 'medallion': {
      const r = Math.min(w, h) / 2
      const cx = w / 2
      const cy = h / 2
      return `M${n(cx - r)},${cy} A${r},${r} 0 1 1 ${n(cx + r)},${cy} A${r},${r} 0 1 1 ${n(cx - r)},${cy} Z`
    }
    case 'arch': {
      // a doorway: the whole top edge is one half circle
      const R = w / 2
      const br = 20
      return `M0,${R} A${R},${R} 0 0 1 ${w},${R} V${h - br} A${br},${br} 0 0 1 ${w - br},${h} H${br} A${br},${br} 0 0 1 0,${h - br} Z`
    }
    case 'facet': {
      // one tile of the mirror ball: an annular sector, top and bottom are concentric arcs
      const R = h / (1 - 0.76)
      const a = Math.asin(w / 2 / R)
      const r = R - h
      const cx = w / 2
      const cy = R
      const p = (rad: number, ang: number) => `${n(cx + rad * Math.sin(ang))},${n(cy - rad * Math.cos(ang))}`
      return `M${p(R, -a)} A${n(R)},${n(R)} 0 0 1 ${p(R, a)} L${p(r, a)} A${n(r)},${n(r)} 0 0 0 ${p(r, -a)} Z`
    }
    case 'ticket': {
      // two half-circle bites on the sides, and small bites where the stub tears off
      const r = 16
      const side = 15
      const px = n(w * 0.75)
      const pn = 9
      const my = h / 2
      return (
        `M${r},0 H${n(px - pn)} A${pn},${pn} 0 0 0 ${n(px + pn)},0 H${w - r} A${r},${r} 0 0 1 ${w},${r} ` +
        `V${n(my - side)} A${side},${side} 0 0 0 ${w},${n(my + side)} V${h - r} A${r},${r} 0 0 1 ${w - r},${h} ` +
        `H${n(px + pn)} A${pn},${pn} 0 0 0 ${n(px - pn)},${h} H${r} A${r},${r} 0 0 1 0,${h - r} ` +
        `V${n(my + side)} A${side},${side} 0 0 0 0,${n(my - side)} V${r} A${r},${r} 0 0 1 ${r},0 Z`
      )
    }
    case 'stitch': {
      // a folder with a raised tab at the top right (where the key sits)
      const T = 18
      const r = 18
      const t1 = w - 22
      const t0 = t1 - 104
      return (
        `M${r},${T} H${t0} C${t0 + 10},${T} ${t0 + 8},0 ${t0 + 22},0 H${t1 - 14} ` +
        `A14,14 0 0 1 ${t1},14 V${T} H${w - r} A${r},${r} 0 0 1 ${w},${T + r} V${h - r} A${r},${r} 0 0 1 ${w - r},${h} H${r} A${r},${r} 0 0 1 0,${h - r} V${T + r} A${r},${r} 0 0 1 ${r},${T} Z`
      )
    }
    case 'coaster': {
      // rounded square (superellipse) with a scalloped edge
      const cx = w / 2
      const cy = h / 2
      const a = Math.min(w, h) / 2 - 5
      const N = 240
      const waves = 30
      const pts: string[] = []
      for (let i = 0; i < N; i++) {
        const t = (i / N) * Math.PI * 2
        const c = Math.cos(t)
        const s = Math.sin(t)
        const base = a / Math.pow(Math.pow(Math.abs(c), 4.2) + Math.pow(Math.abs(s), 4.2), 1 / 4.2)
        const rr = base + 3.6 * Math.cos(waves * t)
        pts.push(`${n(cx + rr * c)},${n(cy + rr * s)}`)
      }
      return `M${pts[0]} L${pts.slice(1).join(' ')} Z`
    }
    case 'triptych': {
      // three arches: a tall centre panel between two lower wings
      const sw = w * 0.28
      const cr = (w - 2 * sw) / 2
      const sr = sw / 2
      const sTop = cr * 0.62
      const syc = sTop + sr
      const br = 16
      return (
        `M0,${n(syc)} A${n(sr)},${n(sr)} 0 0 1 ${n(sw)},${n(syc)} V${n(cr)} A${n(cr)},${n(cr)} 0 0 1 ${n(w - sw)},${n(cr)} ` +
        `V${n(syc)} A${n(sr)},${n(sr)} 0 0 1 ${w},${n(syc)} V${h - br} A${br},${br} 0 0 1 ${w - br},${h} H${br} A${br},${br} 0 0 1 0,${h - br} Z`
      )
    }
  }
}

/** Small English caps code shown before the local kind name (SPEC C-7, e.g. SPARK + the local name). */
export function kindCode(card: Pick<DeckCard, 'kind' | 'variant'>): string {
  if (card.kind === 'song') return card.variant === 'opener' ? 'SPARK' : card.variant === 'visa' ? 'VISA' : 'SONG'
  if (card.kind === 'ask') return card.variant === 'welcome' ? 'WELCOME' : 'ASK'
  if (card.kind === 'invite') return card.variant === 'request' ? 'REQUEST' : card.variant === 'twin' ? 'TWIN' : card.variant === 'duet' ? 'DUET' : 'INVITE'
  const CODES: Record<CardKind, string> = {
    song: 'SONG',
    ask: 'ASK',
    shift: 'SHIFT',
    link: 'LINK',
    voice: 'VOICE',
    gap: 'GAP',
    invite: 'INVITE',
    import: 'IMPORT',
    coaster: 'CHEERS',
    finale: 'FINALE',
    breather: 'BREATHE',
  }
  return CODES[card.kind]
}

/** Local kind name key in the `cards` namespace. */
export function kindKey(card: Pick<DeckCard, 'kind' | 'variant'>): CardsKey {
  if (card.kind === 'song') return card.variant === 'opener' ? 'kind.opener' : card.variant === 'visa' ? 'kind.visa' : 'kind.song'
  if (card.kind === 'ask' && card.variant === 'welcome') return 'kind.welcome'
  if (card.kind === 'invite' && card.variant) {
    if (card.variant === 'request') return 'kind.request'
    if (card.variant === 'twin') return 'kind.twin'
    if (card.variant === 'duet') return 'kind.duet'
  }
  return `kind.${card.kind}` as CardsKey
}

/** Accent light per kind (rim, label, glow). Colour supports the shape, it never replaces it. */
export function kindAccent(card: Pick<DeckCard, 'kind' | 'variant'>): string {
  if (card.kind === 'song') return card.variant === 'opener' ? '#FFD36B' : card.variant === 'visa' ? '#FF7A8A' : '#F5F1FF'
  const A: Record<CardKind, string> = {
    song: '#F5F1FF',
    ask: '#2EF2FF',
    shift: '#FFB547',
    link: '#A48BFF',
    voice: '#C77DFF',
    gap: '#C6FF3D',
    invite: '#FF3DA8',
    import: '#DDE1EE',
    coaster: '#7DF9FF',
    finale: '#FFD36B',
    breather: '#5CFFB0',
  }
  return A[card.kind]
}

/** Left-hand action label (pass for most; later / next time / not now where C-8 says so). */
export function leftKey(card: Pick<DeckCard, 'kind'>): CardsKey {
  switch (card.kind) {
    case 'voice':
    case 'import':
    case 'finale':
      return 'later'
    case 'invite':
      return 'nextTime'
    case 'coaster':
      return 'notNow'
    default:
      return 'pass'
  }
}

/** Peek offsets (SPEC B-2): first peek lifts 12 px at 0.95, the second 22 px at 0.9. */
export const PEEKS = [
  { lift: 16, scale: 0.95, opacity: 1 },
  { lift: 31, scale: 0.9, opacity: 0.8 },
] as const
