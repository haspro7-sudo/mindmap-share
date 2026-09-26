import { ShioriError } from './errors';
import type { B64u, Bytes } from './types';

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

export function utf8(s: string): Bytes {
  return encoder.encode(s) as Bytes;
}

/** Strict UTF-8 decode; throws ShioriError('encoding') on invalid input. */
export function fromUtf8(b: Uint8Array): string {
  try {
    return decoder.decode(b);
  } catch (cause) {
    throw new ShioriError('encoding', '文字コードが正しくありません', { cause });
  }
}

const B64U_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const B64U_LOOKUP = (() => {
  const t = new Int16Array(128).fill(-1);
  for (let i = 0; i < B64U_ALPHABET.length; i++) t[B64U_ALPHABET.charCodeAt(i)] = i;
  return t;
})();

/** base64url without padding (RFC 4648 §5). */
export function b64uEncode(b: Uint8Array): B64u {
  let out = '';
  let i = 0;
  for (; i + 2 < b.length; i += 3) {
    const n = (b[i]! << 16) | (b[i + 1]! << 8) | b[i + 2]!;
    out +=
      B64U_ALPHABET[(n >> 18) & 63]! +
      B64U_ALPHABET[(n >> 12) & 63]! +
      B64U_ALPHABET[(n >> 6) & 63]! +
      B64U_ALPHABET[n & 63]!;
  }
  const rest = b.length - i;
  if (rest === 1) {
    const n = b[i]! << 16;
    out += B64U_ALPHABET[(n >> 18) & 63]! + B64U_ALPHABET[(n >> 12) & 63]!;
  } else if (rest === 2) {
    const n = (b[i]! << 16) | (b[i + 1]! << 8);
    out += B64U_ALPHABET[(n >> 18) & 63]! + B64U_ALPHABET[(n >> 12) & 63]! + B64U_ALPHABET[(n >> 6) & 63]!;
  }
  return out;
}

/** Strict base64url decode (no padding, no '+/='); throws ShioriError('encoding'). */
export function b64uDecode(s: string): Bytes {
  if (s.length % 4 === 1) throw new ShioriError('encoding', 'base64urlの長さが正しくありません');
  const out = new Uint8Array(Math.floor((s.length * 3) / 4));
  let o = 0;
  let acc = 0;
  let bits = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    const v = c < 128 ? B64U_LOOKUP[c]! : -1;
    if (v < 0) throw new ShioriError('encoding', 'base64urlに使えない文字が含まれています');
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (acc >> bits) & 0xff;
    }
  }
  // Non-canonical trailing bits must be zero.
  if (bits > 0 && (acc & ((1 << bits) - 1)) !== 0) {
    throw new ShioriError('encoding', 'base64urlの末尾が正しくありません');
  }
  return out.slice(0, o) as Bytes;
}

export function concatBytes(...parts: Uint8Array[]): Bytes {
  const len = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(len);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out as Bytes;
}

export function randomBytes(n: number): Bytes {
  const out = new Uint8Array(n);
  globalThis.crypto.getRandomValues(out);
  return out as Bytes;
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

export async function sha256(data: Uint8Array): Promise<Bytes> {
  const copy = new Uint8Array(data) as Bytes;
  return new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', copy)) as Bytes;
}

export function toHex(b: Uint8Array): string {
  let s = '';
  for (const x of b) s += x.toString(16).padStart(2, '0');
  return s;
}

export function fromHex(s: string): Bytes {
  if (s.length % 2 !== 0 || /[^0-9a-f]/i.test(s)) throw new ShioriError('encoding', '16進数の形式が正しくありません');
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out as Bytes;
}

/** Random generator type used for dependency injection in tests. */
export type Rng = (n: number) => Bytes;
