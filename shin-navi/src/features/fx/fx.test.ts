// M1 fx-sound unit tests (SPEC L/M1 acceptance 2–6).
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createGovernor, TIERS } from './governor'
import { ticker, setFrameTimeProvider } from '../../core/ticker'
import * as audio from '../../lib/audio'
import { blendPalette, PaletteTracker, PALETTE_RGB, GOLD_RGB, auroraIntro, introProgress } from './aurora'
import { syncCount, project, placement, makeSpeck, ARC, LAP_MS, OMEGA, type Speck } from './specks'
import { BurstSystem, PRESET_PARTICLES } from './bursts'
import { cssToRgb } from './sprites'
import { flowSpeed, installFx, syncFxState } from './installFx'
import { installSound, shouldDuck } from './installSound'
import { fxSignals } from './signals'
import { fxState, resetFxState } from '../../core/fxState'
import { naviApi } from '../../core/store'
import { bus } from '../../core/events'
import { sound, type SfxName } from '../../core/sound'
import { faceNote } from '../../core/rules'
import { SONGS } from '../../data/songs'

// ---------------------------------------------------------------- a fake WebAudio graph

class FakeParam {
  value = 0
  events: { kind: string; v: number; t: number }[] = []
  setValueAtTime(v: number, t: number) {
    this.events.push({ kind: 'set', v, t })
    return this
  }
  linearRampToValueAtTime(v: number, t: number) {
    this.events.push({ kind: 'lin', v, t })
    return this
  }
  exponentialRampToValueAtTime(v: number, t: number) {
    this.events.push({ kind: 'exp', v, t })
    return this
  }
  setTargetAtTime(v: number, t: number, tc: number) {
    this.events.push({ kind: 'target', v, t: t + tc })
    return this
  }
  cancelScheduledValues() {
    return this
  }
}
class FakeNode {
  outs: unknown[] = []
  connect(n: unknown) {
    this.outs.push(n)
    return n
  }
  disconnect() {}
}
class FakeOsc extends FakeNode {
  type = 'sine'
  frequency = new FakeParam()
  detune = new FakeParam()
  start() {}
  stop() {}
}
class FakeGain extends FakeNode {
  gain = new FakeParam()
}
class FakeFilter extends FakeNode {
  type = 'lowpass'
  frequency = new FakeParam()
  Q = new FakeParam()
  gain = new FakeParam()
}
class FakeSource extends FakeNode {
  buffer: unknown = null
  start() {}
  stop() {}
}
class FakeCtx {
  currentTime = 0
  sampleRate = 8000
  state = 'running'
  destination = new FakeNode()
  oscs: FakeOsc[] = []
  sources: FakeSource[] = []
  gains: FakeGain[] = []
  createOscillator() {
    const o = new FakeOsc()
    this.oscs.push(o)
    return o
  }
  createGain() {
    const g = new FakeGain()
    this.gains.push(g)
    return g
  }
  createBiquadFilter() {
    return new FakeFilter()
  }
  createBufferSource() {
    const s = new FakeSource()
    this.sources.push(s)
    return s
  }
  createBuffer(_c: number, len: number) {
    return { getChannelData: () => new Float32Array(len) }
  }
  createDelay() {
    return Object.assign(new FakeNode(), { delayTime: new FakeParam() })
  }
  createDynamicsCompressor() {
    return Object.assign(new FakeNode(), { threshold: new FakeParam(), ratio: new FakeParam() })
  }
  resume() {
    this.state = 'running'
    return Promise.resolve()
  }
}

let ctx: FakeCtx
function freshAudio() {
  ctx = new FakeCtx()
  audio.__setAudioFactory(() => ctx as unknown as BaseAudioContext)
  audio.unlock()
}
function capture(fn: () => void) {
  const o0 = ctx.oscs.length
  const s0 = ctx.sources.length
  audio.__traceStart()
  fn()
  const trace = audio.__traceStop()
  return { trace, oscs: ctx.oscs.length - o0, sources: ctx.sources.length - s0 }
}

