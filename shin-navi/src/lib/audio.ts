// Synthesised sound (SPEC I-5). Nothing is sampled: every sound is built from oscillators and
// noise. Chain: voices → duck (−12 dB while a roommate sings) → master 0.55 (0 when muted)
// → compressor (−18 dB, 4:1) → out, plus a delay send (230 ms, feedback 0.32, low-pass 3.2 kHz).
// Every pitched sound is taken from C major pentatonic (C D E G A). The only unpitched parts
// are noise, the stamp thump, the glass partials of `clink` and FM modulators; they are tagged
// so the unit test can check every audible pitch (see __traceStart).
import { mulberry32 } from './rng'

export type SfxName =
  | 'lightOn'
  | 'faceChime'
  | 'throw'
  | 'land'
  | 'keepFold'
  | 'pass'
  | 'knowTick'
  | 'knowChord'
  | 'redeal'
  | 'twin'
  | 'pillar'
  | 'orbPop'
  | 'clink'
  | 'softTock'
  | 'stamp'
  | 'fanfare'
  | 'penlight'
  | 'standbyChime'
  | 'tap'
  | 'flip'
  | 'open'
  | 'close'

export type SfxOpts = { note?: number; index?: number; half?: boolean; gain?: number }

export const SFX_NAMES: readonly SfxName[] = [
  'lightOn',
  'faceChime',
  'throw',
  'land',
  'keepFold',
  'pass',
  'knowTick',
  'knowChord',
  'redeal',
  'twin',
  'pillar',
  'orbPop',
  'clink',
  'softTock',
  'stamp',
  'fanfare',
  'penlight',
  'standbyChime',
  'tap',
  'flip',
  'open',
  'close',
]

// ------------------------------------------------------------------ pitch

/** C major pentatonic pitch classes (C D E G A). */
export const PENTA = [0, 2, 4, 7, 9] as const
export const mtof = (m: number): number => 440 * Math.pow(2, (m - 69) / 12)
export const ftom = (f: number): number => 69 + 12 * Math.log2(f / 440)

/** Whether a frequency lies on C major pentatonic (within `cents`). */
export function isPentatonicFreq(f: number, cents = 10): boolean {
  if (!(f > 0)) return false
  const m = ftom(f)
  const nearest = Math.round(m)
  if (Math.abs(m - nearest) * 100 > cents) return false
  return (PENTA as readonly number[]).includes(((nearest % 12) + 12) % 12)
}

/** n-th step of the pentatonic stair above `base` (a C). */
export const pentaStep = (base: number, n: number): number => base + PENTA[((n % 5) + 5) % 5] + 12 * Math.floor(n / 5)

const C4 = 60
const N = {
  C2: 36,
  C3: 48,
  G3: 55,
  C4,
  D4: 62,
  E4: 64,
  G4: 67,
  A4: 69,
  C5: 72,
  D5: 74,
  E5: 76,
  G5: 79,
  A5: 81,
  C6: 84,
  D6: 86,
  E6: 88,
  G6: 91,
  A6: 93,
  C7: 96,
  E7: 100,
  G7: 103,
}

// ------------------------------------------------------------------ engine

type Engine = {
  ac: BaseAudioContext & { resume?: () => Promise<void>; state: string }
  /** voices connect here; carries the ducking gain */
  bus: GainNode
  master: GainNode
  /** delay send */
  send: GainNode
  noise: AudioBuffer
}

type Factory = () => (BaseAudioContext & { resume?: () => Promise<void> }) | null

const defaultFactory: Factory = () => {
  if (typeof window === 'undefined') return null
  const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  return AC ? new AC() : null
}

let factory: Factory = defaultFactory
let eng: Engine | null = null
let muted = false
let ducked = false
const MASTER = 0.55
const DUCK = Math.pow(10, -12 / 20) // −12 dB

