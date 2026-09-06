/** 背景・床・マス目・壁の描画 */
import { ARENA_MAX, CELL } from '../engine/rules';
import { FLOOR_Y, H, HALF_CELL_PX, THEME, W, posToX } from './theme';

export interface StageView {
  /** 壁の現在位置（半マス単位、アニメーション用に小数可） */
  wallLo: number;
  wallHi: number;
  /** 壁が迫る予告の強さ 0..1 */
  warn: number;
}

export function drawBackground(ctx: CanvasRenderingContext2D, t: number) {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, THEME.bgTop);
  g.addColorStop(1, THEME.bgBottom);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // 遠景のうっすらした横線（スピード感）
  ctx.strokeStyle = 'rgba(255,255,255,0.03)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 6; i++) {
    const y = 80 + i * 55 + Math.sin(t * 0.3 + i) * 3;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.stroke();
  }
}

export function drawFloor(ctx: CanvasRenderingContext2D, view: StageView, t: number) {
  // 床
  const g = ctx.createLinearGradient(0, FLOOR_Y, 0, H);
  g.addColorStop(0, THEME.floor);
  g.addColorStop(1, THEME.bgTop);
  ctx.fillStyle = g;
  ctx.fillRect(0, FLOOR_Y, W, H - FLOOR_Y);

  // マス目（1マス = 2半マス）
  ctx.lineWidth = 2;
  for (let p = 0; p <= ARENA_MAX; p += CELL) {
    const x = posToX(p);
    const inside = p >= view.wallLo - 0.01 && p <= view.wallHi + 0.01;
    ctx.strokeStyle = inside ? THEME.floorLine : 'rgba(61,70,100,0.25)';
    ctx.beginPath();
    ctx.moveTo(x, FLOOR_Y + 2);
    ctx.lineTo(x, FLOOR_Y + 14);
    ctx.stroke();
  }
  // 床のライン
  ctx.strokeStyle = THEME.floorLine;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(posToX(view.wallLo) - HALF_CELL_PX * 0.5, FLOOR_Y);
  ctx.lineTo(posToX(view.wallHi) + HALF_CELL_PX * 0.5, FLOOR_Y);
  ctx.stroke();

  // 壁の外側は暗く
  ctx.fillStyle = 'rgba(5,7,14,0.72)';
  const xl = posToX(view.wallLo) - HALF_CELL_PX * 0.5;
  const xr = posToX(view.wallHi) + HALF_CELL_PX * 0.5;
  ctx.fillRect(0, 0, Math.max(0, xl), H);
  ctx.fillRect(xr, 0, Math.max(0, W - xr), H);

  // 壁本体
  const pulse = 0.5 + Math.sin(t * 6) * 0.5;
  const warnA = view.warn * pulse;
  for (const [x, dir] of [
    [xl, 1],
    [xr, -1],
  ] as const) {
    ctx.save();
    ctx.strokeStyle = view.warn > 0 ? `rgba(255,${Math.round(90 + 100 * (1 - warnA))},80,${0.6 + warnA * 0.4})` : 'rgba(180,190,220,0.6)';
    ctx.lineWidth = 4;
    ctx.shadowColor = view.warn > 0 ? THEME.danger : 'rgba(120,140,255,0.6)';
    ctx.shadowBlur = 14 + warnA * 18;
    ctx.beginPath();
    ctx.moveTo(x, 60);
    ctx.lineTo(x, FLOOR_Y + 8);
    ctx.stroke();
    // ハザード縞
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 2;
    for (let y = 70; y < FLOOR_Y; y += 22) {
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + dir * 10, y + 10);
      ctx.stroke();
    }
    ctx.restore();
  }
}

/** 足元の影 */
export function drawShadow(ctx: CanvasRenderingContext2D, x: number, scale = 1) {
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath();
  ctx.ellipse(x, FLOOR_Y + 4, 34 * scale, 7 * scale, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}