const ALL: SfxName[] = [...audio.SFX_NAMES]
const PITCHED: SfxName[] = ALL.filter(n => n !== 'throw' && n !== 'pass' && n !== 'stamp') // noise / a thump
const optsFor = (n: SfxName) => (n === 'faceChime' ? { note: 79 } : n === 'knowTick' || n === 'pillar' || n === 'penlight' ? { index: 2 } : {})

// ---------------------------------------------------------------- governor

describe('governor (K-11 tiers)', () => {
  afterEach(() => setFrameTimeProvider(null))

  /** A page whose frame time depends on the tier: `base` (everything else) + the effects' cost. */
  const sim = (g: ReturnType<typeof createGovernor>, cost: Record<0 | 1 | 2, number>) => {
    const load = { base: 0 }
    setFrameTimeProvider(() => load.base + cost[g.tier])
    let t = 0
    const run = (ms: number, base = load.base) => {
      load.base = base
      for (let e = 0; e < ms; e += 250) g.update((t += 250), ticker.frameTimeAvg(), false)
      return g.tier
    }
    return run
  }

  it('steps 2 → 1 → 0 while the effects are what makes frames slow, and back up when they are fast (frameTimeAvg swapped)', () => {
    const g = createGovernor({ graceMs: 0, probeMs: 0 })
    const run = sim(g, { 2: 14, 1: 8, 0: 0 })
    expect(g.tier).toBe(2)
    expect(run(250, 14)).toBe(2) // 28 ms: one slow sample is not enough
    expect(run(1000)).toBe(1) // sustained → down (22 ms)
    expect(run(2250)).toBe(1) // cooldown + verdict: the step bought 6 ms, it stays
    expect(run(1500)).toBe(0) // still > 19 → down again (14 ms)
    expect(run(6000)).toBe(0) // 14 ms is fine; 13 ms is not reached → stays
    expect(g.log.map(e => `${e.from}>${e.to}`)).toEqual(['2>1', '1>0'])
    // the load goes away: < 13 ms for 3 s → up, and up again
    expect(run(3250, 3)).toBe(1)
    expect(run(5250)).toBe(2) // cooldown + 3 s fast; 17 ms at tier 2 sits between the thresholds
    expect(run(8000)).toBe(2)
  })

  it('gives the tier back when a step down bought no frames (the page is slow for other reasons)', () => {
    const g = createGovernor({ graceMs: 0, probeMs: 0 })
    const run = sim(g, { 2: 1.4, 1: 0.8, 0: 0 })
    expect(run(1250, 23)).toBe(1) // 24.4 ms → down to 1 (23.8)
    expect(run(2500)).toBe(2) // verdict: 0.6 ms is nothing → restored
    expect(g.log.at(-1)?.why).toBe('blameless')
    expect(run(14000)).toBe(2) // held: the same slowness does not cost the sparkle again
    // clearly worse than when it was tried (+4 ms): allowed to try again, and this time it pays
    const g2 = createGovernor({ graceMs: 0, probeMs: 0 })
    const run2 = sim(g2, { 2: 9, 1: 3, 0: 0 })
    expect(run2(1250, 16)).toBe(1) // 25 → 19 ms: a real gain
    expect(run2(3000)).toBe(1)
  })

  it('judges a step by medians: one fast moment in the verdict window does not make it look useful', () => {
    const g = createGovernor({ graceMs: 0, probeMs: 0 })
    let t = 0
    let n = 0
    const cost = { 2: 1.4, 1: 0.8, 0: 0 } as const
    for (; t < 1250; t += 250) g.update(t, 23 + cost[g.tier], false)
    expect(g.tier).toBe(1)
    for (; t < 4000; t += 250) g.update(t, ++n === 7 ? 9 : 23 + cost[g.tier], false) // one lucky sample
    expect(g.tier).toBe(2)
    expect(g.log.at(-1)?.why).toBe('blameless')
  })

  it('pins tier 0 under reduced motion, whatever the frame time', () => {
    const g = createGovernor({ graceMs: 0 })
    for (let t = 0; t < 10000; t += 250) g.update(t, 8, true)
    expect(g.tier).toBe(0)
    expect(TIERS[0].auroraRes).toBe(0)
    expect(TIERS[0].specks).toBe(20)
    expect([TIERS[2].specks, TIERS[2].dust, TIERS[1].specks, TIERS[1].dust]).toEqual([60, 120, 40, 60])
    expect([TIERS[2].auroraRes, TIERS[1].auroraRes, TIERS[2].blobs, TIERS[1].blobs]).toEqual([0.5, 0.4, 3, 2])
  })

  it('ignores the entrance (grace) and does not flap between tiers', () => {
    const g = createGovernor({ graceMs: 2500 })
    for (let t = 0; t < 2400; t += 250) g.update(t, 40, false)
    expect(g.tier).toBe(2)
    const changes: number[] = []
    let last = g.tier
    for (let t = 2500; t < 12000; t += 250) {
      g.update(t, 40, false)
      if (g.tier !== last) changes.push(t)
      last = g.tier
    }
    // at least a cooldown between two steps
    for (let i = 1; i < changes.length; i++) expect(changes[i] - changes[i - 1]).toBeGreaterThanOrEqual(1000)
  })

  it('backs off a promotion that fails at once, and re-probes a lost tier on a 60 Hz screen', () => {
    const g = createGovernor({ graceMs: 0, probeMs: 10000, sustainMs: 250 })
    const run = sim(g, { 2: 8, 1: 0, 0: 0 })
    expect(run(750, 16)).toBe(1) // 24 ms → down to 1 (16 ms): a real gain
    expect(run(9000, 16.7)).toBe(1) // steady at the vsync ceiling, not long enough yet
    expect(run(1000)).toBe(2) // probed back up ≈10 s after the drop
    expect(run(3000)).toBe(1) // 24.7 ms at tier 2 again: the probe failed
    run(40000)
    const probes = g.log.filter(e => e.why === 'probe').map(e => e.at)
    const drops = g.log.filter(e => e.why === 'slow').map(e => e.at)
    expect(probes.length).toBeGreaterThanOrEqual(2)
    expect(probes[0] - drops[0]).toBeGreaterThanOrEqual(10000)
    expect(probes[1] - drops[1]).toBeGreaterThanOrEqual(2 * 10000) // waits twice as long
  })
})

