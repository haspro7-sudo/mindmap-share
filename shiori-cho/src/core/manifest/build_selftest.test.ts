import { beforeAll, describe, it, expect } from 'vitest';
import { parseCode } from '../codes';
import { deriveMaster, openGoalSecret, openItem } from '../crypto/shiori';
import { b64uDecode, b64uEncode } from '../encoding';
import { ShioriError } from '../errors';
import { buildUnlockUrl } from '../route';
import type { BuildResult, CodeGoal, CodeRow, ShioriManifestV1, StudioProject } from '../types';
import { buildManifest, normalizeGoalSecret, normalizePayload } from './build';
import { collectSecrets, findLeaks } from './noSpoil';
import { jsonEqual, selfTest } from './selftest';
import { FIXTURE_CODES, FIXTURE_ITERATIONS, FIXTURE_SALT, counterRng, fixtureProject } from './testFixtures';
import { parseManifestText, validateManifest } from './validate';

async function caught(p: Promise<unknown>): Promise<unknown> {
  return p.then(
    () => undefined,
    (e: unknown) => e,
  );
}

async function expectValidationError(p: Promise<unknown>, ...fragments: string[]): Promise<ShioriError> {
  const err = await caught(p);
  expect(err).toBeInstanceOf(ShioriError);
  const e = err as ShioriError;
  expect(e.code).toBe('validation');
  expect(e.messageJa).toMatch(/[ぁ-んァ-ヶ一-龯]/);
  for (const f of fragments) expect(e.messageJa).toContain(f);
  return e;
}

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

function codeGoal(m: ShioriManifestV1, id: string): CodeGoal {
  const g = m.goals.find((x) => x.id === id);
  if (!g || g.unlock.type !== 'code') throw new Error(`no code goal ${id}`);
  return g as CodeGoal;
}

function checkIds(report: { checks: { id: string }[] }): string[] {
  return report.checks.map((c) => c.id);
}

function failed(report: { checks: { id: string; ok: boolean }[] }): string[] {
  return report.checks.filter((c) => !c.ok).map((c) => c.id);
}

