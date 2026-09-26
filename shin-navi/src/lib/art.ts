// Palette and pattern choice for a song's generated artwork, derived from its id and mood.
// Palettes are hand-picked neon sets so every card reads as "night out", never muddy.
import { hashString } from './rng'

export type ArtPattern = 'orbits' | 'waves' | 'prism' | 'bloom' | 'sunset' | 'bubbles'
export const ART_PATTERNS: readonly ArtPattern[] = ['orbits', 'waves', 'prism', 'bloom', 'sunset', 'bubbles']

export type Palette = {
  name: string
  a: string // main neon
  b: string // secondary neon
  c: string // accent / highlight
  deep: string // dark base
  mid: string // dark mid tone for gradients
  glow: string
  bg: string // full-bleed background gradient (CSS)
}

type Raw = { name: string; a: string; b: string; c: string; deep: string; mid: string }

const HOT: Raw[] = [
  { name: 'neon-sunset', a: '#ff2e88', b: '#ff8a00', c: '#ffe066', deep: '#12051f', mid: '#4a0d52' },
  { name: 'magenta-volt', a: '#ff00d4', b: '#00e5ff', c: '#f8f7ff', deep: '#0b0424', mid: '#3a0ca3' },
  { name: 'candy', a: '#ff4d6d', b: '#ffd166', c: '#ffffff', deep: '#1a0624', mid: '#6a1b6e' },
  { name: 'electric', a: '#f72585', b: '#4cc9f0', c: '#fdfcdc', deep: '#0a0322', mid: '#560bad' },
  { name: 'lava', a: '#ff5400', b: '#ff0054', c: '#ffbd00', deep: '#15020f', mid: '#5c0431' },
]
const COOL: Raw[] = [
  { name: 'aurora', a: '#00f5d4', b: '#9b5de5', c: '#f1fffb', deep: '#050b1f', mid: '#1b2a6b' },
  { name: 'midnight', a: '#4361ee', b: '#4cc9f0', c: '#ff70c8', deep: '#050726', mid: '#1f1b72' },
  { name: 'glacier', a: '#72efdd', b: '#5390d9', c: '#ffffff', deep: '#041424', mid: '#1b3a73' },
  { name: 'lavender', a: '#c77dff', b: '#48bfe3', c: '#ffd6ff', deep: '#0c0520', mid: '#3c1a78' },
  { name: 'deep-sea', a: '#06d6a0', b: '#118ab2', c: '#ffd166', deep: '#021219', mid: '#073b4c' },
]

function hexA(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`
}

/** High-energy songs draw from hot palettes, calm ones from cool palettes. */
export function palette(key: string, energy = 0.5): Palette {
  const h = hashString(key)
  const set = energy >= 0.6 ? HOT : energy <= 0.4 ? COOL : (h & 1 ? HOT : COOL)
  const r = set[(h >>> 3) % set.length]
  return {
    ...r,
    glow: hexA(r.a, 0.55),
    bg: `radial-gradient(120% 80% at 15% 0%, ${hexA(r.a, 0.75)}, transparent 55%), radial-gradient(110% 80% at 100% 100%, ${hexA(r.b, 0.6)}, transparent 55%), linear-gradient(165deg, ${r.mid}, ${r.deep} 70%)`,
  }
}

export function patternFor(key: string): ArtPattern {
  return ART_PATTERNS[hashString(key + ':p') % ART_PATTERNS.length]
}

export { hexA }
