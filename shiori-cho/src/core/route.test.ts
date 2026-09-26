import { describe, it, expect } from 'vitest';
import {
  buildHash,
  buildUnlockUrl,
  extractUnlockFromText,
  HELP_SECTIONS,
  parseHashRoute,
  STUDIO_TABS,
  WORK_TABS,
} from './route';
import type { Route } from './route';

const UUID = '3f2b8c1e-9a4d-4e7b-8c21-5d6f7a8b9c0d';
const PID = 'a1b2c3d4-0000-4000-8000-123456789abc';

describe('parseHashRoute', () => {
  it('maps empty hashes to home', () => {
    expect(parseHashRoute('')).toEqual({ name: 'home' });
    expect(parseHashRoute('#')).toEqual({ name: 'home' });
    expect(parseHashRoute('#/')).toEqual({ name: 'home' });
    expect(parseHashRoute('/')).toEqual({ name: 'home' });
  });

  it('parses the simple routes', () => {
    expect(parseHashRoute('#/add')).toEqual({ name: 'add' });
    expect(parseHashRoute('#/settings')).toEqual({ name: 'settings' });
    expect(parseHashRoute('#/studio')).toEqual({ name: 'studio' });
    expect(parseHashRoute('#/demo-pc')).toEqual({ name: 'demoPc' });
    expect(parseHashRoute('#/help')).toEqual({ name: 'help' });
    expect(parseHashRoute('#/code')).toEqual({ name: 'code' });
  });

  it('tolerates a single trailing slash', () => {
    expect(parseHashRoute('#/add/')).toEqual({ name: 'add' });
    expect(parseHashRoute(`#/w/${UUID}/`)).toEqual({ name: 'work', id: UUID, tab: 'progress' });
  });

  it('parses the work page with tab and sheet', () => {
    expect(parseHashRoute(`#/w/${UUID}`)).toEqual({ name: 'work', id: UUID, tab: 'progress' });
    expect(parseHashRoute(`#/w/${UUID}?tab=extras`)).toEqual({ name: 'work', id: UUID, tab: 'extras' });
    expect(parseHashRoute(`#/w/${UUID}?tab=progress&sheet=g3`)).toEqual({
      name: 'work',
      id: UUID,
      tab: 'progress',
      sheet: { type: 'goal', index: 3 },
    });
    expect(parseHashRoute(`#/w/${UUID}?sheet=x0&tab=extras`)).toEqual({
      name: 'work',
      id: UUID,
      tab: 'extras',
      sheet: { type: 'sealed', index: 0 },
    });
  });

  it('falls back to the default tab and ignores bad sheets and unknown params', () => {
    expect(parseHashRoute(`#/w/${UUID}?tab=secret`)).toEqual({ name: 'work', id: UUID, tab: 'progress' });
    expect(parseHashRoute(`#/w/${UUID}?tab=`)).toEqual({ name: 'work', id: UUID, tab: 'progress' });
    expect(parseHashRoute(`#/w/${UUID}?sheet=y3`)).toEqual({ name: 'work', id: UUID, tab: 'progress' });
    expect(parseHashRoute(`#/w/${UUID}?sheet=g-1`)).toEqual({ name: 'work', id: UUID, tab: 'progress' });
    expect(parseHashRoute(`#/w/${UUID}?sheet=g`)).toEqual({ name: 'work', id: UUID, tab: 'progress' });
    expect(parseHashRoute(`#/w/${UUID}?sheet=g1.5`)).toEqual({ name: 'work', id: UUID, tab: 'progress' });
    expect(parseHashRoute(`#/w/${UUID}?utm=x&tab=log&foo`)).toEqual({ name: 'work', id: UUID, tab: 'log' });
    expect(parseHashRoute(`#/w/${UUID}?tab=%E0%A4%A`)).toEqual({ name: 'work', id: UUID, tab: 'progress' });
  });

  it('uses the first occurrence of a repeated param', () => {
    expect(parseHashRoute(`#/w/${UUID}?tab=notes&tab=log`)).toEqual({ name: 'work', id: UUID, tab: 'notes' });
  });

  it('parses work edit, code with work id, and studio routes', () => {
    expect(parseHashRoute(`#/w/${UUID}/edit`)).toEqual({ name: 'workEdit', id: UUID });
    expect(parseHashRoute(`#/code?w=${UUID}`)).toEqual({ name: 'code', workId: UUID });
    expect(parseHashRoute('#/code?w=')).toEqual({ name: 'code' });
    expect(parseHashRoute('#/code?w=bad%20id')).toEqual({ name: 'code' });
    expect(parseHashRoute(`#/studio/${PID}`)).toEqual({ name: 'studioProject', id: PID, tab: 'work' });
    expect(parseHashRoute(`#/studio/${PID}?tab=goals`)).toEqual({ name: 'studioProject', id: PID, tab: 'goals' });
    expect(parseHashRoute(`#/studio/${PID}?tab=nope`)).toEqual({ name: 'studioProject', id: PID, tab: 'work' });
    expect(parseHashRoute(`#/studio/${PID}/preview`)).toEqual({ name: 'studioPreview', id: PID });
  });

  it('parses help sections', () => {
    for (const section of HELP_SECTIONS) {
      expect(parseHashRoute(`#/help/${section}`)).toEqual({ name: 'help', section });
    }
    expect(parseHashRoute('#/help/unknown')).toEqual({ name: 'notFound' });
  });

  it('parses unlock deep links and percent-decodes the code', () => {
    expect(parseHashRoute('#/u/demo-hoshiyomi/ST4-RMA-P1X')).toEqual({
      name: 'unlock',
      manifestWorkId: 'demo-hoshiyomi',
      code: 'ST4-RMA-P1X',
    });
    expect(parseHashRoute('#/u/w-abcdefghjk/K7QM2XRAP')).toEqual({
      name: 'unlock',
      manifestWorkId: 'w-abcdefghjk',
      code: 'K7QM2XRAP',
    });
    const kana = 'ほたるかえでつばめこだますずめ';
    expect(parseHashRoute(`#/u/demo-amaoto/${encodeURIComponent(kana)}`)).toEqual({
      name: 'unlock',
      manifestWorkId: 'demo-amaoto',
      code: kana,
    });
    // an encoded slash stays inside the code
    expect(parseHashRoute('#/u/demo-amaoto/A%2FB')).toEqual({ name: 'unlock', manifestWorkId: 'demo-amaoto', code: 'A/B' });
    // query after the code is not part of it
    expect(parseHashRoute('#/u/demo-amaoto/K7QM2XRAP?from=qr')).toEqual({
      name: 'unlock',
      manifestWorkId: 'demo-amaoto',
      code: 'K7QM2XRAP',
    });
  });

  it('rejects invalid unlock links', () => {
    expect(parseHashRoute('#/u/demo-hoshiyomi/%E3%81')).toEqual({ name: 'notFound' }); // truncated UTF-8
    expect(parseHashRoute('#/u/demo-hoshiyomi/%ZZ')).toEqual({ name: 'notFound' });
    expect(parseHashRoute('#/u/Demo-Upper/K7QM2XRAP')).toEqual({ name: 'notFound' });
    expect(parseHashRoute('#/u/abc/K7QM2XRAP')).toEqual({ name: 'notFound' }); // too short
    expect(parseHashRoute('#/u/-abcd/K7QM2XRAP')).toEqual({ name: 'notFound' });
    expect(parseHashRoute(`#/u/${'a'.repeat(41)}/K7QM2XRAP`)).toEqual({ name: 'notFound' });
    expect(parseHashRoute('#/u/demo-hoshiyomi')).toEqual({ name: 'notFound' });
    expect(parseHashRoute('#/u/demo-hoshiyomi/')).toEqual({ name: 'notFound' });
    expect(parseHashRoute('#/u/demo-hoshiyomi/A/B')).toEqual({ name: 'notFound' });
  });

  it('returns notFound for unknown or malformed input', () => {
    const bad = [
      '#/nope',
      '#nope',
      '#add',
      '#//',
      '#/add//',
      '#//add',
      '#/add/extra',
      '#/w',
      '#/w/',
      '#/w/has space',
      '#/w/bad_id',
      '#/w/%41BC',
      `#/w/${'a'.repeat(65)}`,
      `#/w/${UUID}/edit/more`,
      `#/w/${UUID}/other`,
      '#/studio/p1/nope',
      '#/settings/x',
      '#/demo-pc/1',
      '#/not-found',
      '#/../../etc',
      '#/w/<script>',
    ];
    for (const h of bad) expect(parseHashRoute(h), h).toEqual({ name: 'notFound' });
  });

  it('accepts ids at the 64-character limit', () => {
    const id = 'A'.repeat(64);
    expect(parseHashRoute(`#/w/${id}`)).toEqual({ name: 'work', id, tab: 'progress' });
  });
});