function build(): Engine | null {
  const ac = factory() as Engine['ac'] | null
  if (!ac) return null
  const comp = ac.createDynamicsCompressor()
  comp.threshold.value = -18
  comp.ratio.value = 4
  const master = ac.createGain()
  master.gain.value = muted ? 0 : MASTER
  const bus = ac.createGain()
  bus.gain.value = ducked ? DUCK : 1
  bus.connect(master)
  master.connect(comp)
  comp.connect(ac.destination)

  // delay send: 230 ms, feedback 0.32, low-passed at 3.2 kHz, returns through the duck
  const send = ac.createGain()
  send.gain.value = 1
  const delay = ac.createDelay(1)
  delay.delayTime.value = 0.23
  const fb = ac.createGain()
  fb.gain.value = 0.32
  const lp = ac.createBiquadFilter()
  lp.type = 'lowpass'
  lp.frequency.value = 3200
  send.connect(delay)
  delay.connect(lp)
  lp.connect(fb)
  fb.connect(delay)
  lp.connect(bus)

  const len = Math.floor(ac.sampleRate)
  const noise = ac.createBuffer(1, len, ac.sampleRate)
  const data = noise.getChannelData(0)
  const r = mulberry32(7)
  for (let i = 0; i < len; i++) data[i] = r() * 2 - 1
  return { ac, bus, master, send, noise }
}

/** Create/resume the context. Call from a user gesture; safe to call repeatedly. */
export function unlock(): void {
  if (!eng) eng = build()
  const ac = eng?.ac
  if (ac && ac.state === 'suspended' && ac.resume) void ac.resume().catch(() => {})
}

export function setMuted(m: boolean): void {
  muted = m
  if (eng) eng.master.gain.setTargetAtTime(m ? 0 : MASTER, eng.ac.currentTime, 0.03)
}

export function isMuted(): boolean {
  return muted
}

/** Duck everything by 12 dB (time constant 0.2 s) while a roommate sings. */
export function setDuck(on: boolean): void {
  if (ducked === on) return
  ducked = on
  if (eng) eng.bus.gain.setTargetAtTime(on ? DUCK : 1, eng.ac.currentTime, 0.2)
}

export function isDucked(): boolean {
  return ducked
}

export function contextState(): string {
  return eng ? eng.ac.state : 'none'
}

function ready(): Engine | null {
  if (!eng || muted) return null
  return eng.ac.state === 'running' ? eng : null
}

/** Vibration where supported (Android). Quiet mode (muted) also stops vibration. */
export function haptic(pattern: number | number[] = 12): void {
  if (muted) return
  try {
    navigator.vibrate?.(pattern)
  } catch {
    /* unsupported */
  }
}

// ------------------------------------------------------------------ trace (tests)

export type TraceRole = 'pitched' | 'noise' | 'percussive' | 'inharmonic' | 'modulator'
export type TraceEntry = { sfx: string; role: TraceRole; freqs: number[]; start: number; end: number; gain: number }
let trace: TraceEntry[] | null = null
let traceName = ''

/** Tests: record every voice built from now on (with a fake AudioContext). */
export function __traceStart(): void {
  trace = []
}
export function __traceStop(): TraceEntry[] {
  const t = trace ?? []
  trace = null
  return t
}
/** Tests: swap the AudioContext factory (null restores the browser one) and reset the engine. */
export function __setAudioFactory(f: Factory | null): void {
  factory = f ?? defaultFactory
  eng = null
  muted = false
  ducked = false
}

function record(role: TraceRole, freqs: number[], start: number, end: number, gain: number) {
  trace?.push({ sfx: traceName, role, freqs, start, end, gain })
}

// ------------------------------------------------------------------ primitives

type ToneOpts = {
  f: number
  /** glide target (Hz) and when it is reached (s after start) */
  to?: number
  glide?: number
  glideAt?: number
  type?: OscillatorType
  at: number
  attack?: number
  /** time spent at the peak before the decay */
  hold?: number
  decay: number
  gain: number
  send?: number
  dest?: AudioNode
  role?: TraceRole
}

function env(g: GainNode, at: number, attack: number, hold: number, decay: number, peak: number) {
  g.gain.setValueAtTime(0.0001, at)
  g.gain.linearRampToValueAtTime(peak, at + attack)
  if (hold > 0) g.gain.setValueAtTime(peak, at + attack + hold)
  g.gain.exponentialRampToValueAtTime(0.0001, at + attack + hold + decay)
}

