import { describe, it, expect } from 'vitest';
import { BACKUP_AAD, BACKUP_ITERATIONS } from '../constants';
import { decryptJson, encryptJson } from '../crypto/backupCrypto';
import { b64uDecode, b64uEncode } from '../encoding';
import { ShioriError } from '../errors';
import { DEFAULT_SETTINGS } from '../types';
import type { BackupDataV1, EncryptedJson, ParseBackupError, ShioriManifestV1 } from '../types';
import {
  BACKUP_PASSPHRASE_MIN_CHARS,
  backupErrorMessageJa,
  backupFileName,
  exportBackup,
  isEncryptedBackupText,
  isValidBackupPassphrase,
  parseBackup,
  passphraseLength,
  sanitizeBackupData,
} from './format';
import { backupDataSchema, backupFileSchema } from './schema';

const FAST = 1_000;
const PASS = 'correct horse battery';
const NOW = Date.UTC(2026, 8, 26, 3, 0, 0);
const T0 = Date.UTC(2026, 7, 1, 0, 0, 0);
const APP = '0.1.0';

type Json = Record<string, unknown>;

function bytes(n: number, fill: number): string {
  return b64uEncode(new Uint8Array(n).fill(fill));
}

/** Walks into a parsed JSON tree for hand-editing in tests. */
function dig(v: unknown, ...keys: Array<string | number>): Json {
  let cur = v;
  for (const k of keys) cur = (cur as Record<string | number, unknown>)[k];
  return cur as Json;
}

function deepFreeze<T>(v: T): T {
  if (typeof v === 'object' && v !== null) {
    for (const x of Object.values(v)) deepFreeze(x);
    Object.freeze(v);
  }
  return v;
}

const MANIFEST: ShioriManifestV1 = {
  schema: 'shiori/1',
  work: {
    id: 'demo-hoshiyomi',
    title: '星読みの図書館',
    safeTitle: 'サンプルA',
    circle: 'サンプル工房（架空）',
    kind: 'game',
    engine: 'rpgmaker-mz',
    version: '1.0.0',
  },
  author: { kind: 'creator', name: 'サンプル工房（架空）' },
  kdf: { alg: 'PBKDF2-SHA256', iterations: 200_000, salt: bytes(16, 1) },
  checkpoints: [
    { id: 'ch1', label: '第1章' },
    { id: 'ch4', label: '第4章' },
  ],
  groups: [
    { id: 'endings', label: 'エンディング' },
    { id: 'ach', label: '実績' },
  ],
  goals: [
    {
      id: 'end-true',
      group: 'endings',
      label: 'END 4',
      teaser: '図書館のいちばん上で',
      spoiler: 1,
      hints: ['夜の図書館には、昼とは違う顔がある', '第3章の夜、屋上の天文台へ'],
      missable: { before: 'ch4', warn: 'この先に進む前に、図書館の中をもう一度見て回ろう' },
      unlock: { type: 'code', codeKind: 'b32', tag: bytes(16, 2) },
      secret: { iv: bytes(12, 3), ct: bytes(40, 4) },
    },
    { id: 'ach-cat', group: 'ach', label: '図書館の猫と3回話した', spoiler: 0, hints: [], unlock: { type: 'manual' } },
  ],
  sealed: [
    {
      id: 'afterword',
      label: 'あとがき',
      teaser: '全てのエンディングで開きます',
      kind: 'afterword',
      unlock: { mode: 'allOf', goals: ['end-true'] },
      box: { iv: bytes(12, 5), ct: bytes(64, 6) },
    },
  ],
  changelog: [{ version: '1.0.0', date: '2026-10-01', notes: '初版' }],
};

