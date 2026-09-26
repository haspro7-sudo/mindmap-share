import { beforeAll, describe, it, expect } from 'vitest';
import { b64uDecode, b64uEncode, concatBytes, fromHex, toHex, utf8 } from '../encoding';
import type { Rng } from '../encoding';
import { ShioriError } from '../errors';
import type { Bytes, EncBox, KdfParams, SealedItem, SealedPayload } from '../types';
import { aesGcmDecrypt, aesGcmEncrypt, hkdfSha256 } from './primitives';
import {
  allOfKey,
  deriveMaster,
  goalKey,
  lookupTag,
  openGoalSecret,
  openItem,
  sealGoalSecret,
  sealItem,
} from './shiori';

// ───────────────────────── golden vectors (docs/SPEC.md §4.3) ─────────────────────────
const GOLDEN_KDF: KdfParams = { alg: 'PBKDF2-SHA256', iterations: 100_000, salt: 'AAECAwQFBgcICQoLDA0ODw' };
const WORK = 'demo-vector';
const B32 = 'b32:K7QM2XRAP';
const KANA = 'kana:ほたるかえでつばめこだますずめ';
const B32_MASTER = 'a2e05a107253dc586092bd006c0bf95e5030fbec9ed48e45bd2a86682f961cba';
const B32_TAG = 'uJk22A2jIIW5X8pomdRjfQ';
const KANA_MASTER = 'd71a2dee8fa5a9da411c45d39ab8889cc5c72a48c0e9f571e44f71a987836315';
const KANA_TAG = 'A81l68U1lJh5E23amVDweQ';
const GOAL_KEY_END_A = '3ee47f55d091917e2278b87bc734012fbcf576e6bd3f3ddc6f6887f411fe0fbd';
const SECRET_CT = 'KdmEUu8aoGAckWBHhF2aLbH8Z0eGqhQEe9-sizNMZ0rTG7FUOOahg6sEZg';
const SECRET_IV = 'AAECAwQFBgcICQoL';
const ALLOF_AFTERWORD = '8986c15f93dda206636cb2016d13b700579e2bd98d95611824788f4dff5e7046';

/** Fast params for non-golden tests. */
const KDF: KdfParams = { alg: 'PBKDF2-SHA256', iterations: 1_000, salt: 'EBESExQVFhcYGRobHB0eHw' };
const SALT = b64uDecode(KDF.salt);

const PAYLOAD: SealedPayload = {
  title: 'あとがき',
  body: '最後まで遊んでくれて、ありがとうございました。\n次回作もよろしくお願いします。',
  from: 'サンプル工房（架空）',
};

/** rng returning 0,1,2,… (restarting at 0 for every call) — like the golden iv. */
const seqRng: Rng = (n) => Uint8Array.from({ length: n }, (_, i) => i) as Bytes;

/** Deterministic counter rng: each call continues where the previous stopped. */
function counterRng(start = 0): Rng {
  let c = start;
  return (n) => Uint8Array.from({ length: n }, () => c++ & 0xff) as Bytes;
}

async function caught(p: Promise<unknown>): Promise<unknown> {
  return p.then(
    () => undefined,
    (e: unknown) => e,
  );
}

async function expectCode(p: Promise<unknown>, code: string): Promise<void> {
  const err = await caught(p);
  expect(err).toBeInstanceOf(ShioriError);
  expect((err as ShioriError).code).toBe(code);
}

function flip(b64: string, index = 0): string {
  const b = b64uDecode(b64);
  b[index]! ^= 1;
  return b64uEncode(b);
}

function item(id: string, unlock: SealedItem['unlock'], box: EncBox): SealedItem {
  return { id, label: 'おまけ', kind: 'afterword', unlock, box };
}

// Masters for fast tests (derived once).
const M: Record<string, Bytes> = {};

beforeAll(async () => {
  const codes: Record<string, string> = {
    'end-a': 'b32:AAAAAAAA0',
    'end-b': 'b32:BBBBBBBB0',
    'end-c': 'b32:CCCCCCCC0',
    'voice-1': 'kana:ほたるほたるほたるほたるほたる',
    constructor: 'b32:DDDDDDDD0',
    other: 'b32:EEEEEEEE0',
  };
  for (const [g, c] of Object.entries(codes)) M[g] = await deriveMaster(c, KDF);
});

function pick(...ids: string[]): Record<string, Bytes> {
  const out: Record<string, Bytes> = {};
  for (const id of ids) out[id] = M[id]!;
  return out;
}

