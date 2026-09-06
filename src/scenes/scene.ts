import type { Difficulty } from '../engine/cpu';
import type { Input } from '../input';

export type GameMode = { kind: 'cpu'; difficulty: Difficulty } | { kind: '2p' };

export interface Scene {
  update(dt: number, input: Input): void;
  draw(ctx: CanvasRenderingContext2D, t: number): void;
  /** シーン離脱時 */
  dispose?(): void;
}

export interface App {
  goTitle(): void;
  goMatch(mode: GameMode): void;
  goResult(summary: ResultSummary): void;
}

export interface ResultSummary {
  mode: GameMode;
  winner: 0 | 1 | null;
  scores: [number, number];
  names: [string, string];
  stats: {
    beats: number;
    rounds: number;
    counters: [number, number];
    supers: [number, number];
    blocks: [number, number];
    throws: [number, number];
    perfect: [number, number];
  };
}
