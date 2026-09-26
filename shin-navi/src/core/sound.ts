// The sound facade (SPEC K-7 / I-5). Modules call sound.play('name'); the real synth is
// installed by M1 (installSound → installSoundImpl). Until then every call is a silent no-op.
// In test mode (?test=1) every played name is appended to window.__navi.soundLog.
import { params } from './params'

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

export interface SoundImpl {
  play(n: SfxName, o?: SfxOpts): void
  playMelody(notes: number[], o?: { bpm?: number }): () => void
  unlock(): void
  setMuted(m: boolean): void
  setDuck(on: boolean): void
  haptic(p: number | number[]): void
}

let impl: SoundImpl | null = null

function log(name: string): void {
  if (!params.test || typeof window === 'undefined') return
  try {
    const w = window as unknown as { __navi?: { soundLog?: string[] } }
    const nav = w.__navi ?? (w.__navi = {})
    ;(nav.soundLog ??= []).push(name)
  } catch {
    /* never let logging break sound */
  }
}

const noop = () => {}

export const sound: SoundImpl = {
  play(n, o) {
    log(n)
    try {
      impl?.play(n, o)
    } catch (err) {
      console.warn('[sound]', n, err)
    }
  },
  playMelody(notes, o) {
    log('melody')
    try {
      return impl?.playMelody(notes, o) ?? noop
    } catch (err) {
      console.warn('[sound] melody', err)
      return noop
    }
  },
  unlock() {
    try {
      impl?.unlock()
    } catch (err) {
      console.warn('[sound] unlock', err)
    }
  },
  setMuted(m) {
    impl?.setMuted(m)
  },
  setDuck(on) {
    impl?.setDuck(on)
  },
  haptic(p) {
    try {
      impl?.haptic(p)
    } catch {
      /* vibration is best-effort */
    }
  },
}

/** M1 installs the WebAudio implementation here. Pass null to uninstall (tests). */
export function installSoundImpl(next: SoundImpl | null): void {
  impl = next
}

export function hasSoundImpl(): boolean {
  return impl !== null
}