describe('golden vectors (§4.3)', () => {
  let b32Master: Bytes;
  let kanaMaster: Bytes;

  beforeAll(async () => {
    b32Master = await deriveMaster(B32, GOLDEN_KDF);
    kanaMaster = await deriveMaster(KANA, GOLDEN_KDF);
  });

  it('master and tag for b32:K7QM2XRAP', async () => {
    expect(toHex(b32Master)).toBe(B32_MASTER);
    expect(await lookupTag(b32Master, WORK)).toBe(B32_TAG);
  });

  it('master and tag for the kana code', async () => {
    expect(toHex(kanaMaster)).toBe(KANA_MASTER);
    expect(await lookupTag(kanaMaster, WORK)).toBe(KANA_TAG);
  });

  it('tag is 16 bytes', async () => {
    expect(b64uDecode(await lookupTag(b32Master, WORK)).length).toBe(16);
  });

  it('goalKey("end-a")', async () => {
    expect(toHex(await goalKey(b32Master, GOLDEN_KDF, 'end-a'))).toBe(GOAL_KEY_END_A);
  });

  it('goal secret ciphertext (raw AES-GCM with the golden goal key)', async () => {
    const key = await goalKey(b32Master, GOLDEN_KDF, 'end-a');
    const ct = await aesGcmEncrypt(key, b64uDecode(SECRET_IV), utf8('{"title":"星図の果て"}'), utf8('shiori/1|demo-vector|goal|end-a'));
    expect(b64uEncode(ct)).toBe(SECRET_CT);
  });

  it('sealGoalSecret with an rng returning bytes 0..11 reproduces the golden box', async () => {
    const box = await sealGoalSecret(b32Master, GOLDEN_KDF, WORK, 'end-a', { title: '星図の果て' }, seqRng);
    expect(box).toEqual({ iv: SECRET_IV, ct: SECRET_CT });
  });

  it('openGoalSecret opens the golden box', async () => {
    const secret = await openGoalSecret(b32Master, GOLDEN_KDF, WORK, 'end-a', { iv: SECRET_IV, ct: SECRET_CT });
    expect(secret).toEqual({ title: '星図の果て' });
  });

  it('allOf key for "afterword" over {end-a, voice-1}', async () => {
    const key = await allOfKey({ 'end-a': b32Master, 'voice-1': kanaMaster }, GOLDEN_KDF, 'afterword');
    expect(toHex(key)).toBe(ALLOF_AFTERWORD);
  });

  it('allOf key does not depend on the insertion order of the masters map', async () => {
    const key = await allOfKey({ 'voice-1': kanaMaster, 'end-a': b32Master }, GOLDEN_KDF, 'afterword');
    expect(toHex(key)).toBe(ALLOF_AFTERWORD);
  });

  it('allOf key = HKDF(concat(masters in sorted order), salt, "shiori/1|seal|afterword")', async () => {
    const manual = await hkdfSha256(concatBytes(b32Master, kanaMaster), b64uDecode(GOLDEN_KDF.salt), utf8('shiori/1|seal|afterword'));
    expect(toHex(manual)).toBe(ALLOF_AFTERWORD);
  });

  it('the tag changes when work.id or the salt changes', async () => {
    expect(await lookupTag(b32Master, 'demo-vector2')).not.toBe(B32_TAG);
    expect(await lookupTag(b32Master, 'Demo-vector')).not.toBe(B32_TAG);
    const otherSalt = await deriveMaster(B32, { ...GOLDEN_KDF, salt: 'AQECAwQFBgcICQoLDA0ODw' });
    expect(toHex(otherSalt)).not.toBe(B32_MASTER);
    expect(await lookupTag(otherSalt, WORK)).not.toBe(B32_TAG);
  });

  it('the master changes when iterations change', async () => {
    const m = await deriveMaster(B32, { ...GOLDEN_KDF, iterations: 100_001 });
    expect(toHex(m)).not.toBe(B32_MASTER);
  });
});

describe('deriveMaster / lookupTag / goalKey parameters', () => {
  it('rejects malformed kdf params with ShioriError("crypto")', async () => {
    await expectCode(deriveMaster(B32, { ...KDF, salt: 'AAECAwQFBgcICQoLDA0O' }), 'crypto'); // 15 bytes
    await expectCode(deriveMaster(B32, { ...KDF, salt: 'AAECAwQFBgcICQoLDA0ODxA' }), 'crypto'); // 17 bytes
    await expectCode(deriveMaster(B32, { ...KDF, salt: 'not base64url!' }), 'crypto');
    await expectCode(deriveMaster(B32, { ...KDF, iterations: 0 }), 'crypto');
    await expectCode(deriveMaster(B32, { ...KDF, iterations: 1.5 }), 'crypto');
    await expectCode(deriveMaster(B32, { ...KDF, iterations: 2_000_001 }), 'crypto');
    await expectCode(deriveMaster(B32, { ...KDF, alg: 'PBKDF2-SHA1' as 'PBKDF2-SHA256' }), 'crypto');
  });

  it('is deterministic and code-specific', async () => {
    const a = await deriveMaster('b32:AAAAAAAA0', KDF);
    expect(a.length).toBe(32);
    expect(toHex(a)).toBe(toHex(M['end-a']!));
    expect(toHex(a)).not.toBe(toHex(M['end-b']!));
  });

  it('lookupTag / goalKey reject masters that are not 32 bytes', async () => {
    await expectCode(lookupTag(new Uint8Array(31), WORK), 'crypto');
    await expectCode(goalKey(new Uint8Array(33), KDF, 'g'), 'crypto');
  });

  it('goalKey is goal-specific', async () => {
    const a = await goalKey(M['end-a']!, KDF, 'end-a');
    const b = await goalKey(M['end-a']!, KDF, 'end-b');
    expect(toHex(a)).not.toBe(toHex(b));
  });
});