function tone(e: Engine, o: ToneOpts): OscillatorNode {
  const { ac } = e
  const attack = o.attack ?? 0.005
  const hold = o.hold ?? 0
  const end = o.at + attack + hold + o.decay
  const osc = ac.createOscillator()
  osc.type = o.type ?? 'sine'
  osc.frequency.setValueAtTime(o.f, o.at)
  if (o.to) {
    const gAt = o.at + (o.glideAt ?? 0)
    osc.frequency.setValueAtTime(o.f, gAt)
    osc.frequency.exponentialRampToValueAtTime(o.to, gAt + (o.glide ?? o.decay))
  }
  const g = ac.createGain()
  env(g, o.at, attack, hold, o.decay, o.gain)
  osc.connect(g)
  g.connect(o.dest ?? e.bus)
  if (o.send) {
    const s = ac.createGain()
    s.gain.value = o.send
    g.connect(s)
    s.connect(e.send)
  }
  osc.start(o.at)
  osc.stop(end + 0.05)
  record(o.role ?? 'pitched', o.to ? [o.f, o.to] : [o.f], o.at, end, o.gain)
  return osc
}

type NoiseOpts = { at: number; dur: number; gain: number; from: number; to: number; q?: number; type?: BiquadFilterType; attack?: number; dest?: AudioNode; send?: number }

function noise(e: Engine, o: NoiseOpts): void {
  const { ac } = e
  const src = ac.createBufferSource()
  src.buffer = e.noise
  const f = ac.createBiquadFilter()
  f.type = o.type ?? 'bandpass'
  f.Q.value = o.q ?? 1.2
  f.frequency.setValueAtTime(o.from, o.at)
  f.frequency.exponentialRampToValueAtTime(o.to, o.at + o.dur)
  const g = ac.createGain()
  env(g, o.at, o.attack ?? 0.01, 0, Math.max(0.02, o.dur - (o.attack ?? 0.01)), o.gain)
  src.connect(f)
  f.connect(g)
  g.connect(o.dest ?? e.bus)
  if (o.send) {
    const s = ac.createGain()
    s.gain.value = o.send
    g.connect(s)
    s.connect(e.send)
  }
  src.start(o.at, (o.at * 7.31) % 0.5)
  src.stop(o.at + o.dur + 0.05)
  record('noise', [o.from, o.to], o.at, o.at + o.dur, o.gain)
}

/** FM bell: sine carrier f, sine modulator f×ratio, index decaying with the note. */
function bell(e: Engine, o: { f: number; at: number; gain: number; decay: number; ratio?: number; index?: number; send?: number; dest?: AudioNode }) {
  const { ac } = e
  const ratio = o.ratio ?? 3.5
  const index = o.index ?? 2
  const fm = o.f * ratio
  const car = tone(e, { f: o.f, at: o.at, attack: 0.003, decay: o.decay, gain: o.gain, send: o.send, dest: o.dest })
  const mod = ac.createOscillator()
  mod.type = 'sine'
  mod.frequency.setValueAtTime(fm, o.at)
  const depth = ac.createGain()
  // index = deviation / modulator frequency → deviation = index·fm, decaying to a soft tail
  depth.gain.setValueAtTime(index * fm, o.at)
  depth.gain.exponentialRampToValueAtTime(Math.max(1, index * fm * 0.12), o.at + o.decay)
  mod.connect(depth)
  depth.connect(car.frequency)
  mod.start(o.at)
  mod.stop(o.at + o.decay + 0.06)
  record('modulator', [fm], o.at, o.at + o.decay, 0)
}

function filterTo(e: Engine, type: BiquadFilterType, freq: number, at: number, to?: number, dur?: number): BiquadFilterNode {
  const f = e.ac.createBiquadFilter()
  f.type = type
  f.frequency.setValueAtTime(freq, at)
  if (to && dur) f.frequency.exponentialRampToValueAtTime(to, at + dur)
  f.connect(e.bus)
  return f
}

// ------------------------------------------------------------------ the sounds (SPEC I-5)

const KNOW_NOTES = [N.C5, N.E5, N.G5, N.C6]
const PILLAR_NOTES = [N.C5, N.E5, N.G5]

