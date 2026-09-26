import { describe, it, expect } from 'vitest';
import { isShioriError } from '../errors';
import type { Bytes } from '../types';
import type { QuickCounts } from '../types';
import { QUICK_LIMITS, buildQuickManifest, checkQuickCounts, newPlayerWorkId } from './quick';
import { WORK_ID_RE } from './schema';
import { manifestKey, parseManifestText, validateManifest } from './validate';

const ZERO: QuickCounts = { endings: 0, cg: 0, achievements: 0, tracks: 0, chapters: 0 };
const counts = (c: Partial<QuickCounts>): QuickCounts => ({ ...ZERO, ...c });
const fixedRng = (values: number[]) => (n: number) => new Uint8Array(Array.from({ length: n }, (_, i) => values[i] ?? 0)) as Bytes;

function build(c: Partial<QuickCounts>, extra: Partial<Parameters<typeof buildQuickManifest>[0]> = {}) {
  return buildQuickManifest({ title: 'テスト作品', kind: 'game', workId: 'p-0123456789', counts: counts(c), ...extra });
}

function validationMessage(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    expect(isShioriError(e)).toBe(true);
    if (isShioriError(e)) {
      expect(e.code).toBe('validation');
      return e.messageJa;
    }
  }
  throw new Error('expected a ShioriError');
}

describe('newPlayerWorkId', () => {
  it('is "p-" + 10 lowercase Crockford base32 chars', () => {
    for (let i = 0; i < 200; i++) {
      const id = newPlayerWorkId();
      expect(id).toMatch(/^p-[0-9a-hjkmnp-tv-z]{10}$/);
      expect(WORK_ID_RE.test(id)).toBe(true);
    }
  });

  it('maps random bytes onto the alphabet (mod 32)', () => {
    expect(newPlayerWorkId(fixedRng([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]))).toBe('p-0123456789');
    expect(newPlayerWorkId(fixedRng([10, 17, 18, 21, 22, 27, 31, 32, 255, 224]))).toBe('p-ahjnpvz0z0');
  });

  it('asks the rng for 10 bytes and is practically unique', () => {
    const asked: number[] = [];
    newPlayerWorkId((n) => {
      asked.push(n);
      return new Uint8Array(n) as Bytes;
    });
    expect(asked).toEqual([10]);
    const ids = new Set(Array.from({ length: 1000 }, () => newPlayerWorkId()));
    expect(ids.size).toBe(1000);
  });
});

