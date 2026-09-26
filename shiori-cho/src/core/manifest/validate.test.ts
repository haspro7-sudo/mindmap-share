import { describe, it, expect, vi } from 'vitest';
import { MAX_MANIFEST_BYTES } from '../constants';
import { b64uEncode, randomBytes } from '../encoding';
import type { ValidateResult, ValidationIssue } from '../types';
import { jsonErrorParams, locateJsonError, manifestKey, parseManifestText, utf8ByteLength, validateManifest } from './validate';

// ───────────────────────── Fixtures ─────────────────────────

/** base64url of `n` bytes filled with `fill` (valid binary field of the given length). */
const bin = (n: number, fill = 7) => b64uEncode(new Uint8Array(n).fill(fill));
const box = (ctBytes = 40) => ({ iv: bin(12), ct: bin(ctBytes) });

/** A valid creator manifest exercising every feature (code goals b32/kana, manual goals, allOf, anyOf). */
function fixture(): any {
  return {
    schema: 'shiori/1',
    work: {
      id: 'demo-test',
      title: '星読みの図書館（テスト）',
      safeTitle: 'サンプルA',
      circle: 'サンプル工房（架空）',
      storeCode: 'RJ01234567',
      kind: 'game',
      engine: 'rpgmaker-mz',
      version: '1.0.0',
    },
    author: { kind: 'creator', name: 'サンプル工房（架空）' },
    kdf: { alg: 'PBKDF2-SHA256', iterations: 200000, salt: bin(16) },
    checkpoints: [
      { id: 'ch1', label: '第1章' },
      { id: 'ch2', label: '第2章' },
    ],
    groups: [
      { id: 'endings', label: 'エンディング' },
      { id: 'ach', label: '実績' },
    ],
    goals: [
      {
        id: 'end-a',
        group: 'endings',
        label: 'END 1',
        teaser: '図書館のいちばん上で',
        spoiler: 1,
        hints: ['夜の図書館には、昼とは違う顔がある', '第1章の夜、屋上へ', '望遠鏡を3回調べる'],
        missable: { before: 'ch2', warn: 'この先に進む前に、図書館の中をもう一度見て回ろう' },
        unlock: { type: 'code', codeKind: 'b32', tag: bin(16, 1) },
        secret: box(),
      },
      {
        id: 'end-b',
        group: 'endings',
        label: '？？？',
        spoiler: 2,
        hints: [],
        unlock: { type: 'code', codeKind: 'kana', tag: bin(16, 2) },
        secret: box(),
      },
      { id: 'ach-cat', group: 'ach', label: '図書館の猫と3回話した', unlock: { type: 'manual' } },
    ],
    sealed: [
      {
        id: 'afterword',
        label: 'あとがき',
        teaser: '全てのエンディングで開きます',
        kind: 'afterword',
        unlock: { mode: 'allOf', goals: ['end-a', 'end-b'] },
        box: box(100),
      },
      {
        id: 'letter',
        label: '司書からの手紙',
        kind: 'letter',
        unlock: {
          mode: 'anyOf',
          goals: ['end-a', 'end-b'],
          wraps: [
            { goal: 'end-b', iv: bin(12), ct: bin(48) },
            { goal: 'end-a', iv: bin(12), ct: bin(48) },
          ],
        },
        box: box(),
      },
    ],
    changelog: [{ version: '1.0.0', date: '2026-10-01', notes: '初版\n誤字を修正' }],
  };
}

/** A minimal valid manifest with manual goals only (no kdf). */
function manualOnly(): any {
  return {
    schema: 'shiori/1',
    work: { id: 'p-abcdefghjk', title: 'メモだけの作品', kind: 'voice', version: '1.0.0' },
    author: { kind: 'player' },
    groups: [{ id: 'tracks', label: 'トラック' }],
    goals: [{ id: 'track-1', group: 'tracks', label: 'Track 1', unlock: { type: 'manual' } }],
  };
}

function with_(base: any, mutate: (m: any) => void): any {
  const m = structuredClone(base);
  mutate(m);
  return m;
}

function errorsOf(r: ValidateResult): ValidationIssue[] {
  return r.ok ? [] : r.errors;
}

function expectError(r: ValidateResult, code: string, path: string): ValidationIssue {
  expect(r.ok, JSON.stringify(r)).toBe(false);
  const found = errorsOf(r).find((e) => e.code === code && e.path === path);
  expect(found, `expected ${code} at '${path}', got ${JSON.stringify(errorsOf(r))}`).toBeDefined();
  expect(found!.severity).toBe('error');
  return found!;
}

const JAPANESE = /[ぁ-んァ-ヶー一-龠]/;

// ───────────────────────── validateManifest ─────────────────────────

