/**
 * プロシージャル棒人間。
 * ポーズは関節角（ラジアン）の集合。時間 t (0..1) を受け取る関数でアニメーションを生成し、
 * 2つのポーズを線形補間して描く。
 */

export interface Pose {
  /** 腰の高さオフセット（+で下がる） */
  crouch: number;
  /** 胴の傾き（+で前傾） */
  lean: number;
  /** 上腕・前腕（前側 / 後側）。0 = 真下、+ で前方へ上がる */
  armF: [number, number];
  armB: [number, number];
  /** 太もも・すね（前側 / 後側）。0 = 真下、+ で前方へ */
  legF: [number, number];
  legB: [number, number];
  /** 頭の傾き */
  head: number;
  /** 全体の x オフセット（前方向、px） */
  dx: number;
  /** 全体の y オフセット（px、+で下） */
  dy: number;
  /** 寝転ぶ角度（KO用、0..1） */
  down: number;
}

export const BASE: Pose = {
  crouch: 0,
  lean: 0.05,
  armF: [0.5, 0.9],
  armB: [-0.3, 0.6],
  legF: [0.25, -0.15],
  legB: [-0.25, 0.15],
  head: 0,
  dx: 0,
  dy: 0,
  down: 0,
};

export function pose(p: Partial<Pose>): Pose {
  return { ...BASE, ...p };
}

export function lerpPose(a: Pose, b: Pose, t: number): Pose {
  const l = (x: number, y: number) => x + (y - x) * t;
  return {
    crouch: l(a.crouch, b.crouch),
    lean: l(a.lean, b.lean),
    armF: [l(a.armF[0], b.armF[0]), l(a.armF[1], b.armF[1])],
    armB: [l(a.armB[0], b.armB[0]), l(a.armB[1], b.armB[1])],
    legF: [l(a.legF[0], b.legF[0]), l(a.legF[1], b.legF[1])],
    legB: [l(a.legB[0], b.legB[0]), l(a.legB[1], b.legB[1])],
    head: l(a.head, b.head),
    dx: l(a.dx, b.dx),
    dy: l(a.dy, b.dy),
    down: l(a.down, b.down),
  };
}

// ---------------------------------------------------------------------------
// ポーズ集
// ---------------------------------------------------------------------------

export const POSES = {
  idle: (t: number): Pose =>
    pose({
      crouch: 2 + Math.sin(t * Math.PI * 2) * 1.5,
      armF: [0.5 + Math.sin(t * Math.PI * 2) * 0.05, 0.9],
      armB: [-0.3, 0.6 + Math.sin(t * Math.PI * 2) * 0.05],
    }),
  walk: (t: number): Pose => {
    const s = Math.sin(t * Math.PI * 2);
    return pose({
      crouch: 3 + Math.abs(s) * 2,
      lean: 0.15,
      legF: [0.45 * s, -0.2 + 0.3 * Math.max(0, -s)],
      legB: [-0.45 * s, 0.1 + 0.3 * Math.max(0, s)],
      armF: [0.3 - 0.3 * s, 0.7],
      armB: [-0.2 + 0.3 * s, 0.6],
    });
  },
  backstep: pose({ lean: -0.15, crouch: 6, legF: [0.5, 0.2], legB: [-0.4, 0.3], armF: [0.8, 1.0], armB: [0.2, 0.9] }),
  guard: pose({ lean: 0.1, crouch: 8, armF: [1.4, 2.4], armB: [1.0, 2.1], legF: [0.35, -0.2], legB: [-0.35, 0.2], head: 0.15 }),
  strikeWind: pose({ lean: -0.15, crouch: 6, armF: [-1.2, 1.2], armB: [0.9, 1.3], legF: [0.3, -0.1], legB: [-0.4, 0.2] }),
  strikeHit: pose({ lean: 0.35, crouch: 4, dx: 14, armF: [1.75, 0.05], armB: [-0.9, 1.0], legF: [0.7, -0.3], legB: [-0.6, 0.3] }),
  throwGrab: pose({ lean: 0.4, crouch: 14, dx: 10, armF: [1.3, 0.4], armB: [1.1, 0.5], legF: [0.8, -0.5], legB: [-0.5, 0.4] }),
  throwSlam: pose({ lean: -0.3, crouch: 2, dx: 4, armF: [2.6, 0.2], armB: [2.3, 0.3], legF: [0.3, -0.1], legB: [-0.3, 0.2] }),
  hurt: pose({ lean: -0.45, crouch: 8, dx: -12, armF: [0.9, 1.6], armB: [-0.8, 1.2], legF: [0.6, -0.2], legB: [-0.1, 0.6], head: -0.4 }),
  thrown: pose({ lean: -1.2, crouch: -30, dx: -20, armF: [1.5, 0.5], armB: [1.5, 0.5], legF: [1.2, 0.3], legB: [0.8, 0.8], head: -0.5 }),
  ko: pose({ down: 1, dx: -20 }),
  superWind: pose({ lean: -0.3, crouch: 16, armF: [-1.6, 0.6], armB: [-1.6, 0.6], legF: [0.5, -0.3], legB: [-0.5, 0.3], head: -0.2 }),
  superHit: pose({ lean: 0.5, crouch: 0, dx: 28, armF: [1.9, 0.0], armB: [1.9, 0.0], legF: [0.9, -0.4], legB: [-0.8, 0.4], head: 0.2 }),
  win: (t: number): Pose =>
    pose({ crouch: 2, armF: [2.6 + Math.sin(t * 8) * 0.1, 0.3], armB: [-0.3, 0.5], head: -0.1 }),
  clash: pose({ lean: -0.1, crouch: 6, dx: -6, armF: [1.5, 0.2], armB: [-0.6, 1.0], legF: [0.5, -0.2], legB: [-0.5, 0.3] }),
} as const;

