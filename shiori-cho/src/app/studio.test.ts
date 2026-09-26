import { describe, it, expect, vi } from 'vitest';
import { unzipSync } from 'fflate';
import { generateCode, parseCode } from '../core/codes';
import { isShioriError } from '../core/errors';
import { KDF_ITERATIONS_DEFAULT } from '../core/constants';
import { b64uDecode, fromUtf8 } from '../core/encoding';
import type { Rng } from '../core/encoding';
import { CODES_CSV_HEADER, KIT_PATHS, KIT_QR_DIR } from '../core/kit';
import { WORK_ID_RE } from '../core/manifest/schema';
import { counterRng, FIXTURE_CODES, fixtureProject } from '../core/manifest/testFixtures';
import type { Bytes, StudioProject } from '../core/types';
import amaotoProjectText from '../demo/amaoto.project.json?raw';
import { DEMO_APP_CODES, DEMO_RETURN_CODE } from '../demo/demoCodes';
import hoshiyomiProjectText from '../demo/hoshiyomi.project.json?raw';
import {
  DEMO_KDF_SALTS,
  MAX_PROJECT_BYTES,
  MSG_STALE_BUILD,
  buildAndCheck,
  demoIdentityIssues,
  exportKitZip,
  exportProjectJson,
  findLeakPath,
  generateGoalCode,
  identityCollisionIssues,
  isDemoReturnCode,
  kitZipFileName,
  lintStudioProject,
  markExported,
  newStudioProject,
  newStudioWorkId,
  parseProjectJson,
  projectBackupFileName,
  withBuildSalt,
  withNewWorkIdentity,
} from './studio';

const T0 = 1_790_000_000_000;
const APP_URL = 'https://example.github.io/shiori-cho/';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const JA_RE = /[ぁ-んァ-ヶ一-龠]/;

/** A small project made from the starter, with one code goal, one manual goal and one sealed letter. */
function smallProject(): StudioProject {
  const p = newStudioProject(APP_URL, T0, counterRng(7));
  p.kdfIterations = 100_000;
  p.work.title = '雨音の小さな図書室';
  p.authorName = 'テスト工房（架空）';
  p.goals = [
    {
      id: 'end-a',
      group: 'endings',
      label: 'END 1',
      spoiler: 0,
      hints: ['雨の日に図書室へ行ってみよう'],
      unlockType: 'code',
      codeKind: 'b32',
      code: 'K7Q-M2X-RAP',
      secret: { title: '雨上がりの約束', unlockMessage: '最後まで読んでくれてありがとう。' },
    },
    { id: 'ach-1', group: 'endings', label: '本を10冊読んだ', spoiler: 0, hints: [], unlockType: 'manual' },
  ];
  p.sealed = [
    {
      id: 'letter',
      label: '司書からの手紙',
      kind: 'letter',
      mode: 'allOf',
      goals: ['end-a'],
      payload: { title: '雨の日の手紙', body: '図書室に来てくれて、うれしかったです。\nまた遊びに来てくださいね。', from: '司書より' },
    },
  ];
  return p;
}

/** Codes of studioFixture() that are not public demo codes (the core fixture reuses two of the demos' codes). */
const CODE_B = generateCode('b32', counterRng(40)).display;
const CODE_KANA = generateCode('kana', counterRng(90)).display;
const RETURN_CODE = 'とびらのことば';

/** The core fixture (b32 + kana, allOf + anyOf, returnCode) without any code or return code of the bundled demos. */
function studioFixture(overrides: Partial<StudioProject> = {}): StudioProject {
  const p = fixtureProject(overrides);
  p.goals[1]!.code = CODE_B;
  p.goals[2]!.code = CODE_KANA;
  p.sealed[2]!.payload.returnCode = { code: RETURN_CODE, instruction: 'タイトル画面の「扉の合言葉」に入力してください' };
  return p;
}

function sampleProject(): StudioProject {
  const r = parseProjectJson(hoshiyomiProjectText);
  if (!r.ok) throw new Error('sample project is invalid');
  return r.project;
}

function fakePng(url: string, caption: string): Uint8Array {
  // PNG signature + a recognizable body (the renderer is injected, so any bytes do).
  const body = new TextEncoder().encode(`${caption}|${url}`);
  const out = new Uint8Array(8 + body.length);
  out.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  out.set(body, 8);
  return out;
}

