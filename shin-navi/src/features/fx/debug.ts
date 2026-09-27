// Counters the fx canvases update for tests (?test=1 exposes them as window.__fx).
// Plain mutable numbers: writing them never renders React.
export const fxDebug = {
  /** React renders of the fx components (must stay flat while the home screen idles) */
  renders: { bg: 0, specks: 0, burst: 0 },
  /** frames actually painted */
  frames: { bg: 0, specks: 0, burst: 0 },
  /** living specks / streaks / burst particles right now (last painted canvas) */
  specks: 0,
  streaks: 0,
  particles: 0,
  bursts: 0,
  lightsOn: 0,
  /** palette the background painted last, and the gold weight */
  palette: '',
  bgMode: '' as '' | 'canvas' | 'static',
}