describe('buildManifest', () => {
  let project: StudioProject;
  let built: BuildResult;

  beforeAll(async () => {
    project = fixtureProject();
    built = await buildManifest(project);
  });

  it('produces a manifest that validates (object and JSON text)', () => {
    const v = validateManifest(clone(built.manifest));
    expect(v.ok).toBe(true);
    const parsed = parseManifestText(built.json);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.manifest).toEqual(built.manifest);
  });

  it('json is JSON.stringify(manifest, null, 2)', () => {
    expect(built.json).toBe(JSON.stringify(built.manifest, null, 2));
  });

  it('includes kdf with the project iterations and salt', () => {
    expect(built.manifest.kdf).toEqual({ alg: 'PBKDF2-SHA256', iterations: FIXTURE_ITERATIONS, salt: FIXTURE_SALT });
    expect(built.salt).toBe(FIXTURE_SALT);
  });

  it('copies public metadata and marks the author as creator', () => {
    const m = built.manifest;
    expect(m.schema).toBe('shiori/1');
    expect(m.work).toEqual(project.work);
    expect(m.author).toEqual({ kind: 'creator', name: 'テスト工房（架空）' });
    expect(m.checkpoints).toEqual(project.checkpoints);
    expect(m.groups).toEqual(project.groups);
    expect(m.changelog).toEqual(project.changelog);
    expect(m.goals.map((g) => g.id)).toEqual(['end-a', 'end-b', 'voice-1', 'ach-cat', 'ach-shelf']);
    expect(m.sealed.map((s) => s.id)).toEqual(['afterword', 'letter', 'door']);
  });

  it('manual goals keep only GoalCommon fields; empty teaser, missable and trailing hints are dropped', () => {
    const cat = built.manifest.goals.find((g) => g.id === 'ach-cat')!;
    expect(cat).toEqual({ id: 'ach-cat', group: 'ach', label: '図書館の猫と3回話した', spoiler: 0, hints: [], unlock: { type: 'manual' } });
    const shelf = built.manifest.goals.find((g) => g.id === 'ach-shelf')!;
    expect(shelf).toEqual({
      id: 'ach-shelf',
      group: 'ach',
      label: '全ての書架を調べた',
      spoiler: 0,
      hints: ['書架は全部で12あります'],
      unlock: { type: 'manual' },
    });
    for (const g of built.manifest.goals) {
      for (const key of ['unlockType', 'codeKind', 'code']) expect(Object.keys(g)).not.toContain(key);
    }
  });

  it('code goals carry codeKind, a 16-byte tag and a sealed secret', async () => {
    const a = codeGoal(built.manifest, 'end-a');
    expect(a.unlock.codeKind).toBe('b32');
    expect(b64uDecode(a.unlock.tag)).toHaveLength(16);
    expect(a.missable).toBeUndefined();
    expect(codeGoal(built.manifest, 'voice-1').unlock.codeKind).toBe('kana');
    const b = codeGoal(built.manifest, 'end-b');
    expect(b.missable).toEqual({ before: 'ch3', warn: '第3章に進む前に、書架をもう一度見て回ろう' });

    const master = await deriveMaster('b32:K7QM2XRAP', built.manifest.kdf!);
    const secret = await openGoalSecret(master, built.manifest.kdf!, 'w-test00001', 'end-a', a.secret);
    expect(secret).toEqual(project.goals[0]!.secret);
  });

  it('drops empty optional secret fields before sealing', async () => {
    const master = await deriveMaster('b32:ST4RMAP1X', built.manifest.kdf!);
    const b = codeGoal(built.manifest, 'end-b');
    const secret = await openGoalSecret(master, built.manifest.kdf!, 'w-test00001', 'end-b', b.secret);
    expect(secret).toEqual({ title: '閉館の鐘' });
  });

  it('seals items with sorted goal lists and one wrap per anyOf goal', () => {
    const [afterword, letter, door] = built.manifest.sealed;
    expect(afterword!.unlock).toEqual({ mode: 'allOf', goals: ['end-a', 'end-b', 'voice-1'] });
    expect(letter!.unlock.mode).toBe('anyOf');
    if (letter!.unlock.mode === 'anyOf') expect(letter!.unlock.wraps.map((w) => w.goal)).toEqual(['end-a', 'end-b']);
    expect(door!.kind).toBe('returnCode');
    expect(door!.teaser).toBeUndefined();
    expect(afterword!.teaser).toBe('全てのエンディングで開きます');
  });

  it('returns one CodeRow per code goal', () => {
    const expected: CodeRow[] = [
      {
        goalId: 'end-a',
        label: 'END 1',
        secretTitle: '星図の果て',
        codeKind: 'b32',
        display: 'K7Q-M2X-RAP',
        canonical: 'b32:K7QM2XRAP',
        unlockUrl: buildUnlockUrl(project.appUrl, 'w-test00001', 'b32:K7QM2XRAP'),
      },
      {
        goalId: 'end-b',
        label: 'END 2',
        secretTitle: '閉館の鐘',
        codeKind: 'b32',
        display: 'ST4-RMA-P1X',
        canonical: 'b32:ST4RMAP1X',
        unlockUrl: buildUnlockUrl(project.appUrl, 'w-test00001', 'b32:ST4RMAP1X'),
      },
      {
        goalId: 'voice-1',
        label: '？？？',
        secretTitle: '夜更けの朗読',
        codeKind: 'kana',
        display: 'ほたる・かえで・つばめ・こだま・すずめ',
        canonical: 'kana:ほたるかえでつばめこだますずめ',
        unlockUrl: buildUnlockUrl(project.appUrl, 'w-test00001', 'kana:ほたるかえでつばめこだますずめ'),
      },
    ];
    expect(built.codes).toEqual(expected);
    expect(built.codes[0]!.unlockUrl).toBe('https://example.github.io/shiori-cho/#/u/w-test00001/K7QM2XRAP');
  });

  it('accepts codes typed in any width/case/separators and stores the display form in the rows', async () => {
    const p = fixtureProject();
    p.goals[0]!.code = 'ｋ７ｑ ｍ２ｘ ｒａｐ';
    p.goals[2]!.code = 'ホタル カエデ ツバメ コダマ スズメ';
    const r = await buildManifest(p);
    expect(r.codes[0]!.display).toBe('K7Q-M2X-RAP');
    expect(r.codes[2]!.display).toBe('ほたる・かえで・つばめ・こだま・すずめ');
    expect(codeGoal(r.manifest, 'end-a').unlock.tag).toBe(codeGoal(built.manifest, 'end-a').unlock.tag);
  });

  it('the public JSON contains no code, secret, payload or return code (findLeaks is empty)', () => {
    const secrets = collectSecrets(project);
    expect(secrets.length).toBeGreaterThan(10);
    expect(findLeaks(built.json, secrets)).toEqual([]);
    for (const s of ['K7Q', 'K7QM2XRAP', 'ST4RMAP1X', 'ほたるかえで', '星図の果て', '閉館の鐘', '夜更けの朗読', 'ほしあかり', '感謝をこめて', '司書ミナより', '次回作']) {
      expect(built.json).not.toContain(s);
    }
  });

  it('keeps the salt stable across rebuilds when kdfSalt is set (tags equal, ivs fresh)', async () => {
    const again = await buildManifest(project);
    expect(again.salt).toBe(built.salt);
    expect(again.manifest.kdf).toEqual(built.manifest.kdf);
    for (const id of ['end-a', 'end-b', 'voice-1']) {
      expect(codeGoal(again.manifest, id).unlock.tag).toBe(codeGoal(built.manifest, id).unlock.tag);
      expect(codeGoal(again.manifest, id).secret.iv).not.toBe(codeGoal(built.manifest, id).secret.iv);
    }
  });

  it('generates a salt from rng when kdfSalt is unset, and reusing it reproduces the tags', async () => {
    const p = fixtureProject({ kdfSalt: undefined });
    const first = await buildManifest(p, { rng: counterRng(0x40) });
    expect(b64uDecode(first.salt)).toEqual(Uint8Array.from({ length: 16 }, (_, i) => 0x40 + i));
    expect(first.manifest.kdf!.salt).toBe(first.salt);
    expect(first.salt).not.toBe(FIXTURE_SALT);
    const second = await buildManifest({ ...p, kdfSalt: first.salt });
    expect(second.salt).toBe(first.salt);
    expect(codeGoal(second.manifest, 'end-a').unlock.tag).toBe(codeGoal(first.manifest, 'end-a').unlock.tag);
    // a different salt gives different tags
    expect(codeGoal(first.manifest, 'end-a').unlock.tag).not.toBe(codeGoal(built.manifest, 'end-a').unlock.tag);
  });

  it('is deterministic with a deterministic rng', async () => {
    const a = await buildManifest(fixtureProject({ kdfSalt: undefined }), { rng: counterRng(7) });
    const b = await buildManifest(fixtureProject({ kdfSalt: undefined }), { rng: counterRng(7) });
    expect(a.json).toBe(b.json);
  });

  it('omits kdf when there is no code goal and no sealed item (salt still returned)', async () => {
    const p = fixtureProject({
      kdfSalt: undefined,
      goals: fixtureProject().goals.filter((g) => g.unlockType === 'manual'),
      groups: [{ id: 'ach', label: '実績' }],
      sealed: [],
    });
    const r = await buildManifest(p, { rng: counterRng(1) });
    expect(r.manifest.kdf).toBeUndefined();
    expect(r.codes).toEqual([]);
    expect(b64uDecode(r.salt)).toHaveLength(16);
    expect(validateManifest(clone(r.manifest)).ok).toBe(true);
  });

  it('normalizes the store code and drops empty optional work fields', async () => {
    const p = fixtureProject({
      work: { id: 'w-test00001', title: '星読みの試験館', safeTitle: '', circle: '', storeCode: 'ｒｊ０１２３４５６７', kind: 'game', version: '1.0.0' },
      authorName: '',
    });
    const r = await buildManifest(p);
    expect(r.manifest.work).toEqual({ id: 'w-test00001', title: '星読みの試験館', storeCode: 'RJ01234567', kind: 'game', version: '1.0.0' });
    expect(r.manifest.author).toEqual({ kind: 'creator' });
  });

  describe('rejects unbuildable projects with a Japanese ShioriError("validation")', () => {
    it('code goal without a code', async () => {
      const p = fixtureProject();
      p.goals[1]!.code = '';
      await expectValidationError(buildManifest(p), 'end-b', '合言葉');
    });

    it('code with a checksum error', async () => {
      const p = fixtureProject();
      p.goals[0]!.code = 'K7Q-M2X-RAQ';
      await expectValidationError(buildManifest(p), 'end-a', '入力ミス');
    });

    it('code kind mismatch', async () => {
      const p = fixtureProject();
      p.goals[0]!.codeKind = 'kana';
      await expectValidationError(buildManifest(p), 'end-a', '種類');
    });

    it('infers the kind when codeKind is missing', async () => {
      const p = fixtureProject();
      delete p.goals[2]!.codeKind;
      const r = await buildManifest(p);
      expect(codeGoal(r.manifest, 'voice-1').unlock.codeKind).toBe('kana');
    });

    it('missing secret or secret title', async () => {
      const p = fixtureProject();
      delete p.goals[0]!.secret;
      await expectValidationError(buildManifest(p), 'end-a', '秘密タイトル');
      const q = fixtureProject();
      q.goals[1]!.secret = { title: '  ' };
      await expectValidationError(buildManifest(q), 'end-b', '秘密タイトル');
    });

    it('secret that fails its schema (too long title)', async () => {
      const p = fixtureProject();
      p.goals[0]!.secret = { title: 'あ'.repeat(61) };
      await expectValidationError(buildManifest(p), 'end-a');
    });

    it('duplicate codes', async () => {
      const p = fixtureProject();
      p.goals[1]!.code = 'k7qm2xrap';
      await expectValidationError(buildManifest(p), 'end-a', 'end-b', '同じ合言葉');
    });

    it('sealed item referencing a manual or unknown goal, or with no goals', async () => {
      const p = fixtureProject();
      p.sealed[0]!.goals = ['end-a', 'ach-cat'];
      await expectValidationError(buildManifest(p), 'afterword', 'ach-cat');
      const q = fixtureProject();
      q.sealed[1]!.goals = ['nope'];
      await expectValidationError(buildManifest(q), 'letter', 'nope');
      const r = fixtureProject();
      r.sealed[2]!.goals = [];
      await expectValidationError(buildManifest(r), 'door');
    });

    it('sealed payload that fails its schema', async () => {
      const p = fixtureProject();
      p.sealed[0]!.payload = { title: '', body: '本文' };
      await expectValidationError(buildManifest(p), 'afterword');
    });

    it('iterations outside 100,000..2,000,000', async () => {
      await expectValidationError(buildManifest(fixtureProject({ kdfIterations: 99_999 })), '100,000');
      await expectValidationError(buildManifest(fixtureProject({ kdfIterations: 2_000_001 })), '2,000,000');
      await expectValidationError(buildManifest(fixtureProject({ kdfIterations: 150_000.5 })));
    });

    it('invalid kdfSalt', async () => {
      await expectValidationError(buildManifest(fixtureProject({ kdfSalt: b64uEncode(new Uint8Array(15)) })), 'ソルト');
      await expectValidationError(buildManifest(fixtureProject({ kdfSalt: '***' })), 'ソルト');
    });

    it('a manifest that fails validation lists the issue paths', async () => {
      const p = fixtureProject();
      p.work = { ...p.work, id: 'X' };
      await expectValidationError(buildManifest(p), 'work.id');
      const q = fixtureProject();
      q.goals[3]!.group = 'missing-group';
      await expectValidationError(buildManifest(q), 'goals[3].group');
    });
  });
});

