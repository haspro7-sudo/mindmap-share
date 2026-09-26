// Synthesized sound: UI effects plus a short original motif per song.
// Nothing is sampled; every sound is built from oscillators and noise.
import { mulberry32, hashString } from './rng'

type Ctx = {
  ac: AudioContext
  master: GainNode
  fx: GainNode // send into the delay line
  noise: AudioBuffer
}

let ctx: Ctx | null = null
let muted = false
const listeners = new Set<(m: boolean) => void>()

function build(): Ctx | null {
  const AC: typeof AudioContext | undefined =
    typeof window !== 'undefined' ? window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext : undefined
  if (!AC) return null
  const ac = new AC()
  const comp = ac.createDynamicsCompressor()
  comp.threshold.value = -18
  comp.ratio.value = 4
  const master = ac.createGain()
  master.gain.value = muted ? 0 : 0.55
  master.connect(comp).connect(ac.destination)

  // Ping-pong-ish feedback delay for space.
  const fx = ac.createGain()
  fx.gain.value = 0.28
  const delay = ac.createDelay(1)
  delay.delayTime.value = 0.23
  const fb = ac.createGain()
  fb.gain.value = 0.32
  const tone = ac.createBiquadFilter()
  tone.type = 'lowpass'
  tone.frequency.value = 3200
  fx.connect(delay)
  delay.connect(tone).connect(fb).connect(delay)
  tone.connect(master)

  const len = ac.sampleRate
  const noise = ac.createBuffer(1, len, ac.sampleRate)
  const data = noise.getChannelData(0)
  const r = mulberry32(7)
  for (let i = 0; i < len; i++) data[i] = r() * 2 - 1
  return { ac, master, fx, noise }
}

/** Call from a user gesture. Safe to call repeatedly. */
export function unlockAudio(): void {
  if (!ctx) ctx = build()
  if (ctx && ctx.ac.state === 'suspended') void ctx.ac.resume()
}

export function isMuted(): boolean {
  return muted
}

export function setMuted(m: boolean): void {
  muted = m
  if (ctx) ctx.master.gain.setTargetAtTime(m ? 0 : 0.55, ctx.ac.currentTime, 0.03)
  listeners.forEach(fn => fn(m))
}

export function onMuteChange(fn: (m: boolean) => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

function ready(): Ctx | null {
  if (!ctx || muted) return null
  if (ctx.ac.state !== 'running') return null
  return ctx
}

const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12)

function voice(
  c: Ctx,
  opts: { freq: number; type?: OscillatorType; at?: number; dur?: number; gain?: number; attack?: number; send?: number; glideTo?: number; detune?: number },
): void {
  const { ac } = c
  const t = opts.at ?? ac.currentTime
  const dur = opts.dur ?? 0.25
  const osc = ac.createOscillator()
  osc.type = opts.type ?? 'sine'
  osc.frequency.setValueAtTime(opts.freq, t)
  if (opts.glideTo) osc.frequency.exponentialRampToValueAtTime(opts.glideTo, t + dur)
  if (opts.detune) osc.detune.value = opts.detune
  const g = ac.createGain()
  const peak = opts.gain ?? 0.2
  const atk = opts.attack ?? 0.005
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(peak, t + atk)
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
  osc.connect(g)
  g.connect(c.master)
  if (opts.send) {
    const s = ac.createGain()
    s.gain.value = opts.send
    g.connect(s).connect(c.fx)
  }
  osc.start(t)
  osc.stop(t + dur + 0.05)
}

function noiseBurst(c: Ctx, opts: { at?: number; dur?: number; gain?: number; from?: number; to?: number; q?: number; type?: BiquadFilterType }): void {
  const { ac } = c
  const t = opts.at ?? ac.currentTime
  const dur = opts.dur ?? 0.2
  const src = ac.createBufferSource()
  src.buffer = c.noise
  const f = ac.createBiquadFilter()
  f.type = opts.type ?? 'bandpass'
  f.Q.value = opts.q ?? 1.2
  f.frequency.setValueAtTime(opts.from ?? 2000, t)
  f.frequency.exponentialRampToValueAtTime(opts.to ?? 400, t + dur)
  const g = ac.createGain()
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(opts.gain ?? 0.2, t + 0.02)
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
  src.connect(f).connect(g).connect(c.master)
  src.start(t, Math.random() * 0.5)
  src.stop(t + dur + 0.05)
}

// Major pentatonic ladder used for combos and sparkles.
const PENTA = [0, 2, 4, 7, 9]
const ladder = (base: number, step: number) => base + PENTA[step % 5] + 12 * Math.floor(step / 5)