function synth(e: Engine, name: SfxName, o: SfxOpts, t: number): void {
  const k = o.gain ?? 1
  switch (name) {
    case 'lightOn': {
      // arpeggio C4 E4 G4 A4 D5, 60 ms apart, over a noise swell and a breathing C2 sub
      ;[N.C4, N.E4, N.G4, N.A4, N.D5].forEach((m, i) => {
        tone(e, { f: mtof(m), type: 'triangle', at: t + i * 0.06, attack: 0.005, decay: 0.6, gain: 0.09 * k, send: 0.35 })
        tone(e, { f: mtof(m + 12), type: 'sine', at: t + i * 0.06 + 0.01, attack: 0.005, decay: 0.45, gain: 0.025 * k, send: 0.5 })
      })
      noise(e, { at: t, dur: 0.7, gain: 0.045 * k, from: 400, to: 4000, q: 1.6, attack: 0.45, send: 0.3 })
      const sub = tone(e, { f: mtof(N.C2), type: 'sine', at: t, attack: 0.28, hold: 0.1, decay: 0.7, gain: 0.08 * k })
      // "うねる": a slow wobble on the sub's pitch (a modulator, not a heard pitch)
      const lfo = e.ac.createOscillator()
      lfo.frequency.setValueAtTime(5, t)
      const d = e.ac.createGain()
      d.gain.value = 1.2
      lfo.connect(d)
      d.connect(sub.frequency)
      lfo.start(t)
      lfo.stop(t + 1.12)
      record('modulator', [5], t, t + 1.1, 0)
      break
    }
    case 'faceChime': {
      const note = o.note ?? N.C5
      bell(e, { f: mtof(note), at: t, gain: 0.09 * k, decay: 0.6, send: 0.3 })
      tone(e, { f: mtof(note + 12), at: t, attack: 0.003, decay: 0.3, gain: 0.018 * k })
      break
    }
    case 'throw':
      noise(e, { at: t, dur: 0.2, gain: 0.08 * k, from: 300, to: 4000, q: 1.2, attack: 0.02, send: 0.15 })
      break
    case 'land':
      tone(e, { f: mtof(N.G5), type: 'triangle', at: t, attack: 0.002, decay: 0.08, gain: 0.1 * k })
      tone(e, { f: mtof(N.G6), type: 'sine', at: t, attack: 0.002, decay: 0.05, gain: 0.025 * k })
      break
    case 'keepFold':
      tone(e, { f: mtof(N.E6), at: t, attack: 0.003, decay: 0.16, gain: 0.04 * k, send: 0.4 })
      tone(e, { f: mtof(N.A6), at: t + 0.045, attack: 0.003, decay: 0.22, gain: 0.035 * k, send: 0.4 })
      noise(e, { at: t, dur: 0.12, gain: 0.03 * k, from: 6000, to: 9000, type: 'highpass', q: 0.7, attack: 0.01 })
      break
    case 'pass':
      // a soft "fff" – half the level of everything else, never a penalty sound
      noise(e, { at: t, dur: 0.12, gain: 0.04 * k, from: 600, to: 600, type: 'lowpass', q: 0.5, attack: 0.02 })
      break
    case 'knowTick': {
      const i = Math.max(0, Math.min(3, o.index ?? 0))
      const f = mtof(KNOW_NOTES[i])
      const half = !!o.half
      const dest = half ? filterTo(e, 'lowpass', 1200, t) : e.bus
      const g = (half ? 0.5 : 1) * 0.08 * k
      tone(e, { f, at: t, attack: 0.002, decay: 0.25, gain: g, dest, send: half ? 0 : 0.2 })
      tone(e, { f: f * 4, at: t, attack: 0.002, decay: 0.12, gain: g * 0.2, dest })
      break
    }
    case 'knowChord': {
      // C5 E5 G5 C6 pad: 40 ms attack, swells for 400 ms, fades out over 900 ms
      ;[N.C5, N.E5, N.G5, N.C6].forEach(m => {
        const osc = e.ac.createOscillator()
        osc.type = 'sine'
        osc.frequency.setValueAtTime(mtof(m), t)
        const g = e.ac.createGain()
        const peak = 0.035 * k
        g.gain.setValueAtTime(0.0001, t)
        g.gain.linearRampToValueAtTime(peak * 0.55, t + 0.04)
        g.gain.linearRampToValueAtTime(peak, t + 0.44)
        g.gain.exponentialRampToValueAtTime(0.0001, t + 1.34)
        osc.connect(g)
        g.connect(e.bus)
        const s = e.ac.createGain()
        s.gain.value = 0.35
        g.connect(s)
        s.connect(e.send)
        osc.start(t)
        osc.stop(t + 1.4)
        record('pitched', [mtof(m)], t, t + 1.34, peak)
      })
      ;[N.C7, N.E7, N.G7].forEach((m, i) => tone(e, { f: mtof(m), type: 'triangle', at: t + 0.05 + i * 0.03, attack: 0.004, decay: 0.4, gain: 0.02 * k, send: 0.5 }))
      break
    }
    case 'redeal':
      ;[N.C5, N.D5, N.E5, N.G5, N.A5].forEach((m, i) => tone(e, { f: mtof(m), type: 'triangle', at: t + i * 0.12, attack: 0.004, decay: 0.06, gain: 0.05 * k, send: 0.25 }))
      break
    case 'twin':
      // C5 + D5 (a major second) — the upper voice slides into G5 (a fifth), holds, fades
      tone(e, { f: mtof(N.C5), at: t, attack: 0.02, hold: 0.9, decay: 0.45, gain: 0.035 * k, send: 0.35 })
      tone(e, { f: mtof(N.D5), to: mtof(N.G5), glideAt: 0.14, glide: 0.3, at: t, attack: 0.02, hold: 0.9, decay: 0.45, gain: 0.035 * k, send: 0.35 })
      break
    case 'pillar': {
      const i = Math.max(0, Math.min(2, o.index ?? 0))
      tone(e, { f: mtof(PILLAR_NOTES[i]), type: 'triangle', at: t, attack: 0.01, decay: 0.2, gain: 0.06 * k, send: 0.3 })
      break
    }
    case 'orbPop':
      tone(e, { f: mtof(N.A5), to: mtof(N.E6), glide: 0.08, at: t, attack: 0.004, decay: 0.16, gain: 0.07 * k, send: 0.25 })
      break
    case 'clink':
      // two glass taps (inharmonic 2800 / 4100 Hz partials), then an E6 → A6 "ding-dong"
      for (const d of [0, 0.06]) {
        tone(e, { f: 2800, at: t + d, attack: 0.003, decay: 0.18, gain: 0.03 * k, role: 'inharmonic' })
        tone(e, { f: 4100, at: t + d, attack: 0.003, decay: 0.14, gain: 0.022 * k, role: 'inharmonic' })
      }
      tone(e, { f: mtof(N.E6), at: t + 0.17, attack: 0.003, decay: 0.18, gain: 0.06 * k, send: 0.3 })
      tone(e, { f: mtof(N.A6), at: t + 0.27, attack: 0.003, decay: 0.3, gain: 0.06 * k, send: 0.3 })
      break
    case 'softTock':
      tone(e, { f: mtof(N.A4), to: mtof(N.E4), glide: 0.09, at: t, attack: 0.004, decay: 0.09, gain: 0.05 * k })
      break
    case 'stamp':
      tone(e, { f: 80, to: 50, glide: 0.18, at: t, attack: 0.004, decay: 0.2, gain: 0.25 * k, role: 'percussive' })
      noise(e, { at: t, dur: 0.08, gain: 0.08 * k, from: 3000, to: 1000, q: 1.1, attack: 0.004 })
      break
    case 'fanfare': {
      // sawtooth pad G4-C5-E5-G5 (150 ms apart) through a low-pass opening 400 → 3000 Hz
      const lp = filterTo(e, 'lowpass', 400, t, 3000, 0.8)
      const s = e.ac.createGain()
      s.gain.value = 0.4
      lp.connect(s)
      s.connect(e.send)
      ;[N.G4, N.C5, N.E5, N.G5].forEach((m, i) => {
        tone(e, { f: mtof(m), type: 'sawtooth', at: t + i * 0.15, attack: 0.03, hold: 0.28 - i * 0.05, decay: 0.42, gain: 0.035 * k, dest: lp })
      })
      tone(e, { f: mtof(N.C6), type: 'triangle', at: t + 0.6, attack: 0.01, decay: 0.45, gain: 0.03 * k, send: 0.4 })
      break
    }
    case 'penlight': {
      const m = o.note != null && isPentatonicFreq(mtof(o.note)) ? o.note : pentaStep(N.C5, o.index ?? 0)
      tone(e, { f: mtof(m), type: 'triangle', at: t, attack: 0.005, decay: 0.15, gain: 0.05 * k, send: 0.3 })
      break
    }
    case 'standbyChime':
      tone(e, { f: mtof(N.E5), at: t, attack: 0.004, decay: 0.6, gain: 0.05 * k, send: 0.35 })
      tone(e, { f: mtof(N.A5), at: t + 0.2, attack: 0.004, decay: 0.7, gain: 0.05 * k, send: 0.35 })
      break
    case 'tap':
      tone(e, { f: mtof(N.E6), to: mtof(N.A5), glide: 0.06, type: 'triangle', at: t, attack: 0.002, decay: 0.07, gain: 0.06 * k })
      break
    case 'flip':
      tone(e, { f: mtof(N.G5), to: mtof(N.C6), glide: 0.06, type: 'sine', at: t, attack: 0.003, decay: 0.08, gain: 0.045 * k })
      noise(e, { at: t, dur: 0.07, gain: 0.02 * k, from: 2500, to: 5000, q: 0.8, attack: 0.005 })
      break
    case 'open':
      tone(e, { f: mtof(N.C5), to: mtof(N.G5), glide: 0.12, at: t, attack: 0.006, decay: 0.14, gain: 0.06 * k, send: 0.2 })
      break
    case 'close':
      tone(e, { f: mtof(N.G5), to: mtof(N.C5), glide: 0.1, at: t, attack: 0.006, decay: 0.12, gain: 0.05 * k })
      break
  }
}