describe('validateManifest: valid input', () => {
  it('accepts the full fixture without warnings', () => {
    const r = validateManifest(fixture());
    expect(r.ok, JSON.stringify(r)).toBe(true);
    if (!r.ok) return;
    expect(r.warnings).toEqual([]);
    expect(r.manifest.goals).toHaveLength(3);
    expect(r.manifest.sealed[1]!.unlock.mode).toBe('anyOf');
  });

  it('fills defaults (spoiler 0, hints [], checkpoints/sealed/changelog [])', () => {
    const r = validateManifest(manualOnly());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.manifest.checkpoints).toEqual([]);
    expect(r.manifest.sealed).toEqual([]);
    expect(r.manifest.changelog).toEqual([]);
    expect(r.manifest.goals[0]).toEqual({
      id: 'track-1',
      group: 'tracks',
      label: 'Track 1',
      spoiler: 0,
      hints: [],
      unlock: { type: 'manual' },
    });
    expect(r.manifest.kdf).toBeUndefined();
    expect('kdf' in r.manifest).toBe(false);
  });

  it('strips unknown keys everywhere', () => {
    const m = with_(fixture(), (m) => {
      m.extra = 1;
      m.work.extra = 'x';
      m.author.verified = true;
      m.kdf.extra = 1;
      m.goals[0].extra = 1;
      m.goals[0].unlock.extra = 1;
      m.goals[0].secret.extra = 1;
      m.goals[2].secret = { iv: 'junk' }; // manual goals have no secret
      m.sealed[0].unlock.wraps = []; // allOf has no wraps
      m.sealed[0].box.extra = 1;
      m.changelog[0].extra = 1;
    });
    const r = validateManifest(m);
    expect(r.ok, JSON.stringify(r)).toBe(true);
    if (!r.ok) return;
    const json = JSON.stringify(r.manifest);
    expect(json).not.toContain('extra');
    expect(json).not.toContain('verified');
    expect(json).not.toContain('junk');
    expect(r.manifest.goals[2]).not.toHaveProperty('secret');
    expect(r.manifest.sealed[0]!.unlock).toEqual({ mode: 'allOf', goals: ['end-a', 'end-b'] });
    // The validated output equals the clean fixture once unknown keys are removed.
    const clean = validateManifest(fixture());
    expect(clean.ok).toBe(true);
    if (clean.ok) expect(r.manifest).toEqual(clean.manifest);
  });

  it('does not mutate its input', () => {
    const m = fixture();
    const copy = structuredClone(m);
    validateManifest(m);
    expect(m).toEqual(copy);
  });

  it('accepts boundary lengths', () => {
    const m = with_(fixture(), (m) => {
      m.work.title = 'あ'.repeat(100);
      m.work.safeTitle = 'あ'.repeat(40);
      m.work.circle = '';
      m.goals[0].label = 'あ'.repeat(60);
      m.goals[0].teaser = 'あ'.repeat(120);
      m.goals[0].hints = ['あ'.repeat(200), 'い', 'う'];
      m.groups[0].label = 'あ'.repeat(20);
      m.checkpoints[0].label = 'あ'.repeat(40);
      m.sealed[0].label = 'あ'.repeat(40);
      m.sealed[0].box.ct = bin(65552);
      m.sealed[1].box.ct = bin(16);
      m.kdf.iterations = 2_000_000;
      m.work.version = '1.0.0-beta.1+build';
      m.work.storeCode = 'VJ123456';
      m.changelog[0].notes = 'あ'.repeat(500);
    });
    const r = validateManifest(m);
    expect(r.ok, JSON.stringify(r)).toBe(true);
  });

  it('accepts ids at the pattern edges', () => {
    const m = with_(manualOnly(), (m) => {
      m.work.id = 'a'.repeat(40);
      m.groups[0].id = '0';
      m.goals[0].id = 'a_b-c';
      m.goals[0].group = '0';
    });
    expect(validateManifest(m).ok).toBe(true);
  });
});

describe('validateManifest: schema id', () => {
  it.each([null, undefined, 42, 'shiori/1', [], [{ schema: 'shiori/1' }], {}, { schema: 1 }, { schema: 'other/1' }])(
    'rejects %j as notShiori',
    (input) => {
      const r = validateManifest(input);
      const e = expectError(r, 'notShiori', '');
      expect(e.messageJa).toBe('しおりファイルではないようです');
      expect(errorsOf(r)).toHaveLength(1);
    },
  );

  it.each(['shiori/2', 'shiori/1.1', 'shiori/'])('rejects %s as schemaVersion', (schema) => {
    const r = validateManifest({ ...fixture(), schema });
    const e = expectError(r, 'schemaVersion', 'schema');
    expect(e.messageJa).toBe('新しいバージョンのしおり帳が必要です');
  });

  it('recognizes studio project and backup files with a helpful message', () => {
    const studio = expectError(validateManifest({ format: 'shiori-studio-project', version: 1 }), 'notShiori', '');
    expect(studio.messageJa).toContain('工房');
    const backup = expectError(validateManifest({ format: 'shiori-backup', version: 1 }), 'notShiori', '');
    expect(backup.messageJa).toContain('バックアップ');
  });
});

describe('validateManifest: kdf', () => {
  it('requires kdf when code goals exist', () => {
    const r = validateManifest(with_(fixture(), (m) => delete m.kdf));
    const e = expectError(r, 'kdfMissing', 'kdf');
    expect(e.messageJa).toMatch(JAPANESE);
  });

  it('requires kdf when sealed items exist (even if they are otherwise invalid)', () => {
    const m = with_(manualOnly(), (m) => {
      m.sealed = [{ id: 's', label: 'おまけ', kind: 'story', unlock: { mode: 'allOf', goals: ['track-1'] }, box: box() }];
    });
    const r = validateManifest(m);
    expectError(r, 'kdfMissing', 'kdf');
    expectError(r, 'sealedRefersManual', 'sealed[0].unlock.goals[0]');
  });

  it('warns when kdf is present but unused', () => {
    const r = validateManifest(with_(manualOnly(), (m) => (m.kdf = { alg: 'PBKDF2-SHA256', iterations: 200000, salt: bin(16) })));
    expect(r.ok).toBe(true);
    expect(r.warnings.map((w) => [w.code, w.path, w.severity])).toEqual([['kdfUnused', 'kdf', 'warning']]);
  });

  it.each([99_999, 2_000_001, 150_000.5, 0, -1])('rejects iterations %d', (iterations) => {
    const r = validateManifest(with_(fixture(), (m) => (m.kdf.iterations = iterations)));
    const e = expectError(r, 'kdfIterations', 'kdf.iterations');
    expect(e.messageJa).toBe('反復回数は100,000〜2,000,000の整数にしてください');
  });

  it('rejects non-numeric iterations and a wrong alg', () => {
    expectError(validateManifest(with_(fixture(), (m) => (m.kdf.iterations = '200000'))), 'invalidType', 'kdf.iterations');
    expectError(validateManifest(with_(fixture(), (m) => (m.kdf.alg = 'scrypt'))), 'invalidValue', 'kdf.alg');
  });

  it('warns below 150,000 iterations but accepts the minimum', () => {
    const r = validateManifest(with_(fixture(), (m) => (m.kdf.iterations = 100_000)));
    expect(r.ok).toBe(true);
    expect(r.warnings.map((w) => [w.code, w.path])).toEqual([['kdfIterationsLow', 'kdf.iterations']]);
    const r2 = validateManifest(with_(fixture(), (m) => (m.kdf.iterations = 149_999)));
    expect(r2.warnings.map((w) => w.code)).toEqual(['kdfIterationsLow']);
    const r3 = validateManifest(with_(fixture(), (m) => (m.kdf.iterations = 150_000)));
    expect(r3.warnings).toEqual([]);
  });
});

