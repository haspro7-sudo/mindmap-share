/**
 * ゲーム内 CPU どうしの対戦シミュレーション。
 *
 *   npm run sim
 *
 * 確認したいこと：
 *  - Normal / Hard が単純戦略（打撃連打・ガード連打…）を確実に狩ること
 *  - Hard > Normal > Easy の序列
 *  - 平均ラウンド長が設計目標（8〜14拍）に収まること
 */
import { createBrain, type BeatRecord, type CpuBrain } from '../src/engine/cpu';
import { DEFAULT_BEAT_LIMIT, availableMoves, initialRound, resolveBeat } from '../src/engine/rules';
import type { Move, RoundState, Side } from '../src/engine/types';

let seed = 42;
const rnd = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
};

class SpamBrain implements CpuBrain {
  readonly name: string;
  constructor(private move: Move) {
    this.name = `spam:${move}`;
  }
  choose(state: RoundState, side: Side): Move {
    const av = availableMoves(state, side);
    if (av.includes(this.move)) return this.move;
    return av.includes('guard') ? 'guard' : av[0];
  }
}

/** 試合単位（ROUNDS_PER_MATCH ラウンド）で同じ Brain を使い続ける = ラウンドをまたいで学習できる */
const ROUNDS_PER_MATCH = 5;

function playRounds(a: () => CpuBrain, b: () => CpuBrain, rounds: number) {
  let win0 = 0;
  let beats = 0;
  let ba = a();
  let bb = b();
  const history: BeatRecord[] = [];
  for (let r = 0; r < rounds; r++) {
    if (r % ROUNDS_PER_MATCH === 0) {
      ba = a();
      bb = b();
      history.length = 0;
    }
    let s = initialRound();
    for (;;) {
      const m0 = ba.choose(s, 0, history, DEFAULT_BEAT_LIMIT);
      const m1 = bb.choose(s, 1, history, DEFAULT_BEAT_LIMIT);
      const res = resolveBeat(s, [m0, m1], DEFAULT_BEAT_LIMIT);
      history.push({ before: s, moves: res.moves });
      s = res.next;
      if (res.outcome !== 'continue') {
        beats += s.beat;
        if (res.outcome === 'p0') win0++;
        else if (res.outcome === 'draw') win0 += 0.5;
        break;
      }
    }
  }
  return { winRate: win0 / rounds, avgBeats: beats / rounds };
}

const ROUNDS = Number(process.argv[2] ?? 300);
const pairs: [string, () => CpuBrain, string, () => CpuBrain][] = [
  ['Normal', () => createBrain('normal', rnd), 'Easy', () => createBrain('easy', rnd)],
  ['Hard', () => createBrain('hard', rnd), 'Easy', () => createBrain('easy', rnd)],
  ['Hard', () => createBrain('hard', rnd), 'Normal', () => createBrain('normal', rnd)],
  ['Normal', () => createBrain('normal', rnd), 'Normal', () => createBrain('normal', rnd)],
];
for (const m of ['strike', 'throw', 'guard', 'forward', 'back'] as Move[]) {
  pairs.push(['Normal', () => createBrain('normal', rnd), `spam:${m}`, () => new SpamBrain(m)]);
  pairs.push(['Hard', () => createBrain('hard', rnd), `spam:${m}`, () => new SpamBrain(m)]);
}

console.log(`rounds per pair: ${ROUNDS}`);
console.log('| P0 | P1 | P0勝率 | 平均拍数 |');
console.log('|---|---|---|---|');
for (const [na, a, nb, b] of pairs) {
  const t0 = Date.now();
  const r = playRounds(a, b, ROUNDS);
  console.log(`| ${na} | ${nb} | ${(r.winRate * 100).toFixed(1)}% | ${r.avgBeats.toFixed(1)} |  (${Date.now() - t0}ms)`);
}