describe('goal secrets', () => {
  const secret = {
    title: '星図の果て',
    description: '図書館のいちばん上で、\n星の地図を見つけた。🌟',
    unlockMessage: 'おめでとうございます！',
  };

  it('round-trips with the default (random) rng; two seals differ', async () => {
    const m = M['end-a']!;
    const a = await sealGoalSecret(m, KDF, 'w-test', 'end-a', secret);
    const b = await sealGoalSecret(m, KDF, 'w-test', 'end-a', secret);
    expect(b64uDecode(a.iv).length).toBe(12);
    expect(a.iv).not.toBe(b.iv);
    expect(a.ct).not.toBe(b.ct);
    expect(await openGoalSecret(m, KDF, 'w-test', 'end-a', a)).toEqual(secret);
    expect(await openGoalSecret(m, KDF, 'w-test', 'end-a', b)).toEqual(secret);
  });

  it('plaintext is JSON of the validated secret (unknown keys dropped)', async () => {
    const m = M['end-a']!;
    const box = await sealGoalSecret(m, KDF, 'w', 'g', { title: 't', extra: 'x' } as never, seqRng);
    const key = await goalKey(m, KDF, 'g');
    const pt = await aesGcmDecrypt(key, b64uDecode(box.iv), b64uDecode(box.ct), utf8('shiori/1|w|goal|g'));
    expect(new TextDecoder().decode(pt)).toBe('{"title":"t"}');
  });

  it('fails with the wrong master, goal id, work id or kdf salt', async () => {
    const box = await sealGoalSecret(M['end-a']!, KDF, 'w-test', 'end-a', secret);
    await expectCode(openGoalSecret(M['end-b']!, KDF, 'w-test', 'end-a', box), 'decrypt');
    await expectCode(openGoalSecret(M['end-a']!, KDF, 'w-test', 'end-b', box), 'decrypt');
    await expectCode(openGoalSecret(M['end-a']!, KDF, 'w-other', 'end-a', box), 'decrypt');
    await expectCode(openGoalSecret(M['end-a']!, { ...KDF, salt: 'AAECAwQFBgcICQoLDA0ODw' }, 'w-test', 'end-a', box), 'decrypt');
  });

  it('fails on tampered iv / ct and malformed boxes', async () => {
    const m = M['end-a']!;
    const box = await sealGoalSecret(m, KDF, 'w', 'g', secret);
    await expectCode(openGoalSecret(m, KDF, 'w', 'g', { ...box, ct: flip(box.ct, 3) }), 'decrypt');
    await expectCode(openGoalSecret(m, KDF, 'w', 'g', { ...box, iv: flip(box.iv, 0) }), 'decrypt');
    await expectCode(openGoalSecret(m, KDF, 'w', 'g', { ...box, iv: 'AAECAwQFBgcICQo' }), 'decrypt'); // 11 bytes
    await expectCode(openGoalSecret(m, KDF, 'w', 'g', { ...box, ct: '!!!' }), 'decrypt');
    await expectCode(openGoalSecret(m, KDF, 'w', 'g', { iv: box.iv, ct: '' }), 'decrypt');
    await expectCode(openGoalSecret(new Uint8Array(3), KDF, 'w', 'g', box), 'decrypt');
    await expectCode(openGoalSecret(m, { ...KDF, iterations: 0 }, 'w', 'g', box), 'decrypt');
  });

  it('rejects decrypted plaintext that is not JSON or fails goalSecretSchema', async () => {
    const m = M['end-a']!;
    const key = await goalKey(m, KDF, 'g');
    const iv = new Uint8Array(12);
    const aad = utf8('shiori/1|w|goal|g');
    for (const pt of [
      utf8('not json'),
      utf8('{"title":""}'),
      utf8('{"title":"' + 'あ'.repeat(61) + '"}'),
      utf8('{"title":"a\\u202Eb"}'),
      utf8('{"description":"no title"}'),
      utf8('null'),
      utf8('"just a string"'),
      new Uint8Array([0xff, 0xfe]),
    ]) {
      const ct = await aesGcmEncrypt(key, iv, pt, aad);
      await expectCode(openGoalSecret(m, KDF, 'w', 'g', { iv: b64uEncode(iv), ct: b64uEncode(ct) }), 'decrypt');
    }
  });

  it('validates the secret before sealing (ShioriError("validation"))', async () => {
    const m = M['end-a']!;
    for (const bad of [
      { title: '' },
      { title: 'x'.repeat(61) },
      { title: 'a\nb' },
      { title: 'ok', description: 'x'.repeat(501) },
      { title: 'ok', unlockMessage: 'x'.repeat(301) },
      { title: 'ok', description: 'bidi \u202E' },
      {} as { title: string },
    ]) {
      await expectCode(sealGoalSecret(m, KDF, 'w', 'g', bad), 'validation');
    }
  });

  it('accepts boundary lengths', async () => {
    const m = M['end-a']!;
    const s = { title: 'あ'.repeat(60), description: 'い'.repeat(500), unlockMessage: 'う'.repeat(300) };
    const box = await sealGoalSecret(m, KDF, 'w', 'g', s);
    expect(await openGoalSecret(m, KDF, 'w', 'g', box)).toEqual(s);
  });

  it('rejects an rng that returns the wrong number of bytes', async () => {
    await expectCode(sealGoalSecret(M['end-a']!, KDF, 'w', 'g', { title: 't' }, () => new Uint8Array(11) as Bytes), 'crypto');
  });
});

