// M3 acceptance 2: classifyGesture thresholds, dominant direction, tap vs long-press;
// plus the frame geometry used for the twelve silhouettes (acceptance 1, the pure part).
import { describe, expect, it } from 'vitest'
import { classifyGesture, dragDirection, dragProgress, resist, tiltFor, VelocityTracker, qbez } from './gestures'
import { FRAMES, framePath, frameSize, kindCode, leftKey, PEEKS } from './frames'
import type { CardFrame } from '../../core/types'
import { FRAME_OF, KEEPABLE } from '../../core/types'

const W = 320
const H = 296
const g = (o: Partial<Parameters<typeof classifyGesture>[0]>) => classifyGesture({ dx: 0, dy: 0, vx: 0, vy: 0, w: W, h: H, ms: 150, moved: 0, ...o })

describe('classifyGesture', () => {
  it('tap: moved < 8 px and released before 500 ms', () => {
    expect(g({ moved: 0, ms: 90 })).toBe('tap')
    expect(g({ moved: 7.9, dx: 5, dy: -5, ms: 499 })).toBe('tap')
  })

  it('long press: moved < 8 px and held for 500 ms or more', () => {
    expect(g({ moved: 3, ms: 500 })).toBe('long')
    expect(g({ moved: 7, ms: 1200 })).toBe('long')
    // moving 8 px or more is a drag, however long it was held
    expect(g({ moved: 8, dx: 8, ms: 900 })).toBe(null)
  })

  it('up: vertical dominant and >= 600 px/s upward', () => {
    expect(g({ dy: -40, dx: 10, vy: -600, moved: 42 })).toBe('up')
    expect(g({ dy: -40, dx: 10, vy: -599, moved: 42 })).toBe(null)
  })

  it('up: vertical dominant and moved >= 35% of the card height', () => {
    const d = Math.ceil(H * 0.35)
    expect(g({ dy: -d, moved: d, vy: 0 })).toBe('up')
    expect(g({ dy: -(d - 2), moved: d - 2, vy: 0 })).toBe(null)
  })

  it('right / left: horizontal dominant with velocity or 35% of the card width', () => {
    const d = Math.ceil(W * 0.35)
    expect(g({ dx: d, moved: d })).toBe('right')
    expect(g({ dx: -d, moved: d })).toBe('left')
    expect(g({ dx: 30, vx: 700, moved: 30 })).toBe('right')
    expect(g({ dx: -30, vx: -700, moved: 30 })).toBe('left')
    expect(g({ dx: 60, vx: 100, moved: 60 })).toBe(null)
  })

  it('the dominant axis decides the direction', () => {
    // diagonal up-right, more up than right
    expect(g({ dx: 90, dy: -140, vx: 900, vy: -900, moved: 170 })).toBe('up')
    // diagonal up-right, more right than up
    expect(g({ dx: 140, dy: -90, vx: 900, vy: -900, moved: 170 })).toBe('right')
  })

  it('down never commits an action (the caller springs back)', () => {
    expect(g({ dy: 200, vy: 1200, moved: 200 })).toBe('down')
  })

  it('a release flung back against the drag cancels a distance-only commit', () => {
    const d = Math.ceil(W * 0.4)
    expect(g({ dx: d, vx: -900, moved: d })).toBe(null)
    expect(g({ dy: -H * 0.5, vy: 800, moved: H * 0.5 })).toBe(null)
  })

  it('the spec flick (300 px in 120 ms) is recognised in every direction', () => {
    const v = 300 / 0.12
    expect(g({ dy: -300, vy: -v, moved: 300 })).toBe('up')
    expect(g({ dx: 300, vx: v, moved: 300 })).toBe('right')
    expect(g({ dx: -300, vx: -v, moved: 300 })).toBe('left')
  })

  it('works for the small 290x260 card too', () => {
    expect(classifyGesture({ dx: 0, dy: -92, vx: 0, vy: 0, w: 290, h: 260, ms: 200, moved: 92 })).toBe('up')
    expect(classifyGesture({ dx: 0, dy: -90, vx: 0, vy: 0, w: 290, h: 260, ms: 200, moved: 90 })).toBe(null)
  })
})

