// Penlight (SPEC E-10): every tap sends a light rising from the finger and plays one note of the
// C-major pentatonic stair, so mashing it always sounds in tune. No counters anywhere.
// Lights are plain DOM nodes with a CSS animation (transform/opacity only): tapping never
// re-renders React. At the end of the song the lights are drawn into the singer's orb.
import { sound } from '../../core/sound'
import { penlightNote } from './model'

const HUES = ['#FF3DA8', '#FFB547', '#C6FF3D', '#2EF2FF', '#8A6BFF']
let step = 0
type Tap = { x: number; y: number; at: number }
let taps: Tap[] = []
let tapsFor: string | null = null

function local(host: HTMLElement, clientX: number, clientY: number) {
  const r = host.getBoundingClientRect()
  const s = r.width > 0 ? host.offsetWidth / r.width : 1 // undo the dual frame scale
  return { x: (clientX - r.left) * s, y: (clientY - r.top) * s }
}

/** Wave the penlight once at a viewport point inside `host` (host must be position: relative). */
export function wavePenlight(host: HTMLElement, clientX: number, clientY: number, songItemId: string | null): void {
  const { x, y } = local(host, clientX, clientY)
  const n = step++
  const color = HUES[n % HUES.length]
  const el = document.createElement('span')
  el.className = 'sg-pen'
  el.style.left = `${x.toFixed(1)}px`
  el.style.top = `${y.toFixed(1)}px`
  el.style.setProperty('--pc', color)
  el.style.setProperty('--dx', `${(Math.random() * 44 - 22).toFixed(1)}px`)
  el.style.setProperty('--rot', `${(Math.random() * 36 - 18).toFixed(1)}deg`)
  host.appendChild(el)
  const kill = () => el.remove()
  el.addEventListener('animationend', e => {
    if (e.animationName === 'sg-pen') kill()
  })
  setTimeout(kill, 2200)
  const all = host.querySelectorAll('.sg-pen')
  for (let i = 0; i < all.length - 26; i++) all[i].remove()
  sound.play('penlight', { index: n % 10, note: penlightNote(n) })
  if (songItemId !== tapsFor) {
    tapsFor = songItemId
    taps = []
  }
  taps.push({ x: clientX, y: clientY, at: performance.now() })
  if (taps.length > 40) taps = taps.slice(-40)
}

/**
 * When a song ends, the lights sent to it fly into the singer's orb and it flashes like a
 * crystal. Returns how many lights flew (0 when nobody waved for that song).
 */
export function absorbPenlights(host: HTMLElement, target: HTMLElement | null, endedItemId: string): number {
  if (tapsFor !== endedItemId || !taps.length || !target) {
    if (tapsFor === endedItemId) taps = []
    return 0
  }
  const list = taps.slice(-12)
  taps = []
  tapsFor = null
  const tr = target.getBoundingClientRect()
  const to = local(host, tr.left + tr.width / 2, tr.top + tr.height / 2)
  list.forEach((t, i) => {
    const from = local(host, t.x, t.y)
    const el = document.createElement('span')
    el.className = 'sg-pen-fly'
    el.style.left = `${from.x.toFixed(1)}px`
    el.style.top = `${from.y.toFixed(1)}px`
    el.style.setProperty('--tx', `${(to.x - from.x).toFixed(1)}px`)
    el.style.setProperty('--ty', `${(to.y - from.y).toFixed(1)}px`)
    el.style.setProperty('--pc', HUES[i % HUES.length])
    el.style.animationDelay = `${i * 45}ms`
    host.appendChild(el)
    el.addEventListener('animationend', () => el.remove())
    setTimeout(() => el.remove(), 2000)
  })
  setTimeout(() => {
    target.classList.remove('is-crystal')
    void target.offsetWidth
    target.classList.add('is-crystal')
    setTimeout(() => target.classList.remove('is-crystal'), 1200)
  }, 520 + list.length * 45)
  return list.length
}