// ---------------------------------------------------------------- sound

describe('sound synth (I-5)', () => {
  beforeEach(freshAudio)
  afterEach(() => audio.__setAudioFactory(null))

  it('implements every SfxName, and every one makes sound', () => {
    for (const n of ALL) {
      const c = capture(() => audio.play(n, optsFor(n)))
      expect(c.trace.length, n).toBeGreaterThan(0)
      expect(c.oscs + c.sources, n).toBeGreaterThan(0)
    }
  })

  it('keeps every audible pitch on C major pentatonic (and nothing bypasses the tracer)', () => {
    for (const n of ALL) {
      const opts = optsFor(n)
      const c = capture(() => audio.play(n, opts))
      const oscRoles = c.trace.filter(e => e.role !== 'noise')
      expect(oscRoles.length, `${n}: every oscillator is traced`).toBe(c.oscs)
      expect(c.trace.filter(e => e.role === 'noise').length, `${n}: every noise source is traced`).toBe(c.sources)
      for (const e of c.trace.filter(x => x.role === 'pitched')) {
        for (const f of e.freqs) expect(audio.isPentatonicFreq(f), `${n} plays ${f.toFixed(1)} Hz`).toBe(true)
      }
      if (PITCHED.includes(n)) expect(c.trace.some(e => e.role === 'pitched'), `${n} is pitched`).toBe(true)
    }
    // variants: every know tick, pillar and penlight step, every face note of the catalogue
    for (let i = 0; i < 4; i++) for (const half of [false, true]) for (const e of capture(() => audio.play('knowTick', { index: i, half })).trace.filter(x => x.role === 'pitched')) expect(audio.isPentatonicFreq(e.freqs[0])).toBe(true)
    for (let i = 0; i < 12; i++) for (const e of capture(() => audio.play('penlight', { index: i })).trace.filter(x => x.role === 'pitched')) expect(audio.isPentatonicFreq(e.freqs[0])).toBe(true)
    const notes = new Set(SONGS.map(s => faceNote(s)))
    for (const note of notes) for (const e of capture(() => audio.play('faceChime', { note })).trace.filter(x => x.role === 'pitched')) expect(audio.isPentatonicFreq(e.freqs[0])).toBe(true)
    const mel = capture(() => audio.playMelody([60, 62, 64, 67, 69, 72, 61 /* off-scale input is snapped */]))
    for (const e of mel.trace.filter(x => x.role === 'pitched')) for (const f of e.freqs) expect(audio.isPentatonicFreq(f)).toBe(true)
  })

  it('knowTick climbs C5 → E5 → G5 → C6; the chorus-only tick is half as loud', () => {
    const want = [523.25, 659.26, 783.99, 1046.5]
    want.forEach((f, i) => {
      const t = capture(() => audio.play('knowTick', { index: i })).trace.filter(e => e.role === 'pitched')
      expect(t[0].freqs[0]).toBeCloseTo(f, 0)
    })
    const full = capture(() => audio.play('knowTick', { index: 1 })).trace[0].gain
    const half = capture(() => audio.play('knowTick', { index: 1, half: true })).trace[0].gain
    expect(half).toBeCloseTo(full / 2, 5)
  })

  it('lightOn and fanfare finish within 1.2 s; pass is half the level of throw', () => {
    for (const n of ['lightOn', 'fanfare'] as SfxName[]) {
      const tr = capture(() => audio.play(n)).trace
      const start = Math.min(...tr.map(e => e.start))
      const end = Math.max(...tr.map(e => e.end))
      expect(end - start, n).toBeLessThanOrEqual(1.2)
    }
    const thr = capture(() => audio.play('throw')).trace[0].gain
    const pas = capture(() => audio.play('pass')).trace[0].gain
    expect(pas).toBeCloseTo(thr / 2, 5)
  })

  it('keeps the first-tap chord until a touch activation resumes the context (pointerdown is not one)', async () => {
    ctx = new FakeCtx()
    ctx.state = 'suspended'
    audio.__setAudioFactory(() => ctx as unknown as BaseAudioContext)
    ctx.resume = () => Promise.resolve() // the pointerdown: creation allowed, resume refused
    audio.unlock()
    audio.__traceStart()
    audio.play('lightOn')
    expect(audio.awaitingResume()).toBe(true)
    await Promise.resolve()
    expect(audio.__traceStop().length).toBe(0) // nothing heard yet
    ctx.resume = FakeCtx.prototype.resume // the pointerup: resume works
    audio.__traceStart()
    audio.unlock()
    await new Promise(r => setTimeout(r, 0))
    const tr = audio.__traceStop()
    expect(tr.some(e => e.sfx === 'lightOn')).toBe(true)
    expect(audio.awaitingResume()).toBe(false)
  })

  it('is silent while muted and ducks by 12 dB', () => {
    audio.setMuted(true)
    expect(capture(() => audio.play('land')).trace.length).toBe(0)
    audio.setMuted(false)
    expect(capture(() => audio.play('land')).trace.length).toBeGreaterThan(0)
    const busGain = ctx.gains[1].gain // master is gains[0], the duck bus gains[1]
    audio.setDuck(true)
    const ev = busGain.events.at(-1)!
    expect(ev.kind).toBe('target')
    expect(20 * Math.log10(ev.v)).toBeCloseTo(-12, 1)
    expect(ev.t).toBeCloseTo(0.2, 5) // time constant 0.2 s
    audio.setDuck(false)
    expect(busGain.events.at(-1)!.v).toBe(1)
  })
})

