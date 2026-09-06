/** HUD：HPバー・必殺ゲージ・ラウンド星・拍カウンタ・タイマー・手選択ボタン */
import { GAUGE_MAX, HP_MAX, MOVE_LABEL } from '../engine/rules';
import type { Move, Side } from '../engine/types';
import { KEY_LABEL } from '../input';
import { MOVE_COLOR, THEME, W, playerColor } from './theme';

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

export function text(
  ctx: CanvasRenderingContext2D,
  s: string,
  x: number,
  y: number,
  opts: { size?: number; color?: string; align?: CanvasTextAlign; weight?: number | string; font?: string; alpha?: number; baseline?: CanvasTextBaseline; stroke?: boolean } = {},
) {
  ctx.save();
  ctx.globalAlpha = opts.alpha ?? 1;
  ctx.font = `${opts.weight ?? 700} ${opts.size ?? 16}px ${opts.font ?? THEME.fontDisplay}`;
  ctx.textAlign = opts.align ?? 'left';
  ctx.textBaseline = opts.baseline ?? 'middle';
  if (opts.stroke) {
    ctx.lineWidth = 5;
    ctx.strokeStyle = 'rgba(0,0,0,0.7)';
    ctx.strokeText(s, x, y);
  }
  ctx.fillStyle = opts.color ?? THEME.fg;
  ctx.fillText(s, x, y);
  ctx.restore();
}

export interface FighterHud {
  hp: number;
  /** 表示用に補間した HP */
  hpShown: number;
  gauge: number;
  wins: number;
  name: string;
}

export function drawFighterHud(ctx: CanvasRenderingContext2D, side: Side, f: FighterHud, roundsToWin: number, gaugeFlash: number) {
  const color = playerColor(side);
  const mirror = side === 1;
  const x0 = mirror ? W - 30 : 30;
  const dir = mirror ? -1 : 1;
  const barW = 330;
  const barH = 22;
  const y = 28;

  // 名前
  text(ctx, f.name, x0, y - 18, { size: 13, color, align: mirror ? 'right' : 'left', weight: 800 });

  // HP 背景
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  roundRect(ctx, mirror ? x0 - barW : x0, y, barW, barH, 4);
  ctx.fill();
  // HP セグメント
  const segW = (barW - 8) / HP_MAX;
  for (let i = 0; i < HP_MAX; i++) {
    const filled = i < f.hpShown;
    const partial = f.hpShown > i && f.hpShown < i + 1 ? f.hpShown - i : 1;
    const sx = mirror ? x0 - 4 - (i + 1) * segW + 2 : x0 + 4 + i * segW;
    const w = segW - 4;
    ctx.fillStyle = filled ? (f.hp <= 2 ? THEME.danger : color) : 'rgba(255,255,255,0.08)';
    const fw = filled ? w * partial : w;
    roundRect(ctx, mirror ? sx + (w - fw) : sx, y + 4, fw, barH - 8, 2);
    ctx.fill();
  }
  ctx.restore();

  // ゲージ
  const gy = y + barH + 8;
  const pipW = 22;
  const pipGap = 5;
  for (let i = 0; i < GAUGE_MAX; i++) {
    const px = mirror ? x0 - (i + 1) * (pipW + pipGap) + pipGap : x0 + i * (pipW + pipGap);
    const on = i < f.gauge;
    const max = f.gauge >= GAUGE_MAX;
    ctx.save();
    if (on && max) {
      ctx.shadowColor = THEME.super;
      ctx.shadowBlur = 10 + gaugeFlash * 16;
    }
    ctx.fillStyle = on ? (max ? THEME.super : color) : 'rgba(255,255,255,0.1)';
    roundRect(ctx, px, gy, pipW, 8, 2);
    ctx.fill();
    ctx.restore();
  }
  if (f.gauge >= GAUGE_MAX) {
    const lx = mirror ? x0 - GAUGE_MAX * (pipW + pipGap) - 8 : x0 + GAUGE_MAX * (pipW + pipGap) + 8;
    text(ctx, 'SUPER READY', lx, gy + 4, { size: 11, color: THEME.super, align: mirror ? 'right' : 'left', weight: 900, alpha: 0.7 + gaugeFlash * 0.3 });
  }

  // ラウンド勝利
  for (let i = 0; i < roundsToWin; i++) {
    const cx = mirror ? x0 - barW + 10 + i * 18 : x0 + barW - 10 - i * 18;
    ctx.beginPath();
    ctx.arc(cx, gy + 4, 5, 0, Math.PI * 2);
    ctx.fillStyle = i < f.wins ? THEME.fg : 'rgba(255,255,255,0.15)';
    ctx.fill();
  }
  void dir;
}

