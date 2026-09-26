import { describe, it, expect, vi } from 'vitest';
import {
  KANA_WORD_COUNT,
  foldSpacingVoicedMarks,
  formatKana,
  generateKana,
  normalizeKana,
  splitKanaWords,
} from './kana';
import { KANA_WORDS } from './kanaWords';
import { ShioriError } from '../errors';
import { sha256, toHex, utf8 } from '../encoding';
import type { Bytes } from '../types';

const DEMO = ['ほたる', 'かえで', 'つばめ', 'こだま', 'すずめ'];
const DEMO_DISPLAY = 'ほたる・かえで・つばめ・こだま・すずめ';

/**
 * SHA-256 (hex) of KANA_WORDS.join(','). The list is FROZEN: if this test fails, the change would
 * break every kana code already shipped in a work. Do not update this constant.
 */
const KANA_WORDS_SHA256 = '937dea4089d3ef4c81deb48769c904f757938346a2a37e97a2fe8e960920ff8c';

function fixedRng(bytes: number[]): (n: number) => Bytes {
  return (n: number) => new Uint8Array(bytes.slice(0, n)) as Bytes;
}

function words(input: string): string[] {
  const r = splitKanaWords(input);
  if (!r.ok) throw new Error(`expected ${JSON.stringify(input)} to split, got ${JSON.stringify(r.error)}`);
  return r.words;
}

/** Removes dakuten/handakuten: が→か, ぱ→は, … */
function stripVoicing(s: string): string {
  return s.normalize('NFD').replace(/[\u3099\u309A]/g, '').normalize('NFC');
}

describe('normalizeKana', () => {
  it('converts katakana (full and half width) to hiragana', () => {
    expect(normalizeKana('ホタル')).toBe('ほたる');
    expect(normalizeKana('ﾎﾀﾙ')).toBe('ほたる');
    expect(normalizeKana('ｶｴﾃﾞ')).toBe('かえで');
    expect(normalizeKana('ﾊﾟﾝﾀﾞ')).toBe('ぱんだ');
    expect(normalizeKana('ヴ')).toBe('ゔ');
  });

  it('enlarges small kana', () => {
    expect(normalizeKana('ぁぃぅぇぉっゃゅょゎ')).toBe('あいうえおつやゆよわ');
    expect(normalizeKana('ァィゥェォッャュョヮ')).toBe('あいうえおつやゆよわ');
    expect(normalizeKana('ｧｨｩｪｫｯｬｭｮ')).toBe('あいうえおつやゆよ');
    expect(normalizeKana('ヵヶゕゖ')).toBe('かけかけ');
  });

  it('merges ぢ→じ, づ→ず, を→お (hiragana and katakana)', () => {
    expect(normalizeKana('ぢづを')).toBe('じずお');
    expect(normalizeKana('ヂヅヲ')).toBe('じずお');
    expect(normalizeKana('ｦ')).toBe('お');
  });

  it('composes separate voiced sound marks', () => {
    expect(normalizeKana('か\u3099')).toBe('が');
    expect(normalizeKana('か゛きね')).toBe('がきね');
    expect(normalizeKana('は゜')).toBe('ぱ');
    expect(foldSpacingVoicedMarks('か゛は゜')).toBe('か\u3099は\u309A');
  });

  it('keeps separators and other characters, but drops invisible format characters', () => {
    expect(normalizeKana('ほたる・かえで ー、。/-')).toBe('ほたる・かえで ー、。/-');
    expect(normalizeKana('ﾎﾀﾙ･ｶｴﾃﾞ')).toBe('ほたる・かえで');
    expect(normalizeKana('ＡＢＣ１')).toBe('ABC1');
    expect(normalizeKana('ほた\u200Bる')).toBe('ほたる');
    expect(normalizeKana('')).toBe('');
  });

  it('is idempotent', () => {
    for (const s of ['ホタル・カエデ', 'ﾂﾊﾞﾒ ｺﾀﾞﾏ', 'っゃゅょ', 'ヂヅヲ', 'か゛', DEMO_DISPLAY]) {
      expect(normalizeKana(normalizeKana(s))).toBe(normalizeKana(s));
    }
  });
});