describe('installSound (store + bus → sounds)', () => {
  let off: () => void = () => {}
  beforeEach(() => {
    freshAudio()
    naviApi.getState().resetAll()
    off = installSound(naviApi)
    naviApi.getState().unlockAudio()
    sound.unlock()
  })
  afterEach(() => {
    off()
    audio.__setAudioFactory(null)
  })

  it('follows mute from the store (persisted in settings) and ducks only while a roommate sings', () => {
    naviApi.getState().setMuted(true)
    expect(audio.isMuted()).toBe(true)
    naviApi.getState().setMuted(false)
    expect(audio.isMuted()).toBe(false)
    const item = { id: 'q1', songId: SONGS[0].id, by: 'minato' as const, keyShift: 0, version: 'original' as const, tags: [], addedAt: 0 }
    naviApi.setState(s => ({ room: { ...s.room, now: { item, startedAt: 0, durationMs: 40000 } } }))
    expect(audio.isDucked()).toBe(true)
    naviApi.getState().setNoDuck(true)
    expect(audio.isDucked()).toBe(false)
    naviApi.getState().setNoDuck(false)
    expect(audio.isDucked()).toBe(true)
    naviApi.setState(s => ({ room: { ...s.room, now: { item: { ...item, by: 'me' }, startedAt: 0, durationMs: 40000 } } }))
    expect(audio.isDucked()).toBe(false)
    expect(shouldDuck(naviApi.getState())).toBe(false)
  })

  it('maps card actions and orders to their sounds, and plays one sound once when two callers voice it', () => {
    const card = { id: 'c1', kind: 'song' as const, songId: SONGS[3].id, reason: { source: 'yomu' as const, text: { key: 'reason.opener' } }, trigger: { type: 'enter' as const, at: 0 }, rule: 't', dealtAt: 0 }
    const names = (fn: () => void) => [...new Set(capture(fn).trace.map(e => e.sfx))]
    expect(names(() => bus.emit({ type: 'card/acted', card, action: 'reserve' }))).toEqual(['throw'])
    expect(names(() => bus.emit({ type: 'card/acted', card, action: 'keep' }))).toEqual(['keepFold'])
    expect(names(() => bus.emit({ type: 'card/acted', card, action: 'pass' }))).toEqual(['pass'])
    const order = { id: 'o1', menuId: 'lemon', qty: 1, status: 'accepted' as const, idem: 'x', createdAt: 0, etaAfterSongs: 2 }
    expect(names(() => bus.emit({ type: 'order/status', order }))).toEqual(['clink'])
    expect(names(() => bus.emit({ type: 'order/status', order }))).toEqual([]) // once per order
    // a component and the fallback both voice the chord → heard once
    const n1 = capture(() => {
      sound.play('knowChord')
      sound.play('knowChord')
    })
    expect(n1.trace.filter(e => e.role === 'pitched').length).toBe(4 + 3)
  })

  it('does not play before the first tap (audioOn false)', () => {
    naviApi.getState().resetAll()
    naviApi.setState(s => ({ session: { ...s.session, audioOn: false } }))
    expect(capture(() => sound.play('land')).trace.length).toBe(0)
  })
})

