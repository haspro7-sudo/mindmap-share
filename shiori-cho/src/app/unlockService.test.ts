import { describe, it, expect } from 'vitest';
import { b64uDecode, b64uEncode } from '../core/encoding';
import { ShioriError } from '../core/errors';
import type { UnlockOutcome, WorkRecord } from '../core/types';
import amaotoJson from '../demo/amaoto.shiori.json';
import hoshiyomiJson from '../demo/hoshiyomi.shiori.json';
import { createMemoryRepo } from '../storage/memoryRepo';
import type { ShioriRepo } from '../storage/repo';
import { commitImport, createWork, importBundledDemos, previewImport } from './library';
import {
  addPending,
  decryptGoalSecrets,
  evaluateSealed,
  handleDeepLink,
  markDoneWithoutCode,
  processPending,
  readSealed,
  submitCode,
} from './unlock';

// Demo KDF is 200k iterations: every derivation costs ~50–150 ms, so the tests reuse repos where they can.
const T0 = 1_790_000_000_000;
const HOSHIYOMI_TEXT = JSON.stringify(hoshiyomiJson);
const AMAOTO_TEXT = JSON.stringify(amaotoJson);
/** A code with a valid checksum that belongs to neither demo (the §4.3 golden-vector code). */
const FOREIGN_CODE = 'K7Q-M2X-RAP';

async function withDemos(): Promise<{ repo: ShioriRepo; hoshi: WorkRecord; amaoto: WorkRecord }> {
  const repo = createMemoryRepo();
  const [hoshiId, amaotoId] = await importBundledDemos(repo, T0);
  const hoshi = await repo.getWork(hoshiId!);
  const amaoto = await repo.getWork(amaotoId!);
  if (!hoshi || !amaoto) throw new Error('demo import failed');
  return { repo, hoshi, amaoto };
}

async function importText(repo: ShioriRepo, text: string, now = T0) {
  const preview = await previewImport(repo, text);
  if (preview.kind === 'invalid') throw new Error('invalid manifest');
  return commitImport(repo, preview, { source: 'file', now });
}

function expectOutcome(o: UnlockOutcome, status: UnlockOutcome['status'], goalId?: string): void {
  expect(o.status).toBe(status);
  if (goalId !== undefined) expect(o.goalId).toBe(goalId);
}

