import { describe, expect, it } from 'vitest';
import { solveMatrixGame } from '../src/engine/lp';

const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps;

describe('solveMatrixGame', () => {
  it('じゃんけんは 1/3 ずつ、値 0', () => {
    const A = [
      [0, -1, 1],
      [1, 0, -1],
      [-1, 1, 0],
    ];
    const s = solveMatrixGame(A);
    expect(near(s.value, 0)).toBe(true);
    for (const p of s.row) expect(near(p, 1 / 3, 1e-6)).toBe(true);
    for (const p of s.col) expect(near(p, 1 / 3, 1e-6)).toBe(true);
  });

  it('2x2 混合均衡', () => {
    // 行: x*3 + (1-x)*0 = x*1 + (1-x)*2 → x = 0.5, value 1.5 ; 列 q = 0.25
    const s = solveMatrixGame([
      [3, 1],
      [0, 2],
    ]);
    expect(near(s.value, 1.5)).toBe(true);
    expect(near(s.row[0], 0.5)).toBe(true);
    expect(near(s.col[0], 0.25)).toBe(true);
  });

  it('支配戦略がある場合は純戦略', () => {
    const s = solveMatrixGame([
      [5, 4],
      [1, 2],
    ]);
    expect(near(s.value, 4)).toBe(true);
    expect(near(s.row[0], 1)).toBe(true);
    expect(near(s.col[1], 1)).toBe(true);
  });

  it('負の値を含む行列でも正しい', () => {
    const s = solveMatrixGame([
      [-2, 1],
      [1, -1],
    ]);
    // x*(-2) + (1-x)*1 = x*1 + (1-x)*(-1) → -3x + 1 = 2x - 1 → x = 0.4, value = -0.2
    expect(near(s.value, -0.2)).toBe(true);
    expect(near(s.row[0], 0.4)).toBe(true);
  });

  it('1xN / Nx1', () => {
    expect(solveMatrixGame([[1, 2, -3]]).value).toBe(-3);
    expect(solveMatrixGame([[1], [7], [3]]).value).toBe(7);
  });
});