// ---------------------------------------------------------------- fxState / aurora

describe('fxState sync, palette crossfade and flow speed', () => {
  beforeEach(() => {
    resetFxState()
    naviApi.getState().resetAll()
  })

  it('crossfades the palette when the air changes, and halves the flow for one song after a rest', () => {
    const s0 = naviApi.getState()
    syncFxState(s0)
    expect(fxState.aurora).toBe('quiet')
    naviApi.setState(st => ({ room: { ...st.room, heat: 0.9, moodWord: 'peak' } }))
    const s1 = naviApi.getState()
    syncFxState(s1, s0)
    expect(fxState.aurora).toBe('hot')
    expect(fxState.auroraFrom).toBe('quiet')
    expect(fxState.auroraT).toBe(0)
    expect(fxState.speed).toBeCloseTo(1.4, 5)
    naviApi.getState().restOneSong()
    const s2 = naviApi.getState()
    syncFxState(s2, s1)
    expect(fxState.speed).toBeCloseTo(0.7, 5)
    expect(flowSpeed({ room: { ...s2.room, restUntil: 0 }, session: s2.session })).toBeCloseTo(1.4, 5)
  })

  it('never snaps a live preview back on unrelated store changes (the mixer writes fxState too)', () => {
    const s0 = naviApi.getState()
    syncFxState(s0)
    // the mood mixer previews a hot, fast wall
    fxState.aurora = 'hot'
    fxState.auroraT = 1
    fxState.heat = 0.95
    fxState.speed = 1.45
    // a clock tick changes the store, but not the air
    naviApi.setState(st => ({ session: { ...st.session, simMs: st.session.simMs + 250 } }))
    syncFxState(naviApi.getState(), s0)
    expect([fxState.aurora, fxState.auroraT, fxState.heat, fxState.speed]).toEqual(['hot', 1, 0.95, 1.45])
    // at boot (no previous state) the wall snaps to the room without a fade
    naviApi.setState(st => ({ room: { ...st.room, heat: 0.55, moodWord: 'warming' } }))
    syncFxState(naviApi.getState())
    expect([fxState.aurora, fxState.auroraFrom, fxState.auroraT]).toEqual(['warm', 'warm', 1])
  })

  it('blends palettes smoothly, flushes gold, and never jumps when retargeted mid-fade', () => {
    const q = PALETTE_RGB.quiet
    const h = PALETTE_RGB.hot
    expect(blendPalette(q, h, 0)[0]).toEqual(q[0])
    expect(blendPalette(q, h, 1)[1]).toEqual(h[1])
    const g = blendPalette(q, h, 1, 1)
    g.forEach((c, i) => c.forEach((v, k) => expect(v).toBeCloseTo(GOLD_RGB[i][k], 5)))
    const tr = new PaletteTracker('quiet')
    tr.update({ aurora: 'hot', auroraT: 0.5, gold: 0 })
    const mid = tr.shown.map(c => [...c])
    // the air changes again mid-fade: the next frame starts from what is on screen
    const next = tr.update({ aurora: 'mellow', auroraT: 0, gold: 0 })
    next.forEach((c, i) => c.forEach((v, k) => expect(v).toBeCloseTo(mid[i][k], 5)))
  })

  it('times the aurora entrance per B-2 (0.3 → 1.5 s), compresses it on short intros, fades under reduced motion', () => {
    expect(auroraIntro(200, 'full', false)).toBe(0)
    expect(auroraIntro(900, 'full', false)).toBeCloseTo(0.5, 5)
    expect(auroraIntro(1500, 'full', false)).toBe(1)
    expect(auroraIntro(0, 'none', false)).toBe(1)
    expect(auroraIntro(81 + 300, 'short', false)).toBeCloseTo(1, 5)
    expect(introProgress(150, 'full', true, 300, 1200)).toBeCloseTo(0.5, 5)
  })

  it('installFx: gold on all-know, the lights-on cue on the first tap, specks target from the collection', () => {
    const off = installFx(naviApi)
    const cues: string[] = []
    const offSig = fxSignals.on(s => cues.push(s.type))
    bus.emit({ type: 'know/complete', songId: SONGS[0].id, view: { dots: ['know', 'know', 'know'], knows: 3, size: 3, all: true } })
    expect(fxState.gold).toBe(1)
    bus.emit({ type: 'fx/flash', strength: 0.8 })
    expect(fxState.flash).toBeCloseTo(0.8, 5)
    naviApi.setState(s => ({ session: { ...s.session, audioOn: false } }))
    naviApi.getState().unlockAudio()
    expect(cues).toContain('lightsOn')
    expect(fxState.flash).toBe(1)
    const faces = Object.fromEntries(SONGS.slice(0, 70).map(s => [s.id, { songId: s.id, state: 'mirror' as const, marks: [], firstNightId: 'n', firstAt: 0, sungCount: 1 }]))
    naviApi.setState(s => ({ col: { ...s.col, faces } }))
    expect(fxState.specksTarget).toBe(60)
    offSig()
    off()
  })
})