function sampleData(): BackupDataV1 {
  return {
    works: [
      {
        id: 'b7e9c2f4-0000-4000-8000-000000000001',
        title: '星読みの図書館',
        alias: 'サンプルA',
        kind: 'game',
        status: 'playing',
        coverEmoji: '📘',
        coverColor: 'paper',
        spoilerTolerance: 1,
        manifestKey: 'k-hoshiyomi',
        manifestWorkId: 'demo-hoshiyomi',
        currentCheckpointId: 'ch1',
        newGoalIds: [],
        createdAt: T0,
        updatedAt: T0 + 1_000,
        lastPlayedAt: T0 + 5_000,
      },
      {
        id: 'b7e9c2f4-0000-4000-8000-000000000002',
        title: '雨音と読書の時間🌧️👨\u200D👩\u200D👧',
        alias: '作品B',
        storeCode: 'RJ01234567',
        kind: 'voice',
        status: 'backlog',
        coverEmoji: '🌧️',
        coverColor: 'sky',
        spoilerTolerance: 0,
        newGoalIds: ['track-1'],
        createdAt: T0,
        updatedAt: T0,
      },
    ],
    manifests: [{ key: 'k-hoshiyomi', workId: 'b7e9c2f4-0000-4000-8000-000000000001', manifest: MANIFEST, source: 'bundled', importedAt: T0 }],
    progress: [
      { workId: 'b7e9c2f4-0000-4000-8000-000000000001', goalId: 'ach-cat', via: 'manual', doneAt: T0 + 2_000, hintTierAtDone: 0, archived: false },
      { workId: 'b7e9c2f4-0000-4000-8000-000000000001', goalId: 'end-true', via: 'code', doneAt: T0 + 3_000, hintTierAtDone: 2, archived: false },
    ],
    redemptions: [{ workId: 'b7e9c2f4-0000-4000-8000-000000000001', goalId: 'end-true', canonical: 'b32:ST4RMAP1X', redeemedAt: T0 + 3_000 }],
    hints: [{ workId: 'b7e9c2f4-0000-4000-8000-000000000001', goalId: 'end-true', tier: 2, updatedAt: T0 + 2_500 }],
    sessions: [
      {
        id: 's-1',
        workId: 'b7e9c2f4-0000-4000-8000-000000000001',
        startedAt: T0 + 4_000,
        endedAt: T0 + 5_000,
        minutes: 17,
        checkpointId: 'ch1',
        whereNote: '書架の前',
        nextTodo: '猫に話しかける',
      },
      { id: 's-2', workId: 'b7e9c2f4-0000-4000-8000-000000000002', startedAt: T0 + 6_000 },
    ],
    notes: [
      { id: 'n-1', workId: 'b7e9c2f4-0000-4000-8000-000000000001', text: '||屋上||があやしい\n\tタブ入りのメモ', createdAt: T0, updatedAt: T0 + 10 },
      { id: 'n-2', workId: 'b7e9c2f4-0000-4000-8000-000000000001', goalId: 'ach-cat', text: '', createdAt: T0, updatedAt: T0 },
    ],
    pending: [{ id: 'p-1', canonical: 'kana:ほたるかえでつばめこだますずめ', manifestWorkIdHint: 'demo-amaoto', receivedAt: T0 + 7_000 }],
    sealedOpens: [{ workId: 'b7e9c2f4-0000-4000-8000-000000000001', sealedId: 'afterword', firstOpenedAt: T0 + 3_100, seen: true }],
    settings: {
      discreet: { aliasOnly: true, blurOnHide: false, hideStoreLinks: true, blurExtras: true },
      autoLockSec: 30,
      camouflageText: '買い物メモ\n牛乳',
    },
  };
}

/** sampleData() whose redemption carries a cached master, as a repo row would. */
function dataWithMasters(): BackupDataV1 {
  const d = sampleData();
  d.redemptions = d.redemptions.map((r) => ({ ...r, master: bytes(32, 9), masterSalt: bytes(16, 1) }));
  return d;
}

async function plainText(data: BackupDataV1 = sampleData()): Promise<string> {
  return exportBackup(data, { appVersion: APP, now: NOW });
}

