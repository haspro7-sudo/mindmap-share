/**
 * 全状態の均衡ソルバー（Shapley 値反復）。
 *
 *   npm run solve            → docs/BALANCE.md を生成
 *   npm run solve -- --quick → 反復回数を減らして概算
 *
 * 各状態で「両者の選べる手 × 次状態の値」の行列ゲームを LP で厳密に解き、
 * 値関数が収束するまで反復する。得られた混合戦略で自己対戦し、
 * ラウンド長・KO率・手の使用率・必殺の命中率などを集計する。
 */
import { writeFileSync } from 'node:fs';
import { solveMatrixGame, sampleIndex } from '../src/engine/lp';
import {
  GAUGE_MAX,
  HP_MAX,
  MOVE_LABEL,
  SHRINK_EVERY,
  SHRINK_MAX_PHASE,
  availableMoves,
  distanceCells,
  initialRound,
  rangeOf,
  resolveBeat,
  shrinkPhase,
  wallBounds,
} from '../src/engine/rules';
import type { Move, Range, RoundState } from '../src/engine/types';

const QUICK = process.argv.includes('--quick');
const GAMMA = 0.97;
const MAX_SWEEPS = QUICK ? 12 : 400;
const TOL = 1e-4;
const BEAT_LIMIT = 24;

// ---------------------------------------------------------------------------
// 状態の列挙
// ---------------------------------------------------------------------------

interface Key {
  hp0: number;
  hp1: number;
  pos0: number;
  pos1: number;
  g0: number;
  g1: number;
  /** リング縮小フェーズ 0..SHRINK_MAX_PHASE */
  phase: number;
}

const keys: Key[] = [];
const index = new Map<string, number>();
const keyStr = (k: Key) => `${k.hp0},${k.hp1},${k.pos0},${k.pos1},${k.g0},${k.g1},${k.phase}`;

for (let phase = 0; phase <= SHRINK_MAX_PHASE; phase++) {
  const [lo, hi] = wallBounds(phase * SHRINK_EVERY);
  for (let hp0 = 1; hp0 <= HP_MAX; hp0++)
    for (let hp1 = 1; hp1 <= HP_MAX; hp1++)
      for (let pos0 = lo; pos0 <= hi - 2; pos0++)
        for (let pos1 = pos0 + 2; pos1 <= hi; pos1 += 2)
          for (let g0 = 0; g0 <= GAUGE_MAX; g0++)
            for (let g1 = 0; g1 <= GAUGE_MAX; g1++) {
              const k = { hp0, hp1, pos0, pos1, g0, g1, phase };
              index.set(keyStr(k), keys.length);
              keys.push(k);
            }
}

const N = keys.length;
console.log(`states: ${N}`);

function toState(k: Key, beat = k.phase * SHRINK_EVERY): RoundState {
  return {
    fighters: [
      { hp: k.hp0, pos: k.pos0, gauge: k.g0 },
      { hp: k.hp1, pos: k.pos1, gauge: k.g1 },
    ],
    beat,
  };
}

function indexOf(s: RoundState): number {
  const [a, b] = s.fighters;
  const i = index.get(`${a.hp},${b.hp},${a.pos},${b.pos},${a.gauge},${b.gauge},${shrinkPhase(s.beat)}`);
  if (i === undefined) throw new Error('unknown state ' + JSON.stringify(s));
  return i;
}

// ---------------------------------------------------------------------------
// 遷移の前計算
// ---------------------------------------------------------------------------

interface Node {
  moves0: Move[];
  moves1: Move[];
  /** next[i][j] = 同フェーズに留まる場合の次状態 index、終端なら -1 */
  next: Int32Array;
  /** nextShrink[i][j] = この拍で壁が迫る場合の次状態 index（最終フェーズは next と同じ） */
  nextShrink: Int32Array;
  /** term[i][j] = 終端値 (+1/-1/0)、非終端は NaN */
  term: Float32Array;
}

/** 各拍で壁が迫る確率（フェーズ内の位置を持たない近似） */
const SHRINK_PROB = 1 / SHRINK_EVERY;

