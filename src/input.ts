/** キーボード + 画面ボタンの入力 */
import type { Move, Side } from './engine/types';

export const KEYMAP: Record<Side, Record<string, Move>> = {
  0: { KeyA: 'strike', KeyS: 'throw', KeyD: 'guard', KeyQ: 'back', KeyE: 'forward', KeyW: 'super' },
  1: { KeyJ: 'strike', KeyK: 'throw', KeyL: 'guard', KeyO: 'back', KeyU: 'forward', KeyI: 'super' },
};

export const KEY_LABEL: Record<Side, Record<Move, string>> = {
  0: { strike: 'A', throw: 'S', guard: 'D', back: 'Q', forward: 'E', super: 'W' },
  1: { strike: 'J', throw: 'K', guard: 'L', back: 'O', forward: 'U', super: 'I' },
};

export interface Pointer {
  x: number;
  y: number;
  down: boolean;
  /** このフレームで押された */
  pressed: boolean;
}

export class Input {
  private keysDown = new Set<string>();
  private keysPressed = new Set<string>();
  pointer: Pointer = { x: -1, y: -1, down: false, pressed: false };
  private pendingPress = false;
  private scale = 1;
  private offX = 0;
  private offY = 0;

  constructor(canvas: HTMLCanvasElement, private logicalW: number, private logicalH: number) {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keysDown.add(e.code);
      this.keysPressed.add(e.code);
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keysDown.delete(e.code));
    window.addEventListener('blur', () => this.keysDown.clear());

    const toLogical = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      this.scale = r.width / logicalW;
      this.offX = r.left;
      this.offY = r.top;
      return { x: (e.clientX - this.offX) / this.scale, y: (e.clientY - this.offY) / this.scale };
    };
    canvas.addEventListener('pointerdown', (e) => {
      const p = toLogical(e);
      this.pointer.x = p.x;
      this.pointer.y = p.y;
      this.pointer.down = true;
      this.pendingPress = true;
      e.preventDefault();
    });
    canvas.addEventListener('pointermove', (e) => {
      const p = toLogical(e);
      this.pointer.x = p.x;
      this.pointer.y = p.y;
    });
    window.addEventListener('pointerup', () => {
      this.pointer.down = false;
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  /** フレーム開始時に呼ぶ */
  beginFrame() {
    this.pointer.pressed = this.pendingPress;
    this.pendingPress = false;
  }

  /** フレーム終了時に呼ぶ */
  endFrame() {
    this.keysPressed.clear();
    this.pointer.pressed = false;
  }

  pressed(code: string): boolean {
    return this.keysPressed.has(code);
  }

  anyPressed(): boolean {
    return this.keysPressed.size > 0 || this.pointer.pressed;
  }

  /** このフレームに押された手（キー） */
  movePressed(side: Side): Move | null {
    for (const [code, m] of Object.entries(KEYMAP[side])) if (this.keysPressed.has(code)) return m;
    return null;
  }

  clickIn(x: number, y: number, w: number, h: number): boolean {
    const p = this.pointer;
    return p.pressed && p.x >= x && p.x <= x + w && p.y >= y && p.y <= y + h;
  }

  hover(x: number, y: number, w: number, h: number): boolean {
    const p = this.pointer;
    return p.x >= x && p.x <= x + w && p.y >= y && p.y <= y + h;
  }

  get logical(): [number, number] {
    return [this.logicalW, this.logicalH];
  }
}
