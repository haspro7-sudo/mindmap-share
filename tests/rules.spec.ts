import { describe, expect, it } from 'vitest';
import {
  ARENA_MAX,
  GAUGE_MAX,
  HP_MAX,
  SHRINK_EVERY,
  availableMoves,
  distanceCells,
  initialRound,
  resolveBeat,
  wallBounds,
} from '../src/engine/rules';
import type { Move, RoundState } from '../src/engine/types';

/** 距離 d（マス）で中央付近に配置した状態を作る */
function at(d: number, opts: { hp?: [number, number]; gauge?: [number, number]; pos0?: number } = {}): RoundState {
  const pos0 = opts.pos0 ?? Math.floor((ARENA_MAX - (d * 2 + 2)) / 2);
  const s = initialRound(opts.gauge ?? [0, 0]);
  s.fighters[0].pos = pos0;
  s.fighters[1].pos = pos0 + d * 2 + 2;
  if (opts.hp) {
    s.fighters[0].hp = opts.hp[0];
    s.fighters[1].hp = opts.hp[1];
  }
  return s;
}

const hp = (r: ReturnType<typeof resolveBeat>) => [r.next.fighters[0].hp, r.next.fighters[1].hp];
const gauge = (r: ReturnType<typeof resolveBeat>) => [r.next.fighters[0].gauge, r.next.fighters[1].gauge];

describe('初期状態と選択可能な手', () => {
  it('開始は中距離（d=2）', () => {
    expect(distanceCells(initialRound())).toBe(2);
  });
  it('密着では前進不可', () => {
    expect(availableMoves(at(0), 0)).not.toContain('forward');
    expect(availableMoves(at(1), 0)).toContain('forward');
  });
  it('壁際では後退不可', () => {
    expect(availableMoves(at(2, { pos0: 0 }), 0)).not.toContain('back');
    expect(availableMoves(at(2, { pos0: 2 }), 0)).toContain('back');
  });
  it('必殺はゲージ MAX のみ', () => {
    expect(availableMoves(at(1), 0)).not.toContain('super');
    expect(availableMoves(at(1, { gauge: [GAUGE_MAX, 0] }), 0)).toContain('super');
    expect(availableMoves(at(1, { gauge: [GAUGE_MAX, 0] }), 1)).not.toContain('super');
  });
  it('選べない手は guard に矯正される', () => {
    const r = resolveBeat(at(0), ['forward', 'guard']);
    expect(r.moves[0]).toBe('guard');
  });
});

