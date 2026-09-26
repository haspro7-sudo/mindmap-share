import { afterEach, describe, expect, it, vi } from 'vitest';
import qrcode from 'qrcode-generator';
import { isShioriError } from '../../core/errors';
import { buildUnlockUrl } from '../../core/route';
import { QR_PNG_HEIGHT, QR_PNG_WIDTH, QR_QUIET_ZONE, qrMatrix, qrSvgPath, renderQrPng } from './qrPng';
import { decodeQrMatrix } from './qrDecode.testutil';

const DEMO_URL = 'http://localhost:5173/#/u/demo-hoshiyomi/ST4RMAP1X';
const KANA_CODE = 'ほたるかえでつばめこだますずめ';
const KANA_DISPLAY = 'ほたる・かえで・つばめ・こだま・すずめ';
const LONG_KANA_URL = buildUnlockUrl('https://example.github.io/shiori-cho/', 'w-test00001', `kana:${KANA_CODE}`);

/** Rasterizes qrSvgPath's path (only the `M x y h n v1 h-n z` rectangles it emits) into a size × size grid. */
function rasterizePath(size: number, path: string): { grid: boolean[][]; runs: Array<[number, number, number]> } {
  const grid = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const runs: Array<[number, number, number]> = [];
  const re = /M(\d+) (\d+)h(\d+)v1h-(\d+)z/gy;
  let consumed = 0;
  for (let m = re.exec(path); m; m = re.exec(path)) {
    const [x, y, w, back] = [m[1], m[2], m[3], m[4]].map(Number) as [number, number, number, number];
    expect(back).toBe(w);
    for (let i = 0; i < w; i++) {
      expect(grid[y]![x + i]).toBe(false); // runs never overlap
      grid[y]![x + i] = true;
    }
    runs.push([x, y, w]);
    consumed = re.lastIndex;
  }
  expect(consumed).toBe(path.length);
  return { grid, runs };
}

function withQuietZone(matrix: boolean[][]): boolean[][] {
  const size = matrix.length + 2 * QR_QUIET_ZONE;
  return Array.from({ length: size }, (_, y) =>
    Array.from({ length: size }, (_, x) => matrix[y - QR_QUIET_ZONE]?.[x - QR_QUIET_ZONE] ?? false),
  );
}

describe('qrMatrix / qrSvgPath', () => {
  it('is deterministic', () => {
    expect(qrSvgPath(DEMO_URL)).toEqual(qrSvgPath(DEMO_URL));
    expect(qrSvgPath(LONG_KANA_URL)).toEqual(qrSvgPath(LONG_KANA_URL));
    expect(qrMatrix(DEMO_URL)).toEqual(qrMatrix(DEMO_URL));
    expect(qrSvgPath(DEMO_URL)).not.toEqual(qrSvgPath(`${DEMO_URL}2`));
  });

  it('includes the 4-module quiet zone in an odd size of at least 21 + 8', () => {
    for (const text of ['', 'a', DEMO_URL, LONG_KANA_URL, 'ほしあかり']) {
      const { size } = qrSvgPath(text);
      expect(size).toBe(qrMatrix(text).length + 8);
      expect(size % 2).toBe(1);
      expect(size).toBeGreaterThanOrEqual(29);
    }
  });

  it('draws exactly the dark modules, offset by the quiet zone, as merged horizontal runs', () => {
    for (const text of [DEMO_URL, LONG_KANA_URL]) {
      const { size, path } = qrSvgPath(text);
      const { grid, runs } = rasterizePath(size, path);
      expect(grid).toEqual(withQuietZone(qrMatrix(text)));
      // merged runs: every rectangle is a maximal horizontal run of dark modules
      for (const [x, y, w] of runs) {
        expect(grid[y]![x - 1]).toBe(false);
        expect(grid[y]![x + w]).toBe(false);
      }
      expect(runs.length).toBeLessThan(grid.flat().filter(Boolean).length);
    }
  });

  it('encodes the demo deep link so that a reader gets it back (EC level M)', () => {
    const decoded = decodeQrMatrix(qrMatrix(DEMO_URL));
    expect(decoded.text).toBe(DEMO_URL);
    expect(decoded.ecLevel).toBe('M');
  });

  it('handles a long percent-encoded kana deep link', () => {
    expect(LONG_KANA_URL).toContain('%E3%81%BB'); // ほ, percent-encoded
    const matrix = qrMatrix(LONG_KANA_URL);
    const decoded = decodeQrMatrix(matrix);
    expect(decoded.text).toBe(LONG_KANA_URL);
    expect(decoded.ecLevel).toBe('M');
    expect(decoded.version).toBeGreaterThanOrEqual(7); // exercises version information and multiple blocks
    expect(matrix.length).toBeGreaterThan(qrMatrix(DEMO_URL).length);
  });

  it('encodes raw kana as UTF-8 bytes', () => {
    const decoded = decodeQrMatrix(qrMatrix('ほしあかり'));
    expect(decoded.text).toBe('ほしあかり');
    expect(Array.from(decoded.bytes)).toEqual(Array.from(new TextEncoder().encode('ほしあかり')));
    expect(decodeQrMatrix(qrMatrix(KANA_DISPLAY)).text).toBe(KANA_DISPLAY);
  });

  it('leaves the library-wide string encoder untouched', () => {
    const before = qrcode.stringToBytes;
    qrSvgPath('ほしあかり');
    expect(qrcode.stringToBytes).toBe(before);
  });

  it('rejects text too long for a QR code with a ShioriError', () => {
    let caught: unknown;
    try {
      qrSvgPath('a'.repeat(3000));
    } catch (e) {
      caught = e;
    }
    expect(isShioriError(caught) && caught.code).toBe('validation');
  });

  it('the test reader is not vacuous: a flipped data module is detected', () => {
    const matrix = qrMatrix(DEMO_URL).map((row) => [...row]);
    const n = matrix.length;
    matrix[n - 1]![n - 1] = !matrix[n - 1]![n - 1];
    expect(() => decodeQrMatrix(matrix)).toThrow();
  });
});

