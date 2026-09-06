/**
 * 2人ゼロサム行列ゲームの厳密解（線形計画法・単体法）。
 *
 * 行プレイヤーは A[i][j] を最大化、列プレイヤーは最小化。
 * 返り値は混合戦略 (row, col) とゲームの値 value。
 *
 * 手順：A を正にシフト → 「max Σz s.t. Bz ≤ 1, z ≥ 0」を単体法で解く →
 *       列戦略 q = z/Σz、行戦略 p = 双対変数/Σ、value = 1/Σz − shift。
 */
export interface GameSolution {
  row: number[];
  col: number[];
  value: number;
}

const EPS = 1e-9;

export function solveMatrixGame(A: number[][]): GameSolution {
  const m = A.length;
  const n = A[0]?.length ?? 0;
  if (m === 0 || n === 0) throw new Error('empty matrix');

  // 1x? / ?x1 は純戦略で即答
  if (m === 1) {
    let best = 0;
    for (let j = 1; j < n; j++) if (A[0][j] < A[0][best]) best = j;
    const col = new Array(n).fill(0);
    col[best] = 1;
    return { row: [1], col, value: A[0][best] };
  }
  if (n === 1) {
    let best = 0;
    for (let i = 1; i < m; i++) if (A[i][0] > A[best][0]) best = i;
    const row = new Array(m).fill(0);
    row[best] = 1;
    return { row, col: [1], value: A[best][0] };
  }

  let min = Infinity;
  for (const r of A) for (const v of r) if (v < min) min = v;
  // 全要素を 1 以上に平行移動（極小の正数でもピボットが取れるように）
  const shift = 1 - min;

  // タブロー: 行 0..m-1 が制約、最終行が目的。列 0..n-1 = z、n..n+m-1 = slack、最終列 = RHS
  const cols = n + m + 1;
  const T: number[][] = [];
  for (let i = 0; i < m; i++) {
    const row = new Array(cols).fill(0);
    for (let j = 0; j < n; j++) row[j] = A[i][j] + shift;
    row[n + i] = 1;
    row[cols - 1] = 1;
    T.push(row);
  }
  const obj = new Array(cols).fill(0);
  for (let j = 0; j < n; j++) obj[j] = -1;
  T.push(obj);

  const basis: number[] = [];
  for (let i = 0; i < m; i++) basis.push(n + i);

  for (let iter = 0; iter < 500; iter++) {
    // Bland の規則：負の係数を持つ最小添字の列
    let enter = -1;
    for (let j = 0; j < cols - 1; j++) {
      if (T[m][j] < -EPS) {
        enter = j;
        break;
      }
    }
    if (enter === -1) break;

    let leave = -1;
    let bestRatio = Infinity;
    for (let i = 0; i < m; i++) {
      const a = T[i][enter];
      if (a > EPS) {
        const ratio = T[i][cols - 1] / a;
        if (ratio < bestRatio - EPS || (Math.abs(ratio - bestRatio) <= EPS && basis[i] < basis[leave])) {
          bestRatio = ratio;
          leave = i;
        }
      }
    }
    if (leave === -1) throw new Error('unbounded LP (should not happen for shifted game)');

    // ピボット
    const p = T[leave][enter];
    for (let j = 0; j < cols; j++) T[leave][j] /= p;
    for (let i = 0; i <= m; i++) {
      if (i === leave) continue;
      const factor = T[i][enter];
      if (Math.abs(factor) < EPS) continue;
      for (let j = 0; j < cols; j++) T[i][j] -= factor * T[leave][j];
    }
    basis[leave] = enter;
  }

  const z = new Array(n).fill(0);
  for (let i = 0; i < m; i++) if (basis[i] < n) z[basis[i]] = T[i][cols - 1];
  const y = new Array(m).fill(0);
  for (let i = 0; i < m; i++) y[i] = T[m][n + i];

  const sumZ = z.reduce((a, b) => a + b, 0);
  const sumY = y.reduce((a, b) => a + b, 0);
  const col = z.map((v) => (sumZ > 0 ? v / sumZ : 1 / n));
  const row = y.map((v) => (sumY > 0 ? v / sumY : 1 / m));
  const value = (sumZ > 0 ? 1 / sumZ : 0) - shift;

  return { row: normalize(row), col: normalize(col), value };
}

function normalize(p: number[]): number[] {
  const cleaned = p.map((v) => (v < 0 ? 0 : v));
  const s = cleaned.reduce((a, b) => a + b, 0);
  return s > 0 ? cleaned.map((v) => v / s) : cleaned.map(() => 1 / cleaned.length);
}

/** 混合戦略からサンプリング */
export function sampleIndex(p: number[], rnd: () => number = Math.random): number {
  let r = rnd();
  for (let i = 0; i < p.length; i++) {
    r -= p[i];
    if (r <= 0) return i;
  }
  return p.length - 1;
}
