import { afterEach, describe, it, expect, vi } from 'vitest';
import { isShioriError } from '../core/errors';
import {
  DOWNLOAD_REVOKE_DELAY_MS,
  download,
  isCoarsePointer,
  isIos,
  isIosSafariNotStandalone,
  isStandalone,
  prefersReducedMotion,
  readClipboard,
  readFileAsText,
  requestPersist,
  vibrate,
  writeClipboard,
} from './platform';

const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const IPAD_DESKTOP_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
const ANDROID_UA =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36';

function stubNavigator(n: Record<string, unknown>): void {
  vi.stubGlobal('navigator', n);
}

function stubMatchMedia(matching: readonly string[]): void {
  vi.stubGlobal('window', { matchMedia: (q: string) => ({ matches: matching.includes(q) }) });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('without a browser (node)', () => {
  it('never throws and reports "unsupported"', async () => {
    expect(typeof window).toBe('undefined');
    expect(typeof document).toBe('undefined');
    expect(() => vibrate(30)).not.toThrow();
    expect(await readClipboard()).toBeNull();
    expect(await writeClipboard('K7Q-M2X-RAP')).toBe(false);
    expect(await requestPersist()).toBe(false);
    expect(isIos()).toBe(false);
    expect(isStandalone()).toBe(false);
    expect(isIosSafariNotStandalone()).toBe(false);
    expect(isCoarsePointer()).toBe(false);
    expect(prefersReducedMotion()).toBe(false);
    expect(() => download('shiori-backup-20260922.json', '{}')).not.toThrow();
  });

  it('works without any navigator at all', async () => {
    vi.stubGlobal('navigator', undefined);
    expect(() => vibrate(30)).not.toThrow();
    expect(await readClipboard()).toBeNull();
    expect(await requestPersist()).toBe(false);
    expect(isIosSafariNotStandalone()).toBe(false);
  });
});

describe('vibrate', () => {
  it('calls navigator.vibrate and swallows errors', () => {
    const v = vi.fn();
    stubNavigator({ vibrate: v });
    vibrate(30);
    expect(v).toHaveBeenCalledWith(30);
    stubNavigator({
      vibrate: () => {
        throw new Error('blocked');
      },
    });
    expect(() => vibrate(30)).not.toThrow();
  });
});

describe('clipboard', () => {
  it('reads text, or null when denied', async () => {
    stubNavigator({ clipboard: { readText: async () => 'ST4-RMA-P1X' } });
    expect(await readClipboard()).toBe('ST4-RMA-P1X');
    stubNavigator({ clipboard: { readText: () => Promise.reject(new Error('NotAllowedError')) } });
    expect(await readClipboard()).toBeNull();
  });

  it('writes text; false when denied and no legacy path exists', async () => {
    const writeText = vi.fn(async () => undefined);
    stubNavigator({ clipboard: { writeText } });
    expect(await writeClipboard('ほしあかり')).toBe(true);
    expect(writeText).toHaveBeenCalledWith('ほしあかり');
    stubNavigator({ clipboard: { writeText: () => Promise.reject(new Error('NotAllowedError')) } });
    expect(await writeClipboard('ほしあかり')).toBe(false);
  });

  it('falls back to a hidden textarea + execCommand', async () => {
    stubNavigator({});
    const ta = {
      value: '',
      style: {} as Record<string, string>,
      setAttribute: vi.fn(),
      select: vi.fn(),
      setSelectionRange: vi.fn(),
      remove: vi.fn(),
    };
    const execCommand = vi.fn(() => true);
    const appendChild = vi.fn();
    vi.stubGlobal('document', { execCommand, body: { appendChild }, createElement: () => ta });
    expect(await writeClipboard('K7Q-M2X-RAP')).toBe(true);
    expect(ta.value).toBe('K7Q-M2X-RAP');
    expect(execCommand).toHaveBeenCalledWith('copy');
    expect(appendChild).toHaveBeenCalledWith(ta);
    expect(ta.remove).toHaveBeenCalled();
  });
});

describe('requestPersist', () => {
  it('returns true when already persisted', async () => {
    const persist = vi.fn(async () => false);
    stubNavigator({ storage: { persisted: async () => true, persist } });
    expect(await requestPersist()).toBe(true);
    expect(persist).not.toHaveBeenCalled();
  });

  it('asks for persistence and reports the answer', async () => {
    stubNavigator({ storage: { persisted: async () => false, persist: async () => true } });
    expect(await requestPersist()).toBe(true);
    stubNavigator({ storage: { persisted: async () => false, persist: async () => false } });
    expect(await requestPersist()).toBe(false);
    stubNavigator({ storage: { persist: () => Promise.reject(new Error('SecurityError')) } });
    expect(await requestPersist()).toBe(false);
  });
});

describe('isIosSafariNotStandalone', () => {
  it('is true in an iPhone browser tab', () => {
    stubNavigator({ userAgent: IPHONE_UA, platform: 'iPhone', maxTouchPoints: 5 });
    expect(isIos()).toBe(true);
    expect(isIosSafariNotStandalone()).toBe(true);
  });

  it('detects iPadOS that reports itself as a Mac', () => {
    stubNavigator({ userAgent: IPAD_DESKTOP_UA, platform: 'MacIntel', maxTouchPoints: 5 });
    expect(isIosSafariNotStandalone()).toBe(true);
  });

  it('is false on a real Mac, on Android and in the home-screen app', () => {
    stubNavigator({ userAgent: IPAD_DESKTOP_UA, platform: 'MacIntel', maxTouchPoints: 0 });
    expect(isIosSafariNotStandalone()).toBe(false);
    stubNavigator({ userAgent: ANDROID_UA, platform: 'Linux armv8l', maxTouchPoints: 5 });
    expect(isIosSafariNotStandalone()).toBe(false);
    stubNavigator({ userAgent: IPHONE_UA, platform: 'iPhone', maxTouchPoints: 5, standalone: true });
    expect(isIosSafariNotStandalone()).toBe(false);
  });

  it('treats display-mode: standalone as the installed app', () => {
    stubNavigator({ userAgent: IPHONE_UA, platform: 'iPhone', maxTouchPoints: 5 });
    stubMatchMedia(['(display-mode: standalone)']);
    expect(isStandalone()).toBe(true);
    expect(isIosSafariNotStandalone()).toBe(false);
  });

  it('never throws on a hostile navigator', () => {
    vi.stubGlobal('navigator', {
      get userAgent(): string {
        throw new Error('nope');
      },
    });
    expect(isIosSafariNotStandalone()).toBe(false);
  });
});

describe('media queries', () => {
  it('reads pointer and reduced-motion preferences', () => {
    stubMatchMedia(['(pointer: coarse)', '(prefers-reduced-motion: reduce)']);
    expect(isCoarsePointer()).toBe(true);
    expect(prefersReducedMotion()).toBe(true);
    stubMatchMedia([]);
    expect(isCoarsePointer()).toBe(false);
    expect(prefersReducedMotion()).toBe(false);
  });

  it('is false when matchMedia throws', () => {
    vi.stubGlobal('window', {
      matchMedia: () => {
        throw new Error('nope');
      },
    });
    expect(isCoarsePointer()).toBe(false);
  });
});

describe('download', () => {
  function fakeDom() {
    const anchor = { href: '', download: '', rel: '', style: {} as Record<string, string>, click: vi.fn(), remove: vi.fn() };
    const appendChild = vi.fn();
    vi.stubGlobal('document', { body: { appendChild }, createElement: vi.fn(() => anchor) });
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fake');
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    return { anchor, appendChild, createObjectURL, revokeObjectURL };
  }

  it('clicks a temporary <a download> and revokes the URL later', async () => {
    vi.useFakeTimers();
    const { anchor, appendChild, createObjectURL, revokeObjectURL } = fakeDom();
    download('shiori-backup-20260922.json', '{"a":1}');
    expect(anchor.download).toBe('shiori-backup-20260922.json');
    expect(anchor.href).toBe('blob:fake');
    expect(appendChild).toHaveBeenCalledWith(anchor);
    expect(anchor.click).toHaveBeenCalledOnce();
    expect(anchor.remove).toHaveBeenCalledOnce();

    const blob = createObjectURL.mock.calls[0]![0] as Blob;
    expect(blob.type).toBe('application/json');
    expect(await blob.text()).toBe('{"a":1}');

    expect(revokeObjectURL).not.toHaveBeenCalled();
    vi.advanceTimersByTime(DOWNLOAD_REVOKE_DELAY_MS);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:fake');
  });

  it('uses the given mime type and passes blobs through', () => {
    vi.useFakeTimers();
    const { createObjectURL } = fakeDom();
    download('memo.txt', 'メモ', 'text/plain;charset=utf-8');
    expect((createObjectURL.mock.calls[0]![0] as Blob).type).toBe('text/plain;charset=utf-8');
    const zip = new Blob([new Uint8Array([0x50, 0x4b])], { type: 'application/zip' });
    download('shiori-kit-w-test00001.zip', zip);
    expect(createObjectURL.mock.calls[1]![0]).toBe(zip);
    download('kit.zip', 'x');
    expect((createObjectURL.mock.calls[2]![0] as Blob).type).toBe('application/zip');
  });

  it('never throws when the DOM misbehaves', () => {
    vi.stubGlobal('document', {
      createElement: () => {
        throw new Error('nope');
      },
    });
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fake');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    expect(() => download('a.json', '{}')).not.toThrow();
  });
});

describe('readFileAsText', () => {
  it('reads a File as UTF-8 text', async () => {
    const file = new File(['{"schema":"shiori/1","title":"星読みの図書館"}'], 'shiori.json', { type: 'application/json' });
    expect(await readFileAsText(file)).toBe('{"schema":"shiori/1","title":"星読みの図書館"}');
  });

  it('rejects with ShioriError("io") when reading fails', async () => {
    const broken = { text: () => Promise.reject(new Error('NotReadableError')) } as unknown as File;
    const e = await readFileAsText(broken).catch((err: unknown) => err);
    expect(isShioriError(e) && e.code).toBe('io');
    expect(isShioriError(e) && e.messageJa).toBe('ファイルを読み込めませんでした');
  });
});
