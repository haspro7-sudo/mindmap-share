// Sound wiring (SPEC I-5, L/M1): installs the WebAudio synth behind core `sound`, keeps mute and
// ducking in step with the store, and turns bus events into sounds. Other modules may also call
// sound.play directly (KnowDots plays its own ticks, Standby its chime…): every call passes
// through `impl.play`, which remembers what just sounded, so an event that is voiced both by a
// component and by the fallback here is heard once.
import type { NaviApi, NaviState } from '../../core/store/types'
import { bus } from '../../core/events'
import { installSoundImpl, sound, type SfxName, type SfxOpts, type SoundImpl } from '../../core/sound'
import { faceNote } from '../../core/rules'
import { selTonight } from '../../core/selectors'
import { SONG_BY_ID } from '../../data/songs'
import * as audio from '../../lib/audio'

/** How long a sound blocks an identical one (ms). Keys include index/note/half. */
const DEDUP_MS: Partial<Record<SfxName, number>> = {
  lightOn: 1500,
  knowTick: 220,
  knowChord: 1200,
  orbPop: 160,
  land: 90,
  faceChime: 70,
  stamp: 450,
  clink: 300,
  softTock: 200,
  fanfare: 1500,
  redeal: 800,
  twin: 1200,
  standbyChime: 800,
  throw: 60,
  keepFold: 90,
  pass: 90,
}

const keyOf = (n: SfxName, o?: SfxOpts) => `${n}|${o?.index ?? ''}|${o?.note ?? ''}|${o?.half ? 1 : 0}`

/** Whether a roommate (not me) is singing and ducking is allowed. */
export function shouldDuck(s: Pick<NaviState, 'room' | 'session'>): boolean {
  const now = s.room.now
  return !!now && now.item.by !== 'me' && !s.session.noDuck
}