// ---------------------------------------------------------------------------
// 描画
// ---------------------------------------------------------------------------

export interface DrawOptions {
  x: number;
  floorY: number;
  facing: 1 | -1;
  color: string;
  pose: Pose;
  scale?: number;
  glow?: number;
  alpha?: number;
}

const HEAD_R = 15;
const TORSO = 52;
const UPPER = 30;
const FORE = 28;
const THIGH = 36;
const SHIN = 36;

export function drawStickman(ctx: CanvasRenderingContext2D, o: DrawOptions): void {
  const s = o.scale ?? 1;
  const p = o.pose;
  ctx.save();
  ctx.translate(o.x + p.dx * o.facing * s, o.floorY + p.dy * s);
  ctx.scale(o.facing * s, s);
  ctx.globalAlpha = o.alpha ?? 1;

  if (p.down > 0) {
    // 倒れ：角度で回転
    ctx.rotate((-Math.PI / 2) * p.down);
    ctx.translate(0, p.down * 12);
  }

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = o.color;
  ctx.fillStyle = o.color;
  ctx.lineWidth = 5;
  if (o.glow && o.glow > 0) {
    ctx.shadowColor = o.color;
    ctx.shadowBlur = 18 * o.glow;
  }

  const hipY = -(THIGH + SHIN) + p.crouch;
  const hip = { x: 0, y: hipY };
  // 胴
  const neck = { x: hip.x + Math.sin(p.lean) * TORSO, y: hip.y - Math.cos(p.lean) * TORSO };
  const shoulder = { x: hip.x + Math.sin(p.lean) * (TORSO - 6), y: hip.y - Math.cos(p.lean) * (TORSO - 6) };

  // 脚（後→前の順で描く）
  limb(ctx, hip, p.legB, THIGH, SHIN, 1, 0.55);
  limb(ctx, hip, p.legF, THIGH, SHIN, 1, 1);

  // 胴
  ctx.globalAlpha = (o.alpha ?? 1) * 1;
  line(ctx, hip, neck);

  // 腕（後→前）
  limb(ctx, shoulder, p.armB, UPPER, FORE, -1, 0.55);
  limb(ctx, shoulder, p.armF, UPPER, FORE, -1, 1);

  // 頭
  const headC = { x: neck.x + Math.sin(p.lean + p.head) * (HEAD_R + 4), y: neck.y - Math.cos(p.lean + p.head) * (HEAD_R + 4) };
  ctx.beginPath();
  ctx.arc(headC.x, headC.y, HEAD_R, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function limb(
  ctx: CanvasRenderingContext2D,
  root: { x: number; y: number },
  angles: [number, number],
  l1: number,
  l2: number,
  /** 脚は下向き基準 (+1)、腕は下向き基準だが肩から (-1 は関係なく同じ式) */
  _dir: number,
  alphaMul: number,
) {
  const a1 = angles[0];
  const a2 = angles[0] + angles[1];
  const mid = { x: root.x + Math.sin(a1) * l1, y: root.y + Math.cos(a1) * l1 };
  const end = { x: mid.x + Math.sin(a2) * l2, y: mid.y + Math.cos(a2) * l2 };
  const prev = ctx.globalAlpha;
  ctx.globalAlpha = prev * alphaMul;
  ctx.beginPath();
  ctx.moveTo(root.x, root.y);
  ctx.lineTo(mid.x, mid.y);
  ctx.lineTo(end.x, end.y);
  ctx.stroke();
  ctx.globalAlpha = prev;
}

function line(ctx: CanvasRenderingContext2D, a: { x: number; y: number }, b: { x: number; y: number }) {
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
}