describe('splitKanaWords', () => {
  it('splits the demo code on ・', () => {
    expect(words(DEMO_DISPLAY)).toEqual(DEMO);
  });

  it('gives the same words for katakana, half-width katakana and mixed separators', () => {
    for (const input of [
      'ホタル・カエデ・ツバメ・コダマ・スズメ',
      'ﾎﾀﾙ ｶｴﾃﾞ ﾂﾊﾞﾒ ｺﾀﾞﾏ ｽｽﾞﾒ',
      'ﾎﾀﾙ･ｶｴﾃﾞ･ﾂﾊﾞﾒ･ｺﾀﾞﾏ･ｽｽﾞﾒ',
      'ほたる、かえで・つばめ こだま/すずめ',
      'ほたる\u3000かえで,つばめ.こだま-すずめ',
      'ほたる，かえで．つばめ／こだま－すずめ',
      'ほたるーかえでーつばめーこだまーすずめ',
      'ほたる―かえで—つばめ‐こだま−すずめ',
      'ほたる_かえで〜つばめ～こだま。すずめ',
      '  ほたる ・ かえで ・ つばめ ・ こだま ・ すずめ  ',
      'ホタル、カエデ、ツバメ、コダマ、スズメ。',
      'ほたる\nかえで\nつばめ\nこだま\nすずめ',
    ]) {
      expect(words(input), JSON.stringify(input)).toEqual(DEMO);
    }
  });

  it('chunks input without separators into 3-character words', () => {
    expect(words('ほたるかえでつばめこだますずめ')).toEqual(DEMO);
    expect(words('ホタルカエデツバメコダマスズメ')).toEqual(DEMO);
    expect(words('ﾎﾀﾙｶｴﾃﾞﾂﾊﾞﾒｺﾀﾞﾏｽｽﾞﾒ')).toEqual(DEMO);
    expect(words('  ほたるかえでつばめこだますずめ\n')).toEqual(DEMO);
  });

  it('also chunks tokens that hold several words when only some separators are typed', () => {
    expect(words('ほたるかえで つばめ こだま すずめ')).toEqual(DEMO);
    expect(words('ほたるかえで・つばめこだま・すずめ')).toEqual(DEMO);
  });

  it('applies the spelling merges づ→ず, ぢ→じ, を→お and enlarges small kana', () => {
    expect(words('ほたる・かえで・つばめ・こだま・すづめ')).toEqual(DEMO);
    expect(words('ホタル・カエデ・ツバメ・コダマ・スヅメ')).toEqual(DEMO);
    expect(words('をでん・もみぢ・っばめ・ゃたい・ぉもち')).toEqual(['おでん', 'もみじ', 'つばめ', 'やたい', 'おもち']);
    expect(words('ヲデンモミヂツバメヤタイオモチ')).toEqual(['おでん', 'もみじ', 'つばめ', 'やたい', 'おもち']);
  });

  it('reports the index (0-based) and hiragana form of the first unknown word', () => {
    expect(splitKanaWords('ほたる・かえで・つばね・こだま・すずめ')).toEqual({
      ok: false,
      error: { kind: 'unknownWord', index: 2, word: 'つばね' },
    });
    expect(splitKanaWords('ホタル・カエデ・ツバメ・コダマ・スズネ')).toEqual({
      ok: false,
      error: { kind: 'unknownWord', index: 4, word: 'すずね' },
    });
    expect(splitKanaWords('ほたろかえでつばめこだますずね')).toEqual({
      ok: false,
      error: { kind: 'unknownWord', index: 0, word: 'ほたろ' },
    });
    expect(splitKanaWords('ほたる・かえで・つばめ・こだま・すずめめ')).toEqual({
      ok: false,
      error: { kind: 'unknownWord', index: 4, word: 'すずめめ' },
    });
    expect(splitKanaWords('ほたる・かえで・つばめ・こだま・雀')).toEqual({
      ok: false,
      error: { kind: 'unknownWord', index: 4, word: '雀' },
    });
  });

  it('reports wrong word counts with separators', () => {
    expect(splitKanaWords('ほたる・かえで・つばめ・こだま')).toEqual({
      ok: false,
      error: { kind: 'wordCount', got: 4, expected: 5 },
    });
    expect(splitKanaWords('ほたる・かえで・つばめ・こだま・すずめ・さくら')).toEqual({
      ok: false,
      error: { kind: 'wordCount', got: 6, expected: 5 },
    });
    expect(splitKanaWords('ほたる かえで')).toEqual({ ok: false, error: { kind: 'wordCount', got: 2, expected: 5 } });
  });

  it('reports wrong word counts without separators as ceil(length / 3)', () => {
    const cases: [string, number][] = [
      ['ほたるかえでつばめこだま', 4],
      ['ほたるかえでつばめこだますずめさくら', 6],
      ['ほたるかえでつばめこだますず', 5],
      ['ほたるかえでつばめこだますずめさ', 6],
      ['ほたる', 1],
      ['ほ', 1],
    ];
    for (const [input, got] of cases) {
      expect(splitKanaWords(input), input).toEqual({ ok: false, error: { kind: 'wordCount', got, expected: 5 } });
    }
  });

  it('reports zero words for empty or separator-only input', () => {
    for (const input of ['', '   ', '・・・', 'ー']) {
      expect(splitKanaWords(input), JSON.stringify(input)).toEqual({
        ok: false,
        error: { kind: 'wordCount', got: 0, expected: 5 },
      });
    }
  });

  it('checks the word count before looking words up', () => {
    expect(splitKanaWords('あああ・いいい')).toEqual({ ok: false, error: { kind: 'wordCount', got: 2, expected: 5 } });
  });
});