export function installSound(api: NaviApi): () => void {
  const recent = new Map<string, number>()
  const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())
  const playedWithin = (k: string, ms: number) => {
    const t = recent.get(k)
    return t != null && nowMs() - t < ms
  }
  const audioOn = () => api.getState().session.audioOn

  const impl: SoundImpl = {
    play(n, o) {
      if (!audioOn()) return
      const k = keyOf(n, o)
      const win = DEDUP_MS[n] ?? 35
      if (playedWithin(k, win)) return
      recent.set(k, nowMs())
      if (recent.size > 64) for (const [kk, t] of recent) if (nowMs() - t > 3000) recent.delete(kk)
      audio.play(n, o)
    },
    playMelody(notes, o) {
      if (!audioOn()) return () => {}
      return audio.playMelody(notes, o?.bpm ?? 112)
    },
    unlock() {
      audio.unlock()
    },
    setMuted(m) {
      audio.setMuted(m)
    },
    setDuck(on) {
      audio.setDuck(on)
    },
    haptic(p) {
      audio.haptic(p)
    },
  }
  installSoundImpl(impl)

  const offs: (() => void)[] = []
  // On touch screens the first pointerdown (where the App unlocks) is not a user activation;
  // pointerup / touchend / click are. Resume there, and the waiting lights-on chord plays.
  if (typeof window !== 'undefined') {
    const resume = () => {
      if (api.getState().session.audioOn && audio.awaitingResume()) audio.unlock()
    }
    const evs = ['pointerup', 'touchend', 'click', 'keydown'] as const
    for (const ev of evs) window.addEventListener(ev, resume, { capture: true, passive: true })
    offs.push(() => {
      for (const ev of evs) window.removeEventListener(ev, resume, { capture: true })
    })
  }
  const timers = new Set<ReturnType<typeof setTimeout>>()
  const later = (ms: number, fn: () => void) => {
    const id = setTimeout(() => {
      timers.delete(id)
      fn()
    }, ms)
    timers.add(id)
    return id
  }
  /** Play only when audio is on. */
  const say = (n: SfxName, o?: SfxOpts) => {
    if (audioOn()) sound.play(n, o)
  }
  /** Fallback voice: wait, then play unless a component already voiced the same sound. */
  const fallback = (n: SfxName, o: SfxOpts | undefined, delay: number, window = 700) => {
    later(delay, () => {
      if (!playedWithin(keyOf(n, o), window + delay)) say(n, o)
    })
  }

  // ---- store → mute / duck
  const apply = (s: NaviState) => {
    if (audio.isMuted() !== s.session.muted) sound.setMuted(s.session.muted)
    const d = shouldDuck(s)
    if (audio.isDucked() !== d) sound.setDuck(d)
  }
  apply(api.getState())
  offs.push(
    api.subscribe((s, p) => {
      apply(s)
      // duplicate order tap (SPEC C-8 ⑨): a soft tock, never an error sound
      if (s.metrics.mo.dupBlocked > p.metrics.mo.dupBlocked) say('softTock')
      // the wrap-up opens with a fanfare
      if (s.ui.overlay === 'wrap' && p.ui.overlay !== 'wrap') fallback('fanfare', undefined, 120, 1500)
      // tonight's stamp: a low "don" and a 30 ms buzz
      const st = selTonight(s).stamped
      if (st && !selTonight(p).stamped) {
        fallback('stamp', undefined, 0, 600)
        sound.haptic(30)
      }
    }),
  )

  // ---- faces: chime the face's note when it lands (or now, when nothing is flying there)
  const pendingChime = new Map<string, { run: () => void; id: ReturnType<typeof setTimeout> }>()
  const flying = new Map<string, number>()
  const chimeNow = (songId: string) => {
    const p = pendingChime.get(songId)
    if (!p) return
    clearTimeout(p.id)
    timers.delete(p.id)
    pendingChime.delete(songId)
    p.run()
  }
  offs.push(
    bus.on('fx/flight', e => {
      if (e.songId) flying.set(e.songId, nowMs())
    }),
    bus.on('face/changed', e => {
      if (e.from === e.to) return
      const run = () => {
        say('faceChime', { note: e.note })
        if (e.to === 'prism') sound.haptic([10, 40, 10])
      }
      const prev = pendingChime.get(e.songId)
      if (prev) {
        clearTimeout(prev.id)
        timers.delete(prev.id)
      }
      // cap: never wait longer than a flight could take
      const id = later(750, () => chimeNow(e.songId))
      pendingChime.set(e.songId, { run, id })
      // performCardAction emits fx/flight right after face/changed; M3 may have launched it earlier
      later(0, () => {
        const f = flying.get(e.songId)
        if (f == null || nowMs() - f > 1500) chimeNow(e.songId)
      })
    }),
    bus.on('fx/landed', e => {
      const onBallOrLane = e.to.startsWith('lane:') || e.to.startsWith('face:') || e.to === 'dock:record' || e.to === 'hero:ball' || e.to === 'calendar:today'
      if (onBallOrLane) say('land')
      if (e.songId) {
        flying.delete(e.songId)
        if (pendingChime.has(e.songId)) later(40, () => chimeNow(e.songId!))
      }
    }),
  )

  // ---- card actions
  offs.push(
    bus.on('card/acted', e => {
      switch (e.action) {
        case 'reserve':
        case 'accept':
        case 'insert':
          if (e.card.songId || e.arg?.songId || e.card.options?.length) {
            say('throw')
            sound.haptic(12)
          }
          break
        case 'keep':
        case 'save':
          say('keepFold')
          break
        case 'pass':
          say('pass')
          break
        case 'flip':
          say('flip')
          break
        case 'ask':
          say('throw', { gain: 0.55 })
          break
        case 'reveal':
          say('orbPop')
          break
        case 'select':
        case 'vote':
        case 'rest':
          say('tap')
          break
        case 'oneMore':
          say('redeal', { gain: 0.7 })
          break
        default:
          break
      }
    }),
    bus.on('queue/added', e => {
      // reserves made outside a card (search, room screen) are thrown too
      if (e.item.by === 'me' && (e.source === 'search' || e.source === 'room')) {
        say('throw')
        sound.haptic(12)
      }
    }),
  )

  // ---- the room answering, joining, redealing, ordering, pins
  const accepted = new Set<string>()
  offs.push(
    bus.on('know/answered', e => {
      if (e.a === 'none') return
      fallback('knowTick', { index: Math.min(3, Math.max(0, e.index)), half: e.a === 'chorus' }, 260, 400)
    }),
    bus.on('know/complete', e => {
      if (e.view.all) fallback('knowChord', undefined, 520, 1200)
    }),
    bus.on('deck/redeal', () => fallback('redeal', undefined, 60, 900)),
    bus.on('member/joined', () => say('orbPop')),
    bus.on('order/status', e => {
      if (e.order.status === 'accepted' && !accepted.has(e.order.id)) {
        accepted.add(e.order.id)
        say('clink')
      }
    }),
    bus.on('pin/earned', () => fallback('orbPop', undefined, 380, 300)),
    bus.on('link/added', e => {
      const a = SONG_BY_ID[e.a]
      const b = SONG_BY_ID[e.b]
      if (!a || !b) return
      later(180, () => say('faceChime', { note: faceNote(a), gain: 0.6 }))
      later(330, () => say('faceChime', { note: faceNote(b), gain: 0.6 }))
    }),
  )

  return () => {
    offs.forEach(f => f())
    timers.forEach(id => clearTimeout(id))
    timers.clear()
    installSoundImpl(null)
  }
}
