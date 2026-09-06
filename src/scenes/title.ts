/** タイトル：モード選択と遊び方 */
import { audio } from '../audio';
import type { Input } from '../input';
import { roundRect, text } from '../render/hud';
import { drawBackground, drawFloor, drawShadow } from '../render/stage';
import { POSES, drawStickman, lerpPose, type Pose } from '../render/stickman';
import { FLOOR_Y, H, THEME, W, playerColor, posToX } from '../render/theme';
import { ARENA_MAX } from '../engine/rules';
import type { App, GameMode, Scene } from './scene';

interface MenuItem {
  label: string;
  sub: string;
  mode?: GameMode;
  action?: 'help';
}

const ITEMS: MenuItem[] = [
  { label: '1P vs CPU', sub: 'EASY', mode: { kind: 'cpu', difficulty: 'easy' } },
  { label: '1P vs CPU', sub: 'NORMAL', mode: { kind: 'cpu', difficulty: 'normal' } },
  { label: '1P vs CPU', sub: 'HARD', mode: { kind: 'cpu', difficulty: 'hard' } },
  { label: '2P 対戦', sub: '同じキーボード', mode: { kind: '2p' } },
  { label: '遊び方', sub: 'ルール説明', action: 'help' },
];

const HELP_LINES: [string, string][] = [
  ['基本', '毎拍、同時に手を選ぶ。HP 6、2本先取。24拍で時間切れ（HP多い方の勝ち）'],
  ['打撃', '近距離まで届く。投げ・前進に当てるとカウンター(2)。打撃同士は相打ち(1)'],
  ['投げ', '密着で成立(2)、ガード相手には崩し(3)。近〜中距離からは踏み込む。打撃に負ける'],
  ['ガード', '打撃を防いで反撃(1)、相手を弾く。投げには崩される。空振りを見切るとゲージ+1'],
  ['前進', '1マス詰める。受け身の相手に詰めるとゲージ+1。打撃・投げに刺さると痛い'],
  ['後退', '1マス下がる。後退中は投げられない（投げ抜けでゲージ+1）。壁際では不可'],
  ['必殺', 'ゲージ5で発動。中距離まで届きガード不能(3)。密着の投げにだけ負ける'],
  ['リング', '5拍ごとに壁が迫る。壁際で投げられると壁ドン(+1)。後退できない'],
];

export class TitleScene implements Scene {
  private cursor = 1;
  private help = false;
  private t = 0;
  private poses: [Pose, Pose] = [POSES.idle(0), POSES.idle(0.5)];
  private demoT = 0;

  constructor(private app: App) {}

  update(dt: number, input: Input): void {
    this.t += dt;
    this.demoT += dt;

    if (this.help) {
      if (input.pressed('Escape') || input.pressed('Enter') || input.pressed('Space') || input.pointer.pressed) {
        this.help = false;
        audio.play('ui');
      }
      return;
    }

    if (input.pressed('ArrowUp') || input.pressed('KeyW')) {
      this.cursor = (this.cursor + ITEMS.length - 1) % ITEMS.length;
      audio.play('ui');
    }
    if (input.pressed('ArrowDown') || input.pressed('KeyS')) {
      this.cursor = (this.cursor + 1) % ITEMS.length;
      audio.play('ui');
    }
    // マウス
    for (let i = 0; i < ITEMS.length; i++) {
      const [x, y, w, h] = this.itemRect(i);
      if (input.hover(x, y, w, h) && (input.pointer.x !== -1)) {
        if (this.cursor !== i && input.pointer.down) this.cursor = i;
        if (input.clickIn(x, y, w, h)) {
          this.cursor = i;
          this.select();
          return;
        }
      }
    }
    if (input.pressed('Enter') || input.pressed('Space')) this.select();

    // デモ：ふたりが軽く動く
    const ph = (this.demoT * 0.5) % 1;
    this.poses[0] = lerpPose(this.poses[0], POSES.idle(ph), 0.1);
    this.poses[1] = lerpPose(this.poses[1], POSES.idle((ph + 0.5) % 1), 0.1);
  }

  private select() {
    const item = ITEMS[this.cursor];
    audio.unlock();
    audio.play('lock');
    if (item.action === 'help') this.help = true;
    else if (item.mode) this.app.goMatch(item.mode);
  }