describe('buildHash', () => {
  it('omits default tabs and always starts with #/', () => {
    expect(buildHash({ name: 'work', id: UUID, tab: 'progress' })).toBe(`#/w/${UUID}`);
    expect(buildHash({ name: 'work', id: UUID, tab: 'log' })).toBe(`#/w/${UUID}?tab=log`);
    expect(buildHash({ name: 'work', id: UUID, tab: 'progress', sheet: { type: 'goal', index: 3 } })).toBe(
      `#/w/${UUID}?sheet=g3`,
    );
    expect(buildHash({ name: 'work', id: UUID, tab: 'extras', sheet: { type: 'sealed', index: 1 } })).toBe(
      `#/w/${UUID}?tab=extras&sheet=x1`,
    );
    expect(buildHash({ name: 'studioProject', id: PID, tab: 'work' })).toBe(`#/studio/${PID}`);
    expect(buildHash({ name: 'studioProject', id: PID, tab: 'export' })).toBe(`#/studio/${PID}?tab=export`);
    expect(buildHash({ name: 'code', workId: UUID })).toBe(`#/code?w=${UUID}`);
    expect(buildHash({ name: 'code' })).toBe('#/code');
    expect(buildHash({ name: 'home' })).toBe('#/');
    expect(buildHash({ name: 'notFound' }).startsWith('#/')).toBe(true);
  });

  it('percent-encodes a kana deep-link code', () => {
    const code = 'ほたるかえでつばめこだますずめ';
    const hash = buildHash({ name: 'unlock', manifestWorkId: 'demo-amaoto', code });
    expect(hash).toBe(`#/u/demo-amaoto/${encodeURIComponent(code)}`);
    expect(hash).toMatch(/^[\x21-\x7e]+$/); // ASCII only
  });

  it('drops an invalid sheet index', () => {
    expect(buildHash({ name: 'work', id: UUID, tab: 'progress', sheet: { type: 'goal', index: -1 } })).toBe(`#/w/${UUID}`);
    expect(buildHash({ name: 'work', id: UUID, tab: 'progress', sheet: { type: 'goal', index: 1.5 } })).toBe(`#/w/${UUID}`);
  });

  it('round-trips every route', () => {
    const routes: Route[] = [
      { name: 'home' },
      { name: 'add' },
      ...WORK_TABS.map((tab): Route => ({ name: 'work', id: UUID, tab })),
      { name: 'work', id: UUID, tab: 'progress', sheet: { type: 'goal', index: 0 } },
      { name: 'work', id: UUID, tab: 'extras', sheet: { type: 'sealed', index: 12 } },
      { name: 'work', id: 'x', tab: 'notes', sheet: { type: 'goal', index: 499 } },
      { name: 'workEdit', id: UUID },
      { name: 'code' },
      { name: 'code', workId: UUID },
      { name: 'unlock', manifestWorkId: 'demo-hoshiyomi', code: 'ST4-RMA-P1X' },
      { name: 'unlock', manifestWorkId: 'demo-amaoto', code: 'ほたるかえでつばめこだますずめ' },
      { name: 'unlock', manifestWorkId: 'demo-amaoto', code: 'ほたる・かえで・つばめ・こだま・すずめ' },
      { name: 'unlock', manifestWorkId: 'w-0123456789', code: 'a/b?c#d&e=f%g h' },
      { name: 'settings' },
      { name: 'studio' },
      ...STUDIO_TABS.map((tab): Route => ({ name: 'studioProject', id: PID, tab })),
      { name: 'studioPreview', id: PID },
      { name: 'demoPc' },
      { name: 'help' },
      ...HELP_SECTIONS.map((section): Route => ({ name: 'help', section })),
      { name: 'notFound' },
    ];
    for (const r of routes) {
      const hash = buildHash(r);
      expect(hash.startsWith('#/'), hash).toBe(true);
      expect(parseHashRoute(hash), hash).toStrictEqual(r);
      // and the hash is canonical
      expect(buildHash(parseHashRoute(hash))).toBe(hash);
    }
  });
});