async function encryptedText(data: BackupDataV1 = sampleData()): Promise<string> {
  return exportBackup(data, { appVersion: APP, now: NOW, passphrase: PASS, iterations: FAST });
}

function edit(text: string, f: (file: Json) => void): string {
  const file = JSON.parse(text) as Json;
  f(file);
  return JSON.stringify(file);
}

async function caught(p: Promise<unknown>): Promise<unknown> {
  return p.then(
    () => undefined,
    (e: unknown) => e,
  );
}

describe('exportBackup (plain)', () => {
  it('writes a pretty-printed BackupFileV1 with the header fields', async () => {
    const text = await plainText();
    const file = JSON.parse(text) as Json;
    expect(text).toBe(JSON.stringify(file, null, 2));
    expect(text.startsWith('{\n  "format": "shiori-backup",\n  "version": 1,')).toBe(true);
    expect(file).toMatchObject({ format: 'shiori-backup', version: 1, exportedAt: NOW, appVersion: APP, encrypted: false });
    expect(Object.keys(file)).toEqual(['format', 'version', 'exportedAt', 'appVersion', 'encrypted', 'data']);
    expect(file.data).toEqual(sampleData());
    expect(backupFileSchema.safeParse(file).success).toBe(true);
  });

  it('round-trips through parseBackup', async () => {
    const r = await parseBackup(await plainText());
    expect(r).toEqual({ ok: true, data: sampleData(), encrypted: false, exportedAt: NOW });
  });

  it('round-trips empty data', async () => {
    const empty: BackupDataV1 = {
      works: [],
      manifests: [],
      progress: [],
      redemptions: [],
      hints: [],
      sessions: [],
      notes: [],
      pending: [],
      sealedOpens: [],
      settings: { discreet: { ...DEFAULT_SETTINGS.discreet }, autoLockSec: 60, camouflageText: '' },
    };
    const r = await parseBackup(await plainText(empty));
    expect(r).toEqual({ ok: true, data: empty, encrypted: false, exportedAt: NOW });
  });

  it('never exports cached masters', async () => {
    const text = await plainText(dataWithMasters());
    expect(text).not.toContain('master');
    expect(text).not.toContain(bytes(32, 9));
    const file = JSON.parse(text) as { data: BackupDataV1 };
    expect(file.data.redemptions).toEqual(sampleData().redemptions);
  });

  it('never exports the PIN, the age flag or other local-only settings, even if the caller passes them', async () => {
    const data = sampleData();
    data.settings = {
      ...DEFAULT_SETTINGS,
      ...data.settings,
      pin: { salt: bytes(16, 7), iterations: 200_000, hash: bytes(32, 8) },
      ageConfirmedAt: T0,
      onboardedAt: T0,
      pinFailures: 3,
      lastBackupAt: T0,
      discreet: { ...data.settings.discreet, extra: true },
    } as unknown as BackupDataV1['settings'];
    const text = await plainText(data);
    for (const s of ['pin', 'ageConfirmedAt', 'onboardedAt', 'lastBackupAt', 'extra', bytes(32, 8)]) {
      expect(text).not.toContain(s);
    }
    const file = JSON.parse(text) as { data: BackupDataV1 };
    expect(Object.keys(file.data.settings).sort()).toEqual(['autoLockSec', 'camouflageText', 'discreet']);
    expect(file.data.settings).toEqual(sampleData().settings);
  });

  it('does not mutate its input', async () => {
    const data = deepFreeze(dataWithMasters());
    const snapshot = JSON.stringify(data);
    await plainText(data);
    await encryptedText(data);
    expect(JSON.stringify(data)).toBe(snapshot);
    expect(data.redemptions[0]!.master).toBe(bytes(32, 9));
  });

  it('treats an empty passphrase as no passphrase', async () => {
    const text = await exportBackup(sampleData(), { appVersion: APP, now: NOW, passphrase: '' });
    expect((JSON.parse(text) as Json).encrypted).toBe(false);
  });

  it('rejects an invalid timestamp', async () => {
    for (const now of [Number.NaN, Number.POSITIVE_INFINITY, -1]) {
      const err = await caught(exportBackup(sampleData(), { appVersion: APP, now }));
      expect(err).toBeInstanceOf(ShioriError);
    }
  });
});

