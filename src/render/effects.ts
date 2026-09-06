/** パーティクル・画面揺れ・ヒットストップ・テキストポップ */
import { THEME } from './theme';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  color: string;
  size: number;
}

interface Popup {
  x: number;
  y: number;
  text: string;
  color: string;
  life: number;
  max: number;
  size: number;
  rise: number;
}

interface Flash {
  color: string;
  life: number;
  max: number;
}

export class Effects {
  private particles: Particle[] = [];
  private popups: Popup[] = [];
  private flash: Flash | null = null;
  private shake = 0;
  private shakeDecay = 0;
  hitStop = 0;
  /** スロー倍率 (1 = 通常) */
  timeScale = 1;
  private slowLeft = 0;

  burst(x: number, y: number, color: string, n = 14, speed = 260, size = 4) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = speed * (0.4 + Math.random() * 0.8);
      this.particles.push({
        x,
        y,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v - 80,
        life: 0,
        max: 0.35 + Math.random() * 0.3,
        color,
        size: size * (0.6 + Math.random() * 0.8),
      });
    }
  }

  spark(x: number, y: number, color: string) {
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.4;
      const v = 320 * (0.5 + Math.random());
      this.particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0, max: 0.25 + Math.random() * 0.2, color, size: 3 });
    }
  }

  popup(x: number, y: number, text: string, color: string = THEME.fg, size = 26, rise = 40, duration = 0.9) {
    this.popups.push({ x, y, text, color, life: 0, max: duration, size, rise });
  }

  shakeScreen(amount: number, decay = 8) {
    this.shake = Math.max(this.shake, amount);
    this.shakeDecay = decay;
  }

  flashScreen(color: string, duration = 0.12) {
    this.flash = { color, life: 0, max: duration };
  }

  stop(ms: number) {
    this.hitStop = Math.max(this.hitStop, ms / 1000);
  }

  slow(scale: number, seconds: number) {
    this.timeScale = scale;
    this.slowLeft = seconds;
  }

  update(dt: number) {
    if (this.slowLeft > 0) {
      this.slowLeft -= dt;
      if (this.slowLeft <= 0) this.timeScale = 1;
    }
    for (const p of this.particles) {
      p.life += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 600 * dt;
      p.vx *= 0.96;
    }
    this.particles = this.particles.filter((p) => p.life < p.max);
    for (const p of this.popups) p.life += dt;
    this.popups = this.popups.filter((p) => p.life < p.max);
    if (this.flash) {
      this.flash.life += dt;
      if (this.flash.life >= this.flash.max) this.flash = null;
    }
    if (this.shake > 0) this.shake = Math.max(0, this.shake - this.shakeDecay * dt * 10);
  }

  /** 揺れオフセット */
  offset(): [number, number] {
    if (this.shake <= 0) return [0, 0];
    return [(Math.random() - 0.5) * this.shake * 2, (Math.random() - 0.5) * this.shake * 2];
  }

  drawWorld(ctx: CanvasRenderingContext2D) {
    for (const p of this.particles) {
      const a = 1 - p.life / p.max;
      ctx.globalAlpha = a;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * (0.5 + a * 0.5), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    for (const p of this.popups) {
      const t = p.life / p.max;
      const a = t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3;
      const scale = t < 0.12 ? 0.6 + (t / 0.12) * 0.5 : 1.1 - Math.min(0.1, (t - 0.12) * 0.5);
      ctx.save();
      ctx.globalAlpha = a;
      ctx.translate(p.x, p.y - p.rise * t);
      ctx.scale(scale, scale);
      ctx.font = `900 ${p.size}px ${THEME.fontDisplay}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 6;
      ctx.strokeStyle = 'rgba(0,0,0,0.75)';
      ctx.strokeText(p.text, 0, 0);
      ctx.fillStyle = p.color;
      ctx.fillText(p.text, 0, 0);
      ctx.restore();
    }
  }

  drawOverlay(ctx: CanvasRenderingContext2D, w: number, h: number) {
    if (this.flash) {
      const a = 1 - this.flash.life / this.flash.max;
      ctx.globalAlpha = a * 0.8;
      ctx.fillStyle = this.flash.color;
      ctx.fillRect(0, 0, w, h);
      ctx.globalAlpha = 1;
    }
  }

  clear() {
    this.particles = [];
    this.popups = [];
    this.flash = null;
    this.shake = 0;
    this.hitStop = 0;
    this.timeScale = 1;
    this.slowLeft = 0;
  }
}