describe('validateManifest: binary fields', () => {
  it('rejects a salt that is not 16 bytes', () => {
    const e = expectError(validateManifest(with_(fixture(), (m) => (m.kdf.salt = bin(15)))), 'saltLength', 'kdf.salt');
    expect(e.messageJa).toContain('15');
    expectError(validateManifest(with_(fixture(), (m) => (m.kdf.salt = bin(17)))), 'saltLength', 'kdf.salt');
  });

  it('rejects an IV of 11 bytes (goal secret, sealed box and wraps)', () => {
    expectError(validateManifest(with_(fixture(), (m) => (m.goals[0].secret.iv = bin(11)))), 'ivLength', 'goals[0].secret.iv');
    expectError(validateManifest(with_(fixture(), (m) => (m.sealed[0].box.iv = bin(11)))), 'ivLength', 'sealed[0].box.iv');
    expectError(
      validateManifest(with_(fixture(), (m) => (m.sealed[1].unlock.wraps[0].iv = bin(13)))),
      'ivLength',
      'sealed[1].unlock.wraps[0].iv',
    );
  });

  it('rejects a tag of 15 bytes', () => {
    const e = expectError(validateManifest(with_(fixture(), (m) => (m.goals[1].unlock.tag = bin(15)))), 'tagLength', 'goals[1].unlock.tag');
    expect(e.messageJa).toBe('タグは16バイトにしてください（現在15バイト）');
  });

  it('rejects ciphertexts outside 16..65552 bytes', () => {
    expectError(validateManifest(with_(fixture(), (m) => (m.goals[0].secret.ct = bin(15)))), 'ctLength', 'goals[0].secret.ct');
    expectError(validateManifest(with_(fixture(), (m) => (m.goals[0].secret.ct = ''))), 'ctLength', 'goals[0].secret.ct');
    const e = expectError(validateManifest(with_(fixture(), (m) => (m.sealed[0].box.ct = bin(65553)))), 'ctLength', 'sealed[0].box.ct');
    expect(e.messageJa).toContain('65,553');
  });

  it('rejects a wrap ciphertext that is not 48 bytes', () => {
    expectError(
      validateManifest(with_(fixture(), (m) => (m.sealed[1].unlock.wraps[1].ct = bin(47)))),
      'wrapLength',
      'sealed[1].unlock.wraps[1].ct',
    );
  });

  it.each(['AAAA+AAA', 'AAAA/AAA', 'AAECAw==', 'A', 'AB', 'ＡＡ', 'AAAAAAAAAAAAAAAAAAAAAA '])('rejects malformed base64url %j', (salt) => {
    expectError(validateManifest(with_(fixture(), (m) => (m.kdf.salt = salt))), 'invalidBase64', 'kdf.salt');
  });

  it('requires secret on code goals, and each of its fields', () => {
    const e = expectError(validateManifest(with_(fixture(), (m) => delete m.goals[0].secret)), 'required', 'goals[0].secret');
    expect(e.messageJa).toBe('必須の項目です');
    expectError(validateManifest(with_(fixture(), (m) => delete m.goals[0].secret.iv)), 'required', 'goals[0].secret.iv');
    expectError(validateManifest(with_(fixture(), (m) => (m.goals[0].secret = 'x'))), 'invalidType', 'goals[0].secret');
    expectError(validateManifest(with_(fixture(), (m) => (m.goals[0].secret.ct = 12))), 'invalidType', 'goals[0].secret.ct');
  });

  it('reports secret issues together with other issues of the same goal', () => {
    const r = validateManifest(
      with_(fixture(), (m) => {
        m.goals[0].label = 'あ'.repeat(61);
        m.goals[0].secret.iv = bin(11);
      }),
    );
    expectError(r, 'tooLong', 'goals[0].label');
    expectError(r, 'ivLength', 'goals[0].secret.iv');
  });
});