describe('allOfKey', () => {
  it('uses code-unit order, not locale order', async () => {
    // '-' (0x2d) < '1' (0x31) < '_' (0x5f)
    const masters = { a_1: M['end-c']!, a1: M['end-b']!, 'a-1': M['end-a']! };
    const expected = await hkdfSha256(concatBytes(M['end-a']!, M['end-b']!, M['end-c']!), SALT, utf8('shiori/1|seal|s'));
    expect(toHex(await allOfKey(masters, KDF, 's'))).toBe(toHex(expected));
  });

  it('depends on the sealed id and on every master', async () => {
    const base = toHex(await allOfKey(pick('end-a', 'end-b'), KDF, 's'));
    expect(toHex(await allOfKey(pick('end-a', 'end-b'), KDF, 't'))).not.toBe(base);
    expect(toHex(await allOfKey({ 'end-a': M['end-a']!, 'end-b': M['end-c']! }, KDF, 's'))).not.toBe(base);
    expect(toHex(await allOfKey(pick('end-a'), KDF, 's'))).not.toBe(base);
  });

  it('rejects an empty map and malformed masters', async () => {
    await expectCode(allOfKey({}, KDF, 's'), 'crypto');
    await expectCode(allOfKey({ a: new Uint8Array(31) }, KDF, 's'), 'crypto');
    await expectCode(allOfKey({ a: M['end-a']!, b: 'x' as unknown as Uint8Array }, KDF, 's'), 'crypto');
  });
});