describe('buildQuickManifest', () => {
  it('produces the right ids, labels and group order', () => {
    const m = build({ endings: 3, cg: 2, achievements: 2, tracks: 2, chapters: 2 });
    expect(m.groups).toEqual([
      { id: 'endings', label: 'エンディング' },
      { id: 'cg', label: '回想・CG' },
      { id: 'achievements', label: '実績' },
      { id: 'tracks', label: 'トラック' },
    ]);
    expect(m.goals.map((g) => [g.id, g.group, g.label])).toEqual([
      ['end-1', 'endings', 'END 1'],
      ['end-2', 'endings', 'END 2'],
      ['end-3', 'endings', 'END 3'],
      ['cg-1', 'cg', 'CG 1'],
      ['cg-2', 'cg', 'CG 2'],
      ['ach-1', 'achievements', '実績 1'],
      ['ach-2', 'achievements', '実績 2'],
      ['track-1', 'tracks', 'Track 1'],
      ['track-2', 'tracks', 'Track 2'],
    ]);
    expect(m.checkpoints).toEqual([
      { id: 'ch-1', label: '第1章' },
      { id: 'ch-2', label: '第2章' },
    ]);
  });

  it('makes every goal manual, spoiler 0, without hints', () => {
    const m = build({ endings: 2, tracks: 1 });
    for (const g of m.goals) {
      expect(g).toEqual({ id: g.id, group: g.group, label: g.label, spoiler: 0, hints: [], unlock: { type: 'manual' } });
    }
  });

  it('is player-authored, without kdf, sealed items or changelog', () => {
    const m = build({ cg: 1 }, { kind: 'cg' });
    expect(m.schema).toBe('shiori/1');
    expect(m.author).toEqual({ kind: 'player' });
    expect(m.kdf).toBeUndefined();
    expect(JSON.stringify(m)).not.toContain('kdf');
    expect(m.sealed).toEqual([]);
    expect(m.changelog).toEqual([]);
    expect(m.work).toEqual({ id: 'p-0123456789', title: 'テスト作品', kind: 'cg', version: '1.0.0' });
  });

  it('uses the given version and trims the title', () => {
    const m = build({ endings: 1 }, { title: '  雨音と読書の時間  ', version: '2.1.0', kind: 'voice' });
    expect(m.work).toEqual({ id: 'p-0123456789', title: '雨音と読書の時間', kind: 'voice', version: '2.1.0' });
  });

  it('omits groups with count 0', () => {
    const m = build({ endings: 0, cg: 0, achievements: 5, tracks: 0 });
    expect(m.groups).toEqual([{ id: 'achievements', label: '実績' }]);
    expect(m.goals).toHaveLength(5);
    expect(m.checkpoints).toEqual([]);
    const t = build({ tracks: 6 });
    expect(t.groups.map((g) => g.id)).toEqual(['tracks']);
  });

  it('validates cleanly (no warnings) and round-trips through parseManifestText', async () => {
    for (const c of [
      { endings: 5, cg: 40, tracks: 6 },
      { endings: 1 },
      { achievements: 200, chapters: 30 },
      { endings: 50, cg: 200, achievements: 200, tracks: 50, chapters: 30 },
    ]) {
      const m = build(c);
      const r = validateManifest(m);
      expect(r.ok, JSON.stringify(c)).toBe(true);
      if (!r.ok) continue;
      expect(r.warnings).toEqual([]);
      expect(r.manifest).toEqual(m);
      const parsed = parseManifestText(JSON.stringify(m, null, 2));
      expect(parsed.ok).toBe(true);
      if (parsed.ok) expect(await manifestKey(parsed.manifest)).toBe(await manifestKey(m));
    }
  });

  it('accepts the largest allowed totals (500 goals)', () => {
    const m = build({ endings: 50, cg: 200, achievements: 200, tracks: 50, chapters: 30 });
    expect(m.goals).toHaveLength(500);
    expect(m.goals.at(-1)!.id).toBe('track-50');
    expect(m.checkpoints.at(-1)).toEqual({ id: 'ch-30', label: '第30章' });
  });

  it('rejects all-zero counts and chapters only', () => {
    const msg = 'エンディング・CG・実績・トラックのどれかを1以上にしてください';
    expect(validationMessage(() => build({}))).toBe(msg);
    expect(validationMessage(() => build({ chapters: 5 }))).toBe(msg);
  });

  it.each([
    ['endings', 51, 'エンディングは0〜50の整数で入力してください'],
    ['cg', 201, '回想・CGは0〜200の整数で入力してください'],
    ['achievements', -1, '実績は0〜200の整数で入力してください'],
    ['tracks', 1.5, 'トラックは0〜100の整数で入力してください'],
    ['chapters', 31, '章は0〜30の整数で入力してください'],
    ['endings', Number.NaN, 'エンディングは0〜50の整数で入力してください'],
    ['cg', Number.POSITIVE_INFINITY, '回想・CGは0〜200の整数で入力してください'],
  ] as const)('rejects %s = %d', (key, value, message) => {
    expect(validationMessage(() => build({ endings: 1, [key]: value }))).toBe(message);
  });

  it('rejects non-number counts', () => {
    const bad = { ...counts({ endings: 1 }), cg: '3' as unknown as number };
    expect(validationMessage(() => checkQuickCounts(bad))).toBe('回想・CGは0〜200の整数で入力してください');
  });

  it('rejects more than 500 goals in total', () => {
    const msg = validationMessage(() => build({ endings: 50, cg: 200, achievements: 200, tracks: 51 }));
    expect(msg).toBe('エンディング・CG・実績・トラックの合計は500個までにしてください');
  });

  it('exposes limits matching the form (F6 AC1)', () => {
    expect(QUICK_LIMITS).toEqual({ endings: 50, cg: 200, achievements: 200, tracks: 100, chapters: 30 });
  });

  it('rejects a missing or over-long title', () => {
    expect(validationMessage(() => build({ endings: 1 }, { title: '   ' }))).toBe('タイトルを入力してください');
    expect(validationMessage(() => build({ endings: 1 }, { title: 'あ'.repeat(101) }))).toBe('タイトルは100文字以内にしてください');
    expect(build({ endings: 1 }, { title: 'あ'.repeat(100) }).work.title).toHaveLength(100);
  });

  it('rejects a bad version or work id', () => {
    expect(validationMessage(() => build({ endings: 1 }, { version: '1.0 beta' }))).toContain('バージョン');
    const idMsg = validationMessage(() => build({ endings: 1 }, { workId: 'P-UPPER' }));
    expect(idMsg).toContain('work.id');
    expect(idMsg).toContain('作品ID');
  });

  it('rejects a title with control characters via the validation safety net', () => {
    const msg = validationMessage(() => build({ endings: 1 }, { title: 'a\u202Eb' }));
    expect(msg).toContain('かんたんしおりを作れませんでした');
    expect(msg).toContain('work.title');
  });

  it('works with generated work ids', () => {
    const m = build({ endings: 2 }, { workId: newPlayerWorkId() });
    expect(validateManifest(m).ok).toBe(true);
  });
});
