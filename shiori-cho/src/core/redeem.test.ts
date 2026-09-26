import { beforeAll, describe, it, expect, vi } from 'vitest';
import { deriveMaster } from './crypto/shiori';
import { ShioriError } from './errors';
import { buildManifest } from './manifest/build';
import { buildQuickManifest } from './manifest/quick';
import { FIXTURE_SALT, fixtureProject, smallProject } from './manifest/testFixtures';
import { redeem, satisfiedSealed } from './redeem';
import type { Bytes, KdfParams, RedeemCandidate, ShioriManifestV1 } from './types';

const SALT_B = 'EBESExQVFhcYGRobHB0eHw';

function spyDerive() {
  return vi.fn((canonical: string, kdf: KdfParams): Promise<Bytes> => deriveMaster(canonical, kdf));
}

describe('redeem', () => {
  let fixture: ShioriManifestV1;
  let workA: ShioriManifestV1;
  let workB: ShioriManifestV1;
  let workC: ShioriManifestV1;
  let sameCodeB: ShioriManifestV1;
  let kanaOnly: ShioriManifestV1;
  let quick: ShioriManifestV1;

  beforeAll(async () => {
    [fixture, workA, workB, workC, sameCodeB, kanaOnly] = await Promise.all([
      buildManifest(fixtureProject()).then((r) => r.manifest),
      buildManifest(smallProject('work-aaaa', 'ST4-RMA-P1X')).then((r) => r.manifest),
      buildManifest(smallProject('work-bbbb', 'M00-NDE-SKR', { salt: SALT_B })).then((r) => r.manifest),
      // same salt/iterations as work-aaaa (the master is shared, the tag differs by work id)
      buildManifest(smallProject('work-cccc', 'NEK-0T0-M0E')).then((r) => r.manifest),
      // same code as work-aaaa but another work and salt
      buildManifest(smallProject('work-dddd', 'ST4-RMA-P1X', { salt: SALT_B })).then((r) => r.manifest),
      buildManifest(smallProject('work-kana', 'ほたる・かえで・つばめ・こだま・すずめ', { kind: 'kana' })).then(
        (r) => r.manifest,
      ),
    ]);
    quick = buildQuickManifest({
      title: 'かんたん',
      kind: 'game',
      workId: 'p-0123456789',
      counts: { endings: 2, cg: 0, achievements: 0, tracks: 0, chapters: 0 },
    });
  });

  const cand = (manifestKey: string, manifest: ShioriManifestV1): RedeemCandidate => ({ manifestKey, manifest });

  it('matches the right goal for b32 and kana codes (any width, case, separators)', async () => {
    const cands = [cand('fx', fixture)];
    const a = await redeem('ｋ７ｑ ｍ２ｘ ｒａｐ', cands);
    expect(a.status).toBe('matched');
    if (a.status !== 'matched') return;
    expect(a.goalId).toBe('end-a');
    expect(a.manifestKey).toBe('fx');
    expect(a.canonical).toBe('b32:K7QM2XRAP');
    expect(a.master).toEqual(await deriveMaster('b32:K7QM2XRAP', fixture.kdf!));

    const b = await redeem('st4 rma p1x', cands);
    expect(b.status === 'matched' && b.goalId).toBe('end-b');

    const k = await redeem('ホタル　カエデ　ツバメ　コダマ　スズメ', cands);
    expect(k.status === 'matched' && k.goalId).toBe('voice-1');
    expect(k.status === 'matched' && k.canonical).toBe('kana:ほたるかえでつばめこだますずめ');
  });

  it('accepts canonical forms (pending codes, deep links)', async () => {
    const r = await redeem('b32:K7QM2XRAP', [cand('fx', fixture)]);
    expect(r.status === 'matched' && r.goalId).toBe('end-a');
  });

  it('a valid code of another work gives noMatch', async () => {
    const r = await redeem('M00-NDE-SKR', [cand('a', workA), cand('fx', fixture)]);
    expect(r).toEqual({ status: 'noMatch', canonical: 'b32:M00NDESKR' });
  });

  it('finds the code in the right candidate among several', async () => {
    const r = await redeem('M00-NDE-SKR', [cand('a', workA), cand('fx', fixture), cand('b', workB)]);
    expect(r.status).toBe('matched');
    if (r.status === 'matched') {
      expect(r.manifestKey).toBe('b');
      expect(r.goalId).toBe('end-1');
    }
  });

  it('a checksum error never calls PBKDF2', async () => {
    const derive = spyDerive();
    const r = await redeem('K7Q-M2X-RAQ', [cand('fx', fixture)], { derive });
    expect(r).toEqual({ status: 'invalid', error: { kind: 'checksum' } });
    expect(derive).not.toHaveBeenCalled();
  });

  it('other parse errors never call PBKDF2 either', async () => {
    const derive = spyDerive();
    const cands = [cand('fx', fixture)];
    const unknown = await redeem('ほたる・かえで・ぽぽぽ・こだま・すずめ', cands, { derive });
    expect(unknown.status).toBe('invalid');
    if (unknown.status === 'invalid') expect(unknown.error).toEqual({ kind: 'unknownWord', index: 2, word: 'ぽぽぽ' });
    expect((await redeem('', cands, { derive })).status).toBe('invalid');
    expect(await redeem('K7Q-M2X-RA', cands, { derive })).toEqual({
      status: 'invalid',
      error: { kind: 'length', got: 8, expected: 9 },
    });
    expect((await redeem('K7Q-M2X-RAU', cands, { derive })).status).toBe('invalid');
    expect(derive).not.toHaveBeenCalled();
  });

  it('tries preferWorkId first (one PBKDF2 when it matches)', async () => {
    const derive = spyDerive();
    const cands = [cand('a', workA), cand('fx', fixture), cand('b', workB)];
    const r = await redeem('M00-NDE-SKR', cands, { derive, preferWorkId: 'work-bbbb' });
    expect(r.status === 'matched' && r.manifestKey).toBe('b');
    expect(derive).toHaveBeenCalledTimes(1);
    expect(derive.mock.calls[0]![1].salt).toBe(SALT_B);
  });

  it('without preferWorkId candidates are tried in order', async () => {
    const derive = spyDerive();
    const cands = [cand('a', workA), cand('b', workB)];
    const r = await redeem('M00-NDE-SKR', cands, { derive });
    expect(r.status === 'matched' && r.manifestKey).toBe('b');
    expect(derive.mock.calls.map((c) => c[1].salt)).toEqual([FIXTURE_SALT, SALT_B]);
  });

  it('the preferred work wins when two works share the same code', async () => {
    const cands = [cand('a', workA), cand('d', sameCodeB)];
    const first = await redeem('ST4-RMA-P1X', cands);
    expect(first.status === 'matched' && first.manifestKey).toBe('a');
    const preferred = await redeem('ST4-RMA-P1X', cands, { preferWorkId: 'work-dddd' });
    expect(preferred.status === 'matched' && preferred.manifestKey).toBe('d');
    // an unknown preferWorkId keeps the original order
    const unknown = await redeem('ST4-RMA-P1X', cands, { preferWorkId: 'nope-nope' });
    expect(unknown.status === 'matched' && unknown.manifestKey).toBe('a');
  });

  it('derives once per identical (salt, iterations) pair', async () => {
    const derive = spyDerive();
    // work-aaaa, work-cccc and the fixture all use FIXTURE_SALT with 100,000 iterations
    const r = await redeem('NEK-0T0-M0E', [cand('a', workA), cand('fx', fixture), cand('c', workC), cand('b', workB)], {
      derive,
    });
    expect(r.status === 'matched' && r.manifestKey).toBe('c');
    expect(derive).toHaveBeenCalledTimes(1);

    const derive2 = spyDerive();
    const miss = await redeem('SK1-ES0-NGM', [cand('a', workA), cand('c', workC), cand('b', workB), cand('d', sameCodeB)], {
      derive: derive2,
    });
    expect(miss.status).toBe('noMatch');
    expect(derive2).toHaveBeenCalledTimes(2);
  });

  it('skips candidates without kdf or without a code goal of the parsed kind (no PBKDF2)', async () => {
    const derive = spyDerive();
    const r = await redeem('ST4-RMA-P1X', [cand('q', quick), cand('k', kanaOnly)], { derive });
    expect(r).toEqual({ status: 'noMatch', canonical: 'b32:ST4RMAP1X' });
    expect(derive).not.toHaveBeenCalled();

    const kana = await redeem('ほたる かえで つばめ こだま すずめ', [cand('q', quick), cand('a', workA), cand('k', kanaOnly)], {
      derive,
    });
    expect(kana.status === 'matched' && kana.manifestKey).toBe('k');
    expect(derive).toHaveBeenCalledTimes(1);
  });

  it('never matches a goal of the other code kind even if the tag matched', async () => {
    // Forge: copy work-kana's kana tag into a b32 goal of the same work id and salt.
    const m = structuredClone(kanaOnly);
    const g = m.goals[0]!;
    if (g.unlock.type !== 'code') throw new Error('expected code goal');
    g.unlock = { ...g.unlock, codeKind: 'b32' };
    const r = await redeem('ほたる・かえで・つばめ・こだま・すずめ', [cand('m', m)]);
    expect(r.status).toBe('noMatch');
  });

  it('returns noMatch with no candidates', async () => {
    const derive = spyDerive();
    expect(await redeem('K7Q-M2X-RAP', [], { derive })).toEqual({ status: 'noMatch', canonical: 'b32:K7QM2XRAP' });
    expect(derive).not.toHaveBeenCalled();
  });

  it('skips a candidate whose kdf cannot be used, but propagates unexpected errors', async () => {
    const broken = structuredClone(workA);
    broken.kdf = { ...broken.kdf!, salt: 'AAAA' };
    const r = await redeem('M00-NDE-SKR', [cand('x', broken), cand('b', workB)]);
    expect(r.status === 'matched' && r.manifestKey).toBe('b');

    const failing = vi.fn(async (): Promise<Bytes> => {
      throw new ShioriError('crypto', 'テスト');
    });
    expect((await redeem('M00-NDE-SKR', [cand('b', workB)], { derive: failing })).status).toBe('noMatch');

    const boom = vi.fn((): Promise<Bytes> => {
      throw new Error('webcrypto unavailable');
    });
    await expect(redeem('M00-NDE-SKR', [cand('b', workB)], { derive: boom })).rejects.toThrow('webcrypto unavailable');
  });
});