describe('selfTest', () => {
  let project: StudioProject;
  let built: BuildResult;

  beforeAll(async () => {
    project = fixtureProject();
    built = await buildManifest(project);
  });

  it('is all green for a fresh build', async () => {
    const report = await selfTest(built.manifest, built.codes, project);
    expect(failed(report)).toEqual([]);
    expect(report.ok).toBe(true);
    expect(checkIds(report)).toEqual([
      'validate',
      'redeem:end-a',
      'redeem:end-b',
      'redeem:voice-1',
      'secret:end-a',
      'secret:end-b',
      'secret:voice-1',
      'sealed:afterword',
      'sealedStrict:afterword',
      'sealed:letter',
      'sealed:door',
      'noSpoil',
    ]);
    for (const c of report.checks) expect(c.messageJa).toMatch(/[ぁ-んァ-ヶ一-龯]/);
  });

  it('works on a manifest re-read from its JSON text', async () => {
    const parsed = parseManifestText(built.json);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const report = await selfTest(parsed.manifest, built.codes, project);
    expect(report.ok).toBe(true);
  });

  it('catches a secret injected into a public field (noSpoil)', async () => {
    const m = clone(built.manifest);
    m.goals[0]!.teaser = '星図の果てへ向かう';
    const report = await selfTest(m, built.codes, project);
    expect(report.ok).toBe(false);
    expect(failed(report)).toEqual(['noSpoil']);
    expect(report.checks.find((c) => c.id === 'noSpoil')!.messageJa).toContain('星図の果て');
    expect(findLeaks(JSON.stringify(m, null, 2), collectSecrets(project))).toEqual(['星図の果て']);
  });

  it('catches a code, a multi-line body and a return code injected into public fields', () => {
    const secrets = collectSecrets(project);
    const m = clone(built.manifest);
    m.goals[1]!.hints = ['合言葉は st4-rma-p1x です'];
    m.sealed[0]!.teaser = project.sealed[1]!.payload.body.slice(0, 60);
    m.changelog[0]!.notes = '返し合言葉「ほしあかり」を追加';
    const leaks = findLeaks(JSON.stringify(m, null, 2), secrets);
    expect(leaks).toContain('st4-rma-p1x');
    expect(leaks).toContain(project.sealed[1]!.payload.body);
    expect(leaks).toContain('ほしあかり');
  });

  it('a hint leaking the secret title in the project fails noSpoil after the build', async () => {
    const p = fixtureProject();
    p.goals[0]!.hints = ['「星図の果て」を目指そう'];
    const r = await buildManifest(p);
    const report = await selfTest(r.manifest, r.codes, p);
    expect(failed(report)).toEqual(['noSpoil']);
  });

  it('fails redeem/secret/sealed checks when a code row is wrong', async () => {
    const codes = built.codes.map((c) => (c.goalId === 'end-b' ? { ...c, display: 'SK1-ES0-NGM', canonical: 'b32:SK1ES0NGM' } : c));
    const report = await selfTest(built.manifest, codes, project);
    expect(report.ok).toBe(false);
    // Items that need end-b cannot be checked without its master (the strict check is skipped too).
    expect(failed(report)).toEqual(['redeem:end-b', 'secret:end-b', 'sealed:afterword', 'sealed:letter', 'sealed:door']);
    expect(checkIds(report)).not.toContain('sealedStrict:afterword');
  });

  it('reports a code row that redeems another goal', async () => {
    const codes = built.codes.map((c) => (c.goalId === 'end-a' ? { ...c, display: 'ST4-RMA-P1X', canonical: 'b32:ST4RMAP1X' } : c));
    const report = await selfTest(built.manifest, codes, project);
    const check = report.checks.find((c) => c.id === 'redeem:end-a')!;
    expect(check.ok).toBe(false);
    expect(check.messageJa).toContain('end-b');
  });

  it('reports a code goal missing from the code sheet', async () => {
    const report = await selfTest(built.manifest, built.codes.slice(0, 2), project);
    expect(report.ok).toBe(false);
    expect(report.checks.filter((c) => c.id === 'redeem:voice-1').map((c) => c.ok)).toEqual([false]);
  });

  it('detects swapped goal secrets (AAD binding)', async () => {
    const m = clone(built.manifest);
    const a = codeGoal(m, 'end-a');
    const b = codeGoal(m, 'end-b');
    [a.secret, b.secret] = [b.secret, a.secret];
    const report = await selfTest(m, built.codes, project);
    expect(failed(report)).toEqual(['secret:end-a', 'secret:end-b']);
  });

  it('detects a secret that no longer matches the project', async () => {
    const p = clone(project);
    p.goals[2]!.secret = { title: '別のタイトル' };
    const report = await selfTest(built.manifest, built.codes, p);
    expect(failed(report)).toContain('secret:voice-1');
  });

  it('detects a tampered or mismatched sealed box', async () => {
    const m = clone(built.manifest);
    const ct = b64uDecode(m.sealed[0]!.box.ct);
    ct[0] = ct[0]! ^ 1;
    m.sealed[0]!.box.ct = b64uEncode(ct);
    m.sealed[2]!.box = clone(built.manifest.sealed[1]!.box);
    const report = await selfTest(m, built.codes, project);
    expect(failed(report)).toEqual(['sealed:afterword', 'sealed:door']);
    const p = clone(project);
    p.sealed[1]!.payload.body = '変更された本文';
    const report2 = await selfTest(built.manifest, built.codes, p);
    expect(failed(report2)).toEqual(['sealed:letter']);
  });

  it('detects a broken anyOf wrap even when the first goal opens it', async () => {
    const m = clone(built.manifest);
    const letter = m.sealed[1]!;
    if (letter.unlock.mode !== 'anyOf') throw new Error('expected anyOf');
    letter.unlock.wraps[1] = { ...letter.unlock.wraps[1]!, ct: letter.unlock.wraps[0]!.ct, iv: letter.unlock.wraps[0]!.iv };
    const report = await selfTest(m, built.codes, project);
    expect(failed(report)).toEqual(['sealed:letter']);
    expect(report.checks.find((c) => c.id === 'sealed:letter')!.messageJa).toContain('end-b');
  });

  it('fails validate for an invalid manifest and sealed checks without kdf', async () => {
    const m = clone(built.manifest);
    delete m.kdf;
    const report = await selfTest(m, built.codes, project);
    expect(report.ok).toBe(false);
    expect(failed(report)).toContain('validate');
    expect(failed(report)).toContain('redeem:end-a');
    expect(failed(report)).toContain('sealed:afterword');
  });

  it('reports a project sealed item missing from the manifest', async () => {
    const m = clone(built.manifest);
    m.sealed = m.sealed.filter((s) => s.id !== 'door');
    const report = await selfTest(m, built.codes, project);
    expect(failed(report)).toEqual(['sealed:door']);
  });

  it('the strict allOf check really needs every master', async () => {
    const kdf = built.manifest.kdf!;
    const item = built.manifest.sealed[0]!;
    const masters: Record<string, Uint8Array> = {};
    for (const row of built.codes) masters[row.goalId] = await deriveMaster(row.canonical, kdf);
    const full = await openItem({ workId: built.manifest.work.id, kdf, item, masters });
    expect(full).toEqual(normalizePayload(project.sealed[0]!.payload));
    const partial = { ...masters };
    delete partial['voice-1'];
    expect(await openItem({ workId: built.manifest.work.id, kdf, item, masters: partial })).toBeNull();
  });
});

