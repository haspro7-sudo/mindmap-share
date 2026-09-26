// QR codes for the creator kit (PNG, docs/SPEC.md F15 AC6 / §4.4) and for on-screen display (SVG path).
// Everything is computed locally with 'qrcode-generator': error correction M, automatic version, byte mode
// with the text encoded as UTF-8 (unlock URLs are percent-encoded ASCII, but raw kana must survive too).
import qrcode from 'qrcode-generator';
import { ShioriError } from '../../core/errors';

/** Light modules around the symbol, in modules (the QR spec's minimum quiet zone). */
export const QR_QUIET_ZONE = 4;
/** Kit PNG size in px: the QR fills the top QR_PNG_WIDTH × QR_PNG_WIDTH square, the caption sits below. */
export const QR_PNG_WIDTH = 512;
export const QR_PNG_HEIGHT = 600;

const MSG_TOO_LONG = 'QRコードにするには文字数が多すぎます';
const MSG_NO_CANVAS = 'この環境ではQRコードの画像を作れません';
const MSG_PNG_FAILED = 'QRコードの画像を作れませんでした';

const utf8Encoder = new TextEncoder();
function utf8Bytes(s: string): number[] {
  return Array.from(utf8Encoder.encode(s));
}

/**
 * The QR symbol for `text` as a square matrix of modules (true = dark), without the quiet zone.
 * Deterministic: the same text always gives the same matrix (EC level M, smallest fitting version,
 * the library's best mask). Throws ShioriError('validation') when the text does not fit in version 40.
 */
export function qrMatrix(text: string): boolean[][] {
  const qr = qrcode(0, 'M');
  // Byte mode reads `qrcode.stringToBytes` once, when the segment is added. The library default keeps only
  // the low 8 bits of each UTF-16 unit (so kana would be corrupted); swap in UTF-8 just for this call and
  // restore whatever was installed, so other users of the library are unaffected.
  const previous = qrcode.stringToBytes;
  qrcode.stringToBytes = utf8Bytes;
  try {
    qr.addData(text, 'Byte');
  } finally {
    qrcode.stringToBytes = previous;
  }
  try {
    qr.make();
  } catch (e) {
    throw new ShioriError('validation', MSG_TOO_LONG, { cause: e });
  }
  const n = qr.getModuleCount();
  const rows: boolean[][] = [];
  for (let r = 0; r < n; r++) {
    const row: boolean[] = [];
    for (let c = 0; c < n; c++) row.push(qr.isDark(r, c));
    rows.push(row);
  }
  return rows;
}

/** Horizontal runs of dark modules in one row: [startColumn, length][]. */
function darkRuns(row: readonly boolean[]): Array<[number, number]> {
  const runs: Array<[number, number]> = [];
  let c = 0;
  while (c < row.length) {
    if (!row[c]) {
      c++;
      continue;
    }
    const start = c;
    while (c < row.length && row[c]) c++;
    runs.push([start, c - start]);
  }
  return runs;
}

/**
 * QR as an SVG path string for on-screen display (no network, no innerHTML).
 * `size` is the edge length in modules including the 4-module quiet zone on every side, so the path fits
 * `viewBox="0 0 size size"`. `path` holds one closed rectangle `M x y h n v1 h-n z` per horizontal run of dark
 * modules (coordinates already offset by the quiet zone). Throws ShioriError('validation') for text too long.
 */
export function qrSvgPath(text: string): { size: number; path: string } {
  const matrix = qrMatrix(text);
  const parts: string[] = [];
  matrix.forEach((row, y) => {
    for (const [x, len] of darkRuns(row)) {
      parts.push(`M${x + QR_QUIET_ZONE} ${y + QR_QUIET_ZONE}h${len}v1h-${len}z`);
    }
  });
  return { size: matrix.length + 2 * QR_QUIET_ZONE, path: parts.join('') };
}

/** The part of the 2D context API the renderer uses (shared by OffscreenCanvas and <canvas>). */
type Ctx2D = Pick<
  CanvasRenderingContext2D,
  'fillStyle' | 'fillRect' | 'font' | 'textAlign' | 'textBaseline' | 'measureText' | 'fillText'
>;

interface Surface {
  ctx: Ctx2D;
  toPng(): Promise<Uint8Array>;
}

async function blobBytes(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer());
}

function createSurface(width: number, height: number): Surface {
  if (typeof OffscreenCanvas === 'function') {
    let offscreen: Surface | null = null;
    try {
      const canvas = new OffscreenCanvas(width, height);
      const ctx = typeof canvas.convertToBlob === 'function' ? canvas.getContext('2d') : null;
      if (ctx) offscreen = { ctx, toPng: async () => blobBytes(await canvas.convertToBlob({ type: 'image/png' })) };
    } catch {
      // older engines: OffscreenCanvas without a 2D context — fall back to a DOM canvas
    }
    if (offscreen) return offscreen;
  }
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      return {
        ctx,
        toPng: () =>
          new Promise<Uint8Array>((resolve, reject) => {
            canvas.toBlob((blob) => {
              if (!blob) {
                reject(new ShioriError('internal', MSG_PNG_FAILED));
                return;
              }
              blobBytes(blob).then(resolve, reject);
            }, 'image/png');
          }),
      };
    }
  }
  throw new ShioriError('internal', MSG_NO_CANVAS);
}