describe('submitCode — 星読みの図書館 end to end (§8 unlockService)', () => {
  it('opens the letter after the first code and the afterword and return code after END 4', async () => {
    const { repo, hoshi } = await withDemos();

    // END 1 in lowercase without dashes
    const first = await submitCode(repo, 'st4rmap1x', { workId: hoshi.id, now: T0 + 1 });
    expectOutcome(first, 'unlocked', 'end-a');
    expect(first.workId).toBe(hoshi.id);
    expect(first.canonical).toBe('b32:ST4RMAP1X');
    expect(first.secret?.title).toBeTruthy();
    expect(first.openedSealedIds).toEqual(['letter-mina']);

    const letter = await readSealed(repo, hoshi.id, 'letter-mina');
    expect(letter?.title).toBeTruthy();
    expect(letter?.body.length).toBeGreaterThan(0);
    expect(await readSealed(repo, hoshi.id, 'afterword')).toBeNull();
    expect(await readSealed(repo, hoshi.id, 'door-code')).toBeNull();

    // END 2 in full width, END 3 with spaces: nothing new opens
    const second = await submitCode(repo, 'ｍ００－ｎｄｅ－ｓｋｒ', { workId: hoshi.id, now: T0 + 2 });
    expectOutcome(second, 'unlocked', 'end-b');
    expect(second.openedSealedIds).toEqual([]);
    const third = await submitCode(repo, 'nek 0t0 m0e', { now: T0 + 3 });
    expectOutcome(third, 'unlocked', 'end-c');
    expect(third.openedSealedIds).toEqual([]);
    expect(await readSealed(repo, hoshi.id, 'afterword')).toBeNull();

    // END 4 with Unicode hyphens: the afterword (allOf all four) and the return code (allOf [end-true])
    const fourth = await submitCode(repo, 'SK1‐ES0‐NGM', { workId: hoshi.id, now: T0 + 4 });
    expectOutcome(fourth, 'unlocked', 'end-true');
    expect([...fourth.openedSealedIds].sort()).toEqual(['afterword', 'door-code']);

    const afterword = await readSealed(repo, hoshi.id, 'afterword');
    expect(afterword?.title).toBeTruthy();
    const door = await readSealed(repo, hoshi.id, 'door-code');
    expect(door?.returnCode?.code).toBe('ほしあかり');
    expect(await readSealed(repo, hoshi.id, 'no-such-item')).toBeNull();

    // Opens are stored unseen, with the time they first opened
    const opens = await repo.listSealedOpens(hoshi.id);
    expect(opens.map((o) => o.sealedId).sort()).toEqual(['afterword', 'door-code', 'letter-mina']);
    expect(opens.every((o) => o.seen === false)).toBe(true);
    expect(opens.find((o) => o.sealedId === 'letter-mina')?.firstOpenedAt).toBe(T0 + 1);

    // Progress is via code; redemptions cache the master for the current salt
    const progress = await repo.listProgress(hoshi.id);
    expect(progress.filter((p) => p.via === 'code').map((p) => p.goalId).sort()).toEqual([
      'end-a',
      'end-b',
      'end-c',
      'end-true',
    ]);
    const redemptions = await repo.listRedemptions(hoshi.id);
    expect(redemptions).toHaveLength(4);
    for (const r of redemptions) {
      expect(r.masterSalt).toBe(hoshiyomiJson.kdf.salt);
      expect(b64uDecode(r.master!)).toHaveLength(32);
    }

    // Secrets decrypt from the cached masters
    const secrets = await decryptGoalSecrets(repo, hoshi.id);
    expect(Object.keys(secrets).sort()).toEqual(['end-a', 'end-b', 'end-c', 'end-true']);
    expect(secrets['end-a']).toEqual(first.secret);

    // A second entry of a redeemed code
    const again = await submitCode(repo, 'ST4-RMA-P1X', { workId: hoshi.id, now: T0 + 5 });
    expectOutcome(again, 'already', 'end-a');
    expect(again.openedSealedIds).toEqual([]);
    expect(again.secret).toEqual(first.secret);
    const r = (await repo.listRedemptions(hoshi.id)).find((x) => x.goalId === 'end-a');
    expect(r?.redeemedAt).toBe(T0 + 1);
    expect(await evaluateSealed(repo, hoshi.id, T0 + 6)).toEqual([]);
  });

  it('matches the right work even when ctx.workId points at the other one', async () => {
    const { repo, hoshi, amaoto } = await withDemos();
    const out = await submitCode(repo, 'ama0t0n1j', { workId: hoshi.id, now: T0 });
    expectOutcome(out, 'unlocked', 'script-page');
    expect(out.workId).toBe(amaoto.id);
    expect(out.openedSealedIds).toEqual(['profile']);
    expect(await repo.listRedemptions(hoshi.id)).toEqual([]);
    const profile = await readSealed(repo, amaoto.id, 'profile');
    expect(profile?.title).toBeTruthy();
  });

  it('redeems the kana code of 雨音と読書の時間 in katakana, then reports it as already entered', async () => {
    const { repo, amaoto } = await withDemos();
    const out = await submitCode(repo, 'ホタル カエデ ツバメ コダマ スズメ', { now: T0 });
    expectOutcome(out, 'unlocked', 'bonus-talk');
    expect(out.workId).toBe(amaoto.id);
    expect(out.canonical).toBe('kana:ほたるかえでつばめこだますずめ');
    expect(out.openedSealedIds).toEqual(['after-talk']);
    expect(out.secret?.title).toBeTruthy();
    const story = await readSealed(repo, amaoto.id, 'after-talk');
    expect(story?.title).toBeTruthy();
    expect(await readSealed(repo, amaoto.id, 'profile')).toBeNull();

    const again = await submitCode(repo, 'ほたるかえでつばめこだますずめ', { workId: amaoto.id, now: T0 + 1 });
    expectOutcome(again, 'already', 'bonus-talk');
  });
});

