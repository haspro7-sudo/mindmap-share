import { describe, it, expect } from 'vitest';
import { parseSpoilerSpans } from './notes';
import type { TextSpan } from './notes';

const plain = (text: string): TextSpan => ({ text, spoiler: false });
const spoiler = (text: string): TextSpan => ({ text, spoiler: true });

describe('parseSpoilerSpans', () => {
  it('returns no spans for empty text', () => {
    expect(parseSpoilerSpans('')).toEqual([]);
  });

  it('keeps text without markers as one plain span', () => {
    expect(parseSpoilerSpans('第3章の夜に屋上へ')).toEqual([plain('第3章の夜に屋上へ')]);
    expect(parseSpoilerSpans('a | b')).toEqual([plain('a | b')]);
  });

  it('splits plain and spoiler spans', () => {
    expect(parseSpoilerSpans('犯人は||司書||だった')).toEqual([plain('犯人は'), spoiler('司書'), plain('だった')]);
    expect(parseSpoilerSpans('||全部ネタバレ||')).toEqual([spoiler('全部ネタバレ')]);
    expect(parseSpoilerSpans('||A||と||B||')).toEqual([spoiler('A'), plain('と'), spoiler('B')]);
  });

  it('keeps adjacent spoiler spans separate', () => {
    expect(parseSpoilerSpans('||A||||B||')).toEqual([spoiler('A'), spoiler('B')]);
  });

  it('shows an unclosed || literally', () => {
    expect(parseSpoilerSpans('ここから||閉じていない')).toEqual([plain('ここから||閉じていない')]);
    expect(parseSpoilerSpans('||')).toEqual([plain('||')]);
    expect(parseSpoilerSpans('|||')).toEqual([plain('|||')]);
  });

  it('shows only the trailing unclosed || literally, merged with the text before it', () => {
    expect(parseSpoilerSpans('a||b||c||d')).toEqual([plain('a'), spoiler('b'), plain('c||d')]);
    expect(parseSpoilerSpans('||x|| 続き ||')).toEqual([spoiler('x'), plain(' 続き ||')]);
  });

  it('drops empty spoilers and merges the plain text around them', () => {
    expect(parseSpoilerSpans('||||')).toEqual([]);
    expect(parseSpoilerSpans('a||||b')).toEqual([plain('ab')]);
    expect(parseSpoilerSpans('a||||')).toEqual([plain('a')]);
  });

  it('keeps newlines and whitespace inside spans', () => {
    expect(parseSpoilerSpans('1行目\n||2行目\n3行目||\n4行目')).toEqual([
      plain('1行目\n'),
      spoiler('2行目\n3行目'),
      plain('\n4行目'),
    ]);
    expect(parseSpoilerSpans('|| ||')).toEqual([spoiler(' ')]);
  });

  it('pairs markers left to right', () => {
    // '|||x||': opens at 0, the next '||' starts at index 4
    expect(parseSpoilerSpans('|||x||')).toEqual([spoiler('|x')]);
  });

  it('never loses or adds characters apart from the markers', () => {
    const samples = ['a||b||c', 'x||y', '||||z', 'p||q||r||s||t', '||', 'no markers', 'a|||b|||c'];
    for (const s of samples) {
      const spans = parseSpoilerSpans(s);
      const rebuilt = spans.map((sp) => (sp.spoiler ? `||${sp.text}||` : sp.text)).join('');
      expect(rebuilt.replaceAll('||||', ''), s).toBe(s.replaceAll('||||', ''));
      // no empty spans and no two adjacent plain spans
      for (let i = 0; i < spans.length; i++) {
        expect(spans[i]!.text).not.toBe('');
        if (i > 0) expect(spans[i - 1]!.spoiler || spans[i]!.spoiler).toBe(true);
      }
    }
  });
});