describe('exportBackup (encrypted)', () => {
  it('writes only the envelope, bound to the backup AAD', async () => {
    const text = await encryptedText(dataWithMasters());
    const file = JSON.parse(text) as Json & { enc: EncryptedJson };
    expect(Object.keys(file)).toEqual(['format', 'version', 'exportedAt', 'appVersion', 'encrypted', 'enc']);
    expect(file).toMatchObject({ format: 'shiori-backup', version: 1, exportedAt: NOW, appVersion: APP, encrypted: true });
    expect(file.enc.kdf).toMatchObject({ alg: 'PBKDF2-SHA256', iterations: FAST });
    expect(b64uDecode(file.enc.kdf.salt).length).toBe(16);
    expect(b64uDecode(file.enc.iv).length).toBe(12);
    expect(backupFileSchema.safeParse(file).success).toBe(true);
    // nothing readable leaks
    for (const s of ['星読みの図書館', 'サンプルA', 'ST4RMAP1X', 'ほたる', '屋上', '買い物メモ', 'master']) {
      expect(text).not.toContain(s);
    }
    // the inner payload is the sanitized data, encrypted with aad "shiori-backup/1"
    expect(await decryptJson(file.enc, PASS, BACKUP_AAD)).toEqual(sampleData());
    expect(await caught(decryptJson(file.enc, PASS, 'shiori-backup/2'))).toBeInstanceOf(ShioriError);
  });

  it('uses 600,000 PBKDF2 iterations by default', async () => {
    const text = await exportBackup({ ...sampleData(), manifests: [] }, { appVersion: APP, now: NOW, passphrase: PASS });
    const file = JSON.parse(text) as { enc: { kdf: { iterations: number } } };
    expect(file.enc.kdf.iterations).toBe(BACKUP_ITERATIONS);
    expect(BACKUP_ITERATIONS).toBe(600_000);
  });

  it('round-trips through parseBackup with the passphrase', async () => {
    const r = await parseBackup(await encryptedText(dataWithMasters()), PASS);
    expect(r).toEqual({ ok: true, data: sampleData(), encrypted: true, exportedAt: NOW });
  });

  it('uses a fresh salt and IV each time', async () => {
    const a = JSON.parse(await encryptedText()) as { enc: { kdf: { salt: string }; iv: string; ct: string } };
    const b = JSON.parse(await encryptedText()) as { enc: { kdf: { salt: string }; iv: string; ct: string } };
    expect(a.enc.kdf.salt).not.toBe(b.enc.kdf.salt);
    expect(a.enc.iv).not.toBe(b.enc.iv);
    expect(a.enc.ct).not.toBe(b.enc.ct);
  });

  it('requires a passphrase of at least 8 characters', async () => {
    for (const passphrase of ['1234567', 'short', ' ', '😀😀😀😀', 'ほしあかり']) {
      const err = await caught(exportBackup(sampleData(), { appVersion: APP, now: NOW, passphrase, iterations: FAST }));
      expect(err).toBeInstanceOf(ShioriError);
      expect((err as ShioriError).code).toBe('validation');
      expect((err as ShioriError).messageJa).toBe('パスフレーズは8文字以上にしてください');
    }
    for (const passphrase of ['12345678', 'ほしあかりのよる', '😀😀😀😀😀😀😀😀']) {
      const text = await exportBackup(sampleData(), { appVersion: APP, now: NOW, passphrase, iterations: FAST });
      expect(isEncryptedBackupText(text)).toBe(true);
      expect(await parseBackup(text, passphrase)).toMatchObject({ ok: true, encrypted: true });
    }
  });

  it('counts passphrase length in characters of the NFC form', () => {
    expect(BACKUP_PASSPHRASE_MIN_CHARS).toBe(8);
    expect(passphraseLength('😀😀😀😀')).toBe(4);
    expect(passphraseLength('か\u3099か\u3099か\u3099か\u3099')).toBe(4); // NFD がが… → 4 NFC characters
    expect(isValidBackupPassphrase('abcdefgh')).toBe(true);
    expect(isValidBackupPassphrase('abcdefg')).toBe(false);
  });
});