const nodes: Node[] = new Array(N);
console.time('transitions');
for (let i = 0; i < N; i++) {
  const k = keys[i];
  const s = toState(k);
  const sEdge = toState(k, k.phase * SHRINK_EVERY + SHRINK_EVERY - 1);
  const moves0 = availableMoves(s, 0);
  const moves1 = availableMoves(s, 1);
  const n = moves0.length * moves1.length;
  const next = new Int32Array(n);
  const nextShrink = new Int32Array(n);
  const term = new Float32Array(n);
  for (let a = 0; a < moves0.length; a++)
    for (let b = 0; b < moves1.length; b++) {
      const r = resolveBeat(s, [moves0[a], moves1[b]], 10_000);
      const idx = a * moves1.length + b;
      if (r.outcome === 'continue') {
        next[idx] = indexOf(r.next);
        term[idx] = NaN;
        if (k.phase < SHRINK_MAX_PHASE) {
          const r2 = resolveBeat(sEdge, [moves0[a], moves1[b]], 10_000);
          nextShrink[idx] = indexOf(r2.next);
        } else {
          nextShrink[idx] = next[idx];
        }
      } else {
        next[idx] = -1;
        nextShrink[idx] = -1;
        term[idx] = r.outcome === 'p0' ? 1 : r.outcome === 'p1' ? -1 : 0;
      }
    }
  nodes[i] = { moves0, moves1, next, nextShrink, term };
}
console.timeEnd('transitions');

// ---------------------------------------------------------------------------
// 値反復
// ---------------------------------------------------------------------------

let V = new Float64Array(N);
const rowStrat: number[][] = new Array(N);
const colStrat: number[][] = new Array(N);

console.time('value-iteration');
let sweeps = 0;
for (; sweeps < MAX_SWEEPS; sweeps++) {
  const V2 = new Float64Array(N);
  let maxDelta = 0;
  for (let i = 0; i < N; i++) {
    const node = nodes[i];
    const m = node.moves0.length;
    const n = node.moves1.length;
    const A: number[][] = [];
    for (let a = 0; a < m; a++) {
      const row: number[] = new Array(n);
      for (let b = 0; b < n; b++) {
        const idx = a * n + b;
        const t = node.term[idx];
        row[b] = Number.isNaN(t)
          ? GAMMA * ((1 - SHRINK_PROB) * V[node.next[idx]] + SHRINK_PROB * V[node.nextShrink[idx]])
          : t;
      }
      A.push(row);
    }
    let sol;
    try {
      sol = solveMatrixGame(A);
    } catch (e) {
      console.error('LP failed at state', keys[i], JSON.stringify(A));
      throw e;
    }
    V2[i] = sol.value;
    rowStrat[i] = sol.row;
    colStrat[i] = sol.col;
    const delta = Math.abs(V2[i] - V[i]);
    if (delta > maxDelta) maxDelta = delta;
  }
  V = V2;
  console.log(`sweep ${sweeps + 1}: maxDelta=${maxDelta.toExponential(2)}`);
  if (maxDelta < TOL) {
    sweeps++;
    break;
  }
}
console.timeEnd('value-iteration');

// ---------------------------------------------------------------------------
// レポート
// ---------------------------------------------------------------------------

const lines: string[] = [];
const out = (s = '') => lines.push(s);
const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
const fmt = (v: number) => (v >= 0 ? '+' : '') + v.toFixed(3);

out('# バランス検証レポート（自動生成）');
out();
out(`> \`npm run solve\` の出力。ルールは \`src/engine/rules.ts\`、手法は \`tools/solve.ts\` を参照。`);
out(`> 状態数 ${N}、割引率 ${GAMMA}、値反復 ${sweeps} 回、収束閾値 ${TOL}。`);
out();

// 開始状態
const start = initialRound();
const startIdx = indexOf(start);
out('## 1. 開始状態の値');
out();
out(`- 開始状態（中距離・HP満タン・ゲージ0）の値: **${fmt(V[startIdx])}**（0 = 完全に公平）`);
out();

