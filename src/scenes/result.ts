/** 結果画面 */
import { audio } from '../audio';
import type { Input } from '../input';
import { roundRect, text } from '../render/hud';
import { drawBackground } from '../render/stage';
import { H, THEME, W, playerColor } from '../render/theme';
import type { App, ResultSummary, Scene } from './scene';

export class ResultScene implements Scene {
  private t = 0;
  private cursor = 0;
  constructor(
    private app: App,
    private summary: ResultSummary,
  ) {}

  private buttons(): [string, number, number, number, number][] {
    return [
      ['もう一度', W / 2 - 230, 430, 210, 48],
      ['タイトルへ', W / 2 + 20, 430, 210, 48],
    ];
  }

  update(dt: number, input: Input): void {
    this.t += dt;
    if (input.pressed('ArrowLeft') || input.pressed('ArrowRight') || input.pressed('KeyA') || input.pressed('KeyD')) {
      this.cursor = 1 - this.cursor;
      audio.play('ui');
    }
    const bs = this.buttons();
    for (let i = 0; i < bs.length; i++) {
      const [, x, y, w, h] = bs[i];
      if (input.clickIn(x, y, w, h)) {
        this.cursor = i;
        this.confirm();
        return;
      }
    }
    if (input.pressed('Enter') || input.pressed('Space')) this.confirm();
    if (input.pressed('Escape')) {
      this.cursor = 1;
      this.confirm();
    }
  }

  private confirm() {
    audio.play('lock');
    if (this.cursor === 0) this.app.goMatch(this.summary.mode);
    else this.app.goTitle();
  }

  draw(ctx: CanvasRenderingContext2D, t: number): void {
    drawBackground(ctx, t);
    const s = this.summary;
    const w = s.winner;
    text(ctx, w === null ? 'DRAW' : `${s.names[w]} WINS`, W / 2, 90, { size: 48, color: w === null ? THEME.fg : playerColor(w), align: 'center', weight: 900, stroke: true });
    text(ctx, `${s.scores[0]}  -  ${s.scores[1]}`, W / 2, 150, { size: 40, color: THEME.fg, align: 'center', weight: 900, font: THEME.fontMono });

    // 統計
    const rows: [string, string, string][] = [
      ['カウンター', `${s.stats.counters[0]}`, `${s.stats.counters[1]}`],
      ['投げ成立', `${s.stats.throws[0]}`, `${s.stats.throws[1]}`],
      ['ガード成立', `${s.stats.blocks[0]}`, `${s.stats.blocks[1]}`],
      ['必殺命中', `${s.stats.supers[0]}`, `${s.stats.supers[1]}`],
      ['PERFECT', `${s.stats.perfect[0]}`, `${s.stats.perfect[1]}`],
    ];
    const x0 = W / 2 - 220;
    const y0 = 200;
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    roundRect(ctx, x0, y0 - 20, 440, 30 * rows.length + 60, 10);
    ctx.fill();
    ctx.restore();
    text(ctx, s.names[0], x0 + 300, y0, { size: 14, color: playerColor(0), align: 'center', weight: 900 });
    text(ctx, s.names[1], x0 + 390, y0, { size: 14, color: playerColor(1), align: 'center', weight: 900 });
    rows.forEach(([k, a, b], i) => {
      const y = y0 + 32 + i * 30;
      text(ctx, k, x0 + 20, y, { size: 15, color: THEME.dim, weight: 700 });
      text(ctx, a, x0 + 300, y, { size: 18, color: THEME.fg, align: 'center', weight: 900, font: THEME.fontMono });
      text(ctx, b, x0 + 390, y, { size: 18, color: THEME.fg, align: 'center', weight: 900, font: THEME.fontMono });
    });
    text(ctx, `総拍数 ${s.stats.beats} / ${s.stats.rounds} ラウンド`, W / 2, y0 + 32 + rows.length * 30 + 4, { size: 13, color: THEME.dim, align: 'center' });

    const bs = this.buttons();
    bs.forEach(([label, x, y, bw, bh], i) => {
      const sel = i === this.cursor;
      ctx.save();
      ctx.fillStyle = sel ? THEME.fg : 'rgba(255,255,255,0.08)';
      roundRect(ctx, x, y, bw, bh, 10);
      ctx.fill();
      ctx.restore();
      text(ctx, label, x + bw / 2, y + bh / 2, { size: 18, color: sel ? '#0a0e1a' : THEME.fg, align: 'center', weight: 900 });
    });
    text(ctx, '← → で選択、Enter で決定', W / 2, H - 28, { size: 12, color: THEME.dim, align: 'center' });
  }
}