/** Play one named effect now. Silent until unlocked, and while muted. */
export function play(name: SfxName, o: SfxOpts = {}): void {
  const e = ready()
  if (!e) return
  traceName = name
  synth(e, name, o, e.ac.currentTime + 0.005)
}

/**
 * Tonight's melody (SPEC D-8): face chimes as 8th notes at `bpm` (112) over a soft C pad.
 * Returns a stop function that fades everything out.
 */
export function playMelody(notes: number[], bpm = 112): () => void {
  const e = ready()
  if (!e || !notes.length) return () => {}
  traceName = 'melody'
  const { ac } = e
  const t0 = ac.currentTime + 0.08
  const step = 60 / bpm / 2
  const total = notes.length * step + 0.8
  const out = ac.createGain()
  out.gain.value = 1
  out.connect(e.bus)
  const oscs: OscillatorNode[] = []
  notes.forEach((m, i) => {
    const note = isPentatonicFreq(mtof(m)) ? m : pentaStep(N.C5, i)
    bell(e, { f: mtof(note), at: t0 + i * step, gain: 0.075, decay: 0.55, send: 0.3, dest: out })
  })
  // the pad: C3 G3 C4 E4 triangles, 0.025, fading in and out around the tune
  ;[N.C3, N.G3, N.C4, N.E4].forEach(m => {
    const osc = ac.createOscillator()
    osc.type = 'triangle'
    osc.frequency.setValueAtTime(mtof(m), t0)
    const g = ac.createGain()
    g.gain.setValueAtTime(0.0001, t0)
    g.gain.linearRampToValueAtTime(0.025 / 2, t0 + 0.35)
    g.gain.setValueAtTime(0.025 / 2, t0 + total - 0.6)
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + total)
    osc.connect(g)
    g.connect(out)
    osc.start(t0)
    osc.stop(t0 + total + 0.05)
    oscs.push(osc)
    record('pitched', [mtof(m)], t0, t0 + total, 0.0125)
  })
  let stopped = false
  return () => {
    if (stopped) return
    stopped = true
    try {
      out.gain.cancelScheduledValues(ac.currentTime)
      out.gain.setTargetAtTime(0.0001, ac.currentTime, 0.06)
      for (const o of oscs) o.stop(ac.currentTime + 0.3)
    } catch {
      /* context closed or already stopped */
    }
  }
}