describe('parseBackup errors', () => {
  it("returns 'json' for text that is not JSON", async () => {
    for (const text of ['', ' ', '{', 'not json', '{"format": "shiori-backup",}', "{'format':'shiori-backup'}"]) {
      expect(await parseBackup(text)).toEqual({ ok: false, error: 'json' });
    }
  });

  it("returns 'format' for JSON that is not a shiori backup", async () => {
    const others = ['null', '[]', '42', '"shiori-backup"', 'true', '{}', '{"format":"shiori-studio-project","version":1}', JSON.stringify(MANIFEST)];
    for (const text of others) {
      expect(await parseBackup(text)).toEqual({ ok: false, error: 'format' });
    }
    const plain = await plainText();
    expect(await parseBackup(`[${plain}]`)).toEqual({ ok: false, error: 'format' });
  });

  it("returns 'format' when the version is missing or not a number", async () => {
    const plain = await plainText();
    for (const version of [undefined, null, '1', 0, -1, true]) {
      const text = edit(plain, (f) => {
        f.version = version;
      });
      expect(await parseBackup(text)).toEqual({ ok: false, error: 'format' });
    }
  });

  it("returns 'version' for a backup from a newer app, before asking for a passphrase", async () => {
    const plain = await plainText();
    for (const version of [2, 1.5, 100]) {
      const text = edit(plain, (f) => {
        f.version = version;
      });
      expect(await parseBackup(text)).toEqual({ ok: false, error: 'version' });
    }
    const future = edit(await encryptedText(), (f) => {
      f.version = 2;
    });
    expect(await parseBackup(future)).toEqual({ ok: false, error: 'version' });
    expect(await parseBackup(future, PASS)).toEqual({ ok: false, error: 'version' });
    // even a v2 file with a completely different body
    expect(await parseBackup('{"format":"shiori-backup","version":2,"somethingNew":{}}')).toEqual({ ok: false, error: 'version' });
  });

  it("returns 'passphraseRequired' for an encrypted file without a passphrase", async () => {
    const text = await encryptedText();
    expect(await parseBackup(text)).toEqual({ ok: false, error: 'passphraseRequired' });
    expect(await parseBackup(text, undefined)).toEqual({ ok: false, error: 'passphraseRequired' });
    expect(await parseBackup(text, '')).toEqual({ ok: false, error: 'passphraseRequired' });
  });

  it("returns 'passphrase' for a wrong passphrase", async () => {
    const text = await encryptedText();
    for (const wrong of ['correct horse battery!', 'CORRECT HORSE BATTERY', 'x']) {
      expect(await parseBackup(text, wrong)).toEqual({ ok: false, error: 'passphrase' });
    }
  });

  it("returns 'passphrase' for a tampered ciphertext or header-swapped envelope", async () => {
    const text = await encryptedText();
    const tampered = edit(text, (f) => {
      const enc = f.enc as { ct: string };
      const ct = b64uDecode(enc.ct);
      ct[0] = ct[0]! ^ 1;
      enc.ct = b64uEncode(ct);
    });
    expect(await parseBackup(tampered, PASS)).toEqual({ ok: false, error: 'passphrase' });
    // an envelope made with another AAD (e.g. another format) does not open as a backup
    const other = await encryptJson(sampleData(), PASS, { aad: 'shiori-studio-project/1', iterations: FAST });
    const swapped = edit(text, (f) => {
      f.enc = other;
    });
    expect(await parseBackup(swapped, PASS)).toEqual({ ok: false, error: 'passphrase' });
  });

  it("returns 'schema' for a malformed envelope, with or without a passphrase", async () => {
    const text = await encryptedText();
    const mutations: Array<(enc: Json & { kdf: Json }) => void> = [
      (e) => {
        e.iv = bytes(11, 1);
      },
      (e) => {
        e.iv = 'not base64url!';
      },
      (e) => {
        e.ct = bytes(15, 1);
      },
      (e) => {
        e.kdf.salt = bytes(8, 1);
      },
      (e) => {
        e.kdf.iterations = 0;
      },
      (e) => {
        e.kdf.iterations = 10_000_000;
      },
      (e) => {
        e.kdf.iterations = 1000.5;
      },
      (e) => {
        e.kdf.alg = 'scrypt';
      },
      (e) => {
        delete e.ct;
      },
    ];
    for (const m of mutations) {
      const bad = edit(text, (f) => m(f.enc as Json & { kdf: Json }));
      expect(await parseBackup(bad)).toEqual({ ok: false, error: 'schema' });
      expect(await parseBackup(bad, PASS)).toEqual({ ok: false, error: 'schema' });
    }
    const noEnc = edit(text, (f) => {
      delete f.enc;
      f.data = sampleData();
    });
    expect(await parseBackup(noEnc)).toEqual({ ok: false, error: 'schema' });
  });

  it("returns 'schema' for a malformed header", async () => {
    const plain = await plainText();
    const mutations: Array<(f: Json) => void> = [
      (f) => {
        delete f.exportedAt;
      },
      (f) => {
        f.exportedAt = -5;
      },
      (f) => {
        f.appVersion = 1;
      },
      (f) => {
        delete f.encrypted;
      },
      (f) => {
        f.encrypted = 'no';
      },
      (f) => {
        delete f.data;
      },
      (f) => {
        f.data = null;
      },
    ];
    for (const m of mutations) {
      expect(await parseBackup(edit(plain, m))).toEqual({ ok: false, error: 'schema' });
    }
  });

  const dataMutations: Array<[string, (d: Json) => void]> = [
    ['unknown work status', (d) => (dig(d, 'works', 0).status = 'done')],
    ['unknown cover color', (d) => (dig(d, 'works', 0).coverColor = 'neon')],
    ['spoiler tolerance 4', (d) => (dig(d, 'works', 0).spoilerTolerance = 4)],
    ['empty work id', (d) => (dig(d, 'works', 0).id = '')],
    ['empty title', (d) => (dig(d, 'works', 0).title = '')],
    ['non-normalized store code', (d) => (dig(d, 'works', 1).storeCode = 'rj01234567')],
    ['bad manifestWorkId', (d) => (dig(d, 'works', 0).manifestWorkId = 'Bad Id')],
    ['newGoalIds missing', (d) => delete dig(d, 'works', 0).newGoalIds],
    ['string timestamp', (d) => (dig(d, 'works', 0).updatedAt = '2026-09-26')],
    ['unknown manifest source', (d) => (dig(d, 'manifests', 0).source = 'url')],
    ['manifest of another schema', (d) => (dig(d, 'manifests', 0, 'manifest').schema = 'shiori/2')],
    ['manifest kdf below the minimum', (d) => (dig(d, 'manifests', 0, 'manifest', 'kdf').iterations = 99_999)],
    ['manifest tag of 15 bytes', (d) => (dig(d, 'manifests', 0, 'manifest', 'goals', 0, 'unlock').tag = bytes(15, 1))],
    ['progress via unknown', (d) => (dig(d, 'progress', 0).via = 'cheat')],
    ['hintTierAtDone 5', (d) => (dig(d, 'progress', 0).hintTierAtDone = 5)],
    ['archived not boolean', (d) => (dig(d, 'progress', 0).archived = 'no')],
    ['empty canonical', (d) => (dig(d, 'redemptions', 0).canonical = '')],
    ['hint tier 0', (d) => (dig(d, 'hints', 0).tier = 0)],
    ['hint tier 4', (d) => (dig(d, 'hints', 0).tier = 4)],
    ['negative startedAt', (d) => (dig(d, 'sessions', 0).startedAt = -1)],
    ['endedAt null', (d) => (dig(d, 'sessions', 0).endedAt = null)],
    ['note too long', (d) => (dig(d, 'notes', 0).text = 'あ'.repeat(100_001))],
    ['pending without canonical', (d) => delete dig(d, 'pending', 0).canonical],
    ['seen not boolean', (d) => (dig(d, 'sealedOpens', 0).seen = 1)],
    ['autoLockSec 45', (d) => (dig(d, 'settings').autoLockSec = 45)],
    ['discreet flag missing', (d) => delete dig(d, 'settings', 'discreet').blurExtras],
    ['settings missing', (d) => delete d.settings],
    ['notes missing', (d) => delete d.notes],
    ['works not an array', (d) => (d.works = {})],
  ];

  it.each(dataMutations)("returns 'schema' for invalid data in a plain file: %s", async (_name, mutate) => {
    const text = edit(await plainText(), (f) => mutate(f.data as Json));
    expect(await parseBackup(text)).toEqual({ ok: false, error: 'schema' });
  });

  it("returns 'schema' for invalid data inside an encrypted file", async () => {
    const data = sampleData();
    dataMutations[0]![1](data as unknown as Json);
    const text = await exportBackup(data, { appVersion: APP, now: NOW, passphrase: PASS, iterations: FAST });
    expect(await parseBackup(text, PASS)).toEqual({ ok: false, error: 'schema' });
    // a correctly encrypted payload that is not BackupDataV1
    for (const payload of [{ hello: 'world' }, null, [], 'text']) {
      const junk = await encryptJson(payload, PASS, { aad: BACKUP_AAD, iterations: FAST });
      const withJunk = edit(text, (f) => {
        f.enc = junk;
      });
      expect(await parseBackup(withJunk, PASS)).toEqual({ ok: false, error: 'schema' });
    }
  });
});