// ---------------------------------------------------------------- specks & bursts

describe('specks', () => {
  const box = { w: 390, h: 844, cx: 195, cy: 250, hy: 340 }
  it('crosses the wall in 12 s and fades at the sides', () => {
    expect(OMEGA * LAP_MS).toBeCloseTo(2 * ARC, 8)
    const mid = project({ lon: 0, lat: 0.3 }, box)
    const edge = project({ lon: ARC * 0.98, lat: 0.3 }, box)
    expect(mid.vis).toBe(1)
    expect(edge.vis).toBeLessThan(0.1)
    expect(edge.x).toBeGreaterThan(box.w) // off-screen when it fades
  })
  it('spreads specks over the upper wall mostly', () => {
    let above = 0
    for (let i = 0; i < 60; i++) if (project(placement(i), box).y < box.hy) above++
    expect(above / 60).toBeGreaterThan(0.6)
  })
  it('keeps the living count at the target: adopts transient specks, adds, then fades the surplus', () => {
    const list: Speck[] = []
    expect(syncCount(list, 12, () => null, 600)).toBe(12)
    expect(list.length).toBe(12)
    const t = makeSpeck(99, { x: 10, y: 10 }, 900)
    t.ttl = 2000
    list.push(t)
    expect(syncCount(list, 13, () => null, 900)).toBe(13)
    expect(list.length).toBe(13) // adopted, not added
    expect(syncCount(list, 5, () => null, 900)).toBe(5)
    expect(list.filter(s => s.dying).length).toBe(8)
  })
})

