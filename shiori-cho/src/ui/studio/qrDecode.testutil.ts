// Test-only QR reader (never imported by app code): decodes a clean, axis-aligned module matrix back to its bytes,
// written from the QR standard (ISO/IEC 18004) independently of 'qrcode-generator', so tests can check that what
// we render really carries the intended text. Also reads a matrix back from RGBA pixels (for the rendered PNG).
// Scope: EC level M, byte-mode segments, no error correction (the Reed–Solomon syndromes must all be zero).

export interface DecodedQr {
  text: string;
  bytes: Uint8Array;
  version: number;
  ecLevel: 'L' | 'M' | 'Q' | 'H';
  mask: number;
}

type Matrix = readonly (readonly boolean[])[];

// Per version (index 1..40), EC level M: error-correction codewords per block, and number of blocks.
const ECC_PER_BLOCK_M = [
  -1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28,
  28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28,
];
const BLOCKS_M = [
  -1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31,
  33, 35, 37, 38, 40, 43, 45, 47, 49,
];

const EC_BY_BITS = ['M', 'L', 'H', 'Q'] as const;

function bchRemainder(value: number, generator: number, genBits: number): number {
  let v = value;
  const top = genBits - 1;
  for (let bit = 31 - Math.clz32(v); bit >= top; bit = 31 - Math.clz32(v)) {
    v ^= generator << (bit - top);
  }
  return v;
}

function formatWord(data5: number): number {
  return ((data5 << 10) | bchRemainder(data5 << 10, 0x537, 11)) ^ 0x5412;
}

function versionWord(version: number): number {
  return (version << 12) | bchRemainder(version << 12, 0x1f25, 13);
}

function alignmentCenters(version: number, size: number): number[] {
  if (version === 1) return [];
  const count = Math.floor(version / 7) + 2;
  const step = Math.floor((version * 8 + count * 3 + 5) / (count * 4 - 4)) * 2;
  const out = [6];
  for (let i = count - 1, pos = size - 7; i >= 1; i--, pos -= step) out.splice(1, 0, pos);
  return out;
}

function maskBit(mask: number, r: number, c: number): boolean {
  switch (mask) {
    case 0:
      return (r + c) % 2 === 0;
    case 1:
      return r % 2 === 0;
    case 2:
      return c % 3 === 0;
    case 3:
      return (r + c) % 3 === 0;
    case 4:
      return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0;
    case 5:
      return ((r * c) % 2) + ((r * c) % 3) === 0;
    case 6:
      return (((r * c) % 2) + ((r * c) % 3)) % 2 === 0;
    default:
      return (((r + c) % 2) + ((r * c) % 3)) % 2 === 0;
  }
}

// GF(256), primitive polynomial x^8 + x^4 + x^3 + x^2 + 1.
const GF_EXP = new Array<number>(512);
const GF_LOG = new Array<number>(256).fill(0);
{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255]!;
}
function gfMul(a: number, b: number): number {
  return a === 0 || b === 0 ? 0 : GF_EXP[GF_LOG[a]! + GF_LOG[b]!]!;
}