describe('parseBackup tolerance', () => {
  it('strips unknown keys and cached masters from hand-edited files', async () => {
    const text = edit(await plainText(), (f) => {
      f.extraTop = 1;
      const d = f.data as Json & { works: Json[]; redemptions: Json[]; settings: Json };
      d.extraData = true;
      d.works[0]!.secretField = 'x';
      d.redemptions[0]!.master = bytes(32, 9);
      d.redemptions[0]!.masterSalt = bytes(16, 1);
      d.settings.pin = { salt: 'a', iterations: 1, hash: 'b' };
      d.settings.ageConfirmedAt = 1;
    });
    const r = await parseBackup(text);
    expect(r).toEqual({ ok: true, data: sampleData(), encrypted: false, exportedAt: NOW });
    expect(JSON.stringify(r)).not.toContain('master');
    expect(JSON.stringify(r)).not.toContain('secretField');
  });

  it('accepts a leading byte order mark', async () => {
    const r = await parseBackup(`\uFEFF${await plainText()}`);
    expect(r.ok).toBe(true);
    expect(isEncryptedBackupText(`\uFEFF${await encryptedText()}`)).toBe(true);
  });

  it('ignores a passphrase given for a plain file', async () => {
    expect(await parseBackup(await plainText(), PASS)).toEqual({ ok: true, data: sampleData(), encrypted: false, exportedAt: NOW });
  });

  it('accepts compact (non-pretty) JSON', async () => {
    const compact = JSON.stringify(JSON.parse(await plainText()));
    expect((await parseBackup(compact)).ok).toBe(true);
  });

  it('keeps free text as typed (tabs, emoji sequences, newlines)', async () => {
    const r = await parseBackup(await plainText());
    if (!r.ok) throw new Error('expected ok');
    expect(r.data.notes[0]!.text).toBe('||屋上||があやしい\n\tタブ入りのメモ');
    expect(r.data.works[1]!.title).toBe('雨音と読書の時間🌧️👨\u200D👩\u200D👧');
    expect(backupDataSchema.safeParse(r.data).success).toBe(true);
  });
});

