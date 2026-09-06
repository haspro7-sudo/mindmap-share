/**
 * CPU 思考。3段階すべて「行列ゲームの均衡解」を土台にする。
 *
 *  - Easy   : 選べる手から一様ランダム
 *  - Normal : 1手先読み。各手組み合わせの次状態を評価関数で採点し、その行列ゲームの
 *             混合均衡をそのまま引く（= 局所的に搾取されない）
 *  - Hard   : 2手先読み + 相手モデル。相手の手癖（間合い別の出現率）を推定し、
 *             均衡戦略と混ぜた相手分布に対して最適応答を打つ（= 手癖を狩る）
 */
import { solveMatrixGame, sampleIndex } from './lp';
import { GAUGE_MAX, HP_MAX, availableMoves, distanceCells, other, rangeOf, resolveBeat, roomCells } from './rules';
import type { Move, Range, RoundState, Side } from './types';

export interface BeatRecord {
  /** 拍開始時の状態 */
  before: RoundState;
  moves: [Move, Move];
}

export interface CpuBrain {
  readonly name: string;
  choose(state: RoundState, side: Side, history: readonly BeatRecord[], beatLimit: number): Move;
}

export type Difficulty = 'easy' | 'normal' | 'hard';

export function createBrain(d: Difficulty, rnd: () => number = Math.random): CpuBrain {
  if (d === 'easy') return new RandomBrain(rnd);
  if (d === 'normal') return new ReaderBrain(rnd, 1, 0.4, 'Normal');
  return new ReaderBrain(rnd, 2, 0.8, 'Hard');
}

// ---------------------------------------------------------------------------
// 評価関数（P0 視点、非終端は (-1, 1) に収める）
// ---------------------------------------------------------------------------

export const EVAL_WEIGHTS = {
  hp: 0.8 / HP_MAX,
  gauge: 0.05,
  room: 0.02,
};

export function evaluate(s: RoundState): number {
  const [a, b] = s.fighters;
  let v = (a.hp - b.hp) * EVAL_WEIGHTS.hp;
  v += (a.gauge - b.gauge) * EVAL_WEIGHTS.gauge;
  v += (roomCells(s, 0) - roomCells(s, 1)) * EVAL_WEIGHTS.room;
  return v;
}

/**
 * 状態の値（P0 視点）。depth=0 は評価関数、depth>=1 は行列ゲームを解いて再帰。
 */
export function valueOf(s: RoundState, depth: number, beatLimit: number): number {
  if (depth <= 0) return evaluate(s);
  return solveState(s, depth, beatLimit).value;
}

export interface SolvedState {
  moves0: Move[];
  moves1: Move[];
  matrix: number[][];
  row: number[];
  col: number[];
  value: number;
}

export function solveState(s: RoundState, depth: number, beatLimit: number): SolvedState {
  const moves0 = availableMoves(s, 0);
  const moves1 = availableMoves(s, 1);
  const matrix: number[][] = [];
  for (const m0 of moves0) {
    const row: number[] = [];
    for (const m1 of moves1) {
      const r = resolveBeat(s, [m0, m1], beatLimit);
      let v: number;
      if (r.outcome === 'p0') v = 1;
      else if (r.outcome === 'p1') v = -1;
      else if (r.outcome === 'draw') v = 0;
      else v = valueOf(r.next, depth - 1, beatLimit);
      row.push(v);
    }
    matrix.push(row);
  }
  const sol = solveMatrixGame(matrix);
  return { moves0, moves1, matrix, row: sol.row, col: sol.col, value: sol.value };
}

// ---------------------------------------------------------------------------
// Brains
// ---------------------------------------------------------------------------

export class RandomBrain implements CpuBrain {
  readonly name = 'Easy';
  constructor(private rnd: () => number = Math.random) {}
  choose(state: RoundState, side: Side): Move {
    const moves = availableMoves(state, side);
    return moves[Math.floor(this.rnd() * moves.length)];
  }
}

