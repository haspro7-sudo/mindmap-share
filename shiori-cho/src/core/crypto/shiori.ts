// Code-based sealing for shiori.json (CONTRACT, docs/SPEC.md §4.3 "Derivations").
// The golden vectors in the spec are verified by shiori.test.ts.
import { DS, KDF_ITERATIONS_MAX, MANIFEST_SCHEMA } from '../constants';
import { b64uDecode, b64uEncode, concatBytes, fromUtf8, randomBytes, utf8 } from '../encoding';
import type { Rng } from '../encoding';
import { ShioriError } from '../errors';
import { goalSecretSchema, sealedPayloadSchema } from '../manifest/payloadSchemas';
import type { AnyOfWrap, B64u, Bytes, EncBox, GoalSecret, KdfParams, SealedItem, SealedPayload, SealedUnlock } from '../types';
import { DECRYPT_MESSAGE_JA, GCM_IV_BYTES, aesGcmDecrypt, aesGcmEncrypt, hkdfSha256, hmacSha256, pbkdf2Sha256 } from './primitives';

/** Length of a master key and of every derived AES-256 key (bytes). */
export const MASTER_BYTES = 32;
/** Length of kdf.salt (bytes). */
export const KDF_SALT_BYTES = 16;
/** Length of the lookup tag stored in goal.unlock.tag (bytes). */
export const TAG_BYTES = 16;

const MSG_KDF = '鍵の設定（kdf）が正しくありません';
const MSG_MASTERS = '合言葉の鍵が正しくありません';
const MSG_SECRET_INVALID = 'ゴールの秘密情報の形式が正しくありません';
const MSG_PAYLOAD_INVALID = 'おまけの内容の形式が正しくありません';
const MSG_RNG = '乱数の生成に失敗しました';

// ───────────────────────── helpers ─────────────────────────

/** Validates kdf params and returns the decoded 16-byte salt. Throws ShioriError('crypto'). */
function kdfSalt(kdf: KdfParams): Bytes {
  if (kdf?.alg !== 'PBKDF2-SHA256') throw new ShioriError('crypto', MSG_KDF);
  const { iterations } = kdf;
  if (!Number.isSafeInteger(iterations) || iterations < 1 || iterations > KDF_ITERATIONS_MAX) {
    throw new ShioriError('crypto', MSG_KDF);
  }
  let salt: Bytes;
  try {
    salt = b64uDecode(kdf.salt);
  } catch (cause) {
    throw new ShioriError('crypto', MSG_KDF, { cause });
  }
  if (salt.length !== KDF_SALT_BYTES) throw new ShioriError('crypto', MSG_KDF);
  return salt;
}

function assertMaster(master: unknown): asserts master is Uint8Array {
  if (!(master instanceof Uint8Array) || master.length !== MASTER_BYTES) {
    throw new ShioriError('crypto', MSG_MASTERS);
  }
}

/**
 * Own-property lookup. Goal ids such as "constructor" match the id pattern, so a plain
 * `masters[id]` would find Object.prototype members on an ordinary object literal.
 */
function masterOf(masters: Readonly<Record<string, Uint8Array>>, goalId: string): Uint8Array | undefined {
  if (!Object.hasOwn(masters, goalId)) return undefined;
  const m = masters[goalId];
  return m instanceof Uint8Array ? m : undefined;
}

/** Goal ids of a masters map in JS default (UTF-16 code-unit) order. */
function sortedIds(masters: Readonly<Record<string, Uint8Array>>): string[] {
  return Object.keys(masters).sort();
}

function draw(rng: Rng, n: number): Bytes {
  const out = rng(n);
  if (!(out instanceof Uint8Array) || out.length !== n) throw new ShioriError('crypto', MSG_RNG);
  return new Uint8Array(out) as Bytes;
}

function goalAad(workId: string, goalId: string): Bytes {
  return utf8(`${MANIFEST_SCHEMA}|${workId}|goal|${goalId}`);
}

function sealedAad(workId: string, sealedId: string): Bytes {
  return utf8(`${MANIFEST_SCHEMA}|${workId}|sealed|${sealedId}`);
}

function wrapAad(workId: string, sealedId: string, goalId: string): Bytes {
  return utf8(`${MANIFEST_SCHEMA}|${workId}|wrap|${sealedId}|${goalId}`);
}

function wrapKey(master: Uint8Array, salt: Uint8Array, sealedId: string, goalId: string): Promise<Bytes> {
  return hkdfSha256(master, salt, utf8(`${DS.wrap}${sealedId}|${goalId}`), MASTER_BYTES);
}

