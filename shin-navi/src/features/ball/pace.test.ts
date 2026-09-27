// QA ROBUST#2 (ball raster cost) and the record chips' highlight (fxState.ballHighlight).
import { describe, expect, it } from 'vitest'
import { BALL_TIERS, ballPace, due, oddSlot } from './pace'
import { HIGHLIGHT_KEEP, highlightTargets } from './controller'
import { K_CHROME, K_MIRROR, K_NEON, K_PRISM, K_SKETCH, K_SMOKE } from './render'

const idle = { touch: false, busy: false, dirty: false }

describe('ball frame pacing (pace.ts)', () => {
  it('caps the canvas DPR at 1.5 and lowers it with the governor tier', () => {
    expect(ballPace(2, false, idle).dpr).toBe(1.5)
    expect(ballPace(1, false, idle).dpr).toBeLessThanOrEqual(1.5)
    expect(ballPace(0, false, idle).dpr).toBe(1)
    for (const t of [0, 1, 2] as const) expect(BALL_TIERS[t].dpr).toBeLessThanOrEqual(1.5)
  })

  it('idles at 30 fps on tiers 2 and 1, 15 fps on tier 0', () => {
    expect(ballPace(2, false, idle).gap).toBe(33)
    expect(ballPace(1, false, idle).gap).toBe(33)
    expect(ballPace(0, false, idle).gap).toBe(66)
  })

  it('draws every frame while a finger or an effect moves the ball (tier 2)', () => {
    expect(ballPace(2, false, { ...idle, touch: true }).gap).toBe(0)
    expect(ballPace(2, false, { ...idle, busy: true }).gap).toBe(0)
    // tier 1: the finger still gets every frame, effects run at 30 fps
    expect(ballPace(1, false, { ...idle, touch: true }).gap).toBe(0)
    expect(ballPace(1, false, { ...idle, busy: true }).gap).toBe(33)
    // tier 0: everything at 30 fps at most
    expect(ballPace(0, false, { ...idle, touch: true }).gap).toBe(33)
  })

  it('drops the specular extras below tier 2', () => {
    expect(ballPace(2, false, idle).lite).toBe(false)
    expect(ballPace(1, false, idle).lite).toBe(true)
    expect(ballPace(0, false, idle).lite).toBe(true)
  })

  it('a changed scene is drawn at once', () => {
    for (const t of [0, 1, 2] as const) expect(ballPace(t, false, { ...idle, dirty: true }).gap).toBe(0)
  })

  it('reduced motion: a still picture, redrawn only when something changes, at full quality', () => {
    const p = ballPace(0, true, idle)
    expect(p.gap).toBeGreaterThanOrEqual(1000)
    expect(p.lite).toBe(false)
    expect(p.dpr).toBe(1.5)
    expect(ballPace(0, true, { ...idle, busy: true }).gap).toBe(0)
  })

  it('due(): a 33 ms gap draws every 2nd 60 Hz frame, 66 ms every 4th', () => {
    const count = (gap: number, frame: number, n: number) => {
      let since = 0
      let draws = 0
      for (let i = 0; i < n; i++) {
        since += frame
        if (due(since, gap)) {
          draws++
          since = 0
        }
      }
      return draws
    }
    expect(count(0, 16.7, 60)).toBe(60)
    expect(count(33, 16.7, 60)).toBe(30)
    expect(count(66, 16.7, 60)).toBe(15)
    // 120 Hz: still 30 fps idle
    expect(count(33, 8.33, 120)).toBe(30)
  })
})

describe('taking turns with the speck canvas', () => {
  it('alternates slots frame by frame at 60 Hz, from any vsync offset', () => {
    for (const offset of [0, 3.2, 7.9, 12.4]) {
      const slots = Array.from({ length: 8 }, (_, k) => oddSlot(offset + k * (1000 / 60)))
      for (let k = 1; k < slots.length; k++) expect(slots[k]).toBe(!slots[k - 1])
    }
  })
})

describe('record chips highlight (fxState.ballHighlight)', () => {
  const kind = new Uint8Array([K_SMOKE, K_CHROME, K_SKETCH, K_NEON, K_MIRROR, K_PRISM, K_NEON])

  it('keeps the chosen state lit and dims every other tile to ~25 %', () => {
    const out = new Float32Array(kind.length)
    const m = highlightTargets(kind, 'neon', out)
    expect(m).toEqual([3, 6])
    expect(HIGHLIGHT_KEEP).toBeCloseTo(0.25)
    expect([...out]).toEqual([0.75, 0.75, 0.75, 0, 0.75, 0.75, 0])
  })

  it('null lights everything again', () => {
    const out = new Float32Array(kind.length).fill(0.75)
    expect(highlightTargets(kind, null, out)).toEqual([])
    expect([...out].every(x => x === 0)).toBe(true)
  })

  it('a state nobody has yet dims the whole ball (no match to turn to the front)', () => {
    const out = new Float32Array(kind.length)
    expect(highlightTargets(new Uint8Array([K_SMOKE, K_NEON]), 'prism', new Float32Array(2))).toEqual([])
    highlightTargets(kind, 'sketch', out)
    expect(out[2]).toBe(0)
    expect(out.filter(x => x > 0).length).toBe(kind.length - 1)
  })
})