// Caption layout (px). The caption band is the 88 px under the QR square; the QR's own quiet zone already
// separates it from the symbol.
const CAPTION_TOP = QR_PNG_WIDTH;
const CAPTION_CENTER_Y = CAPTION_TOP + (QR_PNG_HEIGHT - CAPTION_TOP) / 2 - 6;
const CAPTION_MAX_WIDTH = QR_PNG_WIDTH - 2 * 24;
const CAPTION_MAX_PX = 44;
const CAPTION_TWO_LINE_MAX_PX = 32;
const CAPTION_TWO_LINE_BELOW_PX = 30; // prefer two lines when one line would be smaller than this
const CAPTION_MIN_PX = 8;
const CAPTION_LINE_HEIGHT = 1.2;
const CAPTION_FONT_FAMILY =
  "ui-monospace, 'SFMono-Regular', Menlo, Consolas, 'Hiragino Sans', 'Noto Sans JP', 'Noto Sans Mono CJK JP', monospace";
const INK = '#000000';
const PAPER = '#ffffff';

function captionFont(px: number): string {
  return `600 ${px}px ${CAPTION_FONT_FAMILY}`;
}

/** Largest integer font size ≤ maxPx at which every line fits `maxWidth` (never below CAPTION_MIN_PX). */
function fitFontPx(ctx: Ctx2D, lines: readonly string[], maxWidth: number, maxPx: number): number {
  const widthAt = (px: number) => {
    ctx.font = captionFont(px);
    return Math.max(...lines.map((l) => ctx.measureText(l).width));
  };
  const w = widthAt(maxPx);
  let px = w <= maxWidth ? maxPx : Math.max(CAPTION_MIN_PX, Math.floor((maxPx * maxWidth) / w));
  while (px > CAPTION_MIN_PX && widthAt(px) > maxWidth) px--;
  return px;
}

const SEPARATORS = ['・', ' ', '　', '-'];

/** Splits at the separator closest to the middle (the separator itself is dropped), or null if there is none. */
function splitInTwo(text: string): [string, string] | null {
  const chars = Array.from(text);
  let best = -1;
  for (let i = 1; i < chars.length - 1; i++) {
    if (!SEPARATORS.includes(chars[i]!)) continue;
    if (best < 0 || Math.abs(i - chars.length / 2) < Math.abs(best - chars.length / 2)) best = i;
  }
  if (best < 0) return null;
  const first = chars.slice(0, best).join('').trim();
  const second = chars.slice(best + 1).join('').trim();
  return first && second ? [first, second] : null;
}

/** Caption lines and font size: one line when it stays readable, else two balanced lines if the text splits. */
function layoutQrCaption(ctx: Ctx2D, caption: string): { lines: string[]; px: number } {
  const text = caption.trim();
  if (!text) return { lines: [], px: 0 };
  const onePx = fitFontPx(ctx, [text], CAPTION_MAX_WIDTH, CAPTION_MAX_PX);
  if (onePx >= CAPTION_TWO_LINE_BELOW_PX) return { lines: [text], px: onePx };
  const split = splitInTwo(text);
  if (split) {
    const twoPx = fitFontPx(ctx, split, CAPTION_MAX_WIDTH, CAPTION_TWO_LINE_MAX_PX);
    if (twoPx > onePx) return { lines: split, px: twoPx };
  }
  return { lines: [text], px: onePx };
}

function drawCaption(ctx: Ctx2D, caption: string): void {
  const { lines, px } = layoutQrCaption(ctx, caption);
  if (lines.length === 0) return;
  ctx.font = captionFont(px);
  ctx.fillStyle = INK;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const step = px * CAPTION_LINE_HEIGHT;
  const firstY = CAPTION_CENTER_Y - (step * (lines.length - 1)) / 2;
  lines.forEach((line, i) => ctx.fillText(line, QR_PNG_WIDTH / 2, Math.round(firstY + i * step)));
}

/**
 * Renders the kit QR image (docs/SPEC.md §4.4): a 512×600 PNG on white, the QR (EC level M) of `url` centered
 * in the top 512×512 square with at least a 4-module quiet zone and an integer px-per-module scale (crisp
 * modules), and `caption` (the code as the work shows it, e.g. 「ST4-RMA-P1X」) centered underneath in dark
 * text, shrunk to fit (long kana captions wrap onto two lines at a separator). Uses OffscreenCanvas when
 * available, else a DOM canvas; returns the PNG bytes. Throws ShioriError when the url is too long for a QR
 * or when no canvas is available (e.g. jsdom).
 */
export async function renderQrPng(url: string, caption: string): Promise<Uint8Array> {
  const matrix = qrMatrix(url);
  const modules = matrix.length + 2 * QR_QUIET_ZONE;
  const scale = Math.floor(QR_PNG_WIDTH / modules);
  if (scale < 1) throw new ShioriError('validation', MSG_TOO_LONG);
  const origin = Math.floor((QR_PNG_WIDTH - scale * modules) / 2) + QR_QUIET_ZONE * scale;

  const { ctx, toPng } = createSurface(QR_PNG_WIDTH, QR_PNG_HEIGHT);
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, QR_PNG_WIDTH, QR_PNG_HEIGHT);
  ctx.fillStyle = INK;
  matrix.forEach((row, y) => {
    for (const [x, len] of darkRuns(row)) {
      ctx.fillRect(origin + x * scale, origin + y * scale, len * scale, scale);
    }
  });
  drawCaption(ctx, caption);
  return toPng();
}