describe('colours', () => {
  it('reads the hex and hsl colours the app hands over (area colours are hsl)', () => {
    expect(cssToRgb('#FF3DA8')).toEqual([255, 61, 168])
    expect(cssToRgb('hsl(0 100% 50%)')).toEqual([255, 0, 0])
    expect(cssToRgb('hsl(120, 100%, 25%)')).toEqual([0, 128, 0])
    const [r, g, b] = cssToRgb('hsl(330 85% 62%)')
    expect(r).toBeGreaterThan(200)
    expect(b).toBeGreaterThan(g)
  })
})

describe('bursts', () => {
  it('spark12 throws exactly twelve sparks; reduced motion throws none; everything fades', () => {
    const b = new BurstSystem()
    b.fire('spark12', 100, 100)
    expect(b.parts.length).toBe(12)
    expect(PRESET_PARTICLES.spark12).toBe(12)
    for (let i = 0; i < 100; i++) b.step(16)
    expect(b.busy).toBe(false)
    b.fire('prism', 0, 0, { reduced: true })
    expect(b.parts.length).toBe(0)
    expect(b.rings.length).toBeGreaterThan(0) // a soft fade instead
    for (const p of ['spark12', 'prism', 'pin', 'stamp', 'area'] as const) {
      const s = new BurstSystem()
      s.fire(p, 0, 0)
      expect(s.busy, p).toBe(true)
    }
  })
})

// ---------------------------------------------------------------- K-11 static checks

describe('K-11: forbidden drawing APIs', () => {
  const src = import.meta.glob(['./*.ts', './*.tsx', './*.css', '../../lib/audio.ts', '!./*.test.ts'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

  it('scans the module', () => {
    expect(Object.keys(src).length).toBeGreaterThanOrEqual(12)
  })
  it('no shadowBlur, no ctx.filter, no own requestAnimationFrame', () => {
    for (const [file, raw] of Object.entries(src)) {
      const s = strip(raw)
      expect(s, file).not.toMatch(/shadowBlur/)
      expect(s, file).not.toMatch(/\b(ctx|g|context)\.filter\s*=/)
      expect(s, file).not.toMatch(/requestAnimationFrame/)
    }
  })
  it('radial gradients are painted only once, in sprites.ts (never inside a frame loop)', () => {
    for (const [file, raw] of Object.entries(src)) {
      const s = strip(raw)
      if (file.endsWith('sprites.ts')) continue
      expect(s, file).not.toMatch(/createRadialGradient/)
    }
    // inside sprites.ts every gradient lives in a cached `once(...)` factory
    const sp = strip(src['./sprites.ts'])
    const blocks = sp.split(/\nexport /)
    for (const b of blocks) if (/createRadialGradient/.test(b)) expect(b).toMatch(/return once\(/)
  })
  it('no blur/blend on large layers, no extra backdrop-filter, only opacity/transform animate', () => {
    const css = strip(src['./fx.css'])
    expect(css).not.toMatch(/filter\s*:/)
    expect(css).not.toMatch(/mix-blend-mode/)
    expect(css).not.toMatch(/backdrop-filter/)
    const frames = css.match(/@keyframes[^{]+\{([\s\S]*?\}\s*)\}/g) ?? []
    for (const f of frames) for (const prop of f.matchAll(/([a-z-]+)\s*:/g)) expect(['transform', 'opacity']).toContain(prop[1])
    for (const t of css.matchAll(/transition\s*:\s*([a-z-]+)/g)) expect(t[1]).toBe('opacity')
  })
})