describe('密着（d=0）', () => {
  it('打 vs 打 = 相打ち 1/1、両者ゲージ+1', () => {
    const r = resolveBeat(at(0), ['strike', 'strike']);
    expect(hp(r)).toEqual([HP_MAX - 1, HP_MAX - 1]);
    expect(gauge(r)).toEqual([1, 1]);
    expect(r.events.some((e) => e.type === 'clash')).toBe(true);
  });
  it('相打ちでは KO しない（HP1 で耐える）', () => {
    const r = resolveBeat(at(0, { hp: [1, 3] }), ['strike', 'strike']);
    expect(hp(r)).toEqual([1, 2]);
    expect(r.outcome).toBe('continue');
    expect(gauge(r)).toEqual([0, 1]);
  });
  it('打 vs 投 = 打勝ち、投げ側カウンター 2', () => {
    const r = resolveBeat(at(0), ['strike', 'throw']);
    expect(hp(r)).toEqual([HP_MAX, HP_MAX - 2]);
  });
  it('打 vs ガ = ガード成立、攻撃側に反撃1・攻撃側が1マス弾かれる', () => {
    const s = at(0);
    const r = resolveBeat(s, ['strike', 'guard']);
    expect(hp(r)).toEqual([HP_MAX - 1, HP_MAX]);
    expect(distanceCells(r.next)).toBe(1);
    expect(r.next.fighters[1].pos).toBe(s.fighters[1].pos);
    expect(gauge(r)).toEqual([1, 0]);
  });
  it('投 vs ガ = 崩し 3、相手1マス押し出し', () => {
    const r = resolveBeat(at(0), ['throw', 'guard']);
    expect(hp(r)).toEqual([HP_MAX, HP_MAX - 3]);
    expect(distanceCells(r.next)).toBe(1);
  });
  it('投 vs 前（密着では前進不可→ガード扱い）', () => {
    const r = resolveBeat(at(0), ['throw', 'forward']);
    expect(r.moves[1]).toBe('guard');
  });
  it('投 vs 後 = 投げ抜け（後退中は投げ無敵）、抜けた側にゲージ+1', () => {
    const r = resolveBeat(at(0), ['throw', 'back']);
    expect(hp(r)).toEqual([HP_MAX, HP_MAX]);
    expect(gauge(r)).toEqual([0, 1]);
    expect(r.events.some((e) => e.type === 'escape')).toBe(true);
  });
  it('打 vs 後 = 後退しても届く（1ダメ）', () => {
    const r = resolveBeat(at(0), ['strike', 'back']);
    expect(hp(r)).toEqual([HP_MAX, HP_MAX - 1]);
    expect(distanceCells(r.next)).toBe(1);
  });
  it('投 vs 投 = 投げ抜け', () => {
    const r = resolveBeat(at(0), ['throw', 'throw']);
    expect(hp(r)).toEqual([HP_MAX, HP_MAX]);
    expect(r.events.some((e) => e.type === 'tech')).toBe(true);
  });
  it('壁際で投げられると壁ドン +1', () => {
    const s = at(0, { pos0: ARENA_MAX - 2 }); // P1 が壁
    const r = resolveBeat(s, ['throw', 'guard']);
    expect(hp(r)).toEqual([HP_MAX, HP_MAX - 4]);
    expect(r.next.fighters[1].pos).toBe(ARENA_MAX);
  });
  it('壁際の攻撃側はガードに弾かれても動かない', () => {
    const s = at(0, { pos0: 0 }); // P0 が壁
    const r = resolveBeat(s, ['strike', 'guard']);
    expect(hp(r)).toEqual([HP_MAX - 1, HP_MAX]);
    expect(distanceCells(r.next)).toBe(0);
  });
});

describe('近距離（d=1）', () => {
  it('打 vs 投 = 踏み込み投げが密着に入るが打勝ち', () => {
    const r = resolveBeat(at(1), ['strike', 'throw']);
    expect(hp(r)).toEqual([HP_MAX, HP_MAX - 2]);
    expect(distanceCells(r.next)).toBe(0);
  });
  it('投 vs ガ = 踏み込み投げで崩し 3', () => {
    const r = resolveBeat(at(1), ['throw', 'guard']);
    expect(hp(r)).toEqual([HP_MAX, HP_MAX - 3]);
  });
  it('投 vs 前 = 前進側が掴まれる', () => {
    const r = resolveBeat(at(1), ['throw', 'forward']);
    expect(hp(r)).toEqual([HP_MAX, HP_MAX - 2]);
  });
  it('打 vs 前 = 前進側カウンター 2', () => {
    const r = resolveBeat(at(1), ['strike', 'forward']);
    expect(hp(r)).toEqual([HP_MAX, HP_MAX - 2]);
    expect(distanceCells(r.next)).toBe(0);
  });
  it('打 vs 後 = 空振り（後退には釣り報酬なし）', () => {
    const r = resolveBeat(at(1), ['strike', 'back']);
    expect(hp(r)).toEqual([HP_MAX, HP_MAX]);
    expect(gauge(r)).toEqual([0, 0]);
  });
  it('打 vs ガ（空振り）= 立って見切ったガード側に釣りゲージ+1', () => {
    const r = resolveBeat(at(2), ['strike', 'guard']);
    expect(gauge(r)).toEqual([0, 1]);
  });
  it('前 vs ガ = 前進側に圧力ゲージ+1', () => {
    const r = resolveBeat(at(2), ['forward', 'guard']);
    expect(gauge(r)).toEqual([1, 0]);
    expect(distanceCells(r.next)).toBe(1);
  });
  it('前 vs 後 = 前進側に圧力ゲージ+1、距離不変', () => {
    const r = resolveBeat(at(1), ['forward', 'back']);
    expect(gauge(r)).toEqual([1, 0]);
    expect(distanceCells(r.next)).toBe(1);
  });
  it('前 vs 前 = 衝突して密着（半マスずつ）', () => {
    const s = at(1);
    const r = resolveBeat(s, ['forward', 'forward']);
    expect(distanceCells(r.next)).toBe(0);
    expect(r.next.fighters[0].pos).toBe(s.fighters[0].pos + 1);
    expect(r.next.fighters[1].pos).toBe(s.fighters[1].pos - 1);
  });
  it('投 vs 投 = 両者踏み込んで投げ抜け', () => {
    const r = resolveBeat(at(1), ['throw', 'throw']);
    expect(hp(r)).toEqual([HP_MAX, HP_MAX]);
    expect(distanceCells(r.next)).toBe(0);
  });
});