export class NashBrain implements CpuBrain {
  readonly name: string;
  constructor(
    private depth: number = 1,
    private rnd: () => number = Math.random,
  ) {
    this.name = depth >= 2 ? 'Nash-2' : 'Normal';
  }
  choose(state: RoundState, side: Side, _history: readonly BeatRecord[], beatLimit: number): Move {
    const sol = solveState(state, this.depth, beatLimit);
    const strategy = side === 0 ? sol.row : sol.col;
    const moves = side === 0 ? sol.moves0 : sol.moves1;
    return moves[sampleIndex(strategy, this.rnd)];
  }
}

/** 相手の手癖モデル：間合い別 + 全体の出現率を指数減衰で数える */
export class OpponentModel {
  private counts = new Map<Range | 'all', Map<Move, number>>();
  private total = new Map<Range | 'all', number>();
  constructor(private decay = 0.88) {}

  observe(range: Range, move: Move) {
    for (const key of [range, 'all'] as const) {
      const c = this.counts.get(key) ?? new Map<Move, number>();
      for (const [k, v] of c) c.set(k, v * this.decay);
      c.set(move, (c.get(move) ?? 0) + 1);
      this.counts.set(key, c);
      this.total.set(key, (this.total.get(key) ?? 0) * this.decay + 1);
    }
  }

  samples(range: Range | 'all'): number {
    return this.total.get(range) ?? 0;
  }

  /** 選べる手に制限した分布。観測が無ければ null */
  distribution(range: Range | 'all', legal: readonly Move[]): number[] | null {
    const c = this.counts.get(range);
    if (!c) return null;
    const raw = legal.map((m) => c.get(m) ?? 0);
    const sum = raw.reduce((a, b) => a + b, 0);
    if (sum <= 0) return null;
    return raw.map((v) => v / sum);
  }
}

export class ReaderBrain implements CpuBrain {
  readonly name: string;
  private model = new OpponentModel();
  private seen = 0;
  constructor(
    private rnd: () => number = Math.random,
    private depth = 2,
    private exploitRate = 0.7,
    name = 'Hard',
  ) {
    this.name = name;
  }

  choose(state: RoundState, side: Side, history: readonly BeatRecord[], beatLimit: number): Move {
    const opp = other(side);
    // 未観測の履歴を取り込む
    for (; this.seen < history.length; this.seen++) {
      const rec = history[this.seen];
      this.model.observe(rangeOf(distanceCells(rec.before)), rec.moves[opp]);
    }

    const sol = solveState(state, this.depth, beatLimit);
    const myMoves = side === 0 ? sol.moves0 : sol.moves1;
    const oppMoves = side === 0 ? sol.moves1 : sol.moves0;
    const myNash = side === 0 ? sol.row : sol.col;
    const oppNash = side === 0 ? sol.col : sol.row;

    // 間合い別の観測を優先し、足りなければ全体の観測で補う
    const range = rangeOf(distanceCells(state));
    let observed = this.model.distribution(range, oppMoves);
    let n = this.model.samples(range);
    if (!observed || n < 2) {
      observed = this.model.distribution('all', oppMoves);
      n = this.model.samples('all') * 0.6;
    }
    if (!observed || n < 2 || this.rnd() > this.exploitRate) {
      return myMoves[sampleIndex(myNash, this.rnd)];
    }

    // 観測が多いほどモデルを信用（最大 0.85）
    const trust = Math.min(0.85, n / 5);
    const belief = oppNash.map((p, j) => (1 - trust) * p + trust * observed[j]);

    // belief に対する期待値最大の手
    let best = 0;
    let bestV = -Infinity;
    for (let i = 0; i < myMoves.length; i++) {
      let v = 0;
      for (let j = 0; j < oppMoves.length; j++) {
        const cell = side === 0 ? sol.matrix[i][j] : -sol.matrix[j][i];
        v += belief[j] * cell;
      }
      if (v > bestV) {
        bestV = v;
        best = i;
      }
    }
    return myMoves[best];
  }
}

export { GAUGE_MAX };
