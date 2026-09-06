/**
 * 試合シーン：SELECT（同時選択）→ RESOLVE（演出）→ ラウンド/試合の決着。
 */
import { audio } from '../audio';
import { createBrain, type BeatRecord, type CpuBrain } from '../engine/cpu';
import { Match } from '../engine/match';
import {
  GAUGE_MAX,
  HP_MAX,
  SHRINK_EVERY,
  SHRINK_MAX_PHASE,
  availableMoves,
  distanceCells,
  rangeOf,
  shrinkPhase,
  wallBounds,
} from '../engine/rules';
import type { BeatEvent, BeatResult, Move, Side } from '../engine/types';
import type { Input } from '../input';
import { Effects } from '../render/effects';
import { buttonLayout, drawButtons, drawCenterInfo, drawFighterHud, drawReady, drawTimer, roundRect, text } from '../render/hud';
import { drawBackground, drawFloor, drawShadow, type StageView } from '../render/stage';
import { BASE, POSES, drawStickman, lerpPose, type Pose } from '../render/stickman';
import { FLOOR_Y, H, MOVE_COLOR, THEME, W, playerColor, posToX } from '../render/theme';
import type { App, GameMode, ResultSummary, Scene } from './scene';

type Phase = 'intro' | 'select' | 'resolve' | 'roundEnd' | 'matchEnd';

const SELECT_SECONDS = 3.0;
const T_MOVE = 0.25;
const T_STRIKE = 0.4;
const T_THROW = 0.6;
const T_SUPER = 0.55;
const T_END = 1.25;

interface FighterView {
  x: number;
  pose: Pose;
  glow: number;
  alpha: number;
  hpShown: number;
  facing: 1 | -1;
}

interface Tween {
  t0: number;
  t1: number;
  /** 最初に有効になったフレームで現在値を捕捉して補間 */
  apply: (k: number, first: boolean) => void;
  started: boolean;
}

interface Cue {
  t: number;
  fn: () => void;
  done: boolean;
}

const ease = {
  out: (k: number) => 1 - (1 - k) * (1 - k),
  in: (k: number) => k * k,
  inOut: (k: number) => (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2),
};

const RANGE_LABEL = {
  close: ['密着', '打◯ 投◯'],
  near: ['近距離', '打◯ 投→踏み込み'],
  mid: ['中距離', '打✕ 投→踏み込み'],
  far: ['遠距離', '前進で詰めろ'],
} as const;

export class MatchScene implements Scene {
  private match: Match;
  private phase: Phase = 'intro';
  private phaseT = 0;
  private t = 0;
  private fx = new Effects();
  private view: [FighterView, FighterView];
  private stage: StageView;
  private locked: [Move | null, Move | null] = [null, null];
  private cpu: CpuBrain | null;
  private cpuDelay = 0;
  private timer = SELECT_SECONDS;
  private tweens: Tween[] = [];
  private cues: Cue[] = [];
  private resolveT = 0;
  private resolveEnd = T_END;
  private lastResult: BeatResult | null = null;
  private introText = '';
  private roundEndText = '';
  private winnerSide: 0 | 1 | null = null;
  private gaugeFlash = 0;
  private names: [string, string];
  private stats: ResultSummary['stats'] = {
    beats: 0,
    rounds: 0,
    counters: [0, 0],
    supers: [0, 0],
    blocks: [0, 0],
    throws: [0, 0],
    perfect: [0, 0],
  };
  private hint = '';
  private hintT = 0;

  constructor(
    private app: App,
    private mode: GameMode,
  ) {
    this.match = new Match();
    this.cpu = mode.kind === 'cpu' ? createBrain(mode.difficulty) : null;
    this.names = mode.kind === 'cpu' ? ['1P', `CPU (${this.cpu!.name})`] : ['1P', '2P'];
    const s = this.match.round;
    this.view = [
      { x: posToX(s.fighters[0].pos), pose: BASE, glow: 0, alpha: 1, hpShown: HP_MAX, facing: 1 },
      { x: posToX(s.fighters[1].pos), pose: BASE, glow: 0, alpha: 1, hpShown: HP_MAX, facing: -1 },
    ];
    const [lo, hi] = wallBounds(0);
    this.stage = { wallLo: lo, wallHi: hi, warn: 0 };
    this.startIntro();
  }