/** Decodes a QR module matrix (true = dark, no quiet zone). Throws a plain Error describing what is wrong. */
export function decodeQrMatrix(m: Matrix): DecodedQr {
  const n = m.length;
  if (!m.every((row) => row.length === n)) throw new Error('matrix is not square');
  const version = (n - 17) / 4;
  if (!Number.isInteger(version) || version < 1 || version > 40) throw new Error(`bad size ${n}`);
  const dark = (r: number, c: number) => (m[r]![c]! ? 1 : 0);

  // Format information: two copies, bit 14 first.
  let f1 = 0;
  for (let c = 0; c <= 5; c++) f1 = (f1 << 1) | dark(8, c);
  f1 = (f1 << 1) | dark(8, 7);
  f1 = (f1 << 1) | dark(8, 8);
  f1 = (f1 << 1) | dark(7, 8);
  for (let r = 5; r >= 0; r--) f1 = (f1 << 1) | dark(r, 8);
  let f2 = 0;
  for (let r = n - 1; r >= n - 7; r--) f2 = (f2 << 1) | dark(r, 8);
  for (let c = n - 8; c < n; c++) f2 = (f2 << 1) | dark(8, c);
  if (f1 !== f2) throw new Error('format copies differ');
  let data5 = -1;
  for (let d = 0; d < 32; d++) if (formatWord(d) === f1) data5 = d;
  if (data5 < 0) throw new Error('bad format information');
  const ecLevel = EC_BY_BITS[data5 >> 3]!;
  const mask = data5 & 7;
  if (!dark(n - 8, 8)) throw new Error('dark module missing');

  // Version information (v7+): two copies of 18 bits, bit i at (i/3, n-11+i%3) and mirrored.
  if (version >= 7) {
    let va = 0;
    let vb = 0;
    for (let i = 17; i >= 0; i--) {
      va = (va << 1) | dark(Math.floor(i / 3), n - 11 + (i % 3));
      vb = (vb << 1) | dark(n - 11 + (i % 3), Math.floor(i / 3));
    }
    if (va !== versionWord(version) || vb !== va) throw new Error('bad version information');
  }
  if (ecLevel !== 'M') throw new Error(`EC level ${ecLevel} not supported by this reader`);

  // Function patterns.
  const fn = Array.from({ length: n }, () => new Array<boolean>(n).fill(false));
  const mark = (r0: number, c0: number, h: number, w: number) => {
    for (let r = r0; r < r0 + h; r++) for (let c = c0; c < c0 + w; c++) fn[r]![c] = true;
  };
  mark(0, 0, 9, 9);
  mark(0, n - 8, 9, 8);
  mark(n - 8, 0, 8, 9);
  mark(6, 0, 1, n);
  mark(0, 6, n, 1);
  const centers = alignmentCenters(version, n);
  const last = centers.length - 1;
  centers.forEach((r, i) =>
    centers.forEach((c, j) => {
      if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return;
      mark(r - 2, c - 2, 5, 5);
    }),
  );
  if (version >= 7) {
    mark(0, n - 11, 6, 3);
    mark(n - 11, 0, 3, 6);
  }

  // Data modules in zigzag order, unmasked.
  const bits: number[] = [];
  for (let right = n - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    const upward = ((right + 1) & 2) === 0;
    for (let v = 0; v < n; v++) {
      const r = upward ? n - 1 - v : v;
      for (let j = 0; j < 2; j++) {
        const c = right - j;
        if (fn[r]![c]) continue;
        bits.push(dark(r, c) ^ (maskBit(mask, r, c) ? 1 : 0));
      }
    }
  }
  const total = Math.floor(bits.length / 8);
  const codewords: number[] = [];
  for (let i = 0; i < total; i++) {
    let b = 0;
    for (let k = 0; k < 8; k++) b = (b << 1) | bits[i * 8 + k]!;
    codewords.push(b);
  }

  // De-interleave into blocks and check every Reed–Solomon syndrome.
  const blockCount = BLOCKS_M[version]!;
  const ecc = ECC_PER_BLOCK_M[version]!;
  const shortLen = Math.floor(total / blockCount);
  const shortCount = blockCount - (total % blockCount);
  const dataLens = Array.from({ length: blockCount }, (_, i) => (i < shortCount ? shortLen : shortLen + 1) - ecc);
  const blocks: number[][] = dataLens.map(() => []);
  let k = 0;
  for (let i = 0; i <= shortLen - ecc; i++) {
    for (let j = 0; j < blockCount; j++) if (i < dataLens[j]!) blocks[j]!.push(codewords[k++]!);
  }
  for (let i = 0; i < ecc; i++) for (let j = 0; j < blockCount; j++) blocks[j]!.push(codewords[k++]!);
  if (k !== total) throw new Error('block layout mismatch');
  for (const block of blocks) {
    for (let i = 0; i < ecc; i++) {
      let s = 0;
      for (const cw of block) s = gfMul(s, GF_EXP[i]!) ^ cw;
      if (s !== 0) throw new Error('Reed–Solomon syndrome is not zero');
    }
  }

  // Parse the data bit stream (byte-mode segments only).
  const data = blocks.flatMap((b, j) => b.slice(0, dataLens[j]));
  let pos = 0;
  const read = (count: number) => {
    let v = 0;
    for (let i = 0; i < count; i++) {
      const byte = data[(pos + i) >> 3] ?? 0;
      v = (v << 1) | ((byte >> (7 - ((pos + i) & 7))) & 1);
    }
    pos += count;
    return v;
  };
  const out: number[] = [];
  while (pos + 4 <= data.length * 8) {
    const mode = read(4);
    if (mode === 0) break;
    if (mode !== 0b0100) throw new Error(`unsupported mode ${mode.toString(2)}`);
    const count = read(version <= 9 ? 8 : 16);
    if (pos + count * 8 > data.length * 8) throw new Error('segment overruns data');
    for (let i = 0; i < count; i++) out.push(read(8));
  }
  const bytes = Uint8Array.from(out);
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  return { text, bytes, version, ecLevel, mask };
}

/**
 * Reads the module matrix back from an image (RGBA, row-major): finds the dark bounding box, derives the module
 * size from the top-left finder pattern's 7-module width, then samples each module's center.
 */
export function matrixFromPixels(
  rgba: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
): { matrix: boolean[][]; modulePx: number; left: number; top: number } {
  const isDark = (x: number, y: number) => {
    const i = (y * width + x) * 4;
    return rgba[i]! + rgba[i + 1]! + rgba[i + 2]! < 384;
  };
  let top = -1;
  let left = -1;
  for (let y = 0; y < height && top < 0; y++) {
    for (let x = 0; x < width; x++) {
      if (isDark(x, y)) {
        top = y;
        left = x;
        break;
      }
    }
  }
  if (top < 0) throw new Error('no dark pixels');
  let run = 0;
  while (left + run < width && isDark(left + run, top)) run++;
  const modulePx = run / 7;
  let right = left + run - 1;
  for (let x = width - 1; x > right; x--) {
    if (isDark(x, top)) {
      right = x;
      break;
    }
  }
  const n = Math.round((right - left + 1) / modulePx);
  const matrix: boolean[][] = [];
  for (let r = 0; r < n; r++) {
    const row: boolean[] = [];
    for (let c = 0; c < n; c++) {
      row.push(isDark(Math.floor(left + (c + 0.5) * modulePx), Math.floor(top + (r + 0.5) * modulePx)));
    }
    matrix.push(row);
  }
  return { matrix, modulePx, left, top };
}