describe('buildUnlockUrl', () => {
  it('strips the code prefix and any existing hash', () => {
    expect(buildUnlockUrl('https://example.github.io/shiori-cho/', 'demo-hoshiyomi', 'b32:K7QM2XRAP')).toBe(
      'https://example.github.io/shiori-cho/#/u/demo-hoshiyomi/K7QM2XRAP',
    );
    expect(buildUnlockUrl('https://example.github.io/shiori-cho/#/settings', 'demo-hoshiyomi', 'b32:K7QM2XRAP')).toBe(
      'https://example.github.io/shiori-cho/#/u/demo-hoshiyomi/K7QM2XRAP',
    );
    expect(buildUnlockUrl('http://localhost:5173/#', 'demo-hoshiyomi', 'b32:K7QM2XRAP')).toBe(
      'http://localhost:5173/#/u/demo-hoshiyomi/K7QM2XRAP',
    );
  });

  it('percent-encodes a kana code', () => {
    const url = buildUnlockUrl('https://example.org/app/', 'demo-amaoto', 'kana:ほたるかえでつばめこだますずめ');
    expect(url).toBe(`https://example.org/app/#/u/demo-amaoto/${encodeURIComponent('ほたるかえでつばめこだますずめ')}`);
    expect(url).toMatch(/^[\x21-\x7e]+$/);
    expect(url).not.toContain('kana:');
  });

  it('keeps a code without a known prefix as is', () => {
    expect(buildUnlockUrl('https://example.org/', 'demo-amaoto', 'K7QM2XRAP')).toBe(
      'https://example.org/#/u/demo-amaoto/K7QM2XRAP',
    );
  });

  it('round-trips through parseHashRoute and extractUnlockFromText', () => {
    for (const [canonical, code] of [
      ['b32:K7QM2XRAP', 'K7QM2XRAP'],
      ['kana:ほたるかえでつばめこだますずめ', 'ほたるかえでつばめこだますずめ'],
    ] as const) {
      const url = buildUnlockUrl('https://example.org/app/', 'demo-amaoto', canonical);
      const hash = url.slice(url.indexOf('#'));
      expect(parseHashRoute(hash)).toEqual({ name: 'unlock', manifestWorkId: 'demo-amaoto', code });
      expect(extractUnlockFromText(url)).toEqual({ manifestWorkId: 'demo-amaoto', code });
    }
  });
});