  // -------------------------------------------------------------------------
  // フェーズ遷移
  // -------------------------------------------------------------------------

  private startIntro() {
    this.phase = 'intro';
    this.phaseT = 0;
    this.introText = `ROUND ${this.match.roundIndex + 1}`;
    this.locked = [null, null];
    audio.play('round');
  }

  private startSelect() {
    this.phase = 'select';
    this.phaseT = 0;
    this.timer = SELECT_SECONDS;
    this.locked = [null, null];
    this.cpuDelay = 0.5 + Math.random() * 1.4;
    const d = distanceCells(this.match.round);
    const r = rangeOf(d);
    this.hint = RANGE_LABEL[r][1];
    this.hintT = 0;
  }

  private lock(side: Side, move: Move) {
    if (this.phase !== 'select' || this.locked[side] !== null) return;
    if (!availableMoves(this.match.round, side).includes(move)) return;
    this.locked[side] = move;
    audio.play('lock');
    if (this.locked[0] !== null && this.locked[1] !== null) this.startResolve();
  }

  private startResolve() {
    const s = this.match.round;
    const moves: [Move, Move] = [this.locked[0] ?? 'guard', this.locked[1] ?? 'guard'];
    const result = this.match.step(moves);
    this.lastResult = result;
    this.phase = 'resolve';
    this.phaseT = 0;
    this.resolveT = 0;
    this.buildTimeline(s.fighters.map((f) => f.pos) as [number, number], result);
  }

  private endResolve() {
    const result = this.lastResult!;
    if (result.outcome === 'continue') {
      this.startSelect();
      return;
    }
    this.phase = 'roundEnd';
    this.phaseT = 0;
    this.stats.rounds += 1;
    const w = result.outcome === 'p0' ? 0 : result.outcome === 'p1' ? 1 : null;
    this.winnerSide = w;
    const timeUp = result.next.beat >= this.match.config.beatLimit && result.next.fighters[0].hp > 0 && result.next.fighters[1].hp > 0;
    if (w === null) this.roundEndText = 'DRAW';
    else if (timeUp) this.roundEndText = 'TIME UP';
    else this.roundEndText = 'K.O.';
    if (w !== null) {
      const summary = this.match.rounds[this.match.rounds.length - 1];
      if (summary.perfect) this.stats.perfect[w] += 1;
    }
  }

  private finishMatch() {
    this.stats.beats = this.match.allHistory.length;
    this.app.goResult({
      mode: this.mode,
      winner: this.match.winner,
      scores: [...this.match.scores] as [number, number],
      names: this.names,
      stats: this.stats,
    });
  }

  // -------------------------------------------------------------------------
  // 演出タイムライン
  // -------------------------------------------------------------------------

  private tween(t0: number, t1: number, apply: (k: number, first: boolean) => void) {
    this.tweens.push({ t0, t1, apply, started: false });
  }

  private cue(t: number, fn: () => void) {
    this.cues.push({ t, fn, done: false });
  }

  private poseTween(side: Side, t0: number, t1: number, to: Pose | ((k: number) => Pose), easing = ease.out) {
    let from: Pose = BASE;
    this.tween(t0, t1, (k, first) => {
      if (first) from = this.view[side].pose;
      const target = typeof to === 'function' ? to(k) : to;
      this.view[side].pose = typeof to === 'function' ? target : lerpPose(from, target, easing(k));
    });
  }

  private posTween(side: Side, t0: number, t1: number, toPos: number, easing = ease.out) {
    let from = 0;
    this.tween(t0, t1, (k, first) => {
      if (first) from = this.view[side].x;
      this.view[side].x = from + (posToX(toPos) - from) * easing(k);
    });
  }

