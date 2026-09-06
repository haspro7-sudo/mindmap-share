/** 配色・フォント（ミニマル × ネオンアクセント） */
export const THEME = {
  bgTop: '#0a0e1a',
  bgBottom: '#161b2c',
  floor: '#2a3148',
  floorLine: '#3d4664',
  fg: '#f5f7fa',
  dim: '#8b93a7',
  p0: '#00d9ff',
  p1: '#ff3d8a',
  strike: '#ff5252',
  throw: '#3ef06b',
  guard: '#5b7bff',
  forward: '#ffb84d',
  back: '#b48cff',
  super: '#ffd60a',
  danger: '#ff3e3e',
  fontDisplay: '"Hiragino Kaku Gothic ProN", "Noto Sans JP", "Yu Gothic", "Meiryo", system-ui, sans-serif',
  fontMono: '"SF Mono", "Consolas", "Menlo", monospace',
} as const;

export const MOVE_COLOR = {
  strike: THEME.strike,
  throw: THEME.throw,
  guard: THEME.guard,
  forward: THEME.forward,
  back: THEME.back,
  super: THEME.super,
} as const;

export const W = 960;
export const H = 540;
export const FLOOR_Y = 430;
export const ARENA_X0 = 120;
export const HALF_CELL_PX = 40;

export function posToX(pos: number): number {
  return ARENA_X0 + pos * HALF_CELL_PX;
}

export function playerColor(side: 0 | 1): string {
  return side === 0 ? THEME.p0 : THEME.p1;
}