describe('isEncryptedBackupText', () => {
  it('detects encrypted backups', async () => {
    expect(isEncryptedBackupText(await encryptedText())).toBe(true);
    expect(isEncryptedBackupText(await plainText())).toBe(false);
  });

  it('is false for bad JSON and for JSON that is not a shiori backup', () => {
    for (const text of ['', 'not json', '{', 'null', '42', '[{"format":"shiori-backup","encrypted":true}]', '{"encrypted":true}', '{"format":"other","encrypted":true}']) {
      expect(isEncryptedBackupText(text)).toBe(false);
    }
    expect(isEncryptedBackupText('{"format":"shiori-backup","version":1,"encrypted":"true"}')).toBe(false);
    expect(isEncryptedBackupText('{"format":"shiori-backup","version":1,"encrypted":true}')).toBe(true);
  });
});

describe('backupFileName', () => {
  it('runs in Asia/Tokyo for these tests', () => {
    expect(new Date(Date.UTC(2026, 0, 1)).getTimezoneOffset()).toBe(-540);
  });

  it('uses the local (Asia/Tokyo) calendar date', () => {
    expect(backupFileName(Date.UTC(2026, 0, 31, 14, 59, 59, 999))).toBe('shiori-backup-20260131.json');
    expect(backupFileName(Date.UTC(2026, 0, 31, 15, 0, 0))).toBe('shiori-backup-20260201.json');
    expect(backupFileName(Date.UTC(2026, 11, 31, 15, 30))).toBe('shiori-backup-20270101.json');
    expect(backupFileName(Date.UTC(2026, 8, 4, 16))).toBe('shiori-backup-20260905.json');
    expect(backupFileName(NOW)).toBe('shiori-backup-20260926.json');
  });

  it('is neutral: only the date, never any data', () => {
    expect(backupFileName(NOW)).toMatch(/^shiori-backup-\d{8}\.json$/);
  });

  it('falls back to a dateless name for an invalid time', () => {
    expect(backupFileName(Number.NaN)).toBe('shiori-backup.json');
  });
});