// ---- renderQrPng with a recording fake OffscreenCanvas (jsdom/node have no canvas; the real rendering is
// checked in Chromium by the Playwright script) ----

interface Rect {
  style: string;
  x: number;
  y: number;
  w: number;
  h: number;
}
interface Text {
  text: string;
  x: number;
  y: number;
  px: number;
  width: number;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

class FakeCtx {
  fillStyle: string = '#000000';
  font = '10px sans-serif';
  textAlign = 'start';
  textBaseline = 'alphabetic';
  rects: Rect[] = [];
  texts: Text[] = [];
  fillRect(x: number, y: number, w: number, h: number) {
    this.rects.push({ style: this.fillStyle, x, y, w, h });
  }
  /** Monospace-ish metrics: ASCII 0.6 em, anything else 1 em. */
  measureText(text: string) {
    const px = this.px();
    return { width: Array.from(text).reduce((sum, ch) => sum + (ch.codePointAt(0)! < 0x100 ? px * 0.6 : px), 0) };
  }
  fillText(text: string, x: number, y: number) {
    expect(this.textAlign).toBe('center');
    this.texts.push({ text, x, y, px: this.px(), width: this.measureText(text).width });
  }
  private px(): number {
    return Number(/(\d+)px/.exec(this.font)?.[1]);
  }
}

class FakeOffscreenCanvas {
  static last: FakeOffscreenCanvas | undefined;
  readonly ctx = new FakeCtx();
  blobType: string | undefined;
  readonly width: number;
  readonly height: number;
  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    FakeOffscreenCanvas.last = this;
  }
  getContext(kind: string) {
    return kind === '2d' ? this.ctx : null;
  }
  async convertToBlob(options?: { type?: string }) {
    this.blobType = options?.type;
    return new Blob([new Uint8Array(PNG_SIGNATURE)], { type: 'image/png' });
  }
}

async function renderFake(url: string, caption: string) {
  vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas);
  const bytes = await renderQrPng(url, caption);
  const canvas = FakeOffscreenCanvas.last!;
  return { bytes, canvas, ctx: canvas.ctx };
}