export type Sfx =
  | 'tap'
  | 'swipeKeep'
  | 'swipePass'
  | 'reserve'
  | 'collect'
  | 'rare'
  | 'levelUp'
  | 'cheer'
  | 'stamp'
  | 'open'
  | 'close'
  | 'error'
  | 'order'

export function sfx(name: Sfx, intensity = 0): void {
  const c = ready()
  if (!c) return
  const t = c.ac.currentTime + 0.005
  switch (name) {
    case 'tap':
      voice(c, { freq: 1320, glideTo: 880, dur: 0.07, gain: 0.08, type: 'triangle', at: t })
      break
    case 'open':
      voice(c, { freq: 520, glideTo: 780, dur: 0.14, gain: 0.07, type: 'sine', at: t, send: 0.2 })
      break
    case 'close':
      voice(c, { freq: 780, glideTo: 460, dur: 0.12, gain: 0.06, type: 'sine', at: t })
      break
    case 'swipeKeep': {
      // Rising pentatonic triad; climbs with the combo count.
      const base = 72 + Math.min(intensity, 10)
      ;[0, 1, 2].forEach((k, i) => voice(c, { freq: mtof(ladder(base, k + Math.min(intensity, 6))), dur: 0.22, gain: 0.12, type: 'triangle', at: t + i * 0.045, send: 0.35 }))
      noiseBurst(c, { at: t, dur: 0.12, gain: 0.05, from: 6000, to: 9000, type: 'highpass' })
      break
    }
    case 'swipePass':
      noiseBurst(c, { at: t, dur: 0.18, gain: 0.09, from: 1800, to: 300, q: 0.8 })
      voice(c, { freq: 330, glideTo: 220, dur: 0.12, gain: 0.04, type: 'sine', at: t })
      break
    case 'reserve': {
      // Bright maj9 bell.
      ;[60, 64, 67, 71, 74].forEach((m, i) => {
        voice(c, { freq: mtof(m + 12), dur: 1.1, gain: 0.07, type: 'sine', at: t + i * 0.025, send: 0.5 })
        voice(c, { freq: mtof(m + 24), dur: 0.5, gain: 0.025, type: 'triangle', at: t + i * 0.025 })
      })
      break
    }
    case 'collect':
      ;[88, 91, 95].forEach((m, i) => voice(c, { freq: mtof(m), dur: 0.18, gain: 0.06, type: 'sine', at: t + i * 0.05, send: 0.4 }))
      break
    case 'rare': {
      noiseBurst(c, { at: t, dur: 0.6, gain: 0.08, from: 400, to: 6000, q: 2 })
      ;[64, 68, 71, 76, 80].forEach((m, i) => voice(c, { freq: mtof(m + 12), dur: 0.9, gain: 0.07, type: 'triangle', at: t + 0.45 + i * 0.06, send: 0.5 }))
      break
    }
    case 'levelUp': {
      const seq = [67, 72, 76, 79, 84]
      seq.forEach((m, i) => voice(c, { freq: mtof(m), dur: 0.25, gain: 0.1, type: 'square', at: t + i * 0.08, send: 0.3 }))
      ;[72, 76, 79, 84].forEach(m => voice(c, { freq: mtof(m), dur: 1.2, gain: 0.05, type: 'triangle', at: t + 0.42, send: 0.5 }))
      break
    }
    case 'cheer':
      for (let i = 0; i < 7; i++) noiseBurst(c, { at: t + i * 0.07 + Math.random() * 0.05, dur: 0.35, gain: 0.05, from: 900 + Math.random() * 800, to: 1400, q: 0.7 })
      break
    case 'stamp':
      voice(c, { freq: 140, glideTo: 60, dur: 0.18, gain: 0.25, type: 'sine', at: t })
      noiseBurst(c, { at: t, dur: 0.08, gain: 0.08, from: 3000, to: 1000 })
      break
    case 'order':
      ;[76, 83].forEach((m, i) => voice(c, { freq: mtof(m), dur: 0.35, gain: 0.08, type: 'sine', at: t + i * 0.12, send: 0.3 }))
      break
    case 'error':
      voice(c, { freq: 220, dur: 0.12, gain: 0.07, type: 'square', at: t })
      voice(c, { freq: 196, dur: 0.16, gain: 0.07, type: 'square', at: t + 0.12 })
      break
  }
}

export type MotifOptions = { bpm?: number; minor?: boolean; energy?: number; bars?: number }

/**
 * A short original loop that gives each song card its own sonic identity.
 * Returns a stop function. Only one motif plays at a time.
 */