describe('backupErrorMessageJa', () => {
  const ALL: ParseBackupError[] = ['json', 'format', 'version', 'passphraseRequired', 'passphrase', 'schema'];

  it('has the documented messages', () => {
    expect(backupErrorMessageJa('version')).toBe('新しいバージョンのバックアップです。アプリを更新してください');
    expect(backupErrorMessageJa('passphrase')).toBe('パスフレーズが違います');
    expect(backupErrorMessageJa('passphraseRequired')).toBe('このバックアップは暗号化されています。パスフレーズを入力してください');
  });

  it('gives a distinct Japanese message for every error', () => {
    const messages = ALL.map(backupErrorMessageJa);
    expect(new Set(messages).size).toBe(ALL.length);
    for (const m of messages) {
      expect(m).toMatch(/[ぁ-んァ-ヶ一-龠]/);
      expect(m.length).toBeLessThanOrEqual(60);
    }
  });

  it('falls back to a generic message for an unknown code', () => {
    expect(backupErrorMessageJa('nope' as ParseBackupError)).toBe('バックアップを読み込めませんでした');
  });
});

describe('sanitizeBackupData', () => {
  it('drops masters and reduces settings without touching the rest', () => {
    const d = dataWithMasters();
    const clean = sanitizeBackupData(d);
    expect(clean).toEqual(sampleData());
    expect(clean.redemptions[0]).not.toHaveProperty('master');
    expect(clean.redemptions[0]).not.toHaveProperty('masterSalt');
    expect(d.redemptions[0]!.master).toBe(bytes(32, 9));
  });
});