function indexOfBytes(haystack: Uint8Array, needle: Uint8Array): number {
  outer: for (let i = 0; i + needle.length <= haystack.length; i++) {
    for (let j = 0; j < needle.length; j++) if (haystack[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}

describe('newStudioProject', () => {
  it('creates the starter project', () => {
    const spy = vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue('aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee');
    try {
      const p = newStudioProject(`  ${APP_URL} `, T0, counterRng(0));
      expect(p).toEqual({
        format: 'shiori-studio-project',
        version: 1,
        id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
        createdAt: T0,
        updatedAt: T0,
        appUrl: APP_URL,
        work: { id: 'w-0123456789', title: '', kind: 'game', version: '1.0.0' },
        kdfIterations: KDF_ITERATIONS_DEFAULT,
        checkpoints: [],
        groups: [{ id: 'endings', label: 'エンディング' }],
        goals: [],
        sealed: [],
        changelog: [],
      });
      expect(p.kdfSalt).toBeUndefined();
      expect(p.kdfIterations).toBe(200_000);
    } finally {
      spy.mockRestore();
    }
  });

  it('uses random ids by default', () => {
    const a = newStudioProject(APP_URL);
    const b = newStudioProject(APP_URL);
    expect(a.id).toMatch(UUID_RE);
    expect(a.id).not.toBe(b.id);
    expect(a.work.id).not.toBe(b.work.id);
    expect(Math.abs(a.createdAt - Date.now())).toBeLessThan(5_000);
  });

  it('makes opaque work ids: "w-" + 10 lowercase Crockford characters', () => {
    expect(newStudioWorkId(counterRng(10))).toBe('w-abcdefghjk');
    // bytes are masked to 5 bits: 32 → '0', 255 → 'z'
    expect(newStudioWorkId(() => Uint8Array.from([32, 255, 31, 0, 1, 2, 3, 4, 5, 6]) as Bytes)).toBe('w-0zz0123456');
    for (let i = 0; i < 200; i++) {
      const id = newStudioWorkId();
      expect(id).toMatch(/^w-[0-9a-hjkmnp-tv-z]{10}$/);
      expect(WORK_ID_RE.test(id)).toBe(true);
    }
  });
});

describe('generateGoalCode', () => {
  it('generates valid codes of the requested kind', () => {
    const p = smallProject();
    const b32 = parseCode(generateGoalCode(p, 'b32'));
    expect(b32.ok && b32.kind).toBe('b32');
    const kana = parseCode(generateGoalCode(p, 'kana'));
    expect(kana.ok && kana.kind).toBe('kana');
  });

  it('never repeats a code already used in the project', () => {
    const zeros: Rng = (n) => new Uint8Array(n) as Bytes;
    const existing = generateGoalCode(fixtureProject({ goals: [] }), 'b32', zeros);
    const p = smallProject();
    p.goals[0]!.code = existing;
    let calls = 0;
    const next = counterRng(100);
    const rng: Rng = (n) => (calls++ < 3 ? zeros(n) : next(n));
    const code = generateGoalCode(p, 'b32', rng);
    expect(calls).toBe(4);
    expect(code).not.toBe(existing);
    expect(parseCode(code).ok).toBe(true);
  });

  it('gives up with a Japanese error when the rng cannot produce a new code', () => {
    const zeros: Rng = (n) => new Uint8Array(n) as Bytes;
    const p = smallProject();
    p.goals[0]!.code = generateGoalCode(fixtureProject({ goals: [] }), 'kana', zeros);
    expect(() => generateGoalCode(p, 'kana', zeros)).toThrow(/合言葉を作れませんでした/);
  });
});

describe('buildAndCheck', () => {
  it('passes a small valid project (100,000 iterations) and makes it exportable', async () => {
    const p = smallProject();
    const report = await buildAndCheck(p);
    expect(report.errors).toEqual([]);
    expect(report.leaks).toEqual([]);
    expect(report.selfTest?.ok).toBe(true);
    expect(report.exportable).toBe(true);
    expect(report.build).toBeDefined();
    // iterations < 150k: a warning (once, although both lint and validate report it), never an error
    expect(report.warnings.filter((w) => w.code === 'kdfIterationsLow')).toHaveLength(1);
    expect(report.warnings.every((w) => w.severity === 'warning')).toBe(true);

    const build = report.build!;
    expect(b64uDecode(build.salt)).toHaveLength(16);
    expect(build.manifest.kdf?.iterations).toBe(100_000);
    expect(build.codes.map((c) => c.goalId)).toEqual(['end-a']);
    expect(build.codes[0]?.unlockUrl).toBe(`${APP_URL}#/u/${p.work.id}/K7QM2XRAP`);
    // the project is not mutated; the caller persists the salt
    expect(p.kdfSalt).toBeUndefined();
  });

  it('keeps tags stable once the build salt is persisted', async () => {
    const first = await buildAndCheck(smallProject());
    const saved = withBuildSalt(smallProject(), first.build!);
    expect(saved.kdfSalt).toBe(first.build!.salt);
    expect(withBuildSalt(saved, first.build!)).toBe(saved);
    const second = await buildAndCheck(saved);
    expect(second.exportable).toBe(true);
    expect(second.build!.salt).toBe(first.build!.salt);
    const tag = (r: typeof first) => {
      const g = r.build!.manifest.goals.find((x) => x.id === 'end-a');
      return g?.unlock.type === 'code' ? g.unlock.tag : undefined;
    };
    expect(tag(second)).toBe(tag(first));
  });

  it('passes the full fixture (b32 + kana, allOf + anyOf, returnCode)', async () => {
    const report = await buildAndCheck(studioFixture());
    expect(report.errors).toEqual([]);
    expect(report.exportable).toBe(true);
    expect(report.selfTest?.checks.length).toBeGreaterThan(5);
    expect(report.build?.salt).toBe(studioFixture().kdfSalt);
  });

  it('stops at lint errors without building (no PBKDF2)', async () => {
    const p = smallProject();
    p.work.id = 'Bad ID';
    p.goals[0]!.secret = { title: '' };
    const deriveBits = vi.spyOn(globalThis.crypto.subtle, 'deriveBits');
    try {
      const report = await buildAndCheck(p);
      expect(report.exportable).toBe(false);
      expect(report.build).toBeUndefined();
      expect(report.selfTest).toBeUndefined();
      expect(report.leaks).toEqual([]);
      expect(report.errors.map((e) => e.path)).toEqual(expect.arrayContaining(['work.id', 'goals[0].secret.title']));
      expect(report.errors.every((e) => e.severity === 'error' && JA_RE.test(e.messageJa))).toBe(true);
      expect(deriveBits).not.toHaveBeenCalled();
    } finally {
      deriveBits.mockRestore();
    }
  });

  it('keeps lint warnings when lint errors stop the check', async () => {
    const p = smallProject();
    p.groups.push({ id: 'extra', label: 'おまけ' });
    p.goals[0]!.code = 'not a code';
    const report = await buildAndCheck(p);
    expect(report.exportable).toBe(false);
    expect(report.warnings.map((w) => w.code)).toContain('emptyGroup');
  });

  it('turns every build pre-check failure into an error with its path (lint does not check lengths)', async () => {
    const p = smallProject();
    p.sealed[0]!.payload.body = 'あ'.repeat(20_001);
    p.goals[0]!.secret = { title: '雨上がりの約束', description: 'い'.repeat(501) };
    const deriveBits = vi.spyOn(globalThis.crypto.subtle, 'deriveBits');
    try {
      const report = await buildAndCheck(p);
      expect(report.exportable).toBe(false);
      expect(report.build).toBeUndefined();
      expect(report.errors.map((e) => [e.path, e.code])).toEqual([
        ['goals[0].secret.description', 'tooLong'],
        ['sealed[0].payload.body', 'tooLong'],
      ]);
      expect(report.errors[1]!.messageJa).toContain('letter');
      expect(deriveBits).not.toHaveBeenCalled();
    } finally {
      deriveBits.mockRestore();
    }
  });

  it('lists every manifest validation error with its path, not just the first three', async () => {
    const p = studioFixture();
    p.work.title = 'あ'.repeat(101);
    p.checkpoints[0]!.label = 'い'.repeat(41);
    p.groups[0]!.label = 'う'.repeat(21);
    p.goals[3]!.label = 'え'.repeat(61);
    const report = await buildAndCheck(p);
    expect(report.exportable).toBe(false);
    expect(report.errors.map((e) => e.path)).toEqual(['work.title', 'checkpoints[0].label', 'groups[0].label', 'goals[3].label']);
    expect(report.errors.every((e) => e.severity === 'error' && JA_RE.test(e.messageJa))).toBe(true);
  });

  it('treats a leaked secret as a hard error and points at the field', async () => {
    const p = studioFixture();
    p.goals[3]!.teaser = `合言葉は${FIXTURE_CODES['end-a']}です`;
    const report = await buildAndCheck(p);
    expect(report.build).toBeDefined();
    expect(report.leaks).toEqual([FIXTURE_CODES['end-a']]);
    expect(report.exportable).toBe(false);
    const leak = report.errors.find((e) => e.code === 'leak');
    expect(leak).toMatchObject({ path: 'goals[3].teaser', severity: 'error' });
    expect(leak?.messageJa).toContain(FIXTURE_CODES['end-a']);
  });

  it('finds a code written in another spelling (full width, other separators) and points at the field', async () => {
    const p = studioFixture();
    p.changelog[0]!.notes = '合言葉 Ｋ７Ｑ－Ｍ２Ｘ－ＲＡＰ の表示を修正'; // typed with a Japanese IME
    const report = await buildAndCheck(p);
    expect(report.leaks).toEqual([FIXTURE_CODES['end-a']]);
    expect(report.errors.find((e) => e.code === 'leak')?.path).toBe('changelog[0].notes');
    expect(report.exportable).toBe(false);
  });

  it('reports a letter signature that also appears in public text as a warning, not a leak', async () => {
    const p = studioFixture();
    p.sealed[1]!.payload.from = 'ミナ';
    p.sealed[1]!.label = 'ミナからの手紙';
    const report = await buildAndCheck(p);
    expect(report.leaks).toEqual([]);
    expect(report.exportable).toBe(true);
    const w = report.warnings.filter((i) => i.code === 'fromInPublic');
    expect(w).toEqual([expect.objectContaining({ path: 'sealed[1].label', severity: 'warning' })]);
    expect(w[0]!.messageJa).toContain('ミナ');
  });

  it('reports a leaked sealed body', async () => {
    const p = smallProject();
    p.goals[1]!.label = '図書室に来てくれて';
    p.sealed[0]!.payload.body = '図書室に来てくれて';
    const report = await buildAndCheck(p);
    expect(report.leaks).toEqual(['図書室に来てくれて']);
    expect(report.errors.find((e) => e.code === 'leak')?.path).toBe('goals[1].label');
    expect(report.exportable).toBe(false);
  });
});

describe('findLeakPath', () => {
  it('finds nested strings and keys, and skips binary fields', () => {
    const m = { goals: [{ id: 'a', hints: ['x', 'ひみつ'] }], sealed: [{ box: { iv: 'ひみつ', ct: 'x' } }], ひみつの鍵: 1 };
    expect(findLeakPath(m, 'ひみつ')).toBe('goals[0].hints[1]');
    expect(findLeakPath({ sealed: [{ box: { iv: 'ひみつ' } }] }, 'ひみつ')).toBe('');
    expect(findLeakPath({ a: 1, ひみつの鍵: 2 }, 'ひみつ')).toBe('["ひみつの鍵"]');
    expect(findLeakPath('ひみつ', 'ひみつ')).toBe('');
  });

  it('finds other spellings of a code and folded secret texts', () => {
    const m = { goals: [{ hints: ['夜へ', 'ｋ７ｑ・ｍ２ｘ・ｒａｐ'] }], changelog: [{ notes: 'ひ み つ' }] };
    expect(findLeakPath(m, 'K7Q-M2X-RAP')).toBe('goals[0].hints[1]');
    expect(findLeakPath(m, 'ひみつ')).toBe('changelog[0].notes');
  });
});

describe('exportKitZip', () => {
  it('zips the kit text files and one QR PNG per code, in a fixed order', async () => {
    const report = await buildAndCheck(studioFixture());
    const build = report.build!;
    const render = vi.fn(async (url: string, caption: string) => fakePng(url, caption));
    const zip = await exportKitZip(studioFixture(), build, render);
    const files = unzipSync(zip);

    expect(Object.keys(files)).toEqual([
      KIT_PATHS.shioriJson,
      KIT_PATHS.readmePlayer,
      KIT_PATHS.codesCsv,
      KIT_PATHS.snippets,
      KIT_PATHS.projectBackup,
      KIT_PATHS.storeTemplate,
      KIT_PATHS.readmeCreator,
      `${KIT_QR_DIR}/end-a.png`,
      `${KIT_QR_DIR}/end-b.png`,
      `${KIT_QR_DIR}/voice-1.png`,
    ]);
    expect(Object.keys(files)).toContain('非公開_ゲームに埋め込む/qr/voice-1.png');

    expect(render.mock.calls).toEqual(build.codes.map((c) => [c.unlockUrl, c.display]));
    const kana = parseCode(CODE_KANA);
    expect(render.mock.calls[2]).toEqual([
      `${APP_URL}#/u/w-test00001/${encodeURIComponent(kana.ok ? kana.canonical.slice('kana:'.length) : '')}`,
      CODE_KANA,
    ]);
    const endA = build.codes[0]!;
    expect(files[`${KIT_QR_DIR}/end-a.png`]).toEqual(fakePng(endA.unlockUrl, endA.display));
    expect(fromUtf8(files[KIT_PATHS.shioriJson]!)).toBe(build.json);
    const csv = fromUtf8(files[KIT_PATHS.codesCsv]!);
    expect(csv).toContain(FIXTURE_CODES['end-a']);
    // the public file ships no code
    expect(fromUtf8(files[KIT_PATHS.shioriJson]!)).not.toContain(FIXTURE_CODES['end-a']);
  });

  it('stores PNGs uncompressed and text compressed', async () => {
    const build = (await buildAndCheck(studioFixture())).build!;
    const zip = await exportKitZip(studioFixture(), build, async (url, caption) => fakePng(url, caption));
    const png = fakePng(build.codes[1]!.unlockUrl, build.codes[1]!.display);
    expect(indexOfBytes(zip, png)).toBeGreaterThan(0);
  });

  it('writes the build salt and the export time into the project backup of the kit', async () => {
    const p = smallProject();
    const build = (await buildAndCheck(p)).build!;
    vi.useFakeTimers({ toFake: ['Date'] });
    let zip: Uint8Array;
    try {
      vi.setSystemTime(T0 + 1_000);
      zip = await exportKitZip(p, build, async (url, caption) => fakePng(url, caption));
    } finally {
      vi.useRealTimers();
    }
    const backup = parseProjectJson(fromUtf8(unzipSync(zip)[KIT_PATHS.projectBackup]!));
    expect(backup.ok).toBe(true);
    if (backup.ok) {
      expect(backup.project.kdfSalt).toBe(build.salt);
      expect(backup.project).toEqual({ ...p, kdfSalt: build.salt, lastExportedAt: T0 + 1_000 });
      expect(backup.project).toEqual(markExported(p, build, T0 + 1_000));
    }
    expect(p.kdfSalt).toBeUndefined();
    expect(p.lastExportedAt).toBeUndefined();
  });

  it('markExported keeps updatedAt and overwrites an older lastExportedAt', () => {
    const p = { ...fixtureProject(), lastExportedAt: T0 - 5_000 };
    const marked = markExported(p, { salt: p.kdfSalt! }, T0);
    expect(marked).toEqual({ ...p, lastExportedAt: T0 });
    expect(marked.updatedAt).toBe(p.updatedAt);
    expect(markExported(smallProject(), { salt: 'AAECAwQFBgcICQoLDA0ODw' }, T0).kdfSalt).toBe('AAECAwQFBgcICQoLDA0ODw');
  });

  it('is deterministic for the same input and time', async () => {
    const build = (await buildAndCheck(studioFixture())).build!;
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(T0);
      const render = async (url: string, caption: string) => fakePng(url, caption);
      const a = await exportKitZip(studioFixture(), build, render);
      const b = await exportKitZip(studioFixture(), build, render);
      expect(b).toEqual(a);
    } finally {
      vi.useRealTimers();
    }
  });

  it('works without code goals (no qr folder)', async () => {
    const p = smallProject();
    p.goals = [p.goals[1]!];
    p.sealed = [];
    const report = await buildAndCheck(p);
    expect(report.exportable).toBe(true);
    const render = vi.fn(async (url: string, caption: string) => fakePng(url, caption));
    const files = unzipSync(await exportKitZip(p, report.build!, render));
    expect(render).not.toHaveBeenCalled();
    expect(Object.keys(files)).toHaveLength(7);
  });

  it('refuses a build that no longer matches the project', async () => {
    const p = studioFixture();
    const build = (await buildAndCheck(p)).build!;
    const render = vi.fn(async (url: string, caption: string) => fakePng(url, caption));
    const stale = async (changed: StudioProject) => {
      const e = await exportKitZip(changed, build, render).catch((err: unknown) => err);
      expect(isShioriError(e) && e.code).toBe('conflict');
      expect(isShioriError(e) && e.messageJa).toBe(MSG_STALE_BUILD);
    };
    const recoded = studioFixture();
    recoded.goals[0]!.code = 'M00-NDE-SKR';
    await stale(recoded);
    await stale(studioFixture({ work: { ...p.work, id: 'w-other0001' } }));
    await stale(studioFixture({ kdfSalt: 'AQEBAQEBAQEBAQEBAQEBAQ' }));
    const fewer = studioFixture();
    fewer.goals = fewer.goals.filter((g) => g.id !== 'voice-1');
    await stale(fewer);
    expect(render).not.toHaveBeenCalled();
    // label edits are not codes: still accepted
    const relabeled = studioFixture();
    relabeled.goals[0]!.label = 'END 1（改）';
    await expect(exportKitZip(relabeled, build, render)).resolves.toBeInstanceOf(Uint8Array);
  });

  it('propagates a renderer failure', async () => {
    const build = (await buildAndCheck(studioFixture())).build!;
    await expect(
      exportKitZip(studioFixture(), build, async () => {
        throw new Error('canvas unavailable');
      }),
    ).rejects.toThrow('canvas unavailable');
  });

  it('names the kit after the opaque work id', () => {
    expect(kitZipFileName(fixtureProject())).toBe('shiori-kit-w-test00001.zip');
  });

  it('adds no QR images and no unlock URLs without an absolute app URL', async () => {
    const p = smallProject();
    p.appUrl = '';
    const report = await buildAndCheck(p);
    expect(report.exportable).toBe(true);
    expect(report.warnings.map((w) => w.code)).toContain('appUrlMissing');
    const build = report.build!;
    expect(build.codes[0]!.unlockUrl.startsWith('#/u/')).toBe(true);
    const render = vi.fn(async (url: string, caption: string) => fakePng(url, caption));
    const files = unzipSync(await exportKitZip(p, build, render));
    expect(render).not.toHaveBeenCalled();
    expect(Object.keys(files).some((f) => f.startsWith(KIT_QR_DIR))).toBe(false);
    const csv = fromUtf8(files[KIT_PATHS.codesCsv]!);
    const row = csv.split('\r\n')[1]!.split(',');
    expect(row).toHaveLength(CODES_CSV_HEADER.length);
    expect(row[4]).toBe('K7Q-M2X-RAP');
    expect(row[5]).toBe('');
    expect(csv).not.toContain('#/u/');
    expect(fromUtf8(files[KIT_PATHS.readmePlayer]!)).not.toContain('QRコード');
  });
});

describe('project backup file name', () => {
  it('is neutral: no work id or title (F2 AC1)', () => {
    expect(projectBackupFileName(new Date(2026, 8, 5, 23, 59))).toBe('shiori-studio-project-20260905.json');
    expect(projectBackupFileName()).toMatch(/^shiori-studio-project-\d{8}\.json$/);
  });
});

describe('sample and duplicate identity', () => {
  it('keeps DEMO_KDF_SALTS in sync with the bundled demo projects', () => {
    const salts = [hoshiyomiProjectText, amaotoProjectText].map((t) => (JSON.parse(t) as StudioProject).kdfSalt);
    expect([...DEMO_KDF_SALTS].sort()).toEqual([...salts].sort());
  });

  it('a project that keeps the sample identity is not exportable, and no PBKDF2 runs', async () => {
    const p = { ...sampleProject(), appUrl: APP_URL };
    const deriveBits = vi.spyOn(globalThis.crypto.subtle, 'deriveBits');
    try {
      const report = await buildAndCheck(p);
      expect(report.exportable).toBe(false);
      expect(report.build).toBeUndefined();
      expect(report.errors.map((e) => [e.path, e.code])).toEqual([
        ['work.id', 'demoWorkId'],
        ['kdfSalt', 'demoSalt'],
        ['goals[0].code', 'demoCode'],
        ['goals[1].code', 'demoCode'],
        ['goals[2].code', 'demoCode'],
        ['goals[3].code', 'demoCode'],
        ['sealed[2].payload.returnCode.code', 'demoReturnCode'],
      ]);
      expect(report.errors.every((e) => JA_RE.test(e.messageJa))).toBe(true);
      expect(deriveBits).not.toHaveBeenCalled();
    } finally {
      deriveBits.mockRestore();
    }
  });

  it('flags any spelling of a demo code, including the kana one and the return code', () => {
    const p = studioFixture();
    p.goals[0]!.code = 'st4 rma p1x';
    p.goals[2]!.code = 'ホタル カエデ ツバメ コダマ スズメ';
    p.sealed[2]!.payload.returnCode!.code = 'ホシ アカリ';
    expect(demoIdentityIssues(p).map((i) => [i.path, i.severity])).toEqual([
      ['goals[0].code', 'error'],
      ['goals[2].code', 'error'],
      ['sealed[2].payload.returnCode.code', 'error'],
    ]);
    expect(demoIdentityIssues(studioFixture())).toEqual([]);
    // the same checks guard the work id and salt of the other sample
    const amaoto = JSON.parse(amaotoProjectText) as StudioProject;
    expect(demoIdentityIssues({ ...studioFixture(), work: { ...studioFixture().work, id: amaoto.work.id }, kdfSalt: amaoto.kdfSalt }).map((i) => i.code)).toEqual([
      'demoWorkId',
      'demoSalt',
    ]);
  });

  it('withNewWorkIdentity keeps a creator\'s own return code', () => {
    const p = withNewWorkIdentity(studioFixture());
    expect(p.sealed).toEqual(studioFixture().sealed);
  });

  it('withNewWorkIdentity gives the sample its own work id, no salt and new codes', async () => {
    const sample = sampleProject();
    const p = withNewWorkIdentity({ ...sample, lastExportedAt: T0 });
    expect(p.work.id).not.toBe(sample.work.id);
    expect(WORK_ID_RE.test(p.work.id)).toBe(true);
    expect('kdfSalt' in p).toBe(false);
    expect('lastExportedAt' in p).toBe(false);
    const demo = new Set(DEMO_APP_CODES.map((c) => (parseCode(c.display) as { canonical: string }).canonical));
    const codes = p.goals.filter((g) => g.unlockType === 'code').map((g) => parseCode(g.code ?? ''));
    expect(codes).toHaveLength(4);
    for (const [i, c] of codes.entries()) {
      expect(c.ok).toBe(true);
      if (!c.ok) continue;
      expect(c.kind).toBe(sample.goals[i]!.codeKind);
      expect(demo.has(c.canonical)).toBe(false);
    }
    expect(new Set(codes.map((c) => (c.ok ? c.canonical : ''))).size).toBe(4);
    // the sample's public return code is replaced (two words of the kana list); everything else is the sample's
    const door = p.sealed.findIndex((s) => s.kind === 'returnCode');
    const rc = p.sealed[door]!.payload.returnCode!;
    expect(rc.code).not.toBe(DEMO_RETURN_CODE);
    expect(rc.code).toMatch(/^[ぁ-ゖ]{6}$/);
    expect(isDemoReturnCode(rc.code)).toBe(false);
    expect(rc.instruction).toBe(sample.sealed[door]!.payload.returnCode!.instruction);
    expect(p.sealed.map((s, i) => (i === door ? { ...s, payload: { ...s.payload, returnCode: undefined } } : s))).toEqual(
      sample.sealed.map((s, i) => (i === door ? { ...s, payload: { ...s.payload, returnCode: undefined } } : s)),
    );
    expect(p.goals.map((g) => g.secret)).toEqual(sample.goals.map((g) => g.secret));
    expect(sample.work.id).toBe('demo-hoshiyomi');

    // exportable, and a character signature that is also named in public text is only a warning
    const q = { ...p, appUrl: APP_URL, kdfIterations: 100_000 };
    q.sealed = q.sealed.map((s) => (s.id === 'letter-mina' ? { ...s, payload: { ...s.payload, from: 'ミナ' } } : s));
    const report = await buildAndCheck(q);
    expect(report.errors).toEqual([]);
    expect(report.exportable).toBe(true);
    const codesOf = report.warnings.map((w) => w.code);
    expect(codesOf.filter((c) => c === 'fromInPublic')).toHaveLength(1);
  });

  it('warns about another project with the same work id, salt or codes', () => {
    const a = studioFixture();
    const b = { ...studioFixture(), id: 'proj-other' };
    const c = { ...withNewWorkIdentity(studioFixture()), id: 'proj-third', kdfSalt: a.kdfSalt };
    c.goals[1]!.code = CODE_B;
    const issues = identityCollisionIssues(a, [
      { project: a, name: '自分' },
      { project: b, name: 'テストB' },
      { project: c, name: 'テストC' },
    ]);
    expect(issues.map((i) => [i.path, i.code])).toEqual([
      ['work.id', 'workIdShared'],
      ['goals[0].code', 'codeShared'],
      ['goals[1].code', 'codeShared'],
      ['goals[2].code', 'codeShared'],
      ['kdfSalt', 'saltShared'],
      ['goals[1].code', 'codeShared'],
    ]);
    expect(issues.every((i) => i.severity === 'warning')).toBe(true);
    expect(issues[0]!.messageJa).toContain('テストB');
    expect(identityCollisionIssues(a, [{ project: withNewWorkIdentity(a), name: 'x' }])).toEqual([]);
    // 点検 lists them as warnings
    expect(lintStudioProject(a, { others: [{ project: b, name: 'テストB' }] }).filter((i) => i.code === 'workIdShared')).toHaveLength(1);
  });

  it('warns about a local test app URL (not in core lint: the demos use one)', () => {
    const local = lintStudioProject(studioFixture({ appUrl: 'http://localhost:5173/', kdfIterations: 200_000 }));
    expect(local).toEqual([expect.objectContaining({ path: 'appUrl', code: 'appUrlLocal', severity: 'warning' })]);
    expect(lintStudioProject(studioFixture({ kdfIterations: 200_000 }))).toEqual([]);
  });
});

describe('exportProjectJson / parseProjectJson', () => {
  it('round-trips every intermediate editor state (F16 AC7)', () => {
    const p = studioFixture();
    p.goals[0]!.secret = { title: '', description: '説明だけ先に書いた' };
    p.goals[0]!.hints = ['一行目\n二行目'];
    p.goals[3]!.secret = { title: '', description: '手動に切り替える前の残り' };
    p.sealed[0]!.payload = { title: '', body: '' };
    p.sealed[1]!.payload = { ...p.sealed[1]!.payload, returnCode: { code: 'ひみつ', instruction: '' } };
    p.sealed[2]!.payload = { ...p.sealed[2]!.payload, returnCode: { code: '', instruction: '入力場所' }, storeLink: { storeCode: 'rj01234567', caption: '' } };
    expect(parseProjectJson(exportProjectJson(p))).toEqual({ ok: true, project: p });
  });

  it('restores the kit backup of an exportable project whose manual goal keeps a leftover secret', async () => {
    const p = studioFixture();
    p.goals[3]!.secret = { title: '', description: 'まだ合言葉つきだったころの説明' };
    const report = await buildAndCheck(p);
    expect(report.exportable).toBe(true);
    const zip = await exportKitZip(p, report.build!, async (url, caption) => fakePng(url, caption));
    const restored = parseProjectJson(fromUtf8(unzipSync(zip)[KIT_PATHS.projectBackup]!));
    expect(restored.ok).toBe(true);
    if (restored.ok) expect(restored.project.goals[3]!.secret).toEqual({ title: '', description: 'まだ合言葉つきだったころの説明' });
  });

  it('round-trips a full project', () => {
    const p = { ...fixtureProject(), lastExportedAt: T0 };
    const text = exportProjectJson(p);
    expect(text).toBe(JSON.stringify(p, null, 2));
    const parsed = parseProjectJson(text);
    expect(parsed).toEqual({ ok: true, project: p });
  });

  it('round-trips a starter project and tolerates a BOM', () => {
    const p = newStudioProject(APP_URL, T0);
    expect(parseProjectJson(`\uFEFF${exportProjectJson(p)}`)).toEqual({ ok: true, project: p });
  });

  it('strips unknown keys and fills defaults', () => {
    const raw = JSON.parse(exportProjectJson(fixtureProject())) as Record<string, unknown>;
    raw.extra = 'x';
    delete raw.changelog;
    const parsed = parseProjectJson(JSON.stringify(raw));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect('extra' in parsed.project).toBe(false);
    expect(parsed.project.changelog).toEqual([]);
  });

  it('reports JSON syntax errors in Japanese with the position', () => {
    const r = parseProjectJson('{\n  "format": "shiori-studio-project",\n  oops\n}');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toMatchObject({ path: '', code: 'json', severity: 'error' });
    expect(r.errors[0]!.messageJa).toMatch(/^JSONの形式が正しくありません/);
    expect(r.errors[0]!.messageJa).toContain('3行目');

    const empty = parseProjectJson('   ');
    expect(!empty.ok && empty.errors[0]?.messageJa).toBe('JSONの形式が正しくありません（内容が空です）');
  });

  it('recognizes other files', () => {
    const msg = (text: string) => {
      const r = parseProjectJson(text);
      return r.ok ? '' : r.errors[0]!.messageJa;
    };
    expect(msg('[]')).toBe('サークル工房のプロジェクトファイルではないようです');
    expect(msg('{"format":"something"}')).toBe('サークル工房のプロジェクトファイルではないようです');
    expect(msg('{"schema":"shiori/1","work":{}}')).toContain('しおりファイル（shiori.json）のようです');
    expect(msg('{"format":"shiori-backup","version":1}')).toContain('バックアップファイルのようです');
  });

  it('rejects a newer project version', () => {
    const raw = { ...fixtureProject(), version: 2 };
    const r = parseProjectJson(JSON.stringify(raw));
    expect(r).toEqual({
      ok: false,
      errors: [{ path: 'version', code: 'schemaVersion', messageJa: '新しいバージョンのしおり帳が必要です', severity: 'error' }],
    });
  });

  it('lists schema errors with paths and Japanese messages', () => {
    const raw = JSON.parse(exportProjectJson(fixtureProject())) as Record<string, unknown>;
    raw.kdfIterations = 'many';
    (raw.work as Record<string, unknown>).kind = 'movie';
    const r = parseProjectJson(JSON.stringify(raw));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    const paths = r.errors.map((e) => e.path);
    expect(paths).toEqual(expect.arrayContaining(['kdfIterations', 'work.kind']));
    expect(r.errors.every((e) => e.severity === 'error' && JA_RE.test(e.messageJa))).toBe(true);
  });

  it('rejects files that are too large before parsing', () => {
    const r = parseProjectJson(' '.repeat(MAX_PROJECT_BYTES + 1));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0]).toMatchObject({ code: 'tooLarge' });
    expect(r.errors[0]!.messageJa).toContain('8MB');
  });
});
