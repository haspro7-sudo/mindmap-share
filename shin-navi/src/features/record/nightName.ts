// Night naming (SPEC D-7): "{曜日}の{基調色}{象徴}座", e.g. 金曜の琥珀ハモリ座.
// Pure functions — the base colour is the most frequent heat bucket of the night's wall points
// (quiet=瑠璃, mellow=菫, warm=珊瑚, hot=琥珀) and the symbol follows a fixed priority:
// duet → harmony, finale → finale, everyone knew → allKnow, crossing → crossing,
// air-read → airRead, otherwise → spark (口火).
import type { Night, PinId, QueueItem, SungEntry, TextRef } from '../../core/types'
import { AURORA_PALETTES, heatBucket } from '../../core/rules'
import { nightNameKey, type NightColor, type NightSymbol } from './strings'

export type NightFacts = { duet?: boolean; finale?: boolean; allKnow?: boolean; crossing?: boolean; airRead?: boolean }

/** Most frequent heat bucket over the wall points; ties go to the bucket the night reached first. */
export function baseColor(n: Pick<Night, 'points'>): NightColor {
  const count = new Map<NightColor, number>()
  for (const p of n.points) {
    const b = heatBucket(p.heat) as NightColor
    count.set(b, (count.get(b) ?? 0) + 1)
  }
  let best: NightColor = 'quiet'
  let bestN = 0
  for (const [b, k] of count) {
    if (k > bestN) {
      best = b
      bestN = k
    }
  }
  return best
}

/** What the night's own record says (wall markers and shared songs). */
export function derivedFacts(n: Pick<Night, 'points' | 'shared'>): NightFacts {
  const pts = n.points
  const allKnow = n.shared.length > 0 || pts.some(p => p.markers.includes('allKnow'))
  let airRead = false
  pts.forEach((p, i) => {
    if (!p.markers.includes('shift')) return
    const next = pts.slice(i + 1, i + 3)
    if (next.some(q => q.heat - p.heat >= 0.05)) airRead = true
  })
  return { allKnow, airRead }
}

export function nightSymbol(n: Pick<Night, 'points' | 'shared'>, facts: NightFacts = {}): NightSymbol {
  const d = derivedFacts(n)
  const f: NightFacts = {
    duet: !!facts.duet,
    finale: !!facts.finale,
    allKnow: !!facts.allKnow || !!d.allKnow,
    crossing: !!facts.crossing,
    airRead: !!facts.airRead || !!d.airRead,
  }
  if (f.duet) return 'harmony'
  if (f.finale) return 'finale'
  if (f.allKnow) return 'allKnow'
  if (f.crossing) return 'crossing'
  if (f.airRead) return 'airRead'
  return 'spark'
}

/** The night's name as a TextRef ("record.nn.<weekday>.<colour>.<symbol>"). weekday: 0 = Sunday. */
export function nightName(n: Night, o: { weekday: number; facts?: NightFacts; color?: NightColor }): TextRef {
  const wd = ((Math.floor(o.weekday) % 7) + 7) % 7
  return { key: `record.${nightNameKey(wd, o.color ?? baseColor(n), nightSymbol(n, o.facts))}` }
}

export const weekdayOf = (n: Pick<Night, 'startedAt'>): number => new Date(n.startedAt).getDay()

const mine = (i: QueueItem) => i.by === 'me' || i.with === 'me'

/** Facts for tonight from the room log and the pins earned tonight. */
export function factsFrom(sung: SungEntry[], pins: { id: PinId; nightId: string }[], nightId: string): NightFacts {
  const my = sung.filter(e => mine(e.item))
  const pinned = new Set(pins.filter(p => p.nightId === nightId).map(p => p.id))
  return {
    duet: my.some(e => !!e.item.with || e.item.tags.includes('duet')) || pinned.has('harmony'),
    finale: sung.some(e => e.item.tags.includes('finale')),
    allKnow: pinned.has('allKnow'),
    crossing: my.some(e => e.item.tags.includes('visa')) || pinned.has('crossing'),
    airRead: pinned.has('airRead'),
  }
}

/** The stored name, or one computed from the night's own record (older / seeded nights). */
export function nameOf(n: Night, facts?: NightFacts): TextRef {
  if (n.name) return n.name
  // demo nights carry a hand-picked palette: name them after the colours they are shown in
  const color = n.seeded ? (Object.keys(AURORA_PALETTES) as NightColor[]).find(k => AURORA_PALETTES[k].join(',') === n.palette.join(',')) : undefined
  return nightName(n, { weekday: weekdayOf(n), facts, color })
}

const QUIET = AURORA_PALETTES.quiet.join(',')

/**
 * The colours a night is shown in. A night keeps the default (quiet) palette until closeNight
 * stores the real one, so while it is still running (or on the recap) the palette follows its
 * base colour; stored palettes of closed or demo nights are kept as they are.
 */
export function displayPalette(n: Pick<Night, 'points' | 'palette'>): [string, string, string] {
  if (n.points.length && n.palette.join(',') === QUIET) return [...AURORA_PALETTES[baseColor(n)]] as [string, string, string]
  return n.palette
}
