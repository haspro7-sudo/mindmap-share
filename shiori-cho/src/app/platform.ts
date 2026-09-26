// Thin browser wrappers. Every function is feature-detected, safe without window/navigator/document
// (SSR, tests, old browsers) and never throws, except readFileAsText, which rejects with
// ShioriError('io') when the file cannot be read (the caller has to tell the user).
import { ShioriError } from '../core/errors';

/** Delay before revoking a download's object URL (revoking at once can cancel the download in some browsers). */
export const DOWNLOAD_REVOKE_DELAY_MS = 10_000;

interface NavigatorExtras {
  /** iOS Safari: true when running from the home screen */
  standalone?: boolean;
}

function nav(): (Navigator & NavigatorExtras) | undefined {
  return typeof navigator === 'undefined' || navigator === null ? undefined : (navigator as Navigator & NavigatorExtras);
}

function doc(): Document | undefined {
  return typeof document === 'undefined' || document === null ? undefined : document;
}

/** matchMedia(query).matches, false when unsupported. */
export function mediaMatches(query: string): boolean {
  try {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
    return window.matchMedia(query).matches === true;
  } catch {
    return false;
  }
}

export function vibrate(ms: number): void {
  try {
    const n = nav();
    if (n && typeof n.vibrate === 'function') n.vibrate(ms);
  } catch {
    // unsupported or blocked: ignore
  }
}

/** Clipboard text, or null when unsupported, denied or empty-handed. */
export async function readClipboard(): Promise<string | null> {
  try {
    const clipboard = nav()?.clipboard;
    if (!clipboard || typeof clipboard.readText !== 'function') return null;
    const text = await clipboard.readText();
    return typeof text === 'string' ? text : null;
  } catch {
    return null;
  }
}

/** Legacy copy through a hidden textarea (older iOS Safari without the async Clipboard API). */
function copyWithTextarea(text: string): boolean {
  const d = doc();
  if (!d || typeof d.execCommand !== 'function' || !d.body) return false;
  const ta = d.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.top = '0';
  ta.style.left = '0';
  ta.style.opacity = '0';
  d.body.appendChild(ta);
  try {
    ta.select();
    ta.setSelectionRange(0, text.length);
    return d.execCommand('copy');
  } finally {
    ta.remove();
  }
}

/** true when the text was copied. */
export async function writeClipboard(text: string): Promise<boolean> {
  try {
    const clipboard = nav()?.clipboard;
    if (clipboard && typeof clipboard.writeText === 'function') {
      await clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to the legacy path
  }
  try {
    return copyWithTextarea(text);
  } catch {
    return false;
  }
}

/** navigator.storage.persist(); true when storage is (now) persistent. */
export async function requestPersist(): Promise<boolean> {
  try {
    const storage = nav()?.storage;
    if (!storage) return false;
    if (typeof storage.persisted === 'function' && (await storage.persisted()) === true) return true;
    if (typeof storage.persist !== 'function') return false;
    return (await storage.persist()) === true;
  } catch {
    return false;
  }
}

/** iPhone/iPod/iPad, including iPadOS that reports itself as a Mac (MacIntel with a touch screen). */
export function isIos(): boolean {
  try {
    const n = nav();
    if (!n) return false;
    const ua = typeof n.userAgent === 'string' ? n.userAgent : '';
    if (/iPhone|iPad|iPod/.test(ua)) return true;
    return n.platform === 'MacIntel' && typeof n.maxTouchPoints === 'number' && n.maxTouchPoints > 1;
  } catch {
    return false;
  }
}

/** Running as an installed app (home screen / display-mode standalone). */
export function isStandalone(): boolean {
  try {
    if (nav()?.standalone === true) return true;
  } catch {
    // ignore
  }
  return mediaMatches('(display-mode: standalone)');
}

/** iOS/iPadOS browser tab (not the home-screen app): storage is separate from the installed app (F11 AC3). */
export function isIosSafariNotStandalone(): boolean {
  return isIos() && !isStandalone();
}

export function isCoarsePointer(): boolean {
  return mediaMatches('(pointer: coarse)');
}

export function prefersReducedMotion(): boolean {
  return mediaMatches('(prefers-reduced-motion: reduce)');
}

function guessMime(filename: string): string {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.json')) return 'application/json';
  if (lower.endsWith('.zip')) return 'application/zip';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.csv')) return 'text/csv;charset=utf-8';
  return 'text/plain;charset=utf-8';
}

/**
 * Saves `data` as a file: Blob → object URL → a temporary <a download> clicked once → URL revoked later.
 * A string is stored as UTF-8 with `mime` (default: guessed from the file name). Does nothing without a DOM.
 */
export function download(filename: string, data: Blob | string, mime?: string): void {
  try {
    const d = doc();
    if (!d || typeof Blob === 'undefined' || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return;
    const blob =
      typeof data === 'string'
        ? new Blob([data], { type: mime ?? guessMime(filename) })
        : mime !== undefined && data.type !== mime
          ? new Blob([data], { type: mime })
          : data;
    const url = URL.createObjectURL(blob);
    try {
      const a = d.createElement('a');
      a.href = url;
      a.download = filename;
      a.rel = 'noopener';
      a.style.display = 'none';
      (d.body ?? d.documentElement).appendChild(a);
      a.click();
      a.remove();
    } finally {
      setTimeout(() => {
        try {
          URL.revokeObjectURL(url);
        } catch {
          // ignore
        }
      }, DOWNLOAD_REVOKE_DELAY_MS);
    }
  } catch {
    // unsupported: nothing to do
  }
}

const MSG_READ_FAILED = 'ファイルを読み込めませんでした';

function readWithFileReader(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(reader.error ?? new Error('FileReader failed'));
    reader.readAsText(file, 'utf-8');
  });
}

/** The file's text (UTF-8). Rejects with ShioriError('io', 「ファイルを読み込めませんでした」) on failure. */
export async function readFileAsText(file: File): Promise<string> {
  try {
    if (file && typeof file.text === 'function') return await file.text();
    if (typeof FileReader !== 'undefined') return await readWithFileReader(file);
  } catch (cause) {
    throw new ShioriError('io', MSG_READ_FAILED, { cause });
  }
  throw new ShioriError('io', MSG_READ_FAILED);
}