describe('sealItem / openItem: allOf', () => {
  const goals = ['end-a', 'end-b', 'end-c'];

  it('seals with sorted unlock.goals and opens with every master', async () => {
    const { unlock, box } = await sealItem({
      workId: 'w-test', kdf: KDF, sealedId: 'afterword', mode: 'allOf',
      masters: pick('end-c', 'end-a', 'end-b'), payload: PAYLOAD,
    });
    expect(unlock).toEqual({ mode: 'allOf', goals });
    expect(b64uDecode(box.iv).length).toBe(12);
    const opened = await openItem({ workId: 'w-test', kdf: KDF, item: item('afterword', unlock, box), masters: pick(...goals) });
    expect(opened).toEqual(PAYLOAD);
  });

  it('box = AES-GCM(allOfKey, iv, JSON(payload), "shiori/1|<work>|sealed|<id>")', async () => {
    const { box } = await sealItem({
      workId: 'w-test', kdf: KDF, sealedId: 'afterword', mode: 'allOf', masters: pick(...goals), payload: PAYLOAD, rng: seqRng,
    });
    expect(box.iv).toBe(SECRET_IV);
    const key = await allOfKey(pick(...goals), KDF, 'afterword');
    const pt = await aesGcmDecrypt(key, b64uDecode(box.iv), b64uDecode(box.ct), utf8('shiori/1|w-test|sealed|afterword'));
    expect(JSON.parse(new TextDecoder().decode(pt))).toEqual(PAYLOAD);
  });

  it('returns null for every strict subset of the masters (including none)', async () => {
    const { unlock, box } = await sealItem({ workId: 'w', kdf: KDF, sealedId: 's', mode: 'allOf', masters: pick(...goals), payload: PAYLOAD });
    const it_ = item('s', unlock, box);
    const subsets = [[], ['end-a'], ['end-b'], ['end-c'], ['end-a', 'end-b'], ['end-a', 'end-c'], ['end-b', 'end-c']];
    for (const s of subsets) {
      expect(await openItem({ workId: 'w', kdf: KDF, item: it_, masters: pick(...s, 'other') })).toBeNull();
    }
  });

  it('a subset cannot decrypt even if the file is edited to list fewer goals', async () => {
    const { unlock, box } = await sealItem({ workId: 'w', kdf: KDF, sealedId: 's', mode: 'allOf', masters: pick(...goals), payload: PAYLOAD });
    const tampered = item('s', { mode: 'allOf', goals: ['end-a', 'end-b'] }, box);
    expect(unlock.goals).toEqual(goals);
    await expectCode(openItem({ workId: 'w', kdf: KDF, item: tampered, masters: pick('end-a', 'end-b') }), 'decrypt');
  });

  it('does not depend on the order of the masters map or of unlock.goals', async () => {
    const a = await sealItem({ workId: 'w', kdf: KDF, sealedId: 's', mode: 'allOf', masters: pick('end-b', 'end-a'), payload: PAYLOAD, rng: seqRng });
    const b = await sealItem({ workId: 'w', kdf: KDF, sealedId: 's', mode: 'allOf', masters: pick('end-a', 'end-b'), payload: PAYLOAD, rng: seqRng });
    expect(a).toEqual(b);
    const reordered = item('s', { mode: 'allOf', goals: ['end-b', 'end-a'] }, a.box);
    expect(await openItem({ workId: 'w', kdf: KDF, item: reordered, masters: pick('end-b', 'end-a') })).toEqual(PAYLOAD);
    expect(await openItem({ workId: 'w', kdf: KDF, item: item('s', a.unlock, a.box), masters: pick('end-b', 'end-a') })).toEqual(PAYLOAD);
  });

  it('extra unrelated masters are ignored', async () => {
    const { unlock, box } = await sealItem({ workId: 'w', kdf: KDF, sealedId: 's', mode: 'allOf', masters: pick('end-a'), payload: PAYLOAD });
    expect(await openItem({ workId: 'w', kdf: KDF, item: item('s', unlock, box), masters: pick('end-a', 'end-b', 'other') })).toEqual(PAYLOAD);
  });

  it('throws "decrypt" when a held master is wrong for its goal', async () => {
    const { unlock, box } = await sealItem({ workId: 'w', kdf: KDF, sealedId: 's', mode: 'allOf', masters: pick('end-a', 'end-b'), payload: PAYLOAD });
    await expectCode(
      openItem({ workId: 'w', kdf: KDF, item: item('s', unlock, box), masters: { 'end-a': M['end-a']!, 'end-b': M['end-c']! } }),
      'decrypt',
    );
  });

  it('is bound to the sealed id and the work id (AAD)', async () => {
    const { unlock, box } = await sealItem({ workId: 'w', kdf: KDF, sealedId: 's', mode: 'allOf', masters: pick('end-a'), payload: PAYLOAD });
    await expectCode(openItem({ workId: 'w', kdf: KDF, item: item('t', unlock, box), masters: pick('end-a') }), 'decrypt');
    // allOfKey does not depend on the work id, so this failure comes from the AAD alone.
    await expectCode(openItem({ workId: 'w2', kdf: KDF, item: item('s', unlock, box), masters: pick('end-a') }), 'decrypt');
  });

  it('a box moved from another item fails', async () => {
    const one = await sealItem({ workId: 'w', kdf: KDF, sealedId: 'one', mode: 'allOf', masters: pick('end-a'), payload: PAYLOAD });
    const two = await sealItem({ workId: 'w', kdf: KDF, sealedId: 'two', mode: 'allOf', masters: pick('end-a'), payload: { ...PAYLOAD, title: '別' } });
    await expectCode(openItem({ workId: 'w', kdf: KDF, item: item('two', two.unlock, one.box), masters: pick('end-a') }), 'decrypt');
  });

  it('rejects a payload that fails its schema after decryption', async () => {
    const aad = utf8('shiori/1|w|sealed|s');
    const key = await allOfKey(pick('end-a'), KDF, 's');
    const iv = new Uint8Array(12);
    for (const pt of [
      JSON.stringify({ title: '', body: '' }),
      JSON.stringify({ title: 't' }),
      JSON.stringify({ title: 't', body: 'x'.repeat(20001) }),
      JSON.stringify({ title: 't', body: '', storeLink: { storeCode: 'XX123', caption: 'c' } }),
      JSON.stringify({ title: 't', body: 'a\u0007b' }),
      '[]',
      '{"title":',
    ]) {
      const ct = await aesGcmEncrypt(key, iv, utf8(pt), aad);
      const bad = item('s', { mode: 'allOf', goals: ['end-a'] }, { iv: b64uEncode(iv), ct: b64uEncode(ct) });
      await expectCode(openItem({ workId: 'w', kdf: KDF, item: bad, masters: pick('end-a') }), 'decrypt');
    }
  });

  it('rejects malformed items', async () => {
    const { box } = await sealItem({ workId: 'w', kdf: KDF, sealedId: 's', mode: 'allOf', masters: pick('end-a'), payload: PAYLOAD });
    await expectCode(openItem({ workId: 'w', kdf: KDF, item: item('s', { mode: 'allOf', goals: [] }, box), masters: pick('end-a') }), 'decrypt');
    await expectCode(
      openItem({ workId: 'w', kdf: KDF, item: item('s', { mode: 'someOf', goals: ['end-a'] } as never, box), masters: pick('end-a') }),
      'decrypt',
    );
    await expectCode(
      openItem({ workId: 'w', kdf: KDF, item: item('s', { mode: 'allOf', goals: ['end-a'] }, { iv: '***', ct: box.ct }), masters: pick('end-a') }),
      'decrypt',
    );
    await expectCode(
      openItem({ workId: 'w', kdf: { ...KDF, salt: 'short' }, item: item('s', { mode: 'allOf', goals: ['end-a'] }, box), masters: pick('end-a') }),
      'decrypt',
    );
  });
});

