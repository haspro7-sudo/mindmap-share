import { describe, it, expect, vi } from 'vitest';
import { unzipSync } from 'fflate';
import { parseCode } from '../core/codes';
import { isShioriError } from '../core/errors';
import { KDF_ITERATIONS_DEFAULT } from '../core/constants';
import { b64uDecode, fromUtf8 } from '../core/encoding';
import type { Rng } from '../core/encoding';
import { KIT_PATHS, KIT_QR_DIR } from '../core/kit';
import { WORK_ID_RE } from '../core/manifest/schema';
import { counterRng, FIXTURE_CODES, fixtureProject } from '../core/manifest/testFixtures';
import type { Bytes, StudioProject } from '../core/types';
import {
  MAX_PROJECT_BYTES,
  MSG_STALE_BUILD,
  buildAndCheck,
  exportKitZip,
  exportProjectJson,
  findLeakPath,
  generateGoalCode,
  kitZipFileName,
  markExported,
  newStudioProject,
  newStudioWorkId,
  parseProjectJson,
  withBuildSalt,
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
    const report = await buildAndCheck(fixtureProject());
    expect(report.errors).toEqual([]);
    expect(report.exportable).toBe(true);
    expect(report.selfTest?.checks.length).toBeGreaterThan(5);
    expect(report.build?.salt).toBe(fixtureProject().kdfSalt);
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

  it('turns a build failure into an error issue', async () => {
    const p = smallProject();
    p.sealed[0]!.payload.title = ''; // lint does not check payload lengths; the build does
    const report = await buildAndCheck(p);
    expect(report.exportable).toBe(false);
    expect(report.build).toBeUndefined();
    expect(report.errors).toHaveLength(1);
    expect(report.errors[0]).toMatchObject({ code: 'build', severity: 'error' });
    expect(report.errors[0]!.messageJa).toContain('letter');
  });

  it('treats a leaked secret as a hard error and points at the field', async () => {
    const p = fixtureProject();
    p.goals[3]!.teaser = `合言葉は${FIXTURE_CODES['end-a']}です`;
    const report = await buildAndCheck(p);
    expect(report.build).toBeDefined();
    expect(report.leaks).toEqual([FIXTURE_CODES['end-a']]);
    expect(report.exportable).toBe(false);
    const leak = report.errors.find((e) => e.code === 'leak');
    expect(leak).toMatchObject({ path: 'goals[3].teaser', severity: 'error' });
    expect(leak?.messageJa).toContain(FIXTURE_CODES['end-a']);
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
});

describe('exportKitZip', () => {
  it('zips the kit text files and one QR PNG per code, in a fixed order', async () => {
    const report = await buildAndCheck(fixtureProject());
    const build = report.build!;
    const render = vi.fn(async (url: string, caption: string) => fakePng(url, caption));
    const zip = await exportKitZip(fixtureProject(), build, render);
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
    expect(render.mock.calls[2]).toEqual([
      `${APP_URL}#/u/w-test00001/${encodeURIComponent('ほたるかえでつばめこだますずめ')}`,
      FIXTURE_CODES['voice-1'],
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
    const build = (await buildAndCheck(fixtureProject())).build!;
    const zip = await exportKitZip(fixtureProject(), build, async (url, caption) => fakePng(url, caption));
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
    const build = (await buildAndCheck(fixtureProject())).build!;
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(T0);
      const render = async (url: string, caption: string) => fakePng(url, caption);
      const a = await exportKitZip(fixtureProject(), build, render);
      const b = await exportKitZip(fixtureProject(), build, render);
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
    const p = fixtureProject();
    const build = (await buildAndCheck(p)).build!;
    const render = vi.fn(async (url: string, caption: string) => fakePng(url, caption));
    const stale = async (changed: StudioProject) => {
      const e = await exportKitZip(changed, build, render).catch((err: unknown) => err);
      expect(isShioriError(e) && e.code).toBe('conflict');
      expect(isShioriError(e) && e.messageJa).toBe(MSG_STALE_BUILD);
    };
    const recoded = fixtureProject();
    recoded.goals[0]!.code = 'M00-NDE-SKR';
    await stale(recoded);
    await stale(fixtureProject({ work: { ...p.work, id: 'w-other0001' } }));
    await stale(fixtureProject({ kdfSalt: 'AQEBAQEBAQEBAQEBAQEBAQ' }));
    const fewer = fixtureProject();
    fewer.goals = fewer.goals.filter((g) => g.id !== 'voice-1');
    await stale(fewer);
    expect(render).not.toHaveBeenCalled();
    // label edits are not codes: still accepted
    const relabeled = fixtureProject();
    relabeled.goals[0]!.label = 'END 1（改）';
    await expect(exportKitZip(relabeled, build, render)).resolves.toBeInstanceOf(Uint8Array);
  });

  it('propagates a renderer failure', async () => {
    const build = (await buildAndCheck(fixtureProject())).build!;
    await expect(
      exportKitZip(fixtureProject(), build, async () => {
        throw new Error('canvas unavailable');
      }),
    ).rejects.toThrow('canvas unavailable');
  });

  it('names the kit after the opaque work id', () => {
    expect(kitZipFileName(fixtureProject())).toBe('shiori-kit-w-test00001.zip');
  });
});

describe('exportProjectJson / parseProjectJson', () => {
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
