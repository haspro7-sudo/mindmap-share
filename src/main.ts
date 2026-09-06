import { audio } from './audio';
import { Input } from './input';
import { H, W } from './render/theme';
import { MatchScene } from './scenes/match';
import { ResultScene } from './scenes/result';
import type { App, GameMode, ResultSummary, Scene } from './scenes/scene';
import { TitleScene } from './scenes/title';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const input = new Input(canvas, W, H);

function fit() {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const scale = Math.min(window.innerWidth / W, window.innerHeight / H);
  canvas.style.width = `${Math.floor(W * scale)}px`;
  canvas.style.height = `${Math.floor(H * scale)}px`;
  canvas.width = Math.floor(W * dpr);
  canvas.height = Math.floor(H * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener('resize', fit);
fit();

let scene: Scene;
const app: App = {
  goTitle() {
    scene?.dispose?.();
    scene = new TitleScene(app);
  },
  goMatch(mode: GameMode) {
    scene?.dispose?.();
    scene = new MatchScene(app, mode);
  },
  goResult(summary: ResultSummary) {
    scene?.dispose?.();
    scene = new ResultScene(app, summary);
  },
};
app.goTitle();

// 最初の操作で音を解禁
const unlock = () => {
  audio.unlock();
  window.removeEventListener('pointerdown', unlock);
  window.removeEventListener('keydown', unlock);
};
window.addEventListener('pointerdown', unlock);
window.addEventListener('keydown', unlock);

// ミュート切替（M）
window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyM') {
    audio.enabled = !audio.enabled;
    audio.setVolume(audio.enabled ? 0.6 : 0);
  }
});

let last = performance.now();
let elapsed = 0;
function frame(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  elapsed += dt;
  input.beginFrame();
  scene.update(dt, input);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.restore();
  scene.draw(ctx, elapsed);
  input.endFrame();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
