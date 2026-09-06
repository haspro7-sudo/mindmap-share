/**
 * 試合進行（ラウンド管理・ゲージ持ち越し・履歴）。DOM 非依存。
 */
import type { BeatRecord } from './cpu';
import { DEFAULT_BEAT_LIMIT, initialRound, resolveBeat } from './rules';
import type { BeatResult, MatchConfig, Move, RoundOutcome, RoundState } from './types';

export const DEFAULT_MATCH: MatchConfig = { roundsToWin: 2, beatLimit: DEFAULT_BEAT_LIMIT };

export interface RoundSummary {
  index: number;
  outcome: RoundOutcome;
  beats: number;
  finisher: Move | null;
  perfect: boolean;
}

export type MatchWinner = 0 | 1 | null;

export class Match {
  readonly config: MatchConfig;
  scores: [number, number] = [0, 0];
  round: RoundState;
  roundIndex = 0;
  /** 現在ラウンドの履歴 */
  history: BeatRecord[] = [];
  /** 全ラウンドの履歴（統計用） */
  allHistory: BeatRecord[] = [];
  rounds: RoundSummary[] = [];
  winner: MatchWinner = null;

  constructor(config: Partial<MatchConfig> = {}) {
    this.config = { ...DEFAULT_MATCH, ...config };
    this.round = initialRound();
  }

  get roundOver(): boolean {
    return this.rounds.length > this.roundIndex;
  }

  /** 1拍進める。ラウンド決着時は rounds に記録し、試合決着時は winner を設定 */
  step(moves: [Move, Move]): BeatResult {
    if (this.winner !== null || this.roundOver) throw new Error('round already finished');
    const rec: BeatRecord = { before: this.round, moves };
    const result = resolveBeat(this.round, moves, this.config.beatLimit);
    rec.moves = result.moves;
    this.history.push(rec);
    this.allHistory.push(rec);
    this.round = result.next;

    if (result.outcome !== 'continue') {
      const winnerSide = result.outcome === 'p0' ? 0 : result.outcome === 'p1' ? 1 : null;
      const perfect = winnerSide !== null && result.next.fighters[winnerSide].hp === initialRound().fighters[0].hp;
      this.rounds.push({
        index: this.roundIndex,
        outcome: result.outcome,
        beats: result.next.beat,
        finisher: winnerSide !== null ? result.moves[winnerSide] : null,
        perfect,
      });
      if (winnerSide !== null) {
        this.scores[winnerSide] += 1;
        if (this.scores[winnerSide] >= this.config.roundsToWin) this.winner = winnerSide;
      }
    }
    return result;
  }

  /** 次ラウンドへ（ゲージは持ち越し） */
  nextRound(): void {
    if (!this.roundOver || this.winner !== null) throw new Error('cannot start next round');
    const g: [number, number] = [this.round.fighters[0].gauge, this.round.fighters[1].gauge];
    this.round = initialRound(g);
    this.roundIndex += 1;
    this.history = [];
  }
}