describe('遠距離（d=3）', () => {
  it('投げは踏み込まない（前進が唯一の接近手段）', () => {
    const r = resolveBeat(at(3), ['throw', 'guard']);
    expect(distanceCells(r.next)).toBe(3);
    expect(gauge(r)).toEqual([0, 1]);
  });
});

describe('中距離（d=2）', () => {
  it('打 vs 打 = 両者空振り（ゲージ変化なし）', () => {
    const r = resolveBeat(at(2), ['strike', 'strike']);
    expect(hp(r)).toEqual([HP_MAX, HP_MAX]);
    expect(gauge(r)).toEqual([0, 0]);
  });
  it('打 vs 前 = 差し込み（カウンター 2）', () => {
    const r = resolveBeat(at(2), ['strike', 'forward']);
    expect(hp(r)).toEqual([HP_MAX, HP_MAX - 2]);
  });
  it('打 vs 投 = 踏み込んだ投げが打に刺さる', () => {
    const r = resolveBeat(at(2), ['strike', 'throw']);
    expect(hp(r)).toEqual([HP_MAX, HP_MAX - 2]);
  });
  it('打 vs ガ = 空振りでガード側ゲージ+1（見切り）', () => {
    const r = resolveBeat(at(2), ['strike', 'guard']);
    expect(hp(r)).toEqual([HP_MAX, HP_MAX]);
    expect(gauge(r)).toEqual([0, 1]);
  });
  it('投 vs 前 = 密着になり投げ成立', () => {
    const r = resolveBeat(at(2), ['throw', 'forward']);
    expect(hp(r)).toEqual([HP_MAX, HP_MAX - 2]);
  });
});

describe('必殺', () => {
  const G: [number, number] = [GAUGE_MAX, 0];
  it('ガード不能 3ダメ、ゲージ消費', () => {
    const r = resolveBeat(at(1, { gauge: G }), ['super', 'guard']);
    expect(hp(r)).toEqual([HP_MAX, HP_MAX - 3]);
    expect(gauge(r)).toEqual([0, 1]);
  });
  it('打撃をアーマーで受けて通す（自分は 1 ダメ）', () => {
    const r = resolveBeat(at(1, { gauge: G }), ['super', 'strike']);
    expect(hp(r)).toEqual([HP_MAX - 1, HP_MAX - 3]);
  });
  it('密着の投げには負ける', () => {
    const r = resolveBeat(at(0, { gauge: G }), ['super', 'throw']);
    expect(hp(r)).toEqual([HP_MAX - 2, HP_MAX]);
    expect(r.next.fighters[0].gauge).toBe(1); // 消費後に被弾+1
  });
  it('中距離（d=2）まで届く、後退されると空振り', () => {
    expect(hp(resolveBeat(at(2, { gauge: G }), ['super', 'guard']))).toEqual([HP_MAX, HP_MAX - 3]);
    const r = resolveBeat(at(2, { gauge: G }), ['super', 'back']);
    expect(hp(r)).toEqual([HP_MAX, HP_MAX]);
    expect(gauge(r)).toEqual([0, 0]);
  });
});

