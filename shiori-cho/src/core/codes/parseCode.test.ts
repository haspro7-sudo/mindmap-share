import { describe, it, expect, vi } from 'vitest';
import {
  B32_PREFIX,
  KANA_PREFIX,
  KANA_WORDS,
  codeErrorMessageJa,
  detectCodeKind,
  displayFromCanonical,
  generateCode,
  parseCode,
} from './index';
import type { Bytes, CodeError, ParsedCode } from '../types';

const KANA_DEMO_DISPLAY = 'ほたる・かえで・つばめ・こだま・すずめ';
const KANA_DEMO_CANONICAL = 'kana:ほたるかえでつばめこだますずめ';

function fixedRng(bytes: number[]): (n: number) => Bytes {
  return (n: number) => new Uint8Array(bytes.slice(0, n)) as Bytes;
}

function expectOk(r: ParsedCode): Extract<ParsedCode, { ok: true }> {
  if (!r.ok) throw new Error(`expected ok, got ${JSON.stringify(r)}`);
  return r;
}

describe('parseCode: kind detection', () => {
  it('parses Base32 codes', () => {
    expect(parseCode('K7Q-M2X-RAP')).toEqual({
      ok: true,
      kind: 'b32',
      canonical: 'b32:K7QM2XRAP',
      display: 'K7Q-M2X-RAP',
    });
    expect(expectOk(parseCode('ｋ７ｑｍ－２ｘｒａ－ｐ')).canonical).toBe('b32:K7QM2XRAP');
    expect(expectOk(parseCode('k7q m2x rap')).canonical).toBe('b32:K7QM2XRAP');
    expect(expectOk(parseCode('K7Q‐M2X—RAP')).canonical).toBe('b32:K7QM2XRAP');
    expect(expectOk(parseCode('MOO-NDE-SKR')).canonical).toBe('b32:M00NDESKR');
  });

  it('parses kana codes in hiragana, katakana and half-width katakana', () => {
    const expected = { ok: true, kind: 'kana', canonical: KANA_DEMO_CANONICAL, display: KANA_DEMO_DISPLAY };
    expect(parseCode(KANA_DEMO_DISPLAY)).toEqual(expected);
    expect(parseCode('ホタル・カエデ・ツバメ・コダマ・スズメ')).toEqual(expected);
    expect(parseCode('ﾎﾀﾙ ｶｴﾃﾞ ﾂﾊﾞﾒ ｺﾀﾞﾏ ｽｽﾞﾒ')).toEqual(expected);
    expect(parseCode('ほたるかえでつばめこだますずめ')).toEqual(expected);
    expect(parseCode('ほたる、かえで・つばめ こだま/すずめ')).toEqual(expected);
  });

  it('treats ・ and ー as separators, not as kana', () => {
    expect(expectOk(parseCode('K7Q・M2X・RAP')).kind).toBe('b32');
    expect(expectOk(parseCode('K7Qー M2X ｰ RAP')).kind).toBe('b32');
    expect(detectCodeKind('K7Q・M2X・RAP')).toBe('b32');
  });

  it('parses every documented demo code (§4.6)', () => {
    const cases: [string, string][] = [
      ['ST4-RMA-P1X', 'b32:ST4RMAP1X'],
      ['M00-NDE-SKR', 'b32:M00NDESKR'],
      ['NEK-0T0-M0E', 'b32:NEK0T0M0E'],
      ['SK1-ES0-NGM', 'b32:SK1ES0NGM'],
      ['AMA-0T0-N1J', 'b32:AMA0T0N1J'],
      [KANA_DEMO_DISPLAY, KANA_DEMO_CANONICAL],
    ];
    for (const [input, canonical] of cases) {
      const r = expectOk(parseCode(input));
      expect(r.canonical).toBe(canonical);
      expect(r.display).toBe(input);
    }
  });

  it('accepts canonical forms (pending codes, deep links), prefix case-insensitively', () => {
    expect(parseCode('b32:K7QM2XRAP')).toEqual(parseCode('K7Q-M2X-RAP'));
    expect(parseCode('B32:k7q-m2x-rap')).toEqual(parseCode('K7Q-M2X-RAP'));
    expect(parseCode(KANA_DEMO_CANONICAL)).toEqual(parseCode(KANA_DEMO_DISPLAY));
    expect(parseCode('KANA:ホタル・カエデ・ツバメ・コダマ・スズメ')).toEqual(parseCode(KANA_DEMO_DISPLAY));
    expect(parseCode('b32:')).toEqual({ ok: false, kind: 'b32', error: { kind: 'empty' } });
    expect(parseCode('kana:ほたるabc')).toEqual({ ok: false, kind: 'kana', error: { kind: 'mixed' } });
    expect(parseCode('b32:ほたる')).toEqual({ ok: false, kind: 'b32', error: { kind: 'charset', char: 'ほ' } });
  });

  it('detectCodeKind follows the same rule', () => {
    expect(detectCodeKind('')).toBeNull();
    expect(detectCodeKind('  ')).toBeNull();
    expect(detectCodeKind('K7Q')).toBe('b32');
    expect(detectCodeKind('ほ')).toBe('kana');
    expect(detectCodeKind('ﾎ')).toBe('kana');
    expect(detectCodeKind('kana:')).toBe('kana');
    expect(detectCodeKind('合言葉')).toBe('b32');
  });
});

