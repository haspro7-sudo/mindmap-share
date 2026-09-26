// Microphone voice check: pitch tracking (autocorrelation) and simple features.
// Audio never leaves the device and nothing is stored; only summary numbers are kept.

export type PitchFrame = { t: number; hz: number | null; rms: number; centroid: number }

export function detectPitch(buf: Float32Array, sampleRate: number): number | null {
  const n = buf.length
  let rms = 0
  for (let i = 0; i < n; i++) rms += buf[i] * buf[i]
  rms = Math.sqrt(rms / n)
  if (rms < 0.012) return null
  // Trim to the region above a small threshold to reduce edge effects.
  let r1 = 0
  let r2 = n - 1
  const thres = 0.2
  for (let i = 0; i < n / 2; i++) if (Math.abs(buf[i]) < thres) { r1 = i; break }
  for (let i = 1; i < n / 2; i++) if (Math.abs(buf[n - i]) < thres) { r2 = n - i; break }
  const b = buf.subarray(r1, r2)
  const m = b.length
  const c = new Float32Array(m)
  for (let lag = 0; lag < m; lag++) {
    let s = 0
    for (let i = 0; i < m - lag; i++) s += b[i] * b[i + lag]
    c[lag] = s
  }
  let d = 0
  while (d < m - 1 && c[d] > c[d + 1]) d++
  let maxv = -1
  let maxp = -1
  for (let i = d; i < m; i++) if (c[i] > maxv) { maxv = c[i]; maxp = i }
  if (maxp <= 0 || maxp >= m - 1) return null
  const x1 = c[maxp - 1]
  const x2 = c[maxp]
  const x3 = c[maxp + 1]
  const a = (x1 + x3 - 2 * x2) / 2
  const bb = (x3 - x1) / 2
  const T0 = a ? maxp - bb / (2 * a) : maxp
  const hz = sampleRate / T0
  if (hz < 70 || hz > 1100) return null
  return hz
}

export const hzToMidi = (hz: number) => 69 + 12 * Math.log2(hz / 440)

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
/** Japanese karaoke notation. Octaves switch at A: mid2A = A3 (MIDI 57), hiA = A4 (440Hz). */
export function karaokeNote(midi: number): string {
  const m = Math.round(midi)
  const name = NOTE_NAMES[((m % 12) + 12) % 12]
  const band = Math.floor((m - 57) / 12)
  const labels: Record<number, string> = { [-3]: 'lowlow', [-2]: 'low', [-1]: 'mid1', 0: 'mid2', 1: 'hi', 2: 'hihi' }
  return `${labels[band] ?? (band > 0 ? 'hihi' : 'lowlow')}${name}`
}

export type CaptureResult = {
  frames: PitchFrame[]
  range: [number, number] | null // comfortable range (10th-90th percentile of voiced MIDI)
  features: { power: number; care: number; brightness: number; groove: number }
  voicedRatio: number
}

export function summarize(frames: PitchFrame[]): CaptureResult {
  const voiced = frames.filter(f => f.hz != null)
  const voicedRatio = frames.length ? voiced.length / frames.length : 0
  if (voiced.length < 12) {
    return { frames, range: null, features: { power: 0.5, care: 0.5, brightness: 0.5, groove: 0.5 }, voicedRatio }
  }
  const midis = voiced.map(f => hzToMidi(f.hz!)).sort((a, b) => a - b)
  const q = (p: number) => midis[Math.min(midis.length - 1, Math.floor(p * midis.length))]
  const range: [number, number] = [Math.round(q(0.1)), Math.round(q(0.9))]
  // care: how steady the pitch is within held notes (low cents jitter = high care)
  let jitter = 0
  let cnt = 0
  for (let i = 1; i < voiced.length; i++) {
    const d = Math.abs(hzToMidi(voiced[i].hz!) - hzToMidi(voiced[i - 1].hz!))
    if (d < 1) { jitter += d; cnt++ }
  }
  const care = Math.max(0, Math.min(1, 1 - (cnt ? jitter / cnt : 0.5) / 0.5))
  const rmsVals = voiced.map(f => f.rms)
  const meanRms = rmsVals.reduce((a, b) => a + b, 0) / rmsVals.length
  const power = Math.max(0, Math.min(1, meanRms / 0.18))
  const centroid = voiced.reduce((a, f) => a + f.centroid, 0) / voiced.length
  const brightness = Math.max(0, Math.min(1, (centroid - 900) / 2200))
  // groove: regularity of loudness onsets
  const onsets: number[] = []
  for (let i = 1; i < frames.length; i++) if (frames[i].rms > frames[i - 1].rms * 1.6 && frames[i].rms > 0.03) onsets.push(frames[i].t)
  let groove = 0.4
  if (onsets.length >= 4) {
    const gaps = onsets.slice(1).map((t, i) => t - onsets[i])
    const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length
    const sd = Math.sqrt(gaps.reduce((a, g) => a + (g - mean) ** 2, 0) / gaps.length)
    groove = Math.max(0, Math.min(1, 1 - sd / Math.max(mean, 0.05)))
  }
  return { frames, range, features: { power, care, brightness, groove }, voicedRatio }
}

/**
 * Listen for `seconds` and return a summary. Resolves null if the mic is unavailable.
 * onFrame gets live pitch for visual feedback.
 */
export async function captureVoice(seconds: number, onFrame?: (f: PitchFrame) => void, signal?: AbortSignal): Promise<CaptureResult | null> {
  if (!navigator.mediaDevices?.getUserMedia) return null
  let stream: MediaStream
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } })
  } catch {
    return null
  }
  const AC: typeof AudioContext = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
  const ac = new AC()
  const src = ac.createMediaStreamSource(stream)
  const an = ac.createAnalyser()
  an.fftSize = 2048
  src.connect(an)
  const buf = new Float32Array(an.fftSize)
  const spec = new Float32Array(an.frequencyBinCount)
  const frames: PitchFrame[] = []
  const t0 = performance.now()
  await new Promise<void>(resolve => {
    const tick = () => {
      if (signal?.aborted) return resolve()
      const t = (performance.now() - t0) / 1000
      an.getFloatTimeDomainData(buf)
      an.getFloatFrequencyData(spec)
      let rms = 0
      for (let i = 0; i < buf.length; i++) rms += buf[i] * buf[i]
      rms = Math.sqrt(rms / buf.length)
      let num = 0
      let den = 0
      for (let i = 0; i < spec.length; i++) {
        const mag = Math.pow(10, spec[i] / 20)
        num += mag * (i * ac.sampleRate) / an.fftSize
        den += mag
      }
      const f: PitchFrame = { t, hz: detectPitch(buf, ac.sampleRate), rms, centroid: den ? num / den : 0 }
      frames.push(f)
      onFrame?.(f)
      if (t >= seconds) return resolve()
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
  stream.getTracks().forEach(tr => tr.stop())
  void ac.close()
  return summarize(frames)
}