describe('drag helpers', () => {
  it('dragDirection ignores small moves and downward drags', () => {
    expect(dragDirection(4, -6)).toBe(null)
    expect(dragDirection(2, -40)).toBe('up')
    expect(dragDirection(0, 40)).toBe(null)
    expect(dragDirection(40, 5)).toBe('right')
    expect(dragDirection(-40, 5)).toBe('left')
  })
  it('dragProgress reaches 1 at the commit distance', () => {
    expect(dragProgress(0, -H * 0.35, W, H)).toBeCloseTo(1)
    expect(dragProgress(W * 0.175, 0, W, H)).toBeCloseTo(0.5)
    expect(dragProgress(0, 0, W, H)).toBe(0)
  })
  it('tilt is dx * 0.06 degrees', () => {
    expect(tiltFor(100)).toBeCloseTo(6)
    expect(tiltFor(-50)).toBeCloseTo(-3)
    expect(Math.abs(tiltFor(10000))).toBeLessThanOrEqual(18)
  })
  it('resist is monotonic and bounded', () => {
    expect(resist(0)).toBe(0)
    expect(resist(100)).toBeGreaterThan(resist(50))
    expect(resist(10000)).toBeLessThanOrEqual(90)
    expect(resist(-100)).toBeLessThan(0)
  })
  it('VelocityTracker measures px/s and forgets a held finger', () => {
    const v = new VelocityTracker()
    v.add(0, 0, 0)
    v.add(16, 0, -40)
    v.add(32, 0, -80)
    expect(v.velocity(32).vy).toBeCloseTo(-2500, -1)
    expect(v.velocity(400)).toEqual({ vx: 0, vy: 0 })
  })
  it('qbez passes through its end points', () => {
    expect(qbez(0, 50, 100, 0)).toBe(0)
    expect(qbez(0, 50, 100, 1)).toBe(100)
  })
})

describe('frames (C-7)', () => {
  const frames = Object.keys(FRAMES) as CardFrame[]
  it('has twelve frames, each with its own outline', () => {
    expect(frames).toHaveLength(12)
    const paths = new Set(frames.map(f => framePath(f, 320, 296)))
    expect(paths.size).toBe(12)
  })
  it('every kind maps to a frame; visa songs get the passport', () => {
    expect(FRAME_OF({ kind: 'song' })).toBe('portrait')
    expect(FRAME_OF({ kind: 'song', variant: 'visa' })).toBe('passport')
    expect(FRAME_OF({ kind: 'ask' })).toBe('medallion')
    expect(FRAME_OF({ kind: 'breather' })).toBe('pill')
  })
  it('sizes follow C-7 (320x296 phone, 290x260 on 360 wide) and fit a 390 phone with 16 px gutters', () => {
    expect(frameSize('portrait', false)).toEqual({ w: 320, h: 296 })
    expect(frameSize('portrait', true)).toEqual({ w: 290, h: 260 })
    for (const f of frames) {
      expect(frameSize(f, false).w).toBeLessThanOrEqual(390 - 32)
      expect(frameSize(f, true).w).toBeLessThanOrEqual(360 - 32)
      expect(frameSize(f, false).h).toBeLessThanOrEqual(296)
      expect(frameSize(f, true).h).toBeLessThanOrEqual(260)
    }
    expect(frameSize('band', false)).toEqual({ w: 344, h: 206 })
  })
  it('paths are closed and finite', () => {
    for (const f of frames) {
      const d = framePath(f, 300, 260)
      expect(d.trim().endsWith('Z')).toBe(true)
      expect(d).not.toMatch(/NaN|Infinity/)
    }
  })
  it('kind codes are English caps; left labels follow C-8', () => {
    expect(kindCode({ kind: 'song', variant: 'opener' })).toBe('SPARK')
    expect(kindCode({ kind: 'coaster' })).toBe('CHEERS')
    expect(leftKey({ kind: 'invite' })).toBe('nextTime')
    expect(leftKey({ kind: 'coaster' })).toBe('notNow')
    expect(leftKey({ kind: 'song' })).toBe('pass')
  })
  it('peeks lift the next two cards like B-2 (first higher scale than the second)', () => {
    expect(PEEKS[0].scale).toBeGreaterThan(PEEKS[1].scale)
    expect(PEEKS[1].lift).toBeGreaterThan(PEEKS[0].lift)
  })
  it('keep is only offered for kinds that settle on one song', () => {
    expect([...KEEPABLE].sort()).toEqual(['ask', 'link', 'song', 'voice'])
  })
})