describe('sealItem / openItem: anyOf', () => {
  const goals = ['end-a', 'end-b', 'voice-1'];

  it('opens with each listed goal alone and returns null for unlisted goals', async () => {
    const { unlock, box } = await sealItem({
      workId: 'w-test', kdf: KDF, sealedId: 'letter', mode: 'anyOf', masters: pick('voice-1', 'end-b', 'end-a'), payload: PAYLOAD,
    });
    expect(unlock.mode).toBe('anyOf');
    expect(unlock.goals).toEqual(goals);
    const it_ = item('letter', unlock, box);
    for (const g of goals) {
      expect(await openItem({ workId: 'w-test', kdf: KDF, item: it_, masters: pick(g) })).toEqual(PAYLOAD);
    }
    expect(await openItem({ workId: 'w-test', kdf: KDF, item: it_, masters: pick('end-c', 'other') })).toBeNull();
    expect(await openItem({ workId: 'w-test', kdf: KDF, item: it_, masters: {} })).toBeNull();
    expect(await openItem({ workId: 'w-test', kdf: KDF, item: it_, masters: pick(...goals) })).toEqual(PAYLOAD);
  });

  it('an unlisted goal cannot open the item even when named in the file', async () => {
    const { unlock, box } = await sealItem({ workId: 'w', kdf: KDF, sealedId: 's', mode: 'anyOf', masters: pick('end-a'), payload: PAYLOAD });
    if (unlock.mode !== 'anyOf') throw new Error('expected anyOf');
    const forged = item('s', { mode: 'anyOf', goals: ['end-a', 'end-c'], wraps: [...unlock.wraps, { ...unlock.wraps[0]!, goal: 'end-c' }] }, box);
    await expectCode(openItem({ workId: 'w', kdf: KDF, item: forged, masters: pick('end-c') }), 'decrypt');
  });

  it('has one 48-byte wrap per goal with a 12-byte iv', async () => {
    const { unlock } = await sealItem({ workId: 'w', kdf: KDF, sealedId: 's', mode: 'anyOf', masters: pick(...goals), payload: PAYLOAD });
    if (unlock.mode !== 'anyOf') throw new Error('expected anyOf');
    expect(unlock.wraps.map((w) => w.goal)).toEqual(goals);
    for (const w of unlock.wraps) {
      expect(b64uDecode(w.iv).length).toBe(12);
      expect(b64uDecode(w.ct).length).toBe(48);
    }
  });

  it('follows §4.3 exactly: CEK = rng(32), W_g = HKDF(master_g, salt, "shiori/1|wrap|<id>|<g>")', async () => {
    const rng = counterRng(7);
    const { unlock, box } = await sealItem({ workId: 'w-test', kdf: KDF, sealedId: 'letter', mode: 'anyOf', masters: pick('end-a', 'end-b'), payload: PAYLOAD, rng });
    if (unlock.mode !== 'anyOf') throw new Error('expected anyOf');
    const cek = Uint8Array.from({ length: 32 }, (_, i) => 7 + i);
    const pt = await aesGcmDecrypt(cek, b64uDecode(box.iv), b64uDecode(box.ct), utf8('shiori/1|w-test|sealed|letter'));
    expect(JSON.parse(new TextDecoder().decode(pt))).toEqual(PAYLOAD);
    for (const w of unlock.wraps) {
      const wk = await hkdfSha256(M[w.goal]!, SALT, utf8(`shiori/1|wrap|letter|${w.goal}`));
      const unwrapped = await aesGcmDecrypt(wk, b64uDecode(w.iv), b64uDecode(w.ct), utf8(`shiori/1|w-test|wrap|letter|${w.goal}`));
      expect(toHex(unwrapped)).toBe(toHex(cek));
    }
    // All ivs come from the rng and are distinct.
    const ivs = new Set([box.iv, ...unlock.wraps.map((w) => w.iv)]);
    expect(ivs.size).toBe(3);
  });

  it('two seals of the same item use different CEKs and ivs by default', async () => {
    const a = await sealItem({ workId: 'w', kdf: KDF, sealedId: 's', mode: 'anyOf', masters: pick('end-a'), payload: PAYLOAD });
    const b = await sealItem({ workId: 'w', kdf: KDF, sealedId: 's', mode: 'anyOf', masters: pick('end-a'), payload: PAYLOAD });
    expect(a.box.ct).not.toBe(b.box.ct);
    // Mixing wraps from one seal with the box of the other fails.
    await expectCode(openItem({ workId: 'w', kdf: KDF, item: item('s', a.unlock, b.box), masters: pick('end-a') }), 'decrypt');
  });

  it('throws "decrypt" when the held master is wrong for its goal', async () => {
    const { unlock, box } = await sealItem({ workId: 'w', kdf: KDF, sealedId: 's', mode: 'anyOf', masters: pick('end-a', 'end-b'), payload: PAYLOAD });
    await expectCode(openItem({ workId: 'w', kdf: KDF, item: item('s', unlock, box), masters: { 'end-a': M['end-c']! } }), 'decrypt');
  });

  it('uses the first listed goal the player holds', async () => {
    const { unlock, box } = await sealItem({ workId: 'w', kdf: KDF, sealedId: 's', mode: 'anyOf', masters: pick('end-a', 'end-b'), payload: PAYLOAD });
    if (unlock.mode !== 'anyOf') throw new Error('expected anyOf');
    const brokenA = { ...unlock, wraps: unlock.wraps.map((w) => (w.goal === 'end-a' ? { ...w, ct: flip(w.ct) } : w)) };
    // end-a comes first and its wrap is corrupted → throws even though end-b would work.
    await expectCode(openItem({ workId: 'w', kdf: KDF, item: item('s', brokenA, box), masters: pick('end-a', 'end-b') }), 'decrypt');
    expect(await openItem({ workId: 'w', kdf: KDF, item: item('s', brokenA, box), masters: pick('end-b') })).toEqual(PAYLOAD);
  });

  it('throws "decrypt" when the wrap for the held goal is missing', async () => {
    const { unlock, box } = await sealItem({ workId: 'w', kdf: KDF, sealedId: 's', mode: 'anyOf', masters: pick('end-a', 'end-b'), payload: PAYLOAD });
    if (unlock.mode !== 'anyOf') throw new Error('expected anyOf');
    const noA = { ...unlock, wraps: unlock.wraps.filter((w) => w.goal !== 'end-a') };
    await expectCode(openItem({ workId: 'w', kdf: KDF, item: item('s', noA, box), masters: pick('end-a') }), 'decrypt');
    const noWraps = { mode: 'anyOf', goals: unlock.goals } as unknown as SealedItem['unlock'];
    await expectCode(openItem({ workId: 'w', kdf: KDF, item: item('s', noWraps, box), masters: pick('end-a') }), 'decrypt');
  });

  it('is bound to the sealed id (wrap AAD + key) and the work id (AAD only)', async () => {
    const { unlock, box } = await sealItem({ workId: 'w', kdf: KDF, sealedId: 's', mode: 'anyOf', masters: pick('end-a'), payload: PAYLOAD });
    await expectCode(openItem({ workId: 'w', kdf: KDF, item: item('t', unlock, box), masters: pick('end-a') }), 'decrypt');
    // W_g does not depend on the work id, so this failure comes from the AAD alone.
    await expectCode(openItem({ workId: 'w2', kdf: KDF, item: item('s', unlock, box), masters: pick('end-a') }), 'decrypt');
  });

  it('the box AAD alone binds the sealed id (same CEK, box moved between items)', async () => {
    // A fixed rng gives both items the same CEK, so only the box AAD differs.
    const x = await sealItem({ workId: 'w', kdf: KDF, sealedId: 'x', mode: 'anyOf', masters: pick('end-a'), payload: PAYLOAD, rng: seqRng });
    const y = await sealItem({ workId: 'w', kdf: KDF, sealedId: 'y', mode: 'anyOf', masters: pick('end-a'), payload: PAYLOAD, rng: seqRng });
    expect(await openItem({ workId: 'w', kdf: KDF, item: item('y', y.unlock, y.box), masters: pick('end-a') })).toEqual(PAYLOAD);
    await expectCode(openItem({ workId: 'w', kdf: KDF, item: item('y', y.unlock, x.box), masters: pick('end-a') }), 'decrypt');
  });

  it('rejects an unwrapped CEK that is not 32 bytes', async () => {
    const wk = await hkdfSha256(M['end-a']!, SALT, utf8('shiori/1|wrap|s|end-a'));
    const iv = new Uint8Array(12);
    const wct = await aesGcmEncrypt(wk, iv, new Uint8Array(16), utf8('shiori/1|w|wrap|s|end-a'));
    const boxCt = await aesGcmEncrypt(new Uint8Array(16), iv, utf8(JSON.stringify(PAYLOAD)), utf8('shiori/1|w|sealed|s'));
    const bad = item(
      's',
      { mode: 'anyOf', goals: ['end-a'], wraps: [{ goal: 'end-a', iv: b64uEncode(iv), ct: b64uEncode(wct) }] },
      { iv: b64uEncode(iv), ct: b64uEncode(boxCt) },
    );
    await expectCode(openItem({ workId: 'w', kdf: KDF, item: bad, masters: pick('end-a') }), 'decrypt');
  });

  it('rejects a payload that fails its schema after decryption', async () => {
    const cek = new Uint8Array(32).fill(9);
    const iv = new Uint8Array(12);
    const wk = await hkdfSha256(M['end-a']!, SALT, utf8('shiori/1|wrap|s|end-a'));
    const wct = await aesGcmEncrypt(wk, iv, cek, utf8('shiori/1|w|wrap|s|end-a'));
    const boxCt = await aesGcmEncrypt(cek, iv, utf8(JSON.stringify({ title: 'x'.repeat(61), body: '' })), utf8('shiori/1|w|sealed|s'));
    const bad = item(
      's',
      { mode: 'anyOf', goals: ['end-a'], wraps: [{ goal: 'end-a', iv: b64uEncode(iv), ct: b64uEncode(wct) }] },
      { iv: b64uEncode(iv), ct: b64uEncode(boxCt) },
    );
    await expectCode(openItem({ workId: 'w', kdf: KDF, item: bad, masters: pick('end-a') }), 'decrypt');
  });
});