  private buildTimeline(startPos: [number, number], result: BeatResult) {
    this.tweens = [];
    this.cues = [];
    const ev = result.events;
    const moves = result.moves;
    const fx = this.fx;
    let end = T_END;
    const hitAt: [number, number] = [0, 0]; // 各側が被弾する時刻（0 = なし）
    const dmgOf: [number, number] = [0, 0];

    // 攻撃側の時刻を先に決める
    const impactTime = (m: Move) => (m === 'strike' ? T_STRIKE : m === 'throw' ? T_THROW : m === 'super' ? T_SUPER : 0);

    // --- 移動 ---
    for (const e of ev) {
      if (e.type === 'move') {
        const side = e.side;
        this.posTween(side, 0, T_MOVE, e.to);
        if (e.dir === 'back') {
          this.poseTween(side, 0, 0.12, POSES.backstep);
          this.poseTween(side, T_MOVE, T_MOVE + 0.25, POSES.idle(0));
        } else if (moves[side] === 'forward') {
          this.poseTween(side, 0, T_MOVE, (k) => POSES.walk(k));
          this.poseTween(side, T_MOVE, T_MOVE + 0.2, POSES.idle(0));
        }
        this.cue(0, () => audio.play('whoosh'));
      }
    }

    // --- 攻撃モーション ---
    for (const side of [0, 1] as const) {
      const m = moves[side];
      const opp = side === 0 ? 1 : 0;
      const atk = ev.find((e): e is Extract<BeatEvent, { type: 'attack' }> => e.type === 'attack' && e.side === side);
      if (m === 'strike') {
        this.poseTween(side, 0, 0.22, POSES.strikeWind);
        this.poseTween(side, 0.22, T_STRIKE, POSES.strikeHit, ease.in);
        this.poseTween(side, 0.75, 1.05, POSES.idle(0));
        this.cue(0.22, () => audio.play('whoosh'));
        if (atk && !atk.hit) this.cue(T_STRIKE, () => this.popupAt(side, '空振り', THEME.dim, 18));
      } else if (m === 'throw') {
        this.poseTween(side, 0, T_MOVE + 0.1, POSES.throwGrab);
        if (atk?.hit) {
          this.poseTween(side, 0.42, T_THROW, POSES.throwSlam, ease.in);
          this.poseTween(side, 0.9, 1.15, POSES.idle(0));
          this.cue(0.42, () => audio.play('throw'));
        } else {
          this.poseTween(side, 0.5, 0.9, POSES.idle(0));
          this.cue(T_MOVE, () => audio.play('whoosh'));
          const escaped = ev.some((e) => e.type === 'escape' && e.side === opp);
          this.cue(0.45, () => this.popupAt(side, escaped ? '投げ抜け!' : '空振り', escaped ? THEME.throw : THEME.dim, escaped ? 22 : 18));
          if (escaped) this.cue(0.45, () => audio.play('escape'));
        }
      } else if (m === 'guard') {
        this.poseTween(side, 0, 0.15, POSES.guard);
        this.poseTween(side, 0.85, 1.1, POSES.idle(0));
      } else if (m === 'super') {
        this.poseTween(side, 0, 0.3, POSES.superWind);
        this.poseTween(side, 0.3, T_SUPER, POSES.superHit, ease.in);
        this.poseTween(side, 0.95, 1.2, POSES.idle(0));
        this.cue(0, () => {
          audio.play('super');
          fx.flashScreen(THEME.super, 0.18);
          fx.slow(0.55, 0.45);
          this.view[side].glow = 1.5;
          this.popupAt(side, '必殺!', THEME.super, 34);
        });
        this.cue(T_SUPER, () => {
          this.view[side].glow = 0;
        });
        if (atk && !atk.hit) this.cue(T_SUPER + 0.05, () => this.popupAt(side, '空振り', THEME.dim, 18));
      }
    }

    // --- 被弾・ガード・押し出し ---
    for (const e of ev) {
      if (e.type === 'damage') {
        const victim = e.side;
        const attacker: Side = victim === 0 ? 1 : 0;
        const am = moves[attacker];
        // 相打ちは相手の打撃時刻、それ以外は攻撃側の技の時刻
        const tImpact = e.kind === 'armor' ? T_STRIKE : impactTime(am) || T_STRIKE;
        hitAt[victim] = Math.max(hitAt[victim], tImpact);
        dmgOf[victim] += e.amount;
        const kind = e.kind;
        this.cue(tImpact, () => {
          const v = this.view[victim];
          const vx = v.x;
          const vy = FLOOR_Y - 90;
          const color = MOVE_COLOR[am === 'guard' || am === 'forward' || am === 'back' ? 'strike' : am];
          if (kind === 'super') {
            fx.burst(vx, vy, THEME.super, 30, 420, 5);
            fx.spark(vx, vy, THEME.fg);
            fx.shakeScreen(16, 6);
            fx.stop(160);
            fx.flashScreen('#ffffff', 0.08);
            audio.play('superhit');
            this.popupAt(victim, `-${e.amount}`, THEME.super, 40);
          } else if (kind === 'counter') {
            fx.burst(vx, vy, THEME.strike, 22, 340, 4);
            fx.spark(vx, vy, THEME.fg);
            fx.shakeScreen(11, 7);
            fx.stop(120);
            audio.play('counter');
            this.popupAt(victim, 'COUNTER!', THEME.strike, 28, -30);
            this.popupAt(victim, `-${e.amount}`, THEME.fg, 30);
          } else if (kind === 'throw' || kind === 'crush') {
            fx.burst(vx, FLOOR_Y - 20, THEME.throw, 18, 260, 4);
            fx.shakeScreen(10, 7);
            fx.stop(100);
            audio.play('slam');
            if (kind === 'crush') this.popupAt(victim, '崩し!', THEME.throw, 26, -30);
            this.popupAt(victim, `-${e.amount}`, THEME.fg, 30);
          } else if (kind === 'wallslam') {
            fx.burst(vx, vy, THEME.danger, 26, 380, 5);
            fx.shakeScreen(14, 6);
            fx.stop(120);
            this.popupAt(victim, `壁ドン! -${e.amount}`, THEME.danger, 26, -60);
          } else if (kind === 'armor') {
            fx.spark(vx, vy, THEME.super);
            this.popupAt(victim, 'アーマー', THEME.super, 18, -30);
            audio.play('block');
          } else if (kind === 'reflect') {
            fx.spark(vx, vy, THEME.guard);
            this.popupAt(victim, `反撃 -${e.amount}`, THEME.guard, 22);
          } else {
            fx.burst(vx, vy, color, 14, 260, 4);
            fx.shakeScreen(6, 8);
            fx.stop(70);
            audio.play('hit');
            this.popupAt(victim, `-${e.amount}`, THEME.fg, 26);
            if (kind === 'trade') this.popupAt(victim, '相打ち', THEME.dim, 16, -30);
          }
          if (attacker === 0 || attacker === 1) {
            if (kind === 'counter') this.stats.counters[attacker] += 1;
            if (kind === 'super') this.stats.supers[attacker] += 1;
            if (kind === 'throw' || kind === 'crush') this.stats.throws[attacker] += 1;
          }
        });
      } else if (e.type === 'block') {
        const side = e.side;
        this.cue(T_STRIKE, () => {
          const v = this.view[side];
          fx.spark(v.x + 20 * v.facing, FLOOR_Y - 95, THEME.guard);
          fx.shakeScreen(4, 10);
          fx.stop(60);
          audio.play('block');
          this.popupAt(side, 'GUARD', THEME.guard, 22);
          this.stats.blocks[side] += 1;
        });
        // ガード反動
        this.poseTween(side, T_STRIKE, T_STRIKE + 0.08, { ...POSES.guard, dx: -8, lean: -0.05 });
        this.poseTween(side, T_STRIKE + 0.2, T_STRIKE + 0.5, POSES.guard);
      } else if (e.type === 'push') {
        const side = e.side;
        const am = moves[side === 0 ? 1 : 0];
        const t0 = impactTime(am) || T_STRIKE;
        this.posTween(side, t0 + 0.02, t0 + 0.3, e.to);
      } else if (e.type === 'tech') {
        this.cue(T_THROW - 0.15, () => {
          const cx = (this.view[0].x + this.view[1].x) / 2;
          fx.spark(cx, FLOOR_Y - 80, THEME.throw);
          audio.play('escape');
          fx.popup(cx, FLOOR_Y - 150, '投げ抜け', THEME.throw, 24);
        });
        for (const side of [0, 1] as const) {
          this.poseTween(side, T_THROW - 0.15, T_THROW, { ...POSES.throwGrab, dx: -6 });
          this.poseTween(side, 0.8, 1.05, POSES.idle(0));
        }
      } else if (e.type === 'clash') {
        this.cue(T_STRIKE, () => {
          const cx = (this.view[0].x + this.view[1].x) / 2;
          fx.spark(cx, FLOOR_Y - 95, THEME.fg);
          fx.flashScreen('#ffffff', 0.05);
          audio.play('clash');
        });
        for (const side of [0, 1] as const) this.poseTween(side, T_STRIKE, T_STRIKE + 0.1, POSES.clash);
      } else if (e.type === 'gauge') {
        const side = e.side;
        if (e.reason === 'spend') continue;
        const label = e.reason === 'bait' ? '見切り +1' : e.reason === 'pressure' ? '圧力 +1' : null;
        const tg = e.reason === 'hit' ? Math.max(T_STRIKE, hitAt[side]) + 0.15 : 0.7;
        this.cue(tg, () => {
          audio.play('gauge');
          if (label) this.popupAt(side, label, THEME.super, 16, -70, 0.8);
          const g = this.match.round.fighters[side].gauge;
          if (g >= GAUGE_MAX) {
            this.gaugeFlash = 1;
            this.popupAt(side, 'SUPER READY', THEME.super, 22, -95);
          }
        });
      }
    }

    // 被弾ポーズ（時刻が確定してから）
    for (const side of [0, 1] as const) {
      if (dmgOf[side] <= 0) continue;
      const tImpact = hitAt[side];
      const opp: Side = side === 0 ? 1 : 0;
      const am = moves[opp];
      const ko = ev.some((e) => e.type === 'ko' && e.side === side);
      if (am === 'throw' && ev.some((e) => e.type === 'damage' && e.side === side && (e.kind === 'throw' || e.kind === 'crush'))) {
        this.poseTween(side, 0.42, T_THROW, { ...POSES.hurt, crouch: -10, dy: -20 }, ease.out);
        this.poseTween(side, T_THROW, T_THROW + 0.15, POSES.thrown, ease.out);
        this.poseTween(side, T_THROW + 0.15, T_THROW + 0.35, ko ? POSES.ko : { ...POSES.hurt, crouch: 20 }, ease.in);
        if (!ko) this.poseTween(side, 1.0, 1.25, POSES.idle(0));
      } else if (am === 'super' && ev.some((e) => e.type === 'damage' && e.side === side && e.kind === 'super')) {
        this.poseTween(side, tImpact, tImpact + 0.12, { ...POSES.thrown, dx: -40, crouch: -20 });
        this.poseTween(side, tImpact + 0.12, tImpact + 0.45, ko ? POSES.ko : { ...POSES.hurt, dx: -30 }, ease.in);
        if (!ko) this.poseTween(side, 1.05, 1.25, POSES.idle(0));
      } else {
        this.poseTween(side, tImpact, tImpact + 0.08, POSES.hurt);
        if (ko) this.poseTween(side, tImpact + 0.25, tImpact + 0.6, POSES.ko, ease.in);
        else this.poseTween(side, tImpact + 0.45, tImpact + 0.75, POSES.idle(0));
      }
      // HP バー減少
      const target = result.next.fighters[side].hp;
      this.tween(tImpact, tImpact + 0.3, (k, first) => {
        void first;
        const from = this.view[side].hpShown;
        this.view[side].hpShown = from + (target - from) * Math.min(1, k * 1.5);
      });
    }

    // --- リング縮小 ---
    const shrink = ev.find((e): e is Extract<BeatEvent, { type: 'shrink' }> => e.type === 'shrink');
    if (shrink) {
      const t0 = end - 0.1;
      end += 0.55;
      this.cue(t0, () => {
        audio.play('shrink');
        fx.shakeScreen(8, 4);
        fx.popup(W / 2, 200, 'リング縮小!', THEME.danger, 30, 30, 1.0);
      });
      const fromLo = this.stage.wallLo;
      const fromHi = this.stage.wallHi;
      this.tween(t0, t0 + 0.45, (k) => {
        const e2 = ease.inOut(k);
        this.stage.wallLo = fromLo + (shrink.lo - fromLo) * e2;
        this.stage.wallHi = fromHi + (shrink.hi - fromHi) * e2;
      });
      for (const side of [0, 1] as const) {
        if (shrink.from[side] !== shrink.to[side]) this.posTween(side, t0 + 0.1, t0 + 0.45, shrink.to[side], ease.inOut);
      }
    }

    // --- KO ---
    const ko = ev.filter((e): e is Extract<BeatEvent, { type: 'ko' }> => e.type === 'ko');
    if (ko.length > 0) {
      const tKo = Math.max(...ko.map((k) => hitAt[k.side])) + 0.05;
      end = Math.max(end, tKo + 1.6);
      this.cue(tKo, () => {
        audio.play('ko');
        fx.shakeScreen(18, 5);
        fx.slow(0.35, 0.8);
        fx.flashScreen('#ffffff', 0.1);
      });
      if (result.outcome !== 'draw') {
        const w: Side = result.outcome === 'p0' ? 0 : 1;
        this.poseTween(w, tKo + 0.6, tKo + 0.9, POSES.win(0));
      }
    } else if (result.outcome !== 'continue') {
      end = Math.max(end, T_END + 0.4);
    }

    // 終了時の位置を確定（安全弁）
    this.cue(end - 0.01, () => {
      this.view[0].x = posToX(result.next.fighters[0].pos);
      this.view[1].x = posToX(result.next.fighters[1].pos);
      const [lo, hi] = wallBounds(result.next.beat);
      this.stage.wallLo = lo;
      this.stage.wallHi = hi;
    });
    this.resolveEnd = end;
    void startPos;
  }