describe('リング縮小', () => {
  it('SHRINK_EVERY 拍ごとに壁が1マスずつ迫る', () => {
    expect(wallBounds(0)).toEqual([0, ARENA_MAX]);
    expect(wallBounds(SHRINK_EVERY - 1)).toEqual([0, ARENA_MAX]);
    expect(wallBounds(SHRINK_EVERY)).toEqual([2, ARENA_MAX - 2]);
    expect(wallBounds(SHRINK_EVERY * 3)).toEqual([6, ARENA_MAX - 6]);
    expect(wallBounds(100)).toEqual([6, ARENA_MAX - 6]);
  });
  it('壁の外にいると押し込まれる（半マスの偶奇は保存）', () => {
    const s = at(4, { pos0: 1 }); // P0=1, P1=11
    s.beat = SHRINK_EVERY - 1;
    const r = resolveBeat(s, ['guard', 'guard']);
    expect(r.next.beat).toBe(SHRINK_EVERY);
    expect(r.next.fighters[0].pos).toBe(3);
    expect(r.next.fighters[1].pos).toBe(11);
    expect(r.events.some((e) => e.type === 'shrink')).toBe(true);
    expect(Number.isInteger(distanceCells(r.next))).toBe(true);
  });
  it('縮小後は新しい壁で後退不可になる', () => {
    const s = at(2, { pos0: 2 });
    s.beat = SHRINK_EVERY;
    expect(availableMoves(s, 0)).not.toContain('back');
  });
});

describe('決着', () => {
  it('HP 0 で KO', () => {
    const r = resolveBeat(at(0, { hp: [HP_MAX, 1] }), ['strike', 'back']);
    expect(r.outcome).toBe('p0');
    const r2 = resolveBeat(at(0, { hp: [HP_MAX, 1] }), ['strike', 'throw']);
    expect(r2.outcome).toBe('p0');
    expect(r2.events.some((e) => e.type === 'ko')).toBe(true);
  });
  it('必殺同士で両者 0 は引き分け', () => {
    const r = resolveBeat(at(1, { hp: [3, 3], gauge: [GAUGE_MAX, GAUGE_MAX] }), ['super', 'super']);
    expect(r.outcome).toBe('draw');
  });
  it('拍数上限で HP の多い方が勝ち', () => {
    const s = at(3, { hp: [4, 3] });
    s.beat = 23;
    expect(resolveBeat(s, ['guard', 'guard'], 24).outcome).toBe('p0');
    const t = at(3, { hp: [3, 3] });
    t.beat = 23;
    expect(resolveBeat(t, ['guard', 'guard'], 24).outcome).toBe('draw');
  });
});

describe('全組み合わせの健全性', () => {
  it('どの状態・手でも HP/座標/ゲージが範囲内', () => {
    const moves: Move[] = ['strike', 'throw', 'guard', 'forward', 'back', 'super'];
    for (let d = 0; d <= 4; d++) {
      for (const pos0 of [0, 1, 2, 6, ARENA_MAX - 2 - d * 2 - 1, ARENA_MAX - 2 - d * 2]) {
        if (pos0 < 0) continue;
        for (const g of [0, GAUGE_MAX] as const)
        for (const beat of [0, SHRINK_EVERY - 1, SHRINK_EVERY * 2 - 1, SHRINK_EVERY * 3 - 1, 23]) {
          const [lo, hi] = wallBounds(beat);
          const p0 = Math.min(Math.max(pos0, lo), hi - d * 2 - 2);
          if (p0 < lo) continue;
          const s = at(d, { pos0: p0, gauge: [g, g] });
          s.beat = beat;
          for (const m0 of moves)
            for (const m1 of moves) {
              const r = resolveBeat(s, [m0, m1]);
              for (const f of r.next.fighters) {
                expect(f.hp).toBeGreaterThanOrEqual(0);
                expect(f.pos).toBeGreaterThanOrEqual(0);
                expect(f.pos).toBeLessThanOrEqual(ARENA_MAX);
                expect(f.gauge).toBeGreaterThanOrEqual(0);
                expect(f.gauge).toBeLessThanOrEqual(GAUGE_MAX);
              }
              expect(r.next.fighters[1].pos - r.next.fighters[0].pos).toBeGreaterThanOrEqual(2);
              expect(Number.isInteger(distanceCells(r.next))).toBe(true);
            }
        }
      }
    }
  });
});