describe('validateManifest: cross references', () => {
  it.each([
    ['checkpoints', (m: any) => m.checkpoints.push({ id: 'ch1', label: '重複' }), 'checkpoints[2].id'],
    ['groups', (m: any) => m.groups.push({ id: 'ach', label: '重複' }), 'groups[2].id'],
    [
      'goals',
      (m: any) => m.goals.push({ id: 'ach-cat', group: 'ach', label: '重複', unlock: { type: 'manual' } }),
      'goals[3].id',
    ],
    ['sealed', (m: any) => m.sealed.push({ ...structuredClone(m.sealed[0]) }), 'sealed[2].id'],
  ])('reports duplicate ids in %s', (_name, mutate, path) => {
    const e = expectError(validateManifest(with_(fixture(), mutate)), 'duplicateId', path);
    expect(e.messageJa).toMatch(/^ID「.+」が重複しています$/);
  });

  it('reports a dangling group', () => {
    const e = expectError(validateManifest(with_(fixture(), (m) => (m.goals[2].group = 'nope'))), 'danglingGroup', 'goals[2].group');
    expect(e.messageJa).toContain('nope');
  });

  it('reports a dangling checkpoint in missable.before', () => {
    expectError(
      validateManifest(with_(fixture(), (m) => (m.goals[0].missable.before = 'ch9'))),
      'danglingCheckpoint',
      'goals[0].missable.before',
    );
    expectError(
      validateManifest(with_(fixture(), (m) => (m.checkpoints = []))),
      'danglingCheckpoint',
      'goals[0].missable.before',
    );
  });

  it('reports duplicate tags across goals', () => {
    const e = expectError(
      validateManifest(with_(fixture(), (m) => (m.goals[1].unlock.tag = m.goals[0].unlock.tag))),
      'duplicateTag',
      'goals[1].unlock.tag',
    );
    expect(e.messageJa).toContain('end-a');
  });

  it('reports sealed items referring to manual or unknown goals', () => {
    const r = validateManifest(with_(fixture(), (m) => (m.sealed[0].unlock.goals = ['end-a', 'ach-cat', 'ghost'])));
    expectError(r, 'sealedRefersManual', 'sealed[0].unlock.goals[1]');
    expectError(r, 'danglingGoal', 'sealed[0].unlock.goals[2]');
    expect(errorsOf(r)).toHaveLength(2);
  });

  it('reports a goal referenced twice in one condition', () => {
    const r = validateManifest(with_(fixture(), (m) => (m.sealed[0].unlock.goals = ['end-a', 'end-b', 'end-a'])));
    expectError(r, 'duplicateRef', 'sealed[0].unlock.goals[2]');
  });

  it.each([
    ['a missing wrap', (w: any[]) => w.pop()],
    ['an extra wrap', (w: any[]) => w.push({ goal: 'ach-cat', iv: bin(12), ct: bin(48) })],
    ['a duplicated wrap', (w: any[]) => (w[1].goal = 'end-b')],
    ['a wrap for another goal', (w: any[]) => (w[0].goal = 'end-z')],
  ])('reports wraps mismatch with %s', (_name, mutate) => {
    const r = validateManifest(with_(fixture(), (m) => mutate(m.sealed[1].unlock.wraps)));
    expectError(r, 'wrapsMismatch', 'sealed[1].unlock.wraps');
  });

  it('warns about a group without goals, also when failing', () => {
    const m = with_(fixture(), (m) => m.groups.push({ id: 'empty', label: 'からっぽ' }));
    const r = validateManifest(m);
    expect(r.ok).toBe(true);
    expect(r.warnings).toEqual([
      { path: 'groups[2]', code: 'emptyGroup', messageJa: 'グループ「からっぽ」に目標がありません', severity: 'warning' },
    ]);
    // Moving the only 'ach' goal to a missing group empties 'ach' too.
    const bad = validateManifest(with_(m, (m) => (m.goals[2].group = 'nope')));
    expect(bad.ok).toBe(false);
    expect(bad.warnings.map((w) => w.path)).toEqual(['groups[1]', 'groups[2]']);
  });

  it('returns every error at once', () => {
    const r = validateManifest(
      with_(fixture(), (m) => {
        delete m.kdf;
        m.goals[2].group = 'nope';
        m.goals[1].unlock.tag = m.goals[0].unlock.tag;
        m.sealed[0].unlock.goals = ['ghost'];
        m.checkpoints.push({ id: 'ch2', label: 'x' });
      }),
    );
    expect(errorsOf(r).map((e) => e.code).sort()).toEqual(
      ['danglingGoal', 'danglingGroup', 'duplicateId', 'duplicateTag', 'kdfMissing'].sort(),
    );
  });
});