// 状況別の均衡戦略
function stratTable(title: string, s: RoundState) {
  const i = indexOf(s);
  const node = nodes[i];
  out(`### ${title}`);
  out();
  out(`値（P0視点）: ${fmt(V[i])}`);
  out();
  out('| 手 | P0 | P1 |');
  out('|---|---|---|');
  const all: Move[] = ['strike', 'throw', 'guard', 'forward', 'back', 'super'];
  for (const m of all) {
    const a = node.moves0.indexOf(m);
    const b = node.moves1.indexOf(m);
    if (a < 0 && b < 0) continue;
    out(`| ${MOVE_LABEL[m].ja} | ${a >= 0 ? pct(rowStrat[i][a]) : '—'} | ${b >= 0 ? pct(colStrat[i][b]) : '—'} |`);
  }
  out();
}

function mk(d: number, opts: { pos0?: number; hp?: [number, number]; g?: [number, number] } = {}): RoundState {
  const [, hi] = wallBounds(0);
  const pos0 = opts.pos0 ?? Math.floor((hi - (d * 2 + 2)) / 2);
  const s = initialRound(opts.g ?? [0, 0]);
  s.fighters[0].pos = pos0;
  s.fighters[1].pos = pos0 + d * 2 + 2;
  if (opts.hp) {
    s.fighters[0].hp = opts.hp[0];
    s.fighters[1].hp = opts.hp[1];
  }
  return s;
}

out('## 2. 間合い別の均衡混合戦略（HP満タン・ゲージ0・中央）');
out();
for (let d = 0; d <= 4; d++) stratTable(`d=${d}（${rangeOf(d)}）`, mk(d));

out('## 3. 壁際（P0 が壁を背負う）');
out();
stratTable('壁際・密着 d=0', mk(0, { pos0: 0 }));
stratTable('壁際・近距離 d=1', mk(1, { pos0: 0 }));
out(`- 壁際密着の値 ${fmt(V[indexOf(mk(0, { pos0: 0 }))])} vs 中央密着 ${fmt(V[indexOf(mk(0))])} → 壁を背負うコスト`);
out();

out(`## 4. 必殺ゲージ MAX（P0 が ${GAUGE_MAX}、P1 が 0）`);
out();
for (let d = 0; d <= 2; d++) stratTable(`d=${d}`, mk(d, { g: [GAUGE_MAX, 0] }));

out('## 5. 死に手チェック');
out();
out('全状態にわたる各手の「均衡での最大選択率」と「5% 以上選ばれる状態の割合（選択可能な状態のうち）」。');
out();
out('| 手 | 最大選択率 | 5%以上の状態割合 | 平均選択率 |');
out('|---|---|---|---|');
{
  const all: Move[] = ['strike', 'throw', 'guard', 'forward', 'back', 'super'];
  for (const m of all) {
    let max = 0;
    let cnt = 0;
    let avail = 0;
    let sum = 0;
    for (let i = 0; i < N; i++) {
      for (const [strat, moves] of [
        [rowStrat[i], nodes[i].moves0],
        [colStrat[i], nodes[i].moves1],
      ] as const) {
        const k = moves.indexOf(m);
        if (k < 0) continue;
        avail++;
        const p = strat[k];
        sum += p;
        if (p > max) max = p;
        if (p >= 0.05) cnt++;
      }
    }
    out(`| ${MOVE_LABEL[m].ja} | ${pct(max)} | ${pct(cnt / avail)} | ${pct(sum / avail)} |`);
  }
}
out();