  private popupAt(side: Side, s: string, color: string, size = 24, yOff = 0, duration = 0.9) {
    const v = this.view[side];
    this.fx.popup(v.x, FLOOR_Y - 190 + yOff, s, color, size, 36, duration);
  }

  // -------------------------------------------------------------------------
  // 更新
  // -------------------------------------------------------------------------

  update(dt: number, input: Input): void {
    this.t += dt;
    this.gaugeFlash = Math.max(0, this.gaugeFlash - dt * 1.5);
    this.hintT += dt;

    // ヒットストップ
    if (this.fx.hitStop > 0) {
      this.fx.hitStop -= dt;
      this.fx.update(dt * 0.15);
      return;
    }
    const sdt = dt * this.fx.timeScale;
    this.fx.update(sdt);
    this.phaseT += sdt;

    // 壁警告
    const beat = this.match.round.beat;
    const phaseNow = shrinkPhase(beat);
    const beatsToShrink = phaseNow >= SHRINK_MAX_PHASE ? null : (phaseNow + 1) * SHRINK_EVERY - beat;
    this.stage.warn = beatsToShrink !== null && beatsToShrink <= 1 && this.phase === 'select' ? 1 : 0;

    switch (this.phase) {
      case 'intro': {
        if (this.phaseT > 0.9 && this.introText !== 'FIGHT!') {
          this.introText = 'FIGHT!';
          audio.play('lock');
        }
        if (this.phaseT > 1.5) this.startSelect();
        this.idle(sdt);
        break;
      }
      case 'select': {
        this.idle(sdt);
        this.timer -= dt;
        // 人間入力
        this.handleHuman(0, input);
        if (this.mode.kind === '2p') this.handleHuman(1, input);
        // CPU
        if (this.cpu && this.locked[1] === null) {
          this.cpuDelay -= dt;
          if (this.cpuDelay <= 0) {
            const history: BeatRecord[] = this.match.allHistory;
            const m = this.cpu.choose(this.match.round, 1, history, this.match.config.beatLimit);
            this.lock(1, m);
          }
        }
        if (this.phase === 'select' && this.timer <= 0) {
          // タイムアウト：未選択はガード
          for (const side of [0, 1] as const) if (this.locked[side] === null) this.locked[side] = 'guard';
          this.startResolve();
        }
        break;
      }
      case 'resolve': {
        this.resolveT += sdt;
        for (const tw of this.tweens) {
          if (this.resolveT < tw.t0) continue;
          const k = Math.min(1, (this.resolveT - tw.t0) / Math.max(1e-6, tw.t1 - tw.t0));
          const first = !tw.started;
          tw.started = true;
          tw.apply(k, first);
        }
        for (const c of this.cues) {
          if (!c.done && this.resolveT >= c.t) {
            c.done = true;
            c.fn();
          }
        }
        if (this.resolveT >= this.resolveEnd) this.endResolve();
        break;
      }
      case 'roundEnd': {
        if (this.winnerSide !== null) this.view[this.winnerSide].pose = POSES.win(this.t);
        if (this.phaseT > 2.2) {
          if (this.match.winner !== null) {
            this.phase = 'matchEnd';
            this.phaseT = 0;
          } else {
            this.match.nextRound();
            this.resetRoundView();
            this.startIntro();
          }
        }
        break;
      }
      case 'matchEnd': {
        if (this.winnerSide !== null) this.view[this.winnerSide].pose = POSES.win(this.t);
        if (this.phaseT > 1.2 || (this.phaseT > 0.3 && input.anyPressed())) this.finishMatch();
        break;
      }
    }
  }