describe('validateManifest: structure', () => {
  it('rejects 4 hints and bad hint lengths', () => {
    const e = expectError(validateManifest(with_(fixture(), (m) => m.goals[0].hints.push('四つ目'))), 'tooMany', 'goals[0].hints');
    expect(e.messageJa).toBe('3個までにしてください');
    expectError(validateManifest(with_(fixture(), (m) => (m.goals[0].hints[1] = 'あ'.repeat(201)))), 'tooLong', 'goals[0].hints[1]');
    const empty = expectError(validateManifest(with_(fixture(), (m) => (m.goals[0].hints[2] = ''))), 'tooShort', 'goals[0].hints[2]');
    expect(empty.messageJa).toBe('空にはできません');
  });

  it.each([
    ['work.title', (m: any) => (m.work.title = 'あ'.repeat(101)), '100文字以内にしてください'],
    ['work.safeTitle', (m: any) => (m.work.safeTitle = 'あ'.repeat(41)), '40文字以内にしてください'],
    ['work.circle', (m: any) => (m.work.circle = 'あ'.repeat(61)), '60文字以内にしてください'],
    ['author.name', (m: any) => (m.author.name = 'あ'.repeat(61)), '60文字以内にしてください'],
    ['checkpoints[0].label', (m: any) => (m.checkpoints[0].label = 'あ'.repeat(41)), '40文字以内にしてください'],
    ['groups[1].label', (m: any) => (m.groups[1].label = 'あ'.repeat(21)), '20文字以内にしてください'],
    ['goals[1].label', (m: any) => (m.goals[1].label = 'あ'.repeat(61)), '60文字以内にしてください'],
    ['goals[0].teaser', (m: any) => (m.goals[0].teaser = 'あ'.repeat(121)), '120文字以内にしてください'],
    ['goals[0].missable.warn', (m: any) => (m.goals[0].missable.warn = 'あ'.repeat(121)), '120文字以内にしてください'],
    ['sealed[1].label', (m: any) => (m.sealed[1].label = 'あ'.repeat(41)), '40文字以内にしてください'],
    ['sealed[0].teaser', (m: any) => (m.sealed[0].teaser = 'あ'.repeat(121)), '120文字以内にしてください'],
    ['changelog[0].notes', (m: any) => (m.changelog[0].notes = 'あ'.repeat(501)), '500文字以内にしてください'],
  ])('rejects an over-long %s', (path, mutate, message) => {
    const e = expectError(validateManifest(with_(fixture(), mutate)), 'tooLong', path);
    expect(e.messageJa).toBe(message);
  });

  it('rejects empty required strings', () => {
    expectError(validateManifest(with_(fixture(), (m) => (m.work.title = ''))), 'tooShort', 'work.title');
    expectError(validateManifest(with_(fixture(), (m) => (m.goals[0].teaser = ''))), 'tooShort', 'goals[0].teaser');
    expectError(validateManifest(with_(fixture(), (m) => (m.work.safeTitle = ''))), 'tooShort', 'work.safeTitle');
  });

  it('rejects bidi overrides and control characters', () => {
    const bidi = expectError(validateManifest(with_(fixture(), (m) => (m.goals[0].label = 'END\u202E1'))), 'bidiChar', 'goals[0].label');
    expect(bidi.messageJa).toMatch(JAPANESE);
    expectError(validateManifest(with_(fixture(), (m) => (m.work.title = 'a\u2066b'))), 'bidiChar', 'work.title');
    expectError(validateManifest(with_(fixture(), (m) => (m.goals[0].hints[0] = 'a\u0007b'))), 'controlChar', 'goals[0].hints[0]');
    // '\n' is a control character in single-line fields, but allowed in changelog notes.
    expectError(validateManifest(with_(fixture(), (m) => (m.groups[0].label = 'a\nb'))), 'controlChar', 'groups[0].label');
    expect(validateManifest(with_(fixture(), (m) => (m.changelog[0].notes = '1行目\n2行目'))).ok).toBe(true);
    expectError(validateManifest(with_(fixture(), (m) => (m.changelog[0].notes = 'a\u0000'))), 'controlChar', 'changelog[0].notes');
  });

  it('rejects bad ids with an ID-format message', () => {
    const w = expectError(validateManifest(with_(fixture(), (m) => (m.work.id = 'Demo'))), 'invalidFormat', 'work.id');
    expect(w.messageJa).toContain('作品ID');
    expectError(validateManifest(with_(fixture(), (m) => (m.work.id = 'abc'))), 'invalidFormat', 'work.id');
    expectError(validateManifest(with_(fixture(), (m) => (m.work.id = 'a_bcd'))), 'invalidFormat', 'work.id');
    expectError(validateManifest(with_(fixture(), (m) => (m.work.id = '-abcd'))), 'invalidFormat', 'work.id');
    expectError(validateManifest(with_(fixture(), (m) => (m.work.id = 'a'.repeat(41)))), 'invalidFormat', 'work.id');
    const g = expectError(validateManifest(with_(fixture(), (m) => (m.goals[2].id = 'Ach'))), 'invalidFormat', 'goals[2].id');
    expect(g.messageJa).toMatch(/^IDは/);
    expectError(validateManifest(with_(fixture(), (m) => (m.groups[0].id = '_x'))), 'invalidFormat', 'groups[0].id');
    expectError(validateManifest(with_(fixture(), (m) => (m.checkpoints[0].id = ''))), 'invalidFormat', 'checkpoints[0].id');
    expectError(validateManifest(with_(fixture(), (m) => (m.sealed[0].id = 'a'.repeat(41)))), 'invalidFormat', 'sealed[0].id');
  });

  it('rejects bad version, date and store code', () => {
    const v = expectError(validateManifest(with_(fixture(), (m) => (m.work.version = '1.0 beta'))), 'invalidFormat', 'work.version');
    expect(v.messageJa).toContain('バージョン');
    expectError(validateManifest(with_(fixture(), (m) => (m.work.version = ''))), 'invalidFormat', 'work.version');
    const d = expectError(validateManifest(with_(fixture(), (m) => (m.changelog[0].date = '2026/10/01'))), 'invalidFormat', 'changelog[0].date');
    expect(d.messageJa).toContain('YYYY-MM-DD');
    expectError(validateManifest(with_(fixture(), (m) => (m.changelog[0].date = '2026-13-01'))), 'invalidFormat', 'changelog[0].date');
    const s = expectError(validateManifest(with_(fixture(), (m) => (m.work.storeCode = 'rj01234567'))), 'invalidFormat', 'work.storeCode');
    expect(s.messageJa).toBe('作品コードの形式が違います（例: RJ01234567）');
    expectError(validateManifest(with_(fixture(), (m) => (m.work.storeCode = 'RJ0123456'))), 'invalidFormat', 'work.storeCode');
  });

  it('rejects unknown enum and discriminator values', () => {
    const t = expectError(validateManifest(with_(fixture(), (m) => (m.goals[2].unlock.type = 'auto'))), 'invalidValue', 'goals[2].unlock.type');
    expect(t.messageJa).toBe('次のどれかにしてください：manual / code');
    expectError(validateManifest(with_(fixture(), (m) => (m.goals[2].unlock = {}))), 'invalidValue', 'goals[2].unlock.type');
    expectError(validateManifest(with_(fixture(), (m) => (m.sealed[0].unlock.mode = 'someOf'))), 'invalidValue', 'sealed[0].unlock.mode');
    expectError(validateManifest(with_(fixture(), (m) => (m.goals[0].unlock.codeKind = 'hex'))), 'invalidValue', 'goals[0].unlock.codeKind');
    expectError(validateManifest(with_(fixture(), (m) => (m.work.kind = 'movie'))), 'invalidValue', 'work.kind');
    expectError(validateManifest(with_(fixture(), (m) => (m.work.engine = 'godot'))), 'invalidValue', 'work.engine');
    expectError(validateManifest(with_(fixture(), (m) => (m.author.kind = 'official'))), 'invalidValue', 'author.kind');
    expectError(validateManifest(with_(fixture(), (m) => (m.sealed[0].kind = 'image'))), 'invalidValue', 'sealed[0].kind');
    const sp = expectError(validateManifest(with_(fixture(), (m) => (m.goals[0].spoiler = 4))), 'invalidValue', 'goals[0].spoiler');
    expect(sp.messageJa).toBe('次のどれかにしてください：0 / 1 / 2 / 3');
    expectError(validateManifest(with_(fixture(), (m) => (m.goals[0].spoiler = '1'))), 'invalidValue', 'goals[0].spoiler');
  });

  it('rejects missing and wrongly typed fields', () => {
    expectError(validateManifest(with_(fixture(), (m) => delete m.work)), 'required', 'work');
    expectError(validateManifest(with_(fixture(), (m) => delete m.groups)), 'required', 'groups');
    expectError(validateManifest(with_(fixture(), (m) => delete m.goals)), 'required', 'goals');
    expectError(validateManifest(with_(fixture(), (m) => delete m.goals[0].label)), 'required', 'goals[0].label');
    const t = expectError(validateManifest(with_(fixture(), (m) => (m.goals = {}))), 'invalidType', 'goals');
    expect(t.messageJa).toBe('配列で指定してください');
    expectError(validateManifest(with_(fixture(), (m) => (m.work.title = 42))), 'invalidType', 'work.title');
    expectError(validateManifest(with_(fixture(), (m) => (m.work.title = null))), 'invalidType', 'work.title');
    expectError(validateManifest(with_(fixture(), (m) => (m.goals[0] = 'goal'))), 'invalidType', 'goals[0]');
  });

  it('enforces collection sizes', () => {
    const groups = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `g${i}`, label: `G${i}` }));
    const goals = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ id: `goal-${i}`, group: 'tracks', label: `#${i}`, unlock: { type: 'manual' } }));
    expectError(validateManifest(with_(manualOnly(), (m) => (m.groups = []))), 'tooFew', 'groups');
    expectError(validateManifest(with_(manualOnly(), (m) => (m.groups = groups(21)))), 'tooMany', 'groups');
    expectError(
      validateManifest(with_(manualOnly(), (m) => (m.checkpoints = groups(51).map((g) => ({ ...g, label: 'x' }))))),
      'tooMany',
      'checkpoints',
    );
    const many = expectError(validateManifest(with_(manualOnly(), (m) => (m.goals = goals(501)))), 'tooMany', 'goals');
    expect(many.messageJa).toBe('500個までにしてください');
    expect(validateManifest(with_(manualOnly(), (m) => (m.goals = goals(500)))).ok).toBe(true);
    expect(validateManifest(with_(manualOnly(), (m) => (m.goals = []))).ok).toBe(true);
    const cl = Array.from({ length: 101 }, () => ({ version: '1.0.0', date: '2026-10-01', notes: '' }));
    expectError(validateManifest(with_(manualOnly(), (m) => (m.changelog = cl))), 'tooMany', 'changelog');
    const sealed = Array.from({ length: 51 }, (_, i) => ({ ...structuredClone(fixture().sealed[0]), id: `s${i}` }));
    expectError(validateManifest(with_(fixture(), (m) => (m.sealed = sealed))), 'tooMany', 'sealed');
    expectError(validateManifest(with_(fixture(), (m) => (m.sealed[0].unlock.goals = []))), 'tooFew', 'sealed[0].unlock.goals');
    expectError(
      validateManifest(with_(fixture(), (m) => (m.sealed[0].unlock.goals = Array.from({ length: 51 }, (_, i) => `g${i}`)))),
      'tooMany',
      'sealed[0].unlock.goals',
    );
    expectError(validateManifest(with_(fixture(), (m) => (m.sealed[1].unlock.wraps = []))), 'tooFew', 'sealed[1].unlock.wraps');
  });

  it('reports multiple structural errors with correct paths, all in Japanese', () => {
    const r = validateManifest(
      with_(fixture(), (m) => {
        m.work.title = '';
        m.goals[0].hints = ['a', 'b', 'c', 'd'];
        m.goals[1].label = 'x'.repeat(61);
        m.sealed[1].unlock.wraps[0].ct = bin(47);
      }),
    );
    expect(errorsOf(r).map((e) => e.path)).toEqual([
      'work.title',
      'goals[0].hints',
      'goals[1].label',
      'sealed[1].unlock.wraps[0].ct',
    ]);
    for (const e of errorsOf(r)) {
      expect(e.messageJa).toMatch(JAPANESE);
      expect(e.messageJa).not.toMatch(/Invalid|expected|received/);
    }
  });
});