let stopCurrent: (() => void) | null = null
export function playMotif(seedKey: string, opts: MotifOptions = {}): () => void {
  stopCurrent?.()
  const c = ready()
  if (!c) return () => {}
  const { ac } = c
  const rand = mulberry32(hashString(seedKey))
  const bpm = Math.min(170, Math.max(70, opts.bpm ?? 110))
  const beat = 60 / bpm
  const step = beat / 2
  const energy = opts.energy ?? 0.5
  const scale = opts.minor ? [0, 3, 5, 7, 10] : [0, 2, 4, 7, 9]
  const root = 57 + Math.floor(rand() * 7)
  const bus = ac.createGain()
  bus.gain.value = 0.9
  bus.connect(c.master)
  const send = ac.createGain()
  send.gain.value = 0.35
  bus.connect(send).connect(c.fx)

  // Melody: 16 steps, stepwise walk with occasional leaps.
  const melody: (number | null)[] = []
  let deg = Math.floor(rand() * 5)
  for (let i = 0; i < 16; i++) {
    if (rand() < 0.22 && i % 4 !== 0) {
      melody.push(null)
      continue
    }
    deg += rand() < 0.7 ? (rand() < 0.5 ? 1 : -1) : rand() < 0.5 ? 2 : -2
    deg = Math.max(0, Math.min(9, deg))
    melody.push(root + 12 + scale[deg % 5] + 12 * Math.floor(deg / 5))
  }
  const chords = [0, opts.minor ? 8 : 9, opts.minor ? 3 : 5, 7].map(o => root - 12 + o)
  const bars = opts.bars ?? 2
  const start = ac.currentTime + 0.06
  const nodes: AudioScheduledSourceNode[] = []
  const fire = (freq: number, at: number, dur: number, type: OscillatorType, gain: number) => {
    const o = ac.createOscillator()
    o.type = type
    o.frequency.value = freq
    const g = ac.createGain()
    g.gain.setValueAtTime(0.0001, at)
    g.gain.exponentialRampToValueAtTime(gain, at + 0.01)
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur)
    o.connect(g).connect(bus)
    o.start(at)
    o.stop(at + dur + 0.02)
    nodes.push(o)
  }
  for (let bar = 0; bar < bars * 2; bar++) {
    const barT = start + bar * beat * 4
    const chordRoot = chords[bar % 4]
    // Pad
    ;[0, opts.minor ? 3 : 4, 7].forEach(o => fire(mtof(chordRoot + 12 + o), barT, beat * 4, 'triangle', 0.025))
    // Bass pulse
    for (let b = 0; b < 4; b++) fire(mtof(chordRoot), barT + b * beat, beat * 0.8, 'sine', 0.09)
    // Kick & hat scaled by energy
    if (energy > 0.35) {
      for (let b = 0; b < 4; b++) {
        const kt = barT + b * beat
        const o = ac.createOscillator()
        o.frequency.setValueAtTime(130, kt)
        o.frequency.exponentialRampToValueAtTime(45, kt + 0.12)
        const g = ac.createGain()
        g.gain.setValueAtTime(0.18 * energy, kt)
        g.gain.exponentialRampToValueAtTime(0.0001, kt + 0.16)
        o.connect(g).connect(bus)
        o.start(kt)
        o.stop(kt + 0.2)
        nodes.push(o)
      }
    }
    // Melody on the second half of the loop so it breathes in.
    if (bar >= 1) {
      for (let s = 0; s < 8; s++) {
        const m = melody[(bar * 8 + s) % 16]
        if (m == null) continue
        fire(mtof(m), barT + s * step, step * 0.9, 'square', 0.03)
        fire(mtof(m), barT + s * step, step * 1.6, 'sine', 0.04)
      }
    }
  }
  const total = bars * 2 * beat * 4
  bus.gain.setValueAtTime(0.9, start + total - 0.4)
  bus.gain.linearRampToValueAtTime(0.0001, start + total)
  let stopped = false
  const stop = () => {
    if (stopped) return
    stopped = true
    try {
      bus.gain.cancelScheduledValues(ac.currentTime)
      bus.gain.setTargetAtTime(0.0001, ac.currentTime, 0.05)
      nodes.forEach(n => {
        try {
          n.stop(ac.currentTime + 0.2)
        } catch {
          /* already stopped */
        }
      })
    } catch {
      /* context closed */
    }
    if (stopCurrent === stop) stopCurrent = null
  }
  stopCurrent = stop
  setTimeout(stop, total * 1000 + 200)
  return stop
}

export function stopMotif(): void {
  stopCurrent?.()
}

/** Vibration where supported (Android). */
export function haptic(pattern: number | number[] = 12): void {
  if (muted) return
  try {
    navigator.vibrate?.(pattern)
  } catch {
    /* unsupported */
  }
}