describe('submitCode — errors', () => {
  it('rejects a checksum error and an unknown kana word without touching the library', async () => {
    const repo = createMemoryRepo();
    await importBundledDemos(repo, T0);
    const before = await repo.getSettings();

    const typo = await submitCode(repo, 'ST4-RMA-P1Y', { now: T0 });
    expect(typo).toEqual({ status: 'invalid', error: { kind: 'checksum' }, openedSealedIds: [] });
    const kana = await submitCode(repo, 'ほたる・かえで・るるる・こだま・すずめ', { now: T0 });
    expect(kana.status).toBe('invalid');
    expect(kana.error).toEqual({ kind: 'unknownWord', index: 2, word: 'るるる' });
    const empty = await submitCode(repo, '   ', { now: T0 });
    expect(empty.error).toEqual({ kind: 'empty' });

    expect(await repo.listRedemptions()).toEqual([]);
    expect((await repo.getSettings()).changesSinceBackup).toBe(before.changesSinceBackup);
  });

  it('returns noMatch with the canonical code; it can be kept as pending and stays there', async () => {
    const { repo } = await withDemos();
    const out = await submitCode(repo, FOREIGN_CODE.toLowerCase().replaceAll('-', ' '), { now: T0 });
    expect(out).toEqual({ status: 'noMatch', canonical: 'b32:K7QM2XRAP', openedSealedIds: [] });

    await addPending(repo, out.canonical!, undefined, T0);
    expect(await processPending(repo, T0 + 1)).toEqual([]);
    const pending = await repo.listPending();
    expect(pending).toHaveLength(1);
    expect(pending[0]?.canonical).toBe('b32:K7QM2XRAP');
  });

  it('returns noMatch when no work has a manifest with code goals', async () => {
    const repo = createMemoryRepo();
    await createWork(repo, { title: '記録だけの作品', kind: 'game' }, T0);
    const out = await submitCode(repo, 'ST4-RMA-P1X', { now: T0 });
    expect(out.status).toBe('noMatch');
  });
});

describe('pending codes and deep links', () => {
  it('stores a deep-link code as pending before import and redeems it when the file is imported', async () => {
    const repo = createMemoryRepo();
    const link = await handleDeepLink(repo, 'demo-hoshiyomi', 'ST4RMAP1X', T0);
    expect(link).toEqual({ status: 'pending', canonical: 'b32:ST4RMAP1X', openedSealedIds: [] });
    const pending = await repo.listPending();
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ canonical: 'b32:ST4RMAP1X', manifestWorkIdHint: 'demo-hoshiyomi', receivedAt: T0 });

    // amaoto first: the pending code does not match it and stays pending
    const a = await importText(repo, AMAOTO_TEXT, T0 + 1);
    expect(a.pendingOutcomes).toEqual([]);
    expect(await repo.listPending()).toHaveLength(1);

    const h = await importText(repo, HOSHIYOMI_TEXT, T0 + 2);
    expect(h.pendingOutcomes).toHaveLength(1);
    const outcome = h.pendingOutcomes[0]!;
    expectOutcome(outcome, 'unlocked', 'end-a');
    expect(outcome.workId).toBe(h.workId);
    expect(outcome.openedSealedIds).toEqual(['letter-mina']);
    expect(await repo.listPending()).toEqual([]);
    const progress = await repo.listProgress(h.workId);
    expect(progress).toEqual([
      { workId: h.workId, goalId: 'end-a', via: 'code', doneAt: T0 + 2, hintTierAtDone: 0, archived: false },
    ]);
  });

  it('redeems a deep link directly when the work is imported, and rejects a malformed code', async () => {
    const { repo, hoshi } = await withDemos();
    const out = await handleDeepLink(repo, 'demo-hoshiyomi', 'NEK0T0M0E', T0);
    expectOutcome(out, 'unlocked', 'end-c');
    expect(out.workId).toBe(hoshi.id);
    expect(out.openedSealedIds).toEqual(['letter-mina']);

    const bad = await handleDeepLink(repo, 'demo-hoshiyomi', 'NEK0T0M0F', T0);
    expect(bad.status).toBe('invalid');
    expect(bad.error).toEqual({ kind: 'checksum' });
    expect(await repo.listPending()).toEqual([]);
  });

  it('deduplicates pending codes by canonical form and keeps a hint learned later', async () => {
    const repo = createMemoryRepo();
    await addPending(repo, 'b32:ST4RMAP1X', undefined, T0);
    await addPending(repo, 'st4-rma-p1x', 'demo-hoshiyomi', T0 + 1);
    await addPending(repo, 'ＳＴ４ＲＭＡＰ１Ｘ', 'demo-amaoto', T0 + 2);
    const pending = await repo.listPending();
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ canonical: 'b32:ST4RMAP1X', manifestWorkIdHint: 'demo-hoshiyomi', receivedAt: T0 });

    await addPending(repo, 'ほたる かえで つばめ こだま すずめ', 'Not A Valid Id!', T0 + 3);
    const kana = (await repo.listPending()).find((p) => p.canonical.startsWith('kana:'));
    expect(kana?.manifestWorkIdHint).toBeUndefined();

    await expect(addPending(repo, 'ST4-RMA-P1Y')).rejects.toMatchObject({
      code: 'validation',
      messageJa: '入力ミスがあるようです。1文字違っているかもしれません',
    });
  });

  it('processPending redeems stored codes against every work and drops ones that can never parse', async () => {
    const { repo, hoshi, amaoto } = await withDemos();
    await addPending(repo, 'M00-NDE-SKR', undefined, T0);
    await addPending(repo, 'AMA-0T0-N1J', 'demo-amaoto', T0 + 1);
    // A corrupted entry (e.g. from an old backup) is removed instead of being retried forever.
    await repo.putPending({ id: 'broken', canonical: 'b32:NOTACODE', receivedAt: T0 + 2 });

    const outcomes = await processPending(repo, T0 + 10);
    expect(outcomes.map((o) => [o.status, o.workId, o.goalId])).toEqual([
      ['unlocked', hoshi.id, 'end-b'],
      ['unlocked', amaoto.id, 'script-page'],
    ]);
    expect(await repo.listPending()).toEqual([]);

    // Pending again after it was redeemed → 'already' and removed
    await addPending(repo, 'M00-NDE-SKR', undefined, T0 + 20);
    const again = await processPending(repo, T0 + 21);
    expect(again.map((o) => o.status)).toEqual(['already']);
    expect(await repo.listPending()).toEqual([]);
  });
});

