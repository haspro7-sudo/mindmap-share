/**
 * 棒人間ファイト RE — 純粋ロジックの型定義。
 * ここには DOM / Canvas への依存を一切置かない（Node で単体テスト・ソルバーを回すため）。
 */

/** 1拍（ビート）で選べる手 */
export type Move = 'strike' | 'throw' | 'guard' | 'forward' | 'back' | 'super';

export const ALL_MOVES: readonly Move[] = ['strike', 'throw', 'guard', 'forward', 'back', 'super'];

/** プレイヤー番号。0 = 左（右向き）、1 = 右（左向き） */
export type Side = 0 | 1;

export interface Fighter {
  hp: number;
  /** 半マス単位の座標。0..ARENA_MAX。P0 は小さい側、P1 は大きい側 */
  pos: number;
  /** 必殺ゲージ 0..GAUGE_MAX */
  gauge: number;
}

export interface RoundState {
  fighters: [Fighter, Fighter];
  /** 経過拍数（0 始まり） */
  beat: number;
}

export type RoundOutcome = 'continue' | 'p0' | 'p1' | 'draw';

/** 解決結果を描画側が再生するためのイベント列 */
export type BeatEvent =
  | { type: 'move'; side: Side; from: number; to: number; dir: 'forward' | 'back' }
  | { type: 'attack'; side: Side; move: 'strike' | 'throw' | 'super'; hit: boolean }
  | { type: 'block'; side: Side; pushedTo: number; atWall: boolean }
  | { type: 'damage'; side: Side; amount: number; kind: 'hit' | 'counter' | 'throw' | 'crush' | 'wallslam' | 'super' | 'armor' | 'trade' | 'reflect' }
  | { type: 'push'; side: Side; from: number; to: number }
  | { type: 'gauge'; side: Side; delta: number; reason: 'hit' | 'block' | 'bait' | 'pressure' | 'spend' }
  | { type: 'tech' }
  | { type: 'clash' }
  | { type: 'escape'; side: Side }
  | { type: 'ko'; side: Side }
  | { type: 'shrink'; lo: number; hi: number; from: [number, number]; to: [number, number] };

export interface BeatResult {
  next: RoundState;
  events: BeatEvent[];
  outcome: RoundOutcome;
  /** 解決に使った各手（不可な手は guard に矯正済み） */
  moves: [Move, Move];
}

/** 間合いカテゴリ（マス単位の距離から） */
export type Range = 'close' | 'near' | 'mid' | 'far';

export interface MatchConfig {
  roundsToWin: number;
  beatLimit: number;
}