async function sealBox(key: Uint8Array, plaintext: Uint8Array, aad: Uint8Array, rng: Rng): Promise<EncBox> {
  const iv = draw(rng, GCM_IV_BYTES);
  const ct = await aesGcmEncrypt(key, iv, plaintext, aad);
  return { iv: b64uEncode(iv), ct: b64uEncode(ct) };
}

async function openBox(key: Uint8Array, box: EncBox, aad: Uint8Array): Promise<Bytes> {
  return aesGcmDecrypt(key, b64uDecode(box.iv), b64uDecode(box.ct), aad);
}

function decryptError(cause?: unknown): ShioriError {
  return new ShioriError('decrypt', DECRYPT_MESSAGE_JA, cause === undefined ? undefined : { cause });
}

/** Runs op; every failure becomes ShioriError('decrypt'). */
async function asDecrypt<T>(op: () => Promise<T>): Promise<T> {
  try {
    return await op();
  } catch (cause) {
    if (cause instanceof ShioriError && cause.code === 'decrypt') throw cause;
    throw decryptError(cause);
  }
}

function parseJson(pt: Uint8Array): unknown {
  return JSON.parse(fromUtf8(pt)) as unknown;
}

// ───────────────────────── derivations ─────────────────────────

/** PBKDF2-HMAC-SHA256(utf8(canonical), salt, iterations, 32) */
export async function deriveMaster(canonical: string, kdf: KdfParams): Promise<Bytes> {
  const salt = kdfSalt(kdf);
  return pbkdf2Sha256(utf8(canonical), salt, kdf.iterations, MASTER_BYTES);
}

/** HMAC-SHA256(master, utf8("shiori/1|tag|" + workId))[0..16] as b64u */
export async function lookupTag(master: Uint8Array, workId: string): Promise<B64u> {
  assertMaster(master);
  const mac = await hmacSha256(master, utf8(DS.tag + workId));
  return b64uEncode(mac.subarray(0, TAG_BYTES));
}

/** HKDF-SHA256(master, salt, "shiori/1|goal|" + goalId) → 32 bytes */
export async function goalKey(master: Uint8Array, kdf: KdfParams, goalId: string): Promise<Bytes> {
  assertMaster(master);
  const salt = kdfSalt(kdf);
  return hkdfSha256(master, salt, utf8(DS.goal + goalId), MASTER_BYTES);
}

/**
 * Encrypts a GoalSecret for goal.secret. The secret is validated with goalSecretSchema first
 * (ShioriError('validation') if invalid); the plaintext is utf8(JSON.stringify(validated secret)),
 * which drops unknown keys.
 */
export async function sealGoalSecret(
  master: Uint8Array, kdf: KdfParams, workId: string, goalId: string, secret: GoalSecret, rng: Rng = randomBytes,
): Promise<EncBox> {
  const parsed = goalSecretSchema.safeParse(secret);
  if (!parsed.success) throw new ShioriError('validation', MSG_SECRET_INVALID, { cause: parsed.error });
  const key = await goalKey(master, kdf, goalId);
  return sealBox(key, utf8(JSON.stringify(parsed.data)), goalAad(workId, goalId), rng);
}

/** Decrypts and validates against goalSecretSchema; throws ShioriError('decrypt') on failure. */
export async function openGoalSecret(
  master: Uint8Array, kdf: KdfParams, workId: string, goalId: string, box: EncBox,
): Promise<GoalSecret> {
  return asDecrypt(async () => {
    const key = await goalKey(master, kdf, goalId);
    const pt = await openBox(key, box, goalAad(workId, goalId));
    const parsed = goalSecretSchema.safeParse(parseJson(pt));
    if (!parsed.success) throw decryptError(parsed.error);
    return parsed.data;
  });
}

/** HKDF over concat(masters sorted by goal id, code-unit order), info "shiori/1|seal|" + sealedId */
export async function allOfKey(masters: Readonly<Record<string, Uint8Array>>, kdf: KdfParams, sealedId: string): Promise<Bytes> {
  const ids = sortedIds(masters);
  if (ids.length === 0) throw new ShioriError('crypto', MSG_MASTERS);
  const parts = ids.map((id) => {
    const m = masterOf(masters, id);
    assertMaster(m);
    return m;
  });
  const salt = kdfSalt(kdf);
  return hkdfSha256(concatBytes(...parts), salt, utf8(DS.seal + sealedId), MASTER_BYTES);
}

// ───────────────────────── sealed items ─────────────────────────

