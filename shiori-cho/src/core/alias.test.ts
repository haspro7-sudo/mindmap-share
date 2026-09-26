import { describe, it, expect } from 'vitest';
import { aliasLetters, nextAlias } from './alias';

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

describe('aliasLetters', () => {
  it('is bijective base-26', () => {
    expect(aliasLetters(1)).toBe('A');
    expect(aliasLetters(2)).toBe('B');
    expect(aliasLetters(26)).toBe('Z');
    expect(aliasLetters(27)).toBe('AA');
    expect(aliasLetters(28)).toBe('AB');
    expect(aliasLetters(52)).toBe('AZ');
    expect(aliasLetters(53)).toBe('BA');
    expect(aliasLetters(702)).toBe('ZZ');
    expect(aliasLetters(703)).toBe('AAA');
    expect(aliasLetters(0)).toBe('');
  });

  it('produces unique labels', () => {
    const seen = new Set<string>();
    for (let n = 1; n <= 2000; n++) seen.add(aliasLetters(n));
    expect(seen.size).toBe(2000);
  });
});

describe('nextAlias', () => {
  it('starts at 作品A', () => {
    expect(nextAlias([])).toBe('作品A');
  });

  it('returns the first unused alias', () => {
    expect(nextAlias(['作品A'])).toBe('作品B');
    expect(nextAlias(['作品A', '作品B', '作品D'])).toBe('作品C');
    expect(nextAlias(['作品B', '作品C'])).toBe('作品A');
  });

  it('continues 作品Z → 作品AA → 作品AB', () => {
    const aToZ = LETTERS.map((l) => `作品${l}`);
    expect(nextAlias(aToZ)).toBe('作品AA');
    expect(nextAlias([...aToZ, '作品AA'])).toBe('作品AB');
    expect(nextAlias(['作品Z', ...aToZ.slice(0, 25)])).toBe('作品AA');
  });

  it('ignores unrelated aliases, e.g. manifest safe titles', () => {
    expect(nextAlias(['サンプルA', 'サンプルB', '作品', 'わたしの作品A'])).toBe('作品A');
  });

  it('treats full-width and padded variants as taken', () => {
    expect(nextAlias(['作品Ａ', ' 作品B '])).toBe('作品C');
  });

  it('keeps producing fresh aliases for long libraries', () => {
    const existing: string[] = [];
    for (let i = 0; i < 800; i++) existing.push(nextAlias(existing));
    expect(new Set(existing).size).toBe(800);
    expect(existing[25]).toBe('作品Z');
    expect(existing[26]).toBe('作品AA');
    expect(existing[701]).toBe('作品ZZ');
    expect(existing[702]).toBe('作品AAA');
  });
});