describe('validateManifest: robustness', () => {
  /** Collects every [container, key] pair of a JSON-like value. */
  function slots(v: any, out: Array<[any, string | number]> = []): Array<[any, string | number]> {
    if (Array.isArray(v)) {
      v.forEach((x, i) => {
        out.push([v, i]);
        slots(x, out);
      });
    } else if (v && typeof v === 'object') {
      for (const k of Object.keys(v)) {
        out.push([v, k]);
        slots(v[k], out);
      }
    }
    return out;
  }

  it('never throws on randomly corrupted manifests', () => {
    const replacements = [null, 0, -1, 1.5, '', 'x', 'shiori/1', true, [], {}, [1], { a: 1 }, undefined, 'AAAA', bin(16)];
    const rnd = randomBytes(6000);
    let k = 0;
    const next = () => rnd[k++ % rnd.length]!;
    for (let t = 0; t < 1000; t++) {
      const m = fixture();
      const all = slots(m);
      for (let e = 0; e < 1 + (next() % 3); e++) {
        const [container, key] = all[(next() * 256 + next()) % all.length]!;
        const value = structuredClone(replacements[next() % replacements.length]);
        if (value === undefined) delete container[key];
        else container[key] = value;
      }
      const r = validateManifest(m);
      if (r.ok) {
        expect(r.manifest.schema).toBe('shiori/1');
      } else {
        expect(r.errors.length).toBeGreaterThan(0);
        for (const e of r.errors) {
          expect(e.severity).toBe('error');
          expect(e.messageJa).toMatch(JAPANESE);
          expect(e.messageJa).not.toMatch(/Invalid|expected|received/);
        }
      }
    }
  });
});