describe('extractUnlockFromText', () => {
  it('finds a URL inside Japanese prose', () => {
    const text = 'クリアおめでとう！ https://example.github.io/shiori-cho/#/u/demo-hoshiyomi/ST4-RMA-P1X を開いてね。';
    expect(extractUnlockFromText(text)).toEqual({ manifestWorkId: 'demo-hoshiyomi', code: 'ST4-RMA-P1X' });
  });

  it('works with a bare URL, a bare hash and multiline text', () => {
    expect(extractUnlockFromText('https://example.org/#/u/demo-hoshiyomi/K7QM2XRAP')).toEqual({
      manifestWorkId: 'demo-hoshiyomi',
      code: 'K7QM2XRAP',
    });
    expect(extractUnlockFromText('#/u/demo-hoshiyomi/K7QM2XRAP')).toEqual({
      manifestWorkId: 'demo-hoshiyomi',
      code: 'K7QM2XRAP',
    });
    expect(extractUnlockFromText('一行目\nhttps://example.org/#/u/demo-hoshiyomi/K7QM2XRAP\n三行目')).toEqual({
      manifestWorkId: 'demo-hoshiyomi',
      code: 'K7QM2XRAP',
    });
  });

  it('decodes a percent-encoded kana code', () => {
    const enc = encodeURIComponent('ほたるかえでつばめこだますずめ');
    expect(extractUnlockFromText(`合言葉のURL：https://example.org/#/u/demo-amaoto/${enc}。`)).toEqual({
      manifestWorkId: 'demo-amaoto',
      code: 'ほたるかえでつばめこだますずめ',
    });
  });

  it('accepts an already-decoded kana code', () => {
    expect(extractUnlockFromText('https://example.org/#/u/demo-amaoto/ほたるかえでつばめこだますずめ。')).toEqual({
      manifestWorkId: 'demo-amaoto',
      code: 'ほたるかえでつばめこだますずめ',
    });
    expect(extractUnlockFromText('#/u/demo-amaoto/ほたる・かえで・つばめ・こだま・すずめ」')).toEqual({
      manifestWorkId: 'demo-amaoto',
      code: 'ほたる・かえで・つばめ・こだま・すずめ',
    });
  });

  it('trims trailing punctuation and brackets', () => {
    const cases = [
      '（https://example.org/#/u/demo-hoshiyomi/K7QM2XRAP）',
      '(https://example.org/#/u/demo-hoshiyomi/K7QM2XRAP)',
      '[link](https://example.org/#/u/demo-hoshiyomi/K7QM2XRAP)',
      '<https://example.org/#/u/demo-hoshiyomi/K7QM2XRAP>',
      '「https://example.org/#/u/demo-hoshiyomi/K7QM2XRAP」',
      'https://example.org/#/u/demo-hoshiyomi/K7QM2XRAP。',
      'https://example.org/#/u/demo-hoshiyomi/K7QM2XRAP、次は',
      'https://example.org/#/u/demo-hoshiyomi/K7QM2XRAP.',
      'https://example.org/#/u/demo-hoshiyomi/K7QM2XRAP!',
      'https://example.org/#/u/demo-hoshiyomi/K7QM2XRAP]',
      '"https://example.org/#/u/demo-hoshiyomi/K7QM2XRAP"',
      'https://example.org/#/u/demo-hoshiyomi/K7QM2XRAPを入力してください',
      'https://example.org/#/u/demo-hoshiyomi/K7QM2XRAP?utm_source=x',
    ];
    for (const text of cases) {
      expect(extractUnlockFromText(text), text).toEqual({ manifestWorkId: 'demo-hoshiyomi', code: 'K7QM2XRAP' });
    }
  });

  it('stops at full-width whitespace', () => {
    expect(extractUnlockFromText('#/u/demo-hoshiyomi/K7Q-M2X-RAP　です')).toEqual({
      manifestWorkId: 'demo-hoshiyomi',
      code: 'K7Q-M2X-RAP',
    });
  });

  it('returns the first valid occurrence', () => {
    const text = 'A: #/u/demo-first/AAA-AAA-AAA B: #/u/demo-second/BBB-BBB-BBB';
    expect(extractUnlockFromText(text)).toEqual({ manifestWorkId: 'demo-first', code: 'AAA-AAA-AAA' });
    // an undecodable first candidate is skipped
    expect(extractUnlockFromText('#/u/demo-first/%E3%81 #/u/demo-second/K7QM2XRAP')).toEqual({
      manifestWorkId: 'demo-second',
      code: 'K7QM2XRAP',
    });
    // an invalid work id is skipped
    expect(extractUnlockFromText('#/u/BAD/K7QM2XRAP and #/u/demo-second/K7QM2XRAP')).toEqual({
      manifestWorkId: 'demo-second',
      code: 'K7QM2XRAP',
    });
  });

  it('returns null when there is no deep link', () => {
    expect(extractUnlockFromText('')).toBeNull();
    expect(extractUnlockFromText('K7Q-M2X-RAP')).toBeNull();
    expect(extractUnlockFromText('https://example.org/#/w/abc')).toBeNull();
    expect(extractUnlockFromText('#/u/demo-hoshiyomi/')).toBeNull();
    expect(extractUnlockFromText('#/u/demo-hoshiyomi/。')).toBeNull();
    expect(extractUnlockFromText('#/u/demo-hoshiyomi')).toBeNull();
    expect(extractUnlockFromText('#/u/abc/K7QM2XRAP')).toBeNull();
  });
});