// 自己対戦シミュレーション
out('## 6. 均衡戦略どうしの自己対戦（20,000 ラウンド）');
out();
{
  let seed = 12345;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const ROUNDS = 20_000;
  let win0 = 0;
  let win1 = 0;
  let draw = 0;
  let timeouts = 0;
  let totalBeats = 0;
  const useByRange = new Map<Range, Map<Move, number>>();
  const rangeCount = new Map<Range, number>();
  let superUsed = 0;
  let superHit = 0;
  let wallslam = 0;
  let throws = 0;
  let throwHit = 0;
  let counters = 0;
  let blocks = 0;
  let crushes = 0;
  const lengths: number[] = [];

  for (let r = 0; r < ROUNDS; r++) {
    let s = initialRound();
    // ゲージ持ち越しを模して 30% のラウンドはランダムなゲージから開始
    if (rnd() < 0.3) {
      s.fighters[0].gauge = Math.floor(rnd() * (GAUGE_MAX + 1));
      s.fighters[1].gauge = Math.floor(rnd() * (GAUGE_MAX + 1));
    }
    for (;;) {
      const i = indexOf(s);
      const node = nodes[i];
      const m0 = node.moves0[sampleIndex(rowStrat[i], rnd)];
      const m1 = node.moves1[sampleIndex(colStrat[i], rnd)];
      const range = rangeOf(distanceCells(s));
      rangeCount.set(range, (rangeCount.get(range) ?? 0) + 2);
      const um = useByRange.get(range) ?? new Map<Move, number>();
      um.set(m0, (um.get(m0) ?? 0) + 1);
      um.set(m1, (um.get(m1) ?? 0) + 1);
      useByRange.set(range, um);

      const res = resolveBeat(s, [m0, m1], BEAT_LIMIT);
      for (const e of res.events) {
        if (e.type === 'attack' && e.move === 'super') {
          superUsed++;
          if (e.hit) superHit++;
        }
        if (e.type === 'attack' && e.move === 'throw') {
          throws++;
          if (e.hit) throwHit++;
        }
        if (e.type === 'damage' && e.kind === 'wallslam') wallslam++;
        if (e.type === 'damage' && e.kind === 'crush') crushes++;
        if (e.type === 'damage' && e.kind === 'counter') counters++;
        if (e.type === 'block') blocks++;
      }
      s = res.next;
      if (res.outcome !== 'continue') {
        totalBeats += s.beat;
        lengths.push(s.beat);
        if (res.outcome === 'p0') win0++;
        else if (res.outcome === 'p1') win1++;
        else draw++;
        if (s.beat >= BEAT_LIMIT && s.fighters[0].hp > 0 && s.fighters[1].hp > 0) timeouts++;
        break;
      }
    }
  }
  lengths.sort((a, b) => a - b);
  out(`- P0 勝率 ${pct(win0 / ROUNDS)} / P1 勝率 ${pct(win1 / ROUNDS)} / 引き分け ${pct(draw / ROUNDS)}`);
  out(`- 平均ラウンド長 **${(totalBeats / ROUNDS).toFixed(1)} 拍**（中央値 ${lengths[Math.floor(lengths.length / 2)]}、90%tile ${lengths[Math.floor(lengths.length * 0.9)]}）`);
  out(`- 時間切れ率 ${pct(timeouts / ROUNDS)}（上限 ${BEAT_LIMIT} 拍）`);
  out(`- 必殺: 発動 ${superUsed} 回、命中率 ${superUsed ? pct(superHit / superUsed) : '—'}`);
  out(`- 投げ: 試行 ${throws} 回、成立率 ${throws ? pct(throwHit / throws) : '—'}`);
  out(`- カウンターヒット ${counters} 回、ガード成立 ${blocks} 回、崩し投げ ${crushes} 回、壁ドン ${wallslam} 回（1ラウンドあたり ${(wallslam / ROUNDS).toFixed(2)}）`);
  out(`- 1ラウンドあたり: 必殺 ${(superUsed / ROUNDS).toFixed(2)} 回、投げ試行 ${(throws / ROUNDS).toFixed(2)} 回、カウンター ${(counters / ROUNDS).toFixed(2)} 回`);
  out();
  out('### 間合い別の手の使用率（両者合算）');
  out();
  const all: Move[] = ['strike', 'throw', 'guard', 'forward', 'back', 'super'];
  out(`| 間合い | 拍数 | ${all.map((m) => MOVE_LABEL[m].ja).join(' | ')} |`);
  out(`|---|---|${all.map(() => '---').join('|')}|`);
  for (const range of ['close', 'near', 'mid', 'far'] as Range[]) {
    const um = useByRange.get(range) ?? new Map();
    const total = rangeCount.get(range) ?? 0;
    out(`| ${range} | ${total / 2} | ${all.map((m) => pct((um.get(m) ?? 0) / Math.max(1, total))).join(' | ')} |`);
  }
  out();
}

writeFileSync('docs/BALANCE.md', lines.join('\n') + '\n');
console.log('wrote docs/BALANCE.md');