// ───────────────────────── parseManifestText ─────────────────────────

describe('parseManifestText', () => {
  it('parses valid text (also with a BOM)', () => {
    const text = JSON.stringify(fixture(), null, 2);
    expect(parseManifestText(text).ok).toBe(true);
    expect(parseManifestText('\uFEFF' + text).ok).toBe(true);
  });

  it('rejects input over 512 KiB before parsing', () => {
    const spy = vi.spyOn(JSON, 'parse');
    try {
      const r = parseManifestText('{' + ' '.repeat(MAX_MANIFEST_BYTES) + '}');
      expect(r).toEqual({
        ok: false,
        errors: [{ path: '', code: 'tooLarge', messageJa: 'ファイルが大きすぎます（512KBまで）', severity: 'error' }],
        warnings: [],
      });
      // 200,000 hiragana = 600,000 UTF-8 bytes, although only 200,000 UTF-16 units.
      const kana = parseManifestText(JSON.stringify({ ...manualOnly(), pad: 'あ'.repeat(200_000) }));
      expect(errorsOf(kana).map((e) => e.code)).toEqual(['tooLarge']);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it('accepts input of exactly 512 KiB', () => {
    const base = JSON.stringify(manualOnly());
    const text = base + ' '.repeat(MAX_MANIFEST_BYTES - utf8ByteLength(base));
    expect(utf8ByteLength(text)).toBe(MAX_MANIFEST_BYTES);
    expect(parseManifestText(text).ok).toBe(true);
    expect(errorsOf(parseManifestText(text + ' ')).map((e) => e.code)).toEqual(['tooLarge']);
  });

  it('reports invalid JSON in Japanese with the position (V8 position message)', () => {
    const r = parseManifestText('{\n  "schema": "shiori/1",\n}');
    const e = expectError(r, 'json', '');
    expect(e.messageJa).toBe('JSONの形式が正しくありません（3行目 1文字目付近）');
  });

  it('computes the position itself when the message has none', () => {
    // V8 reports this one as "Unexpected token ',', ..." without a position.
    const text = '{\n  "schema": "shiori/1",\n  "goals": [1, 2,, 3]\n}';
    const e = expectError(parseManifestText(text), 'json', '');
    expect(e.messageJa).toBe('JSONの形式が正しくありません（3行目 18文字目付近）');
  });

  it('is not fooled by position-like text quoted from the input', () => {
    const e = expectError(parseManifestText('{"a": "at position 99 (line 9 column 9)",, "b": 1}'), 'json', '');
    expect(e.messageJa).toBe('JSONの形式が正しくありません（1行目 42文字目付近）');
  });

  it('handles engines without positions (Safari-style messages)', () => {
    const spy = vi.spyOn(JSON, 'parse').mockImplementation(() => {
      throw new SyntaxError('JSON Parse error: Unexpected identifier "schema"');
    });
    try {
      const e = expectError(parseManifestText('{\n  schema: "shiori/1"\n}'), 'json', '');
      expect(e.messageJa).toBe('JSONの形式が正しくありません（2行目 3文字目付近）');
    } finally {
      spy.mockRestore();
    }
  });

  it('uses Firefox-style line/column messages', () => {
    const spy = vi.spyOn(JSON, 'parse').mockImplementation(() => {
      throw new SyntaxError("JSON.parse: expected property name or '}' at line 1 column 2 of the JSON data");
    });
    try {
      const e = expectError(parseManifestText('{a:1}'), 'json', '');
      expect(e.messageJa).toBe('JSONの形式が正しくありません（1行目 2文字目付近）');
    } finally {
      spy.mockRestore();
    }
  });

  it('explains empty and truncated input', () => {
    expect(expectError(parseManifestText(''), 'json', '').messageJa).toBe('JSONの形式が正しくありません（内容が空です）');
    expect(expectError(parseManifestText('  \n '), 'json', '').messageJa).toBe('JSONの形式が正しくありません（内容が空です）');
    expect(expectError(parseManifestText('{"schema": "shiori/1", "work": tru'), 'json', '').messageJa).toBe(
      'JSONの形式が正しくありません（途中で終わっているようです）',
    );
  });

  it('falls back to a message without position when nothing can be located', () => {
    const spy = vi.spyOn(JSON, 'parse').mockImplementation(() => {
      throw new SyntaxError('weird');
    });
    try {
      expect(expectError(parseManifestText('{}'), 'json', '').messageJa).toBe('JSONの形式が正しくありません');
    } finally {
      spy.mockRestore();
    }
  });

  it('passes parsed JSON through validateManifest', () => {
    expectError(parseManifestText(JSON.stringify({ ...fixture(), schema: 'shiori/2' })), 'schemaVersion', 'schema');
    expectError(parseManifestText('[]'), 'notShiori', '');
    expectError(parseManifestText('"shiori/1"'), 'notShiori', '');
  });
});

describe('jsonErrorParams / locateJsonError', () => {
  const valid = [
    '{}',
    '[]',
    ' \n\t\r{ } ',
    '0',
    '-0.5e+10',
    '1E5',
    '"a\\"b\\\\c\\/\\b\\f\\n\\r\\t\\u00e9"',
    'true',
    'false',
    'null',
    '[1, [2, [3, {"a": [{}]}]], "x"]',
    '{"a": {"b": {"c": [null, true, false]}}, "d": -1.25}',
    '"あいう🎉"',
    JSON.stringify(fixture(), null, 2),
  ];
  it.each(valid)('accepts valid JSON %j', (s) => {
    expect(() => JSON.parse(s)).not.toThrow();
    expect(locateJsonError(s)).toBe(-1);
  });

  // [input, expected offset] — offsets agree with V8's "at position N" where V8 reports one.
  const invalid: Array<[string, number]> = [
    ['{"a":}', 5],
    ['{\n  "a": 1,\n}', 12],
    ['{"a" 1}', 5],
    ['[1,2', 4],
    ['{"a":"x\ny"}', 7],
    ['{"a":1}x', 7],
    ['{a:1}', 1],
    ['"abc', 4],
    ['[01]', 2],
    ['{"a":-}', 6],
    ['[1,]', 3],
    ['[,1]', 1],
    ['{"a":1,,}', 7],
    ['[1 2]', 3],
    ['tru', 3],
    ['nul', 3],
    ['falsy', 4],
    ['"\\x"', 2],
    ['"\\u12G4"', 5],
    ['1.', 2],
    ['1e', 2],
    ['.5', 0],
    ['+1', 0],
    ["{'a':1}", 1],
    ['', 0],
    ['{"a":1', 6],
    ['[[[', 3],
  ];
  it.each(invalid)('locates the error in %j at %d', (s, offset) => {
    expect(() => JSON.parse(s)).toThrow(SyntaxError);
    expect(locateJsonError(s)).toBe(offset);
  });

  it('agrees with V8 positions whenever V8 reports one', () => {
    for (const [s] of invalid) {
      try {
        JSON.parse(s);
      } catch (e) {
        const m = /at position (\d+)/.exec((e as Error).message);
        if (m) expect(locateJsonError(s), s).toBe(Number(m[1]));
      }
    }
  });

  it('agrees with JSON.parse on validity for random mutations', () => {
    const base = JSON.stringify(fixture());
    const alphabet = '{}[]:,"\\ 0123456789-+.eEtrufalsn\n\u0001';
    const rnd = randomBytes(4000);
    let k = 0;
    const next = () => rnd[k++ % rnd.length]!;
    for (let t = 0; t < 800; t++) {
      let s = base;
      const edits = 1 + (next() % 3);
      for (let e = 0; e < edits; e++) {
        const pos = (next() * 256 + next()) % (s.length + 1);
        const op = next() % 3;
        const ch = alphabet[next() % alphabet.length]!;
        if (op === 0) s = s.slice(0, pos) + ch + s.slice(pos);
        else if (op === 1) s = s.slice(0, pos) + s.slice(pos + 1);
        else s = s.slice(0, pos) + ch + s.slice(pos + 1);
      }
      let ok = true;
      try {
        JSON.parse(s);
      } catch {
        ok = false;
      }
      expect(locateJsonError(s) === -1, s).toBe(ok);
    }
  });

  it('handles very deep nesting without recursion', () => {
    const depth = 100_000;
    expect(locateJsonError('['.repeat(depth) + ']'.repeat(depth))).toBe(-1);
    expect(locateJsonError('['.repeat(depth))).toBe(depth);
    expect(jsonErrorParams('['.repeat(depth), 'Unexpected end of JSON input')).toEqual({ reason: 'end' });
  });

  it('counts columns in code points', () => {
    expect(jsonErrorParams('{"🎉": x}', 'no position')).toEqual({ line: 1, column: 7 });
    expect(jsonErrorParams('[\r\n1,\r\n]', 'no position')).toEqual({ line: 3, column: 1 });
  });
});

describe('utf8ByteLength', () => {
  it('matches TextEncoder, including emoji and lone surrogates', () => {
    const samples = ['', 'abc', 'あいう', '🎉', 'é', 'a\uD800b', '\uDC00', '\uD83C', 'mix: ｶﾀｶﾅ 漢字 🎉🎉 \u0000'];
    for (const s of samples) expect(utf8ByteLength(s), s).toBe(new TextEncoder().encode(s).length);
  });
});

describe('manifestKey', () => {
  it('is b64u(SHA-256(utf8(JSON.stringify(manifest))))', async () => {
    const r = validateManifest(fixture());
    if (!r.ok) throw new Error('fixture invalid');
    // Independent computation: WebCrypto digest + btoa-based base64url.
    const digest = new Uint8Array(
      await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(r.manifest))),
    );
    const expected = btoa(String.fromCharCode(...digest)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const key = await manifestKey(r.manifest);
    expect(key).toBe(expected);
    expect(key).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('is stable across key order and unknown keys in the source file', async () => {
    const a = validateManifest(fixture());
    const shuffled = Object.fromEntries(Object.entries(fixture()).reverse());
    (shuffled as any).work = Object.fromEntries(Object.entries((shuffled as any).work).reverse());
    (shuffled as any).unknown = { anything: true };
    const b = validateManifest(shuffled);
    if (!a.ok || !b.ok) throw new Error('fixture invalid');
    expect(await manifestKey(b.manifest)).toBe(await manifestKey(a.manifest));
  });

  it('changes when the content changes', async () => {
    const a = validateManifest(fixture());
    const b = validateManifest(with_(fixture(), (m) => (m.work.version = '1.0.1')));
    if (!a.ok || !b.ok) throw new Error('fixture invalid');
    expect(await manifestKey(b.manifest)).not.toBe(await manifestKey(a.manifest));
  });
});
