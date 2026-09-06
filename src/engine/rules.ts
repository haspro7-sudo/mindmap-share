/**
 * 棒人間ファイト RE — ルール正本（docs/DESIGN.md §3 と 1:1 対応）。
 *
 * 1拍の解決は 3 段階：
 *   1. 移動（前進 / 後退 / 投げの踏み込み）を同時適用
 *   2. 移動後の間合いで「届く／届かない」を判定
 *   3. 届いた技同士の優先順位（打 > 投 は打勝ち、投 > 必殺、必殺 > 打）で被害を確定
 */
import type { BeatEvent, BeatResult, Fighter, Move, Range, RoundOutcome, RoundState, Side } from './types';

// ---------------------------------------------------------------------------
// 定数
// ---------------------------------------------------------------------------

/** アリーナは半マス単位 0..ARENA_MAX。1マス = 2 */
export const ARENA_MAX = 18;
export const CELL = 2;
export const START_POS: readonly [number, number] = [6, 12];
export const HP_MAX = 6;
export const GAUGE_MAX = 5;
export const DEFAULT_BEAT_LIMIT = 24;
/** リング縮小：SHRINK_EVERY 拍ごとに両側の壁が 1 マスずつ迫る（最大 SHRINK_MAX_PHASE 回） */
export const SHRINK_EVERY = 5;
export const SHRINK_MAX_PHASE = 3;

export const DMG = {
  strike: 1,
  counter: 2,
  throw: 2,
  /** ガードしている相手への投げ（崩し） */
  throwCrush: 3,
  wallslam: 1,
  super: 3,
  armor: 1,
  /** ガード成立時に攻撃側が受ける反撃 */
  reflect: 1,
} as const;

export const REACH = {
  strike: 1,
  throw: 0,
  super: 2,
} as const;

// ---------------------------------------------------------------------------
// 状態ユーティリティ
// ---------------------------------------------------------------------------

export function initialRound(gauges: [number, number] = [0, 0]): RoundState {
  return {
    fighters: [
      { hp: HP_MAX, pos: START_POS[0], gauge: gauges[0] },
      { hp: HP_MAX, pos: START_POS[1], gauge: gauges[1] },
    ],
    beat: 0,
  };
}

export function cloneState(s: RoundState): RoundState {
  return {
    fighters: [{ ...s.fighters[0] }, { ...s.fighters[1] }],
    beat: s.beat,
  };
}

/** マス単位の距離（0 = 密着） */
export function distanceCells(s: RoundState): number {
  return (s.fighters[1].pos - s.fighters[0].pos - CELL) / CELL;
}

export function distanceFromPositions(pos0: number, pos1: number): number {
  return (pos1 - pos0 - CELL) / CELL;
}

/** 現在の拍における壁の位置 [左, 右]（半マス単位） */
export function shrinkPhase(beat: number): number {
  return Math.min(SHRINK_MAX_PHASE, Math.floor(beat / SHRINK_EVERY));
}

export function wallBounds(beat: number): [number, number] {
  const p = shrinkPhase(beat) * CELL;
  return [p, ARENA_MAX - p];
}

/** 背後の余白（マス単位、切り捨て） */
export function roomCells(s: RoundState, side: Side): number {
  const f = s.fighters[side];
  const [lo, hi] = wallBounds(s.beat);
  return side === 0 ? Math.floor((f.pos - lo) / CELL) : Math.floor((hi - f.pos) / CELL);
}

export function atWall(s: RoundState, side: Side): boolean {
  return roomCells(s, side) < 1;
}

export function rangeOf(d: number): Range {
  if (d <= 0) return 'close';
  if (d === 1) return 'near';
  if (d === 2) return 'mid';
  return 'far';
}

export function availableMoves(s: RoundState, side: Side): Move[] {
  const moves: Move[] = ['strike', 'throw', 'guard'];
  if (distanceCells(s) >= 1) moves.push('forward');
  if (roomCells(s, side) >= 1) moves.push('back');
  if (s.fighters[side].gauge >= GAUGE_MAX) moves.push('super');
  return moves;
}

export function isAvailable(s: RoundState, side: Side, m: Move): boolean {
  return availableMoves(s, side).includes(m);
}

export function other(side: Side): Side {
  return side === 0 ? 1 : 0;
}

/** 前方向の符号。P0 は +、P1 は - */
function fwd(side: Side): number {
  return side === 0 ? 1 : -1;
}

function isAttack(m: Move): m is 'strike' | 'throw' | 'super' {
  return m === 'strike' || m === 'throw' || m === 'super';
}

// ---------------------------------------------------------------------------
// 1拍の解決
// ---------------------------------------------------------------------------