describe('parseCode: errors', () => {
  it('reports empty input without a kind', () => {
    for (const input of ['', '   ', '\u3000', '\n\t']) {
      expect(parseCode(input), JSON.stringify(input)).toEqual({ ok: false, error: { kind: 'empty' } });
    }
    expect(parseCode(undefined as unknown as string)).toEqual({ ok: false, error: { kind: 'empty' } });
  });

  it('reports separator-only input as empty', () => {
    const r = parseCode('---');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toEqual({ kind: 'empty' });
  });

  it('rejects kana mixed with ASCII letters or digits (any width)', () => {
    const mixed = { ok: false, kind: 'kana', error: { kind: 'mixed' } };
    expect(parseCode('ほたる・かえで・つばめ・こだま・abc')).toEqual(mixed);
    expect(parseCode('K7Qほたる')).toEqual(mixed);
    expect(parseCode('ほたる1')).toEqual(mixed);
    expect(parseCode('ほたるＫ')).toEqual(mixed);
    expect(parseCode('ﾎﾀﾙ7')).toEqual(mixed);
  });

  it('passes Base32 errors through with kind b32', () => {
    expect(parseCode('K7Q-M2X-RAQ')).toEqual({ ok: false, kind: 'b32', error: { kind: 'checksum' } });
    expect(parseCode('K7Q-M2X-RA')).toEqual({ ok: false, kind: 'b32', error: { kind: 'length', got: 8, expected: 9 } });
    expect(parseCode('K7Q-M2X-RAU')).toEqual({ ok: false, kind: 'b32', error: { kind: 'charset', char: 'U' } });
    expect(parseCode('合言葉')).toEqual({ ok: false, kind: 'b32', error: { kind: 'charset', char: '合' } });
  });

  it('passes kana errors through with kind kana', () => {
    expect(parseCode('ほたる・かえで')).toEqual({
      ok: false,
      kind: 'kana',
      error: { kind: 'wordCount', got: 2, expected: 5 },
    });
    expect(parseCode('ほたる・かえで・つばね・こだま・すずめ')).toEqual({
      ok: false,
      kind: 'kana',
      error: { kind: 'unknownWord', index: 2, word: 'つばね' },
    });
  });

  it('composes spacing voiced marks before NFKC', () => {
    expect(expectOk(parseCode('ほたる かえて゛ つは゛め こた゛ま すす゛め')).canonical).toBe(KANA_DEMO_CANONICAL);
  });

  it('never touches WebCrypto (no KDF runs while parsing)', () => {
    const subtle = globalThis.crypto.subtle;
    const spies = [
      vi.spyOn(subtle, 'deriveBits'),
      vi.spyOn(subtle, 'importKey'),
      vi.spyOn(subtle, 'digest'),
      vi.spyOn(subtle, 'sign'),
    ];
    try {
      for (const input of ['K7Q-M2X-RAP', 'K7Q-M2X-RAQ', KANA_DEMO_DISPLAY, 'ほたる・つばね', '', 'U']) {
        const r = parseCode(input);
        expect(r).not.toBeInstanceOf(Promise);
      }
      for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });
});

describe('generateCode', () => {
  it('generates Base32 codes that parse back to themselves', () => {
    for (let i = 0; i < 200; i++) {
      const { canonical, display } = generateCode('b32');
      expect(canonical).toMatch(/^b32:[0-9A-HJKMNP-TV-Z]{9}$/);
      expect(display).toMatch(/^[0-9A-HJKMNP-TV-Z]{3}-[0-9A-HJKMNP-TV-Z]{3}-[0-9A-HJKMNP-TV-Z]{3}$/);
      expect(parseCode(display)).toEqual({ ok: true, kind: 'b32', canonical, display });
      expect(parseCode(canonical)).toEqual({ ok: true, kind: 'b32', canonical, display });
      expect(displayFromCanonical(canonical)).toBe(display);
    }
  });

  it('generates kana codes that parse back to themselves', () => {
    for (let i = 0; i < 200; i++) {
      const { canonical, display } = generateCode('kana');
      expect(canonical).toMatch(/^kana:[\u3041-\u3093]{15}$/);
      expect(display.split('・')).toHaveLength(5);
      expect(parseCode(display)).toEqual({ ok: true, kind: 'kana', canonical, display });
      expect(parseCode(canonical)).toEqual({ ok: true, kind: 'kana', canonical, display });
      expect(displayFromCanonical(canonical)).toBe(display);
    }
  });

  it('uses the injected rng', () => {
    expect(generateCode('b32', fixedRng([0, 0, 0, 0, 0]))).toEqual({
      canonical: 'b32:000000000',
      display: '000-000-000',
    });
    const w = KANA_WORDS[0]!;
    expect(generateCode('kana', fixedRng([0, 0, 0, 0, 0]))).toEqual({
      canonical: KANA_PREFIX + w.repeat(5),
      display: [w, w, w, w, w].join('・'),
    });
  });
});

describe('displayFromCanonical', () => {
  it('formats canonical forms', () => {
    expect(displayFromCanonical('b32:K7QM2XRAP')).toBe('K7Q-M2X-RAP');
    expect(displayFromCanonical(B32_PREFIX + 'ST4RMAP1X')).toBe('ST4-RMA-P1X');
    expect(displayFromCanonical(KANA_DEMO_CANONICAL)).toBe(KANA_DEMO_DISPLAY);
  });

  it('is the inverse of parseCode(...).canonical', () => {
    for (const input of ['k7q m2x rap', 'moo-nde-skr', 'ﾎﾀﾙ ｶｴﾃﾞ ﾂﾊﾞﾒ ｺﾀﾞﾏ ｽｽﾞﾒ']) {
      const r = expectOk(parseCode(input));
      expect(displayFromCanonical(r.canonical)).toBe(r.display);
    }
  });

  it('falls back to lenient parsing, then to the input itself', () => {
    expect(displayFromCanonical('b32:k7qm2xrap')).toBe('K7Q-M2X-RAP');
    expect(displayFromCanonical('K7QM2XRAP')).toBe('K7Q-M2X-RAP');
    expect(displayFromCanonical('not a code')).toBe('not a code');
    expect(displayFromCanonical('b32:XYZ')).toBe('b32:XYZ');
    expect(displayFromCanonical('')).toBe('');
  });
});

describe('codeErrorMessageJa', () => {
  const cases: [CodeError, string][] = [
    [{ kind: 'empty' }, '合言葉を入力してください'],
    [{ kind: 'charset', char: 'U' }, '使えない文字が含まれています（U）'],
    [{ kind: 'charset' }, '使えない文字が含まれています'],
    [{ kind: 'mixed' }, '英数字とひらがなが混ざっています'],
    [{ kind: 'length', got: 8, expected: 9 }, '英数字の合言葉は9文字です（いま 8文字）'],
    [{ kind: 'length', got: 10, expected: 9 }, '英数字の合言葉は9文字です（いま 10文字）'],
    [{ kind: 'checksum' }, '入力ミスがあるようです。1文字違っているかもしれません'],
    [{ kind: 'wordCount', got: 4, expected: 5 }, 'ひらがなの合言葉は5語です（いま 4語）'],
    [{ kind: 'wordCount', got: 0, expected: 5 }, 'ひらがなの合言葉は5語です（いま 0語）'],
    [{ kind: 'unknownWord', index: 2, word: 'つばね' }, '3語目『つばね』が見つかりません'],
    [{ kind: 'unknownWord', index: 0, word: 'ほたろ' }, '1語目『ほたろ』が見つかりません'],
  ];

  it.each(cases)('%j → %s', (error, message) => {
    expect(codeErrorMessageJa(error)).toBe(message);
  });

  it('explains a character-count problem when the rounded word count looks right', () => {
    const msg = codeErrorMessageJa({ kind: 'wordCount', got: 5, expected: 5 });
    expect(msg).toBe('ひらがなの合言葉は5語（15文字）です。文字数を確かめてください');
  });

  it('shows invisible or combining characters as code points', () => {
    expect(codeErrorMessageJa({ kind: 'charset', char: '\u0007' })).toBe('使えない文字が含まれています（U+0007）');
    expect(codeErrorMessageJa({ kind: 'charset', char: '\u3099' })).toBe('使えない文字が含まれています（U+3099）');
    expect(codeErrorMessageJa({ kind: 'charset', char: '😀' })).toBe('使えない文字が含まれています（😀）');
  });

  it('shortens very long unknown words', () => {
    const msg = codeErrorMessageJa({ kind: 'unknownWord', index: 4, word: 'あ'.repeat(40) });
    expect(msg).toBe(`5語目『${'あ'.repeat(12)}…』が見つかりません`);
  });

  it('gives the F10 AC2 messages end to end', () => {
    const b = parseCode('K7Q-M2X-RAQ');
    const k = parseCode('ほたる・かえで・つばね・こだま・すずめ');
    expect(b.ok || codeErrorMessageJa(b.error)).toBe('入力ミスがあるようです。1文字違っているかもしれません');
    expect(k.ok || codeErrorMessageJa(k.error)).toBe('3語目『つばね』が見つかりません');
  });

  it('never returns an empty message', () => {
    const inputs = ['', 'U', 'K7Q', 'K7QM2XRAQ', 'ほたる', 'ほたるA', 'ほたる・かえで・つばね・こだま・すずめ'];
    for (const input of inputs) {
      const r = parseCode(input);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(codeErrorMessageJa(r.error).length).toBeGreaterThan(0);
    }
  });
});