describe('sealItem validation and edge cases', () => {
  it('validates the payload first (ShioriError("validation"))', async () => {
    for (const bad of [
      { title: '', body: '' },
      { title: 't', body: 'x'.repeat(20001) },
      { title: 't', body: '', from: 'x'.repeat(41) },
      { title: 't', body: '', storeLink: { storeCode: 'RJ12345', caption: 'c' } },
      { title: 't', body: '', returnCode: { code: '', instruction: 'i' } },
      { title: 't\u202E', body: '' },
    ]) {
      await expectCode(sealItem({ workId: 'w', kdf: KDF, sealedId: 's', mode: 'allOf', masters: pick('end-a'), payload: bad }), 'validation');
    }
  });

  it('rejects an empty masters map and malformed masters', async () => {
    for (const mode of ['allOf', 'anyOf'] as const) {
      await expectCode(sealItem({ workId: 'w', kdf: KDF, sealedId: 's', mode, masters: {}, payload: PAYLOAD }), 'crypto');
      await expectCode(sealItem({ workId: 'w', kdf: KDF, sealedId: 's', mode, masters: { a: new Uint8Array(16) }, payload: PAYLOAD }), 'crypto');
    }
    await expectCode(sealItem({ workId: 'w', kdf: KDF, sealedId: 's', mode: 'xOf' as never, masters: pick('end-a'), payload: PAYLOAD }), 'crypto');
  });

  it('round-trips a full payload (returnCode, storeLink, max-length body)', async () => {
    const payload: SealedPayload = {
      title: 'お手紙',
      body: 'あ'.repeat(19_999) + '\n',
      from: 'サンプル工房（架空）',
      returnCode: { code: 'K7Q-M2X-RAP', instruction: '次回作のしおり帳で入力してください' },
      storeLink: { storeCode: 'RJ01234567', caption: '次回作' },
    };
    for (const mode of ['allOf', 'anyOf'] as const) {
      const { unlock, box } = await sealItem({ workId: 'w', kdf: KDF, sealedId: 's', mode, masters: pick('end-a', 'end-b'), payload });
      expect(b64uDecode(box.ct).length).toBeLessThanOrEqual(65_552);
      expect(await openItem({ workId: 'w', kdf: KDF, item: item('s', unlock, box), masters: pick('end-a', 'end-b') })).toEqual(payload);
    }
  });

  it('drops unknown payload keys before sealing', async () => {
    const { unlock, box } = await sealItem({
      workId: 'w', kdf: KDF, sealedId: 's', mode: 'allOf', masters: pick('end-a'), payload: { ...PAYLOAD, secretNote: 'x' } as SealedPayload,
    });
    expect(await openItem({ workId: 'w', kdf: KDF, item: item('s', unlock, box), masters: pick('end-a') })).toEqual(PAYLOAD);
  });

  it('treats goal ids that shadow Object.prototype members as absent unless held', async () => {
    for (const mode of ['allOf', 'anyOf'] as const) {
      const { unlock, box } = await sealItem({ workId: 'w', kdf: KDF, sealedId: 's', mode, masters: pick('constructor'), payload: PAYLOAD });
      expect(unlock.goals).toEqual(['constructor']);
      const it_ = item('s', unlock, box);
      expect(await openItem({ workId: 'w', kdf: KDF, item: it_, masters: {} })).toBeNull();
      expect(await openItem({ workId: 'w', kdf: KDF, item: it_, masters: pick('end-a') })).toBeNull();
      expect(await openItem({ workId: 'w', kdf: KDF, item: it_, masters: pick('constructor') })).toEqual(PAYLOAD);
    }
  });

  it('opens the golden-vector style allOf item with the documented codes', async () => {
    const b32 = await deriveMaster(B32, GOLDEN_KDF);
    const kana = await deriveMaster(KANA, GOLDEN_KDF);
    const { unlock, box } = await sealItem({
      workId: WORK, kdf: GOLDEN_KDF, sealedId: 'afterword', mode: 'allOf', masters: { 'voice-1': kana, 'end-a': b32 }, payload: PAYLOAD,
    });
    const pt = await aesGcmDecrypt(fromHex(ALLOF_AFTERWORD), b64uDecode(box.iv), b64uDecode(box.ct), utf8('shiori/1|demo-vector|sealed|afterword'));
    expect(JSON.parse(new TextDecoder().decode(pt))).toEqual(PAYLOAD);
    expect(await openItem({ workId: WORK, kdf: GOLDEN_KDF, item: item('afterword', unlock, box), masters: { 'end-a': b32 } })).toBeNull();
  });
});