describe('renderQrPng (fake canvas)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    FakeOffscreenCanvas.last = undefined;
  });

  it('draws a 512×600 PNG: white paper, crisp centered modules with a quiet zone', async () => {
    const { bytes, canvas, ctx } = await renderFake(DEMO_URL, 'ST4-RMA-P1X');
    expect(Array.from(bytes)).toEqual(PNG_SIGNATURE);
    expect([canvas.width, canvas.height]).toEqual([QR_PNG_WIDTH, QR_PNG_HEIGHT]);
    expect(canvas.blobType).toBe('image/png');

    const [paper, ...modules] = ctx.rects;
    expect(paper).toEqual({ style: '#ffffff', x: 0, y: 0, w: 512, h: 600 });
    const matrix = qrMatrix(DEMO_URL);
    const n = matrix.length;
    const scale = modules[0]!.h;
    expect(scale).toBe(Math.floor(512 / (n + 8)));
    const left = Math.min(...modules.map((r) => r.x));
    const top = Math.min(...modules.map((r) => r.y));
    for (const r of modules) {
      expect(r.style).toBe('#000000');
      expect([r.x, r.y, r.w, r.h].every(Number.isInteger)).toBe(true);
      expect(r.h).toBe(scale);
      expect(r.w % scale).toBe(0);
    }
    // quiet zone ≥ 4 modules on every side of the 512 square, and centered (±1 px)
    const right = 512 - (left + n * scale);
    const bottom = 512 - (top + n * scale);
    for (const margin of [left, top, right, bottom]) expect(margin).toBeGreaterThanOrEqual(4 * scale);
    expect(Math.abs(left - right)).toBeLessThanOrEqual(1);
    expect(Math.abs(top - bottom)).toBeLessThanOrEqual(1);
    // the rectangles reproduce the matrix exactly
    const grid = Array.from({ length: n }, () => new Array<boolean>(n).fill(false));
    for (const r of modules) {
      for (let i = 0; i < r.w / scale; i++) grid[(r.y - top) / scale]![(r.x - left) / scale + i] = true;
    }
    expect(grid).toEqual(matrix);
  });

  it('prints a Base32 caption on one line, centered under the QR, large and within the width', async () => {
    const { ctx } = await renderFake(DEMO_URL, 'ST4-RMA-P1X');
    expect(ctx.texts).toHaveLength(1);
    const [t] = ctx.texts;
    expect(t!.text).toBe('ST4-RMA-P1X');
    expect(t!.x).toBe(256);
    expect(t!.y - t!.px / 2).toBeGreaterThanOrEqual(512);
    expect(t!.y + t!.px / 2).toBeLessThanOrEqual(600);
    expect(t!.px).toBeGreaterThanOrEqual(36);
    expect(t!.width).toBeLessThanOrEqual(512 - 48);
  });

  it('shrinks and wraps a long kana caption at a separator so it stays readable', async () => {
    const { ctx } = await renderFake(LONG_KANA_URL, KANA_DISPLAY);
    expect(ctx.texts.map((t) => t.text)).toEqual(['ほたる・かえで・つばめ', 'こだま・すずめ']);
    for (const t of ctx.texts) {
      expect(t.px).toBeGreaterThanOrEqual(28);
      expect(t.width).toBeLessThanOrEqual(512 - 48);
      expect(t.y - t.px / 2).toBeGreaterThanOrEqual(512);
      expect(t.y + t.px / 2).toBeLessThanOrEqual(600);
    }
    expect(ctx.texts[0]!.y).toBeLessThan(ctx.texts[1]!.y);
  });

  it('shrinks a long caption without separators onto one line', async () => {
    const caption = 'ほしあかりほしあかりほしあかりほしあかりほしあかり';
    const { ctx } = await renderFake(DEMO_URL, caption);
    expect(ctx.texts).toHaveLength(1);
    expect(ctx.texts[0]!.width).toBeLessThanOrEqual(512 - 48);
  });

  it('skips an empty caption', async () => {
    const { ctx } = await renderFake(DEMO_URL, '  ');
    expect(ctx.texts).toHaveLength(0);
  });

  it('fails with a ShioriError when no canvas is available', async () => {
    vi.stubGlobal('OffscreenCanvas', undefined);
    const err = await renderQrPng(DEMO_URL, 'ST4-RMA-P1X').catch((e: unknown) => e);
    expect(isShioriError(err) && err.code).toBe('internal');
  });
});