  private resetRoundView() {
    const s = this.match.round;
    this.fx.clear();
    for (const side of [0, 1] as const) {
      this.view[side].x = posToX(s.fighters[side].pos);
      this.view[side].pose = BASE;
      this.view[side].hpShown = HP_MAX;
      this.view[side].glow = 0;
    }
    const [lo, hi] = wallBounds(0);
    this.stage.wallLo = lo;
    this.stage.wallHi = hi;
  }

  private idle(dt: number) {
    void dt;
    for (const side of [0, 1] as const) {
      const ph = (this.t * 0.6 + side * 0.5) % 1;
      this.view[side].pose = lerpPose(this.view[side].pose, POSES.idle(ph), 0.2);
    }
  }

  private handleHuman(side: Side, input: Input) {
    if (this.locked[side] !== null) return;
    const km = input.movePressed(side);
    if (km) {
      this.lock(side, km);
      return;
    }
    const specs = buttonLayout(side, availableMoves(this.match.round, side));
    for (const b of specs) {
      if (b.enabled && input.clickIn(b.x, b.y, b.w, b.h)) {
        this.lock(side, b.move);
        return;
      }
    }
  }

  // -------------------------------------------------------------------------
  // 描画
  // -------------------------------------------------------------------------

  draw(ctx: CanvasRenderingContext2D, t: number): void {
    const [sx, sy] = this.fx.offset();
    drawBackground(ctx, t);
    ctx.save();
    ctx.translate(sx, sy);
    drawFloor(ctx, this.stage, t);

    // 必殺の暗転
    const superGlow = Math.max(this.view[0].glow, this.view[1].glow);
    if (superGlow > 0) {
      ctx.fillStyle = `rgba(0,0,0,${Math.min(0.55, superGlow * 0.4)})`;
      ctx.fillRect(-20, 0, W + 40, H);
    }

    // 影・キャラ
    for (const side of [0, 1] as const) drawShadow(ctx, this.view[side].x);
    for (const side of [0, 1] as const) {
      const v = this.view[side];
      drawStickman(ctx, { x: v.x, floorY: FLOOR_Y, facing: v.facing, color: playerColor(side), pose: v.pose, glow: 0.25 + v.glow, alpha: v.alpha });
    }
    this.fx.drawWorld(ctx);
    ctx.restore();

    // HUD
    const s = this.match.round;
    for (const side of [0, 1] as const) {
      drawFighterHud(
        ctx,
        side,
        { hp: s.fighters[side].hp, hpShown: this.view[side].hpShown, gauge: s.fighters[side].gauge, wins: this.match.scores[side], name: this.names[side] },
        this.match.config.roundsToWin,
        this.gaugeFlash,
      );
    }
    const phaseNow = shrinkPhase(s.beat);
    const beatsToShrink = phaseNow >= SHRINK_MAX_PHASE ? null : (phaseNow + 1) * SHRINK_EVERY - s.beat;
    drawCenterInfo(ctx, s.beat, this.match.config.beatLimit, beatsToShrink, `ROUND ${this.match.roundIndex + 1}`);

    // 間合い表示
    const d = distanceCells(s);
    const r = rangeOf(d);
    if (this.phase === 'select' || this.phase === 'intro') {
      const cx = W / 2;
      const y = 112;
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      roundRect(ctx, cx - 110, y - 14, 220, 30, 15);
      ctx.fill();
      ctx.restore();
      text(ctx, `${RANGE_LABEL[r][0]}  ·  ${this.hint}`, cx, y, { size: 13, color: THEME.fg, align: 'center', weight: 800 });
    }

    if (this.phase === 'select') {
      drawTimer(ctx, this.timer / SELECT_SECONDS);
      const av0 = availableMoves(s, 0);
      const hover0 = this.hoverMove(0, av0);
      drawButtons(ctx, 0, buttonLayout(0, av0), { locked: this.locked[0], hideChoice: this.mode.kind === '2p', hover: hover0, superFlash: this.gaugeFlash });
      drawReady(ctx, 0, this.locked[0] !== null, '手を選べ');
      if (this.mode.kind === '2p') {
        const av1 = availableMoves(s, 1);
        drawButtons(ctx, 1, buttonLayout(1, av1), { locked: this.locked[1], hideChoice: true, hover: this.hoverMove(1, av1), superFlash: this.gaugeFlash });
        drawReady(ctx, 1, this.locked[1] !== null, '手を選べ');
      } else {
        drawReady(ctx, 1, this.locked[1] !== null, 'CPU 思考中…');
      }
    } else if (this.phase === 'resolve' && this.lastResult) {
      // 両者の手を公開
      for (const side of [0, 1] as const) {
        const m = this.lastResult.moves[side];
        const label = { strike: '打撃', throw: '投げ', guard: 'ガード', forward: '前進', back: '後退', super: '必殺' }[m];
        const x = side === 0 ? 120 : W - 120;
        ctx.save();
        ctx.fillStyle = MOVE_COLOR[m];
        roundRect(ctx, x - 50, 470, 100, 40, 8);
        ctx.fill();
        ctx.restore();
        text(ctx, label, x, 490, { size: 20, color: '#0a0e1a', align: 'center', weight: 900 });
      }
    }

    // 中央テキスト
    if (this.phase === 'intro') {
      const k = Math.min(1, this.phaseT / 0.25);
      const scale = this.introText === 'FIGHT!' ? 1 + (1 - Math.min(1, (this.phaseT - 0.9) / 0.2)) * 0.6 : 1.4 - 0.4 * k;
      this.bigText(ctx, this.introText, this.introText === 'FIGHT!' ? THEME.danger : THEME.fg, scale);
    } else if (this.phase === 'roundEnd' || this.phase === 'matchEnd') {
      const scale = 1 + Math.max(0, 0.5 - this.phaseT) * 1.2;
      this.bigText(ctx, this.roundEndText, this.roundEndText === 'K.O.' ? THEME.danger : THEME.fg, scale);
      if (this.winnerSide !== null) {
        text(ctx, `${this.names[this.winnerSide]} WINS`, W / 2, H / 2 + 50, { size: 22, color: playerColor(this.winnerSide), align: 'center', weight: 900, stroke: true });
      }
      const last = this.match.rounds[this.match.rounds.length - 1];
      if (last?.perfect) text(ctx, 'PERFECT', W / 2, H / 2 + 80, { size: 18, color: THEME.super, align: 'center', weight: 900, stroke: true });
    }

    this.fx.drawOverlay(ctx, W, H);
  }

  private hoverMove(side: Side, av: readonly Move[]): Move | null {
    // input への参照を持たないので、ボタン hover は draw 時には使わない（クリックで即ロック）
    void side;
    void av;
    return null;
  }

  private bigText(ctx: CanvasRenderingContext2D, s: string, color: string, scale: number) {
    ctx.save();
    ctx.translate(W / 2, H / 2 - 10);
    ctx.scale(scale, scale);
    text(ctx, s, 0, 0, { size: 64, color, align: 'center', weight: 900, stroke: true });
    ctx.restore();
  }
}