describe('generateKana', () => {
  it('uses one random byte per word', () => {
    expect(generateKana(fixedRng([0, 1, 2, 254, 255]))).toEqual([
      KANA_WORDS[0],
      KANA_WORDS[1],
      KANA_WORDS[2],
      KANA_WORDS[254],
      KANA_WORDS[255],
    ]);
  });

  it('can produce the demo code', () => {
    const bytes = DEMO.map((w) => KANA_WORDS.indexOf(w));
    expect(generateKana(fixedRng(bytes))).toEqual(DEMO);
  });

  it('asks the rng for exactly 5 bytes', () => {
    const rng = vi.fn(fixedRng([9, 8, 7, 6, 5]));
    generateKana(rng);
    expect(rng).toHaveBeenCalledTimes(1);
    expect(rng).toHaveBeenCalledWith(KANA_WORD_COUNT);
  });

  it('throws when the rng returns too few bytes', () => {
    expect(() => generateKana(fixedRng([1, 2]))).toThrow(ShioriError);
  });

  it('produces 1000 codes that split back to the same words, with and without separators', () => {
    for (let i = 0; i < 1000; i++) {
      const w = generateKana();
      expect(w).toHaveLength(5);
      for (const word of w) expect(KANA_WORDS).toContain(word);
      expect(words(formatKana(w))).toEqual(w);
      expect(words(w.join(''))).toEqual(w);
    }
  });
});

describe('formatKana', () => {
  it('joins words with ・', () => {
    expect(formatKana(DEMO)).toBe(DEMO_DISPLAY);
    expect(formatKana([])).toBe('');
  });
});

describe('KANA_WORDS', () => {
  it('has exactly 256 unique entries and is frozen', () => {
    expect(KANA_WORDS).toHaveLength(256);
    expect(new Set(KANA_WORDS).size).toBe(256);
    expect(Object.isFrozen(KANA_WORDS)).toBe(true);
  });

  it('uses exactly 3 basic hiragana per word (no small kana, ゐ, ゑ, を, ぢ, づ, ゔ or ー)', () => {
    const forbidden = /[ぁぃぅぇぉっゃゅょゎゕゖゐゑをぢづゔー]/;
    for (const w of KANA_WORDS) {
      expect(w, w).toMatch(/^[\u3041-\u3093]{3}$/);
      expect(w.length, w).toBe(3);
      expect(forbidden.test(w), w).toBe(false);
      expect(w.normalize('NFC'), w).toBe(w);
      expect(w.normalize('NFKC'), w).toBe(w);
    }
  });

  it('contains only fixed points of normalizeKana', () => {
    for (const w of KANA_WORDS) expect(normalizeKana(w), w).toBe(w);
  });

  it('includes the demo words', () => {
    for (const w of DEMO) expect(KANA_WORDS).toContain(w);
  });

  it('has no pair of words that differ only by dakuten/handakuten on one character', () => {
    const set = new Set(KANA_WORDS);
    const voiced: Record<string, string[]> = {};
    for (const w of KANA_WORDS) {
      for (let i = 0; i < 3; i++) {
        const plain = stripVoicing(w[i]!);
        // every voicing variant of this character (か → か, が; は → は, ば, ぱ)
        const variants = [plain, plain + '\u3099', plain + '\u309A']
          .map((c) => c.normalize('NFC'))
          .filter((c) => c.length === 1 && c !== w[i]);
        for (const v of variants) {
          const other = w.slice(0, i) + v + w.slice(i + 1);
          if (set.has(other)) (voiced[w] ??= []).push(other);
        }
      }
    }
    expect(voiced).toEqual({});
  });

  it('keeps words distinct even with all dakuten/handakuten removed', () => {
    const bases = KANA_WORDS.map(stripVoicing);
    expect(new Set(bases).size).toBe(256);
  });

  it('has no two words that differ in exactly one character (a single typo is always detected)', () => {
    const close: string[] = [];
    for (let i = 0; i < KANA_WORDS.length; i++) {
      for (let j = i + 1; j < KANA_WORDS.length; j++) {
        const a = KANA_WORDS[i]!;
        const b = KANA_WORDS[j]!;
        let d = 0;
        for (let k = 0; k < 3; k++) if (a[k] !== b[k]) d++;
        if (d <= 1) close.push(`${a}/${b}`);
      }
    }
    expect(close).toEqual([]);
  });

  it('is sorted by code unit', () => {
    const sorted = [...KANA_WORDS].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    expect([...KANA_WORDS]).toEqual(sorted);
  });

  it('matches the frozen snapshot hash', async () => {
    const digest = toHex(await sha256(utf8(KANA_WORDS.join(','))));
    expect(digest).toBe(KANA_WORDS_SHA256);
  });
});