describe('helpers', () => {
  it('jsonEqual ignores key order and undefined-valued keys', () => {
    expect(jsonEqual({ a: 1, b: [1, { c: 'x' }] }, { b: [1, { c: 'x' }], a: 1 })).toBe(true);
    expect(jsonEqual({ a: 1, b: undefined }, { a: 1 })).toBe(true);
    expect(jsonEqual({ a: 1 }, { a: 2 })).toBe(false);
    expect(jsonEqual([1, 2], [2, 1])).toBe(false);
    expect(jsonEqual({ a: [] }, { a: {} })).toBe(false);
    expect(jsonEqual(null, {})).toBe(false);
  });

  it('normalizeGoalSecret / normalizePayload drop empty optional parts', () => {
    expect(normalizeGoalSecret({ title: 't', description: ' ', unlockMessage: '' })).toEqual({ title: 't' });
    expect(normalizeGoalSecret({ title: 't', description: 'd' })).toEqual({ title: 't', description: 'd' });
    expect(
      normalizePayload({
        title: 't',
        body: '',
        from: '',
        returnCode: { code: '', instruction: '' },
        storeLink: { storeCode: 'ｒｊ１２３４５６', caption: '次回作' },
      }),
    ).toEqual({ title: 't', body: '', storeLink: { storeCode: 'RJ123456', caption: '次回作' } });
  });

  it('parseCode agrees with the fixture codes', () => {
    for (const code of Object.values(FIXTURE_CODES)) expect(parseCode(code).ok).toBe(true);
  });
});