export function resolveBeat(
  state: RoundState,
  chosen: [Move, Move],
  beatLimit: number = DEFAULT_BEAT_LIMIT,
): BeatResult {
  const s = cloneState(state);
  const ev: BeatEvent[] = [];
  const f: [Fighter, Fighter] = s.fighters;

  // 選択できない手は guard に矯正（タイムアウト等の安全弁）
  const moves: [Move, Move] = [
    isAvailable(state, 0, chosen[0]) ? chosen[0] : 'guard',
    isAvailable(state, 1, chosen[1]) ? chosen[1] : 'guard',
  ];

  const dBefore = distanceCells(state);

  // ---- 1. 移動 ----------------------------------------------------------
  const step: [number, number] = [0, 0];
  for (const side of [0, 1] as const) {
    const m = moves[side];
    if (m === 'forward') step[side] = CELL * fwd(side);
    else if (m === 'back') step[side] = -CELL * fwd(side);
    else if (m === 'throw' && dBefore >= 1 && dBefore <= 2) step[side] = CELL * fwd(side); // 踏み込み投げ（近〜中距離）
  }
  const [lo, hi] = wallBounds(state.beat);
  // 動かない側は壁で丸めない（半マスの偶奇を崩さないため）
  let n0 = step[0] === 0 ? f[0].pos : clamp(f[0].pos + step[0], lo, hi);
  let n1 = step[1] === 0 ? f[1].pos : clamp(f[1].pos + step[1], lo, hi);
  if (n1 - n0 < CELL) {
    // 互いに踏み込んで衝突 → 中央で密着（半マスずつ）
    const excess = CELL - (n1 - n0);
    const half0 = Math.floor(excess / 2);
    n0 -= half0;
    n1 += excess - half0;
  }
  for (const side of [0, 1] as const) {
    const to = side === 0 ? n0 : n1;
    if (to !== f[side].pos) {
      ev.push({
        type: 'move',
        side,
        from: f[side].pos,
        to,
        dir: moves[side] === 'back' ? 'back' : 'forward',
      });
    }
  }
  f[0].pos = n0;
  f[1].pos = n1;

  // ---- 2. 届く判定 ------------------------------------------------------
  const d = distanceCells(s);
  const reaches = (side: Side): boolean => {
    const m = moves[side];
    const om = moves[other(side)];
    if (m === 'strike') return d <= REACH.strike;
    if (m === 'throw') return d <= REACH.throw && om !== 'back'; // 後退中は投げ無敵
    if (m === 'super') return d <= REACH.super;
    return false;
  };
  const r: [boolean, boolean] = [reaches(0), reaches(1)];

  for (const side of [0, 1] as const) {
    const m = moves[side];
    if (isAttack(m)) {
      ev.push({ type: 'attack', side, move: m, hit: r[side] });
      if (m === 'throw' && moves[other(side)] === 'back' && d - 1 <= REACH.throw) {
        ev.push({ type: 'escape', side: other(side) });
      }
    }
  }

  // ---- 3. 被害・ゲージ ----------------------------------------------------
  const dmg: [number, number] = [0, 0];
  const gaugeDelta: [number, number] = [0, 0];
  const spend: [boolean, boolean] = [moves[0] === 'super', moves[1] === 'super'];

  const hurt = (side: Side, amount: number, kind: Extract<BeatEvent, { type: 'damage' }>['kind']) => {
    if (amount <= 0) return;
    dmg[side] += amount;
    ev.push({ type: 'damage', side, amount, kind });
    gaugeDelta[side] += 1;
    ev.push({ type: 'gauge', side, delta: 1, reason: 'hit' });
  };

  /** 投げ・ガードの押し出し。壁なら動かず true を返す */
  const pushBack = (side: Side): boolean => {
    const room = roomCells(s, side);
    if (room < 1) return true;
    const from = f[side].pos;
    f[side].pos = from - CELL * fwd(side);
    ev.push({ type: 'push', side, from, to: f[side].pos });
    return false;
  };

  const throwHit = (victim: Side) => {
    const crush = moves[victim] === 'guard';
    hurt(victim, crush ? DMG.throwCrush : DMG.throw, crush ? 'crush' : 'throw');
    const wall = pushBack(victim);
    if (wall) hurt(victim, DMG.wallslam, 'wallslam');
  };

  const bait = (side: Side) => {
    gaugeDelta[side] += 1;
    ev.push({ type: 'gauge', side, delta: 1, reason: 'bait' });
  };

  if (r[0] && r[1]) {
    // 両者の技が届いた
    const a = moves[0] as 'strike' | 'throw' | 'super';
    const b = moves[1] as 'strike' | 'throw' | 'super';
    if (a === 'strike' && b === 'strike') {
      // 相打ち：両者 -1 だが、相打ちでは KO しない（HP 1 で耐える）
      hurt(0, Math.min(DMG.strike, f[0].hp - 1), 'trade');
      hurt(1, Math.min(DMG.strike, f[1].hp - 1), 'trade');
      ev.push({ type: 'clash' });
    } else if (a === 'strike' && b === 'throw') {
      hurt(1, DMG.counter, 'counter');
    } else if (a === 'throw' && b === 'strike') {
      hurt(0, DMG.counter, 'counter');
    } else if (a === 'strike' && b === 'super') {
      hurt(1, DMG.armor, 'armor');
      hurt(0, DMG.super, 'super');
    } else if (a === 'super' && b === 'strike') {
      hurt(0, DMG.armor, 'armor');
      hurt(1, DMG.super, 'super');
    } else if (a === 'throw' && b === 'throw') {
      ev.push({ type: 'tech' });
    } else if (a === 'throw' && b === 'super') {
      throwHit(1);
    } else if (a === 'super' && b === 'throw') {
      throwHit(0);
    } else {
      // super vs super
      hurt(0, DMG.super, 'super');
      hurt(1, DMG.super, 'super');
    }
  } else if (r[0] || r[1]) {
    // 片方だけ届いた
    const atk: Side = r[0] ? 0 : 1;
    const def: Side = other(atk);
    const am = moves[atk] as 'strike' | 'throw' | 'super';
    const dm = moves[def];
    if (am === 'strike') {
      if (dm === 'guard') {
        // ガード成立：攻撃側に反撃 1、攻撃側が弾かれて 1 マス下がる
        ev.push({ type: 'block', side: def, pushedTo: f[def].pos, atWall: false });
        hurt(atk, DMG.reflect, 'reflect');
        pushBack(atk);
      } else if (dm === 'back') {
        hurt(def, DMG.strike, 'hit');
      } else {
        // forward / 空振りした攻撃 → カウンター
        hurt(def, DMG.counter, 'counter');
      }
    } else if (am === 'throw') {
      throwHit(def);
    } else {
      // super: ガード不能
      hurt(def, DMG.super, 'super');
    }
  } else {
    // 誰も届かなかった
    // 釣り：空振りを「立ってガード」で見切った側に +1（後退による回避は位置が報酬）
    if (isAttack(moves[0]) && moves[1] === 'guard') bait(1);
    if (isAttack(moves[1]) && moves[0] === 'guard') bait(0);
    // 投げ抜け：投げを後退で空振りさせた側にも +1
    if (moves[0] === 'throw' && moves[1] === 'back') bait(1);
    if (moves[1] === 'throw' && moves[0] === 'back') bait(0);
    // 圧力：受け身（ガード / 後退）の相手に前進した側に +1
    const passive = (m: Move) => m === 'guard' || m === 'back';
    if (moves[0] === 'forward' && passive(moves[1])) {
      gaugeDelta[0] += 1;
      ev.push({ type: 'gauge', side: 0, delta: 1, reason: 'pressure' });
    }
    if (moves[1] === 'forward' && passive(moves[0])) {
      gaugeDelta[1] += 1;
      ev.push({ type: 'gauge', side: 1, delta: 1, reason: 'pressure' });
    }
  }

  // ---- 適用 ---------------------------------------------------------------
  for (const side of [0, 1] as const) {
    if (spend[side]) {
      ev.push({ type: 'gauge', side, delta: -f[side].gauge, reason: 'spend' });
      f[side].gauge = 0;
    }
    f[side].gauge = clamp(f[side].gauge + gaugeDelta[side], 0, GAUGE_MAX);
    f[side].hp = Math.max(0, f[side].hp - dmg[side]);
  }
  s.beat = state.beat + 1;

  // ---- リング縮小 ---------------------------------------------------------
  if (shrinkPhase(s.beat) !== shrinkPhase(state.beat)) {
    const [nlo, nhi] = wallBounds(s.beat);
    const pushed: [number, number] = [f[0].pos, f[1].pos];
    // 偶奇（半マス）を保ったまま壁の内側へ。押された側が相手と重なるなら相手も押す
    if (f[0].pos < nlo) {
      f[0].pos = nlo + (f[0].pos & 1);
      if (f[1].pos - f[0].pos < CELL) f[1].pos = f[0].pos + CELL;
    }
    if (f[1].pos > nhi) {
      f[1].pos = nhi - (f[1].pos & 1);
      if (f[1].pos - f[0].pos < CELL) f[0].pos = f[1].pos - CELL;
    }
    ev.push({ type: 'shrink', lo: nlo, hi: nhi, from: pushed, to: [f[0].pos, f[1].pos] });
  }

  // ---- 決着判定 -----------------------------------------------------------
  let outcome: RoundOutcome = 'continue';
  const ko0 = f[0].hp <= 0;
  const ko1 = f[1].hp <= 0;
  if (ko0 && ko1) outcome = 'draw';
  else if (ko0) outcome = 'p1';
  else if (ko1) outcome = 'p0';
  else if (s.beat >= beatLimit) {
    outcome = f[0].hp > f[1].hp ? 'p0' : f[1].hp > f[0].hp ? 'p1' : 'draw';
  }
  if (ko0) ev.push({ type: 'ko', side: 0 });
  if (ko1) ev.push({ type: 'ko', side: 1 });

  return { next: s, events: ev, outcome, moves };
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** 表示用ラベル */
export const MOVE_LABEL: Record<Move, { ja: string; en: string; short: string }> = {
  strike: { ja: '打撃', en: 'STRIKE', short: '打' },
  throw: { ja: '投げ', en: 'THROW', short: '投' },
  guard: { ja: 'ガード', en: 'GUARD', short: 'ガ' },
  forward: { ja: '前進', en: 'STEP IN', short: '前' },
  back: { ja: '後退', en: 'STEP BACK', short: '後' },
  super: { ja: '必殺', en: 'SUPER', short: '必' },
};