describe('markDoneWithoutCode and progress', () => {
  it('counts the goal as done but keeps the title masked and the seals closed, until the code arrives', async () => {
    const { repo, hoshi } = await withDemos();
    await repo.putHint({ workId: hoshi.id, goalId: 'end-true', tier: 2, updatedAt: T0 });
    await markDoneWithoutCode(repo, hoshi.id, 'end-true', T0 + 1);

    expect(await repo.listProgress(hoshi.id)).toEqual([
      { workId: hoshi.id, goalId: 'end-true', via: 'manual', doneAt: T0 + 1, hintTierAtDone: 2, archived: false },
    ]);
    expect(await repo.listRedemptions(hoshi.id)).toEqual([]);
    expect(await evaluateSealed(repo, hoshi.id, T0 + 2)).toEqual([]);
    expect(await repo.listSealedOpens(hoshi.id)).toEqual([]);
    expect(await decryptGoalSecrets(repo, hoshi.id)).toEqual({});
    expect(await readSealed(repo, hoshi.id, 'door-code')).toBeNull();

    // Marking again is a no-op (the earliest completion stays)
    await markDoneWithoutCode(repo, hoshi.id, 'end-true', T0 + 3);
    expect((await repo.listProgress(hoshi.id))[0]?.doneAt).toBe(T0 + 1);

    // The code later upgrades the progress to 'code' but keeps the first completion time and tier
    await repo.putHint({ workId: hoshi.id, goalId: 'end-true', tier: 3, updatedAt: T0 + 4 });
    const out = await submitCode(repo, 'SK1-ES0-NGM', { workId: hoshi.id, now: T0 + 5 });
    expectOutcome(out, 'unlocked', 'end-true');
    expect([...out.openedSealedIds].sort()).toEqual(['door-code', 'letter-mina']);
    expect(await repo.listProgress(hoshi.id)).toEqual([
      { workId: hoshi.id, goalId: 'end-true', via: 'code', doneAt: T0 + 1, hintTierAtDone: 2, archived: false },
    ]);
  });

  it('records the hint tier revealed when a code is entered', async () => {
    const { repo, amaoto } = await withDemos();
    await repo.putHint({ workId: amaoto.id, goalId: 'script-page', tier: 1, updatedAt: T0 });
    await submitCode(repo, 'AMA-0T0-N1J', { workId: amaoto.id, now: T0 + 1 });
    const p = (await repo.listProgress(amaoto.id)).find((x) => x.goalId === 'script-page');
    expect(p).toEqual({ workId: amaoto.id, goalId: 'script-page', via: 'code', doneAt: T0 + 1, hintTierAtDone: 1, archived: false });
  });

  it('throws notFound for an unknown work or goal', async () => {
    const { repo, hoshi } = await withDemos();
    await expect(markDoneWithoutCode(repo, 'nope', 'end-a')).rejects.toBeInstanceOf(ShioriError);
    await expect(markDoneWithoutCode(repo, hoshi.id, 'no-goal')).rejects.toMatchObject({ code: 'notFound' });
    const plain = await createWork(repo, { title: '記録だけ', kind: 'other' }, T0);
    await expect(markDoneWithoutCode(repo, plain.id, 'end-a')).rejects.toMatchObject({ code: 'notFound' });
  });
});