describe('satisfiedSealed', () => {
  let m: ShioriManifestV1;

  beforeAll(async () => {
    m = (await buildManifest(fixtureProject())).manifest;
  });

  const ids = (items: { id: string }[]) => items.map((s) => s.id);

  it('nothing is satisfied without redemptions', () => {
    expect(satisfiedSealed(m, [])).toEqual([]);
  });

  it('anyOf opens with any listed goal; allOf needs every goal', () => {
    expect(ids(satisfiedSealed(m, ['end-a']))).toEqual(['letter']);
    expect(ids(satisfiedSealed(m, ['end-b']))).toEqual(['letter', 'door']);
    expect(ids(satisfiedSealed(m, ['voice-1']))).toEqual([]);
    expect(ids(satisfiedSealed(m, ['end-a', 'voice-1']))).toEqual(['letter']);
    expect(ids(satisfiedSealed(m, ['end-a', 'end-b', 'voice-1']))).toEqual(['afterword', 'letter', 'door']);
  });

  it('ignores unknown and manual goal ids and accepts any iterable', () => {
    expect(ids(satisfiedSealed(m, new Set(['ach-cat', 'nope', 'end-b'])))).toEqual(['letter', 'door']);
    function* gen() {
      yield 'voice-1';
      yield 'end-b';
      yield 'end-a';
    }
    expect(ids(satisfiedSealed(m, gen()))).toEqual(['afterword', 'letter', 'door']);
  });

  it('returns the manifest items themselves', () => {
    const [item] = satisfiedSealed(m, ['end-a']);
    expect(item).toBe(m.sealed[1]);
  });

  it('a manifest without sealed items gives an empty list', () => {
    expect(satisfiedSealed({ ...m, sealed: [] }, ['end-a', 'end-b', 'voice-1'])).toEqual([]);
  });
});
