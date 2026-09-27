// QA fix round 1 (pure parts): peek poses tall enough for a teaser, every kind has a localised
// teaser + glyph, the link card rows never overlap, and every cards string that counts has a
// singular sibling.
import { describe, expect, it } from 'vitest'
import type { CardKind, CardVariant } from '../../core/types'
import { LOCALE_IDS, namespaceStrings, trIn } from '../../i18n'
import { PEEKS, PEEKS_SMALL, glyphOf, kindKey, peeksFor, teaserKey } from './frames'
import { linkLayout } from './bodies/LinkCardBody'
import './strings'
import '../../i18n/vocab'

const KINDS: { kind: CardKind; variant?: CardVariant; from?: 'saki' }[] = [
  { kind: 'song' },
  { kind: 'song', variant: 'opener' },
  { kind: 'song', variant: 'visa' },
  { kind: 'ask' },
  { kind: 'ask', variant: 'welcome' },
  { kind: 'shift' },
  { kind: 'link' },
  { kind: 'voice' },
  { kind: 'gap' },
  { kind: 'invite', variant: 'request', from: 'saki' },
  { kind: 'invite', variant: 'request' },
  { kind: 'invite', variant: 'twin' },
  { kind: 'invite', variant: 'duet' },
  { kind: 'import' },
  { kind: 'coaster' },
  { kind: 'finale' },
  { kind: 'breather' },
]

describe('peeks', () => {
  it('lift ~30/54 px (26/46 on 360) so a 12 px teaser fits in the first band', () => {
    expect(PEEKS[0].lift).toBeGreaterThanOrEqual(28)
    expect(PEEKS[1].lift - PEEKS[0].lift).toBeGreaterThanOrEqual(20)
    expect(PEEKS_SMALL[0].lift).toBeGreaterThanOrEqual(24)
    expect(peeksFor(true)).toBe(PEEKS_SMALL)
    expect(peeksFor(false)).toBe(PEEKS)
  })

  it('every kind has a glyph, a localised kind label and a teaser in all five locales (no English codes)', () => {
    for (const c of KINDS) {
      expect(glyphOf(c)).toBeTruthy()
      for (const l of LOCALE_IDS) {
        const teaser = trIn({ key: `cards.${teaserKey(c)}`, vars: c.from ? { name: { member: c.from } } : undefined }, l)
        const label = trIn({ key: `cards.${kindKey(c)}` }, l)
        expect(teaser.startsWith('cards.'), `${c.kind}/${c.variant} teaser in ${l}`).toBe(false)
        expect(label.startsWith('cards.')).toBe(false)
        expect(teaser).not.toMatch(/\{\w+\}/)
        if (l === 'ja') expect(teaser).not.toMatch(/^[A-Z]{3,}$/)
      }
    }
    expect(trIn({ key: `cards.${teaserKey({ kind: 'invite', variant: 'request', from: 'saki' })}`, vars: { name: { member: 'saki' } } }, 'ja')).toBe('サキから便り')
  })
})

describe('link card rows (ROBUST#10)', () => {
  for (const small of [false, true]) {
    it(`label · face · "just reserved" · tiles · reason never overlap (${small ? '360' : '390'})`, () => {
      const L = linkLayout(small)
      const faceBottom = L.center.y + 22
      expect(L.fromTop).toBeGreaterThanOrEqual(faceBottom + 2)
      const sideTop = L.spots[0].y - L.mh / 2
      const midTop = L.spots[1].y - L.mh / 2
      const lift = 5 + (L.mh * 0.05) / 2 // the selected tile rises 5 px and scales 1.05
      expect(Math.min(sideTop, midTop) - lift).toBeGreaterThan(L.fromTop + L.fromH)
      // the reason line (2 lines of 12 px) sits under the tiles, 12 px from the bottom
      expect(L.tilesBottom).toBeLessThanOrEqual(L.h - 12 - 34)
      // tiles never touch each other
      expect(L.spots[1].x - L.mw / 2).toBeGreaterThan(L.spots[0].x + L.mw / 2)
    })
  }
})

describe('cards strings', () => {
  it('every {n} count string has a .one sibling in all locales', () => {
    const s = namespaceStrings('cards')!
    const ja = s.ja as Record<string, string>
    const counts = Object.keys(ja).filter(k => !k.endsWith('.one') && /\{n\}/.test(ja[k]) && !/#\{n\}/.test(ja[k]))
    expect(counts.length).toBeGreaterThan(0)
    for (const k of counts) {
      for (const l of LOCALE_IDS) {
        const d = (s as unknown as Record<string, Record<string, string>>)[l]
        expect(d[`${k}.one`], `${k}.one in ${l}`).toBeTypeOf('string')
      }
    }
  })
})