describe('cached masters', () => {
  it('re-derives a missing master (e.g. after a backup restore) and caches it again', async () => {
    const { repo, hoshi } = await withDemos();
    await submitCode(repo, 'ST4-RMA-P1X', { workId: hoshi.id, now: T0 });
    const [r] = await repo.listRedemptions(hoshi.id);
    const master = r!.master;
    await repo.putRedemption({ workId: r!.workId, goalId: r!.goalId, canonical: r!.canonical, redeemedAt: r!.redeemedAt });

    const secrets = await decryptGoalSecrets(repo, hoshi.id);
    expect(Object.keys(secrets)).toEqual(['end-a']);
    const [cached] = await repo.listRedemptions(hoshi.id);
    expect(cached?.master).toBe(master);
    expect(cached?.masterSalt).toBe(hoshiyomiJson.kdf.salt);
    expect((await readSealed(repo, hoshi.id, 'letter-mina'))?.title).toBeTruthy();
  });

  it('replaces a stale cache (wrong salt or wrong key) and drops one that cannot be re-derived', async () => {
    const { repo, hoshi } = await withDemos();
    const bogus = b64uEncode(new Uint8Array(32).fill(7));
    // stale salt → re-derived
    await repo.putRedemption({
      workId: hoshi.id,
      goalId: 'end-a',
      canonical: 'b32:ST4RMAP1X',
      redeemedAt: T0,
      master: bogus,
      masterSalt: 'AAAAAAAAAAAAAAAAAAAAAA',
    });
    // right salt but a wrong master (tag mismatch) → re-derived
    await repo.putRedemption({
      workId: hoshi.id,
      goalId: 'end-b',
      canonical: 'b32:M00NDESKR',
      redeemedAt: T0,
      master: bogus,
      masterSalt: hoshiyomiJson.kdf.salt,
    });
    // a canonical that does not belong to the goal → cache dropped, canonical kept
    await repo.putRedemption({
      workId: hoshi.id,
      goalId: 'end-c',
      canonical: 'b32:K7QM2XRAP',
      redeemedAt: T0,
      master: bogus,
      masterSalt: 'AAAAAAAAAAAAAAAAAAAAAA',
    });

    const secrets = await decryptGoalSecrets(repo, hoshi.id);
    expect(Object.keys(secrets).sort()).toEqual(['end-a', 'end-b']);
    const byGoal = new Map((await repo.listRedemptions(hoshi.id)).map((r) => [r.goalId, r]));
    expect(byGoal.get('end-a')?.masterSalt).toBe(hoshiyomiJson.kdf.salt);
    expect(byGoal.get('end-a')?.master).not.toBe(bogus);
    expect(byGoal.get('end-b')?.master).not.toBe(bogus);
    expect(byGoal.get('end-c')).toEqual({ workId: hoshi.id, goalId: 'end-c', canonical: 'b32:K7QM2XRAP', redeemedAt: T0 });

    // Sealed evaluation only counts redemptions with valid masters: the letter opens, the afterword does not.
    expect(await evaluateSealed(repo, hoshi.id, T0 + 1)).toEqual(['letter-mina']);

    // The failed re-derivation is remembered: no further write for end-c.
    const changes = (await repo.getSettings()).changesSinceBackup;
    await decryptGoalSecrets(repo, hoshi.id);
    expect((await repo.getSettings()).changesSinceBackup).toBe(changes);
  });

  it('replaces a redemption whose code no longer matches when the goal is redeemed with its current code', async () => {
    const { repo, hoshi } = await withDemos();
    await repo.putRedemption({ workId: hoshi.id, goalId: 'end-a', canonical: 'b32:K7QM2XRAP', redeemedAt: T0 });
    const out = await submitCode(repo, 'ST4-RMA-P1X', { workId: hoshi.id, now: T0 + 1 });
    expectOutcome(out, 'unlocked', 'end-a');
    const [r] = await repo.listRedemptions(hoshi.id);
    expect(r).toMatchObject({ canonical: 'b32:ST4RMAP1X', redeemedAt: T0 + 1, masterSalt: hoshiyomiJson.kdf.salt });
  });
});

describe('concurrency', () => {
  it('serializes a double submission: one unlocks, the other reports already', async () => {
    const { repo, hoshi } = await withDemos();
    const [a, b] = await Promise.all([
      submitCode(repo, 'ST4-RMA-P1X', { workId: hoshi.id, now: T0 }),
      submitCode(repo, 'ST4-RMA-P1X', { workId: hoshi.id, now: T0 + 1 }),
    ]);
    expect([a.status, b.status]).toEqual(['unlocked', 'already']);
    expect(a.openedSealedIds).toEqual(['letter-mina']);
    expect(b.openedSealedIds).toEqual([]);
    expect(await repo.listRedemptions(hoshi.id)).toHaveLength(1);
  });
});
