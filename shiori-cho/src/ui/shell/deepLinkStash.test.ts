// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { clearDeepLinkStash, readDeepLinkStash, writeDeepLinkStash } from './deepLinkStash';

const NOW = 1_800_000_000_000;

beforeEach(() => {
  window.sessionStorage.clear();
});

describe('deep-link stash (F11 AC1)', () => {
  it('keeps the link for this tab until it is cleared', () => {
    writeDeepLinkStash({ manifestWorkId: 'demo-hoshiyomi', code: 'ST4RMAP1X' }, NOW);
    expect(readDeepLinkStash(NOW + 1000)).toEqual({ manifestWorkId: 'demo-hoshiyomi', code: 'ST4RMAP1X' });
    clearDeepLinkStash();
    expect(readDeepLinkStash(NOW + 1000)).toBeNull();
  });

  it('drops a link that was never processed after a while', () => {
    writeDeepLinkStash({ manifestWorkId: 'w-1', code: 'ABC' }, NOW);
    expect(readDeepLinkStash(NOW + 31 * 60_000)).toBeNull();
  });

  it('ignores damaged or foreign values', () => {
    window.sessionStorage.setItem('shiori.deeplink', 'not json');
    expect(readDeepLinkStash(NOW)).toBeNull();
    window.sessionStorage.setItem('shiori.deeplink', JSON.stringify({ manifestWorkId: 1, code: 'x', at: NOW }));
    expect(readDeepLinkStash(NOW)).toBeNull();
    window.sessionStorage.setItem('shiori.deeplink', JSON.stringify({ manifestWorkId: '', code: 'x', at: NOW }));
    expect(readDeepLinkStash(NOW)).toBeNull();
  });
});