/**
 * Seals a SealedItem box. `masters` holds goalId → master for every goal in the condition;
 * unlock.goals is its key set in code-unit order (deterministic regardless of insertion order).
 * All randomness (box iv, anyOf CEK, wrap ivs) comes from `rng`.
 */
export async function sealItem(args: {
  workId: string;
  kdf: KdfParams;
  sealedId: string;
  mode: 'allOf' | 'anyOf';
  /** goalId → master for every goal in the condition */
  masters: Readonly<Record<string, Uint8Array>>;
  payload: SealedPayload;
  rng?: Rng;
}): Promise<{ unlock: SealedUnlock; box: EncBox }> {
  const { workId, kdf, sealedId, mode, masters } = args;
  const rng = args.rng ?? randomBytes;
  if (mode !== 'allOf' && mode !== 'anyOf') throw new ShioriError('crypto', '封印の条件が正しくありません');
  const parsed = sealedPayloadSchema.safeParse(args.payload);
  if (!parsed.success) throw new ShioriError('validation', MSG_PAYLOAD_INVALID, { cause: parsed.error });

  const goals = sortedIds(masters);
  if (goals.length === 0) throw new ShioriError('crypto', MSG_MASTERS);
  const ordered = goals.map((g) => {
    const m = masterOf(masters, g);
    assertMaster(m);
    return [g, m] as const;
  });
  const salt = kdfSalt(kdf);
  const plaintext = utf8(JSON.stringify(parsed.data));
  const aad = sealedAad(workId, sealedId);

  if (mode === 'allOf') {
    const key = await allOfKey(masters, kdf, sealedId);
    const box = await sealBox(key, plaintext, aad, rng);
    return { unlock: { mode: 'allOf', goals }, box };
  }

  const cek = draw(rng, MASTER_BYTES);
  const box = await sealBox(cek, plaintext, aad, rng);
  const wraps: AnyOfWrap[] = [];
  for (const [g, m] of ordered) {
    const w = await wrapKey(m, salt, sealedId, g);
    const sealed = await sealBox(w, cek, wrapAad(workId, sealedId, g), rng);
    wraps.push({ goal: g, iv: sealed.iv, ct: sealed.ct });
  }
  return { unlock: { mode: 'anyOf', goals, wraps }, box };
}

/**
 * Opens a sealed item with the masters the player has.
 * Returns null if the condition is not satisfied by the provided masters.
 * Throws ShioriError('decrypt') on tampering / wrong binding / invalid payload.
 */
export async function openItem(args: {
  workId: string;
  kdf: KdfParams;
  item: SealedItem;
  masters: Readonly<Record<string, Uint8Array>>;
}): Promise<SealedPayload | null> {
  const { workId, kdf, item, masters } = args;
  const unlock = item?.unlock;
  if (!unlock || !Array.isArray(unlock.goals)) throw decryptError();
  const aad = sealedAad(workId, item.id);

  if (unlock.mode === 'allOf') {
    if (unlock.goals.length === 0) throw decryptError();
    const subset = Object.create(null) as Record<string, Uint8Array>;
    for (const g of unlock.goals) {
      const m = masterOf(masters, g);
      if (!m) return null;
      subset[g] = m;
    }
    return asDecrypt(async () => {
      const key = await allOfKey(subset, kdf, item.id);
      return parsePayload(await openBox(key, item.box, aad));
    });
  }

  if (unlock.mode === 'anyOf') {
    const held = firstHeld(masters, unlock.goals);
    if (!held) return null;
    const [g, m] = held;
    return asDecrypt(async () => {
      const wrap = Array.isArray(unlock.wraps) ? unlock.wraps.find((w) => w.goal === g) : undefined;
      if (!wrap) throw decryptError();
      const salt = kdfSalt(kdf);
      assertMaster(m);
      const w = await wrapKey(m, salt, item.id, g);
      const cek = await openBox(w, wrap, wrapAad(workId, item.id, g));
      if (cek.length !== MASTER_BYTES) throw decryptError();
      return parsePayload(await openBox(cek, item.box, aad));
    });
  }

  throw decryptError();
}

/** The first goal (in unlock.goals order) whose master the player holds. */
function firstHeld(masters: Readonly<Record<string, Uint8Array>>, goals: readonly string[]): [string, Uint8Array] | undefined {
  for (const g of goals) {
    const m = masterOf(masters, g);
    if (m) return [g, m];
  }
  return undefined;
}

function parsePayload(pt: Uint8Array): SealedPayload {
  const parsed = sealedPayloadSchema.safeParse(parseJson(pt));
  if (!parsed.success) throw decryptError(parsed.error);
  return parsed.data;
}