export function drawCenterInfo(ctx: CanvasRenderingContext2D, beat: number, beatLimit: number, beatsToShrink: number | null, roundLabel: string) {
  const cx = W / 2;
  text(ctx, roundLabel, cx, 14, { size: 13, color: THEME.dim, align: 'center', weight: 800 });
  text(ctx, `${beat}`, cx - 4, 40, { size: 30, color: THEME.fg, align: 'right', weight: 900, font: THEME.fontMono });
  text(ctx, `/ ${beatLimit}`, cx + 2, 44, { size: 14, color: THEME.dim, align: 'left', weight: 700, font: THEME.fontMono });
  if (beatsToShrink !== null) {
    const urgent = beatsToShrink <= 1;
    text(ctx, `壁まで ${beatsToShrink}`, cx, 66, { size: 12, color: urgent ? THEME.danger : THEME.dim, align: 'center', weight: 800 });
  } else {
    text(ctx, '最終リング', cx, 66, { size: 12, color: THEME.danger, align: 'center', weight: 800 });
  }
}

export function drawTimer(ctx: CanvasRenderingContext2D, ratio: number) {
  const w = 240;
  const x = W / 2 - w / 2;
  const y = 82;
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  roundRect(ctx, x, y, w, 6, 3);
  ctx.fill();
  ctx.fillStyle = ratio < 0.3 ? THEME.danger : THEME.fg;
  roundRect(ctx, x, y, w * Math.max(0, ratio), 6, 3);
  ctx.fill();
}

export interface ButtonSpec {
  move: Move;
  x: number;
  y: number;
  w: number;
  h: number;
  enabled: boolean;
}

const BUTTON_ORDER: Move[] = ['back', 'strike', 'throw', 'guard', 'forward'];

/** 画面下部のボタン配置を返す */
export function buttonLayout(side: Side, available: readonly Move[]): ButtonSpec[] {
  const bw = 78;
  const bh = 58;
  const gap = 8;
  const order = side === 0 ? BUTTON_ORDER : [...BUTTON_ORDER].reverse();
  const total = order.length * bw + (order.length - 1) * gap;
  const x0 = side === 0 ? 24 : W - 24 - total;
  const y = 466;
  const specs: ButtonSpec[] = order.map((m, i) => ({ move: m, x: x0 + i * (bw + gap), y, w: bw, h: bh, enabled: available.includes(m) }));
  if (available.includes('super')) {
    const sx = side === 0 ? x0 + total + gap : x0 - gap - bw;
    specs.push({ move: 'super', x: sx, y, w: bw, h: bh, enabled: true });
  }
  return specs;
}

export function drawButtons(
  ctx: CanvasRenderingContext2D,
  side: Side,
  specs: ButtonSpec[],
  state: { locked: Move | null; hideChoice: boolean; hover: Move | null; superFlash: number },
) {
  for (const b of specs) {
    const color = MOVE_COLOR[b.move];
    const isLocked = state.locked === b.move && !state.hideChoice;
    const dimmed = state.locked !== null && !isLocked;
    ctx.save();
    ctx.globalAlpha = b.enabled ? (dimmed ? 0.35 : 1) : 0.22;
    if (b.move === 'super') {
      ctx.shadowColor = THEME.super;
      ctx.shadowBlur = 8 + state.superFlash * 14;
    }
    ctx.fillStyle = isLocked ? color : 'rgba(255,255,255,0.06)';
    roundRect(ctx, b.x, b.y, b.w, b.h, 8);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.lineWidth = state.hover === b.move && b.enabled ? 3 : 2;
    ctx.strokeStyle = isLocked ? THEME.fg : color;
    roundRect(ctx, b.x, b.y, b.w, b.h, 8);
    ctx.stroke();
    text(ctx, MOVE_LABEL[b.move].ja, b.x + b.w / 2, b.y + 22, { size: 18, color: isLocked ? '#0a0e1a' : THEME.fg, align: 'center', weight: 900 });
    text(ctx, KEY_LABEL[side][b.move], b.x + b.w / 2, b.y + 44, { size: 11, color: isLocked ? '#0a0e1a' : color, align: 'center', weight: 800, font: THEME.fontMono });
    ctx.restore();
  }
}

/** 相手の選択状態（READY 表示） */
export function drawReady(ctx: CanvasRenderingContext2D, side: Side, ready: boolean, label: string) {
  const x = side === 0 ? 24 : W - 24;
  text(ctx, ready ? 'READY' : label, x, 452, { size: 12, color: ready ? playerColor(side) : THEME.dim, align: side === 0 ? 'left' : 'right', weight: 900 });
}