  private itemRect(i: number): [number, number, number, number] {
    return [W / 2 - 150, 262 + i * 46, 300, 40];
  }

  draw(ctx: CanvasRenderingContext2D, t: number): void {
    drawBackground(ctx, t);
    drawFloor(ctx, { wallLo: 0, wallHi: ARENA_MAX, warn: 0 }, t);
    drawShadow(ctx, posToX(3));
    drawShadow(ctx, posToX(15));
    drawStickman(ctx, { x: posToX(3), floorY: FLOOR_Y, facing: 1, color: playerColor(0), pose: this.poses[0], glow: 0.4, alpha: 0.9 });
    drawStickman(ctx, { x: posToX(15), floorY: FLOOR_Y, facing: -1, color: playerColor(1), pose: this.poses[1], glow: 0.4, alpha: 0.9 });

    // ロゴ
    ctx.save();
    ctx.translate(W / 2, 120);
    text(ctx, '棒人間ファイト', 0, 0, { size: 64, color: THEME.fg, align: 'center', weight: 900, stroke: true });
    const g = ctx.createLinearGradient(-120, 0, 120, 0);
    g.addColorStop(0, THEME.p0);
    g.addColorStop(1, THEME.p1);
    ctx.font = `900 26px ${THEME.fontDisplay}`;
    ctx.textAlign = 'center';
    ctx.fillStyle = g;
    ctx.fillText('R E   —   間合いと読み合い', 0, 52);
    ctx.restore();

    // メニュー
    for (let i = 0; i < ITEMS.length; i++) {
      const [x, y, w, h] = this.itemRect(i);
      const sel = i === this.cursor;
      ctx.save();
      ctx.fillStyle = sel ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.3)';
      roundRect(ctx, x, y, w, h, 8);
      ctx.fill();
      if (sel) {
        ctx.strokeStyle = THEME.fg;
        ctx.lineWidth = 2;
        roundRect(ctx, x, y, w, h, 8);
        ctx.stroke();
      }
      ctx.restore();
      text(ctx, ITEMS[i].label, x + 16, y + h / 2, { size: 18, color: sel ? THEME.fg : THEME.dim, weight: 900 });
      text(ctx, ITEMS[i].sub, x + w - 16, y + h / 2, { size: 12, color: sel ? THEME.super : THEME.dim, align: 'right', weight: 800, font: THEME.fontMono });
    }

    text(ctx, '↑↓ / W S で選択、Enter で決定（クリックでも可）', W / 2, 500, { size: 12, color: THEME.dim, align: 'center' });
    text(ctx, '1P: Q後 W必 E前 / A打 S投 Dガ     2P: U前 I必 O後 / J打 K投 Lガ', W / 2, 520, { size: 12, color: THEME.dim, align: 'center', font: THEME.fontMono });

    if (this.help) this.drawHelp(ctx);
  }

  private drawHelp(ctx: CanvasRenderingContext2D) {
    ctx.save();
    ctx.fillStyle = 'rgba(5,7,14,0.92)';
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
    text(ctx, '遊び方', W / 2, 44, { size: 30, color: THEME.fg, align: 'center', weight: 900 });
    text(ctx, '読み合いの基本：打撃 > 投げ > ガード > 打撃。移動で間合いを作り、届く技だけが当たる。', W / 2, 80, { size: 14, color: THEME.super, align: 'center', weight: 800 });
    const colors: Record<string, string> = { 打撃: THEME.strike, 投げ: THEME.throw, ガード: THEME.guard, 前進: THEME.forward, 後退: THEME.back, 必殺: THEME.super, リング: THEME.danger, 基本: THEME.fg };
    HELP_LINES.forEach(([k, v], i) => {
      const y = 118 + i * 44;
      ctx.save();
      ctx.fillStyle = colors[k] ?? THEME.fg;
      roundRect(ctx, 70, y - 14, 76, 28, 6);
      ctx.fill();
      ctx.restore();
      text(ctx, k, 108, y, { size: 15, color: '#0a0e1a', align: 'center', weight: 900 });
      text(ctx, v, 162, y, { size: 14, color: THEME.fg, weight: 600 });
    });
    text(ctx, 'Enter / クリックで戻る', W / 2, H - 28, { size: 12, color: THEME.dim, align: 'center' });
  }
}
