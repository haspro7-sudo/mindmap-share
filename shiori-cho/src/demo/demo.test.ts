import { beforeAll, describe, it, expect } from 'vitest';
import { parseCode } from '../core/codes';
import { openGoalSecret, openItem } from '../core/crypto/shiori';
import { b64uDecode } from '../core/encoding';
import { ShioriError } from '../core/errors';
import { lintProject } from '../core/manifest/lint';
import { collectSecrets, findLeaks } from '../core/manifest/noSpoil';
import { studioProjectSchema } from '../core/manifest/schema';
import { FIXTURE_SALT } from '../core/manifest/testFixtures';
import { parseManifestText } from '../core/manifest/validate';
import { computeProgress, missableAlerts } from '../core/progress';
import { redeem, satisfiedSealed } from '../core/redeem';
import type {
  Bytes,
  CodeGoal,
  DraftGoal,
  DraftSealed,
  RedeemCandidate,
  SealedItem,
  ShioriManifestV1,
  StudioProject,
} from '../core/types';
import amaotoShioriJson from './amaoto.shiori.json';
import amaotoProjectText from './amaoto.project.json?raw';
import amaotoShioriText from './amaoto.shiori.json?raw';
import { buildDemo, DEMO_NAMES, DEMO_RNG_POOL_BYTES, demoRng } from './demoBuild';
import type { DemoName } from './demoBuild';
import {
  DEMO_AMAOTO,
  DEMO_APP_CODES,
  DEMO_CODES,
  DEMO_HOSHIYOMI,
  DEMO_RETURN_CODE,
  DEMO_RETURN_CODE_NOTE,
} from './demoCodes';
import type { DemoCode } from './demoCodes';
import hoshiyomiShioriJson from './hoshiyomi.shiori.json';
import hoshiyomiProjectText from './hoshiyomi.project.json?raw';
import hoshiyomiShioriText from './hoshiyomi.shiori.json?raw';
import { getPcScene, isDoorCode, PC_BONUS, PC_SCENE_LIST, PC_SCENES, PC_START, PC_WORK_ID } from './pcScenes';
import type { PcScene } from './pcScenes';

// ───────────────────────── fixtures ─────────────────────────

interface Demo {
  name: DemoName;
  projectText: string;
  text: string;
  project: StudioProject;
}

const DEMOS: readonly Demo[] = [
  { name: 'hoshiyomi', projectText: hoshiyomiProjectText, text: hoshiyomiShioriText, project: JSON.parse(hoshiyomiProjectText) as StudioProject },
  { name: 'amaoto', projectText: amaotoProjectText, text: amaotoShioriText, project: JSON.parse(amaotoProjectText) as StudioProject },
];

function demo(name: DemoName): Demo {
  const d = DEMOS.find((x) => x.name === name);
  if (!d) throw new Error(`no demo ${name}`);
  return d;
}

/** The committed manifest after validation (throws with the issues if it does not validate). */
function manifestOf(name: DemoName): ShioriManifestV1 {
  const r = parseManifestText(demo(name).text);
  if (!r.ok) throw new Error(`${name}.shiori.json is invalid: ${JSON.stringify(r.errors)}`);
  return r.manifest;
}

function demoByWorkId(workId: string): Demo {
  const d = DEMOS.find((x) => x.project.work.id === workId);
  if (!d) throw new Error(`no demo with work.id ${workId}`);
  return d;
}

function candidates(): RedeemCandidate[] {
  return DEMOS.map((d) => ({ manifestKey: d.name, manifest: manifestOf(d.name) }));
}

function draftGoal(project: StudioProject, id: string): DraftGoal {
  const g = project.goals.find((x) => x.id === id);
  if (!g) throw new Error(`no draft goal ${id}`);
  return g;
}

function draftSealed(project: StudioProject, id: string): DraftSealed {
  const s = project.sealed.find((x) => x.id === id);
  if (!s) throw new Error(`no draft sealed ${id}`);
  return s;
}

function codeGoal(m: ShioriManifestV1, id: string): CodeGoal {
  const g = m.goals.find((x) => x.id === id);
  if (!g || g.unlock.type !== 'code') throw new Error(`no code goal ${id}`);
  return g as CodeGoal;
}

function sealedItem(m: ShioriManifestV1, id: string): SealedItem {
  const s = m.sealed.find((x) => x.id === id);
  if (!s) throw new Error(`no sealed item ${id}`);
  return s;
}

/** Every strict subset of xs (including the empty set). */
function strictSubsets<T>(xs: readonly T[]): T[][] {
  const out: T[][] = [];
  for (let mask = 0; mask < (1 << xs.length) - 1; mask++) out.push(xs.filter((_, i) => (mask & (1 << i)) !== 0));
  return out;
}

/** All string values (not keys) of a JSON-like value. */
function strings(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) for (const v of value) strings(v, out);
  else if (typeof value === 'object' && value !== null) for (const v of Object.values(value)) strings(v, out);
  return out;
}

/** All keys of a JSON-like value (recursively). */
function keys(value: unknown, out: string[] = []): string[] {
  if (Array.isArray(value)) for (const v of value) keys(v, out);
  else if (typeof value === 'object' && value !== null) {
    for (const [k, v] of Object.entries(value)) {
      out.push(k);
      keys(v, out);
    }
  }
  return out;
}

async function caught(p: Promise<unknown>): Promise<unknown> {
  return p.then(
    () => undefined,
    (e: unknown) => e,
  );
}

const STORE_CODE_LIKE = /(RJ|VJ|BJ)\s*\d{6}/i;
const JAPANESE = /[ぁ-んァ-ヶ一-龯]/;

/** Masters of the documented app codes, by `${workId}/${goalId}` (filled by redeeming DEMO_APP_CODES). */
const masters = new Map<string, Bytes>();

function masterFor(workId: string, goalId: string): Bytes {
  const m = masters.get(`${workId}/${goalId}`);
  if (!m) throw new Error(`no master for ${workId}/${goalId} (did the redeem test run?)`);
  return m;
}

function mastersFor(workId: string, goalIds: readonly string[]): Record<string, Uint8Array> {
  const out = Object.create(null) as Record<string, Uint8Array>;
  for (const g of goalIds) out[g] = masterFor(workId, g);
  return out;
}

beforeAll(async () => {
  // One redeem per documented app code against BOTH demo manifests (no work hint), exactly like the app.
  const all = candidates();
  for (const c of DEMO_APP_CODES) {
    const r = await redeem(c.display, all);
    if (r.status === 'matched') masters.set(`${c.workId}/${r.goalId}`, r.master);
  }
});

// ───────────────────────── project files ─────────────────────────

describe('demo project files', () => {
  it.each(DEMO_NAMES)('%s.project.json is a valid, lint-clean studio project', (name) => {
    const { project } = demo(name);
    const parsed = studioProjectSchema.safeParse(project);
    expect(parsed.success).toBe(true);
    expect(project.format).toBe('shiori-studio-project');
    expect(project.version).toBe(1);
    expect(project.id).toBe(`demo-project-${name}`);
    expect(project.appUrl).toBe('http://localhost:5173/');
    expect(project.kdfIterations).toBe(200_000);
    expect(Number.isInteger(project.createdAt)).toBe(true);
    expect(Number.isInteger(project.updatedAt)).toBe(true);
    expect(project.updatedAt).toBeGreaterThanOrEqual(project.createdAt);
    expect(project.lastExportedAt).toBeUndefined();
    expect(project.work.circle).toBe('サンプル工房（架空）');
    expect(project.authorName).toBe('サンプル工房（架空）');
    expect(project.work.version).toBe('1.0.0');
    // No errors and no warnings at all.
    expect(lintProject(project)).toEqual([]);
  });

  it('have fixed, distinct 16-byte salts (not the test-fixture salt)', () => {
    const salts = DEMOS.map((d) => d.project.kdfSalt);
    for (const s of salts) {
      expect(typeof s).toBe('string');
      expect(b64uDecode(s!).length).toBe(16);
      expect(s).not.toBe(FIXTURE_SALT);
    }
    expect(new Set(salts).size).toBe(salts.length);
  });

  it('contain no store code anywhere (F17 AC4)', () => {
    for (const d of DEMOS) {
      expect(keys(d.project)).not.toContain('storeCode');
      expect(keys(d.project)).not.toContain('storeLink');
      expect(d.projectText).not.toMatch(STORE_CODE_LIKE);
    }
  });

  it('mention no URL other than the local appUrl', () => {
    for (const d of DEMOS) {
      const urls = strings(d.project).filter((s) => /https?:\/\//i.test(s));
      expect(urls).toEqual(['http://localhost:5173/']);
    }
  });

  it('say that the content is fictional', () => {
    expect(draftSealed(demo('hoshiyomi').project, 'afterword').payload.body).toContain('架空');
    expect(draftSealed(demo('amaoto').project, 'profile').payload.body).toContain('架空');
  });
});

// ───────────────────────── committed manifests ─────────────────────────

describe('committed demo manifests', () => {
  it.each(DEMO_NAMES)('%s.shiori.json validates with no errors and no warnings', (name) => {
    const r = parseManifestText(demo(name).text);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.warnings).toEqual([]);
    // Already in the validated normal form (nothing stripped or defaulted).
    expect(r.manifest).toEqual(JSON.parse(demo(name).text));
  });

  it.each(DEMO_NAMES)('%s.shiori.json is pretty-printed JSON ending with a newline', (name) => {
    const { text } = demo(name);
    expect(text.endsWith('}\n')).toBe(true);
    expect(text).toBe(`${JSON.stringify(JSON.parse(text), null, 2)}\n`);
    expect(new TextEncoder().encode(text).length).toBeLessThan(64 * 1024);
  });

  it('JSON module imports (as the app bundles them) equal the committed text', () => {
    expect(hoshiyomiShioriJson).toEqual(JSON.parse(hoshiyomiShioriText));
    expect(amaotoShioriJson).toEqual(JSON.parse(amaotoShioriText));
  });

  it.each(DEMO_NAMES)('%s: work, author, kdf and structure match the project', (name) => {
    const { project } = demo(name);
    const m = manifestOf(name);
    expect(m.schema).toBe('shiori/1');
    expect(m.work).toEqual(project.work);
    expect(m.author).toEqual({ kind: 'creator', name: project.authorName });
    expect(m.kdf).toEqual({ alg: 'PBKDF2-SHA256', iterations: 200_000, salt: project.kdfSalt });
    expect(m.checkpoints).toEqual(project.checkpoints);
    expect(m.groups).toEqual(project.groups);
    expect(m.changelog).toEqual(project.changelog);
    expect(m.goals.map((g) => g.id)).toEqual(project.goals.map((g) => g.id));
    for (const g of m.goals) {
      const d = draftGoal(project, g.id);
      expect(g.label).toBe(d.label);
      expect(g.teaser).toBe(d.teaser);
      expect(g.spoiler).toBe(d.spoiler);
      expect(g.hints).toEqual(d.hints);
      expect(g.missable).toEqual(d.missable);
      expect(g.unlock.type).toBe(d.unlockType);
      if (g.unlock.type === 'code') expect(g.unlock.codeKind).toBe(d.codeKind);
    }
    expect(m.sealed.map((s) => [s.id, s.label, s.teaser, s.kind, s.unlock.mode])).toEqual(
      project.sealed.map((s) => [s.id, s.label, s.teaser, s.kind, s.mode]),
    );
    for (const s of m.sealed) expect([...s.unlock.goals].sort()).toEqual([...draftSealed(project, s.id).goals].sort());
  });

  it.each(DEMO_NAMES)('%s: contains no code, secret title, body or return code in plain text', (name) => {
    const { project, text } = demo(name);
    const secrets = collectSecrets(project);
    expect(secrets.length).toBeGreaterThan(5);
    expect(findLeaks(text, secrets)).toEqual([]);
    for (const c of DEMO_CODES.filter((x) => x.workId === project.work.id)) {
      expect(text).not.toContain(c.display);
      const parsed = parseCode(c.display);
      if (parsed.ok) expect(text).not.toContain(parsed.canonical.slice(parsed.canonical.indexOf(':') + 1));
    }
  });

  it('contain no store code anywhere (F17 AC4)', () => {
    for (const name of DEMO_NAMES) {
      const m = manifestOf(name);
      expect(m.work.storeCode).toBeUndefined();
      expect(keys(JSON.parse(demo(name).text))).not.toContain('storeCode');
      expect(demo(name).text).not.toMatch(STORE_CODE_LIKE);
    }
  });

  it('use unique lookup tags across both demos', () => {
    const tags = DEMO_NAMES.flatMap((n) =>
      manifestOf(n).goals.flatMap((g) => (g.unlock.type === 'code' ? [g.unlock.tag] : [])),
    );
    expect(tags).toHaveLength(6);
    expect(new Set(tags).size).toBe(6);
  });

  it.each(DEMO_NAMES)('%s: a fresh build of the project reproduces the committed file byte for byte', async (name) => {
    const { project, text } = demo(name);
    const { build, report, text: rebuilt } = await buildDemo(project);
    expect(report.checks.filter((c) => !c.ok)).toEqual([]);
    expect(report.ok).toBe(true);
    expect(build.salt).toBe(project.kdfSalt);
    expect(rebuilt).toBe(text);
    // The private code sheet agrees with the documented demo codes.
    const documented = DEMO_APP_CODES.filter((c) => c.workId === project.work.id);
    expect(build.codes.map((r) => [r.goalId, r.display, r.label]).sort()).toEqual(
      documented.map((c) => [c.goalId, c.display, c.goalLabel]).sort(),
    );
    for (const row of build.codes) {
      expect(row.unlockUrl.startsWith(`http://localhost:5173/#/u/${project.work.id}/`)).toBe(true);
    }
  });
});

// ───────────────────────── content of each demo ─────────────────────────

describe('星読みの図書館 (demo-hoshiyomi)', () => {
  const { project } = demo('hoshiyomi');

  it('has the documented work meta', () => {
    expect(project.work).toEqual({
      id: 'demo-hoshiyomi',
      title: '星読みの図書館',
      safeTitle: 'サンプルA',
      circle: 'サンプル工房（架空）',
      kind: 'game',
      engine: 'rpgmaker-mz',
      version: '1.0.0',
    });
  });

  it('has chapters 第1章–第4章 and 終章, and the groups エンディング and 実績', () => {
    const m = manifestOf('hoshiyomi');
    expect(m.checkpoints).toEqual([
      { id: 'ch1', label: '第1章' },
      { id: 'ch2', label: '第2章' },
      { id: 'ch3', label: '第3章' },
      { id: 'ch4', label: '第4章' },
      { id: 'epilogue', label: '終章' },
    ]);
    expect(m.groups).toEqual([
      { id: 'endings', label: 'エンディング' },
      { id: 'ach', label: '実績' },
    ]);
  });

  it('has 4 code-gated endings END 1..END 4 with 3 tiered hints, a teaser and spoiler 1–2', () => {
    const m = manifestOf('hoshiyomi');
    const endings = m.goals.filter((g) => g.group === 'endings');
    expect(endings.map((g) => [g.id, g.label])).toEqual([
      ['end-a', 'END 1'],
      ['end-b', 'END 2'],
      ['end-c', 'END 3'],
      ['end-true', 'END 4'],
    ]);
    for (const g of endings) {
      expect(g.unlock).toMatchObject({ type: 'code', codeKind: 'b32' });
      expect(g.hints).toHaveLength(3);
      expect(g.teaser).toBeTruthy();
      expect([1, 2]).toContain(g.spoiler);
      const secret = draftGoal(project, g.id).secret!;
      expect(secret.title).not.toBe(g.label);
      for (const h of g.hints) expect(h).not.toContain(secret.title);
    }
    expect(codeGoal(m, 'end-true').missable?.before).toBe('ch4');
  });

  it('has the 4 manual achievements; 星図を3枚集めた is missable before ch3', () => {
    const m = manifestOf('hoshiyomi');
    const ach = m.goals.filter((g) => g.group === 'ach');
    expect(ach.map((g) => g.label)).toEqual([
      '全ての書架を調べた',
      '図書館の猫と3回話した',
      '星図を3枚集めた',
      '閉館後に誰にも見つからずに第2章を終えた',
    ]);
    for (const g of ach) expect(g.unlock).toEqual({ type: 'manual' });
    expect(ach.find((g) => g.label === '星図を3枚集めた')?.missable?.before).toBe('ch3');
  });

  it('has the letter (anyOf), the afterword (allOf) and the return code (allOf [end-true])', () => {
    const m = manifestOf('hoshiyomi');
    const all = ['end-a', 'end-b', 'end-c', 'end-true'];
    const letter = sealedItem(m, 'letter-mina');
    expect(letter).toMatchObject({ label: '司書ミナからの手紙', kind: 'letter' });
    expect(letter.unlock.mode).toBe('anyOf');
    expect([...letter.unlock.goals].sort()).toEqual(all);
    if (letter.unlock.mode === 'anyOf') expect(letter.unlock.wraps.map((w) => w.goal).sort()).toEqual(all);
    const afterword = sealedItem(m, 'afterword');
    expect(afterword).toMatchObject({ label: 'あとがき', kind: 'afterword', unlock: { mode: 'allOf' } });
    expect([...afterword.unlock.goals].sort()).toEqual(all);
    const door = sealedItem(m, 'door-code');
    expect(door).toMatchObject({ label: '図書館の扉の合言葉', kind: 'returnCode', unlock: { mode: 'allOf', goals: ['end-true'] } });

    expect(draftSealed(project, 'letter-mina').payload.from).toBe('司書ミナより');
    expect(draftSealed(project, 'door-code').payload.returnCode).toEqual({
      code: 'ほしあかり',
      instruction: 'タイトル画面の「扉の合言葉」に入力してください',
    });
  });

  it('warns about missables by chapter (missableAlerts on the real demo)', () => {
    const m = manifestOf('hoshiyomi');
    const at = (cp?: string) => missableAlerts(m, [], cp).map((a) => [a.goalId, a.level]);
    expect(at()).toEqual([
      ['end-true', 'ahead'],
      ['ach-starmaps', 'ahead'],
    ]);
    expect(at('ch2')).toEqual([
      ['end-true', 'ahead'],
      ['ach-starmaps', 'soon'],
    ]);
    expect(at('ch3')).toEqual([['end-true', 'soon']]);
    expect(at('ch4')).toEqual([]);
    expect(computeProgress(m, []).total).toBe(8);
  });
});

describe('雨音と読書の時間 (demo-amaoto)', () => {
  const { project } = demo('amaoto');

  it('has the documented work meta (voice, no engine, no chapters)', () => {
    expect(project.work).toEqual({
      id: 'demo-amaoto',
      title: '雨音と読書の時間',
      safeTitle: 'サンプルB',
      circle: 'サンプル工房（架空）',
      kind: 'voice',
      version: '1.0.0',
    });
    expect(manifestOf('amaoto').checkpoints).toEqual([]);
  });

  it('has 6 manual track goals Track 1..6 and the bonus code goals', () => {
    const m = manifestOf('amaoto');
    expect(m.groups).toEqual([
      { id: 'tracks', label: 'トラック' },
      { id: 'bonus', label: 'おまけ' },
    ]);
    const tracks = m.goals.filter((g) => g.group === 'tracks');
    expect(tracks).toHaveLength(6);
    tracks.forEach((g, i) => {
      expect(g.id).toBe(`track-${i + 1}`);
      expect(g.label.startsWith(`Track ${i + 1} `)).toBe(true);
      expect(g.label.length).toBeGreaterThan(`Track ${i + 1} `.length);
      expect(g.unlock).toEqual({ type: 'manual' });
    });
    const bonus = m.goals.filter((g) => g.group === 'bonus');
    expect(bonus.map((g) => [g.id, g.unlock.type === 'code' ? g.unlock.codeKind : 'manual'])).toEqual([
      ['bonus-talk', 'kana'],
      ['script-page', 'b32'],
    ]);
    for (const g of bonus) expect(g.hints.length).toBeGreaterThan(0);
    expect(codeGoal(m, 'bonus-talk').teaser).toContain('Track 6');
    expect(codeGoal(m, 'script-page').teaser).toContain('台本');
    expect(computeProgress(m, []).total).toBe(8);
  });

  it('has the after-talk story (allOf [bonus-talk]) and the profile (allOf [script-page])', () => {
    const m = manifestOf('amaoto');
    expect(sealedItem(m, 'after-talk')).toMatchObject({
      label: 'アフタートーク（文字版）',
      kind: 'story',
      unlock: { mode: 'allOf', goals: ['bonus-talk'] },
    });
    expect(sealedItem(m, 'profile')).toMatchObject({
      label: '登場人物紹介',
      kind: 'profile',
      unlock: { mode: 'allOf', goals: ['script-page'] },
    });
  });
});

// ───────────────────────── redemption and decryption ─────────────────────────

describe('documented demo codes', () => {
  it.each(DEMO_APP_CODES.map((c) => [c.display, c] as const))('%s redeems to its goal', (_display, c) => {
    expect(c.goalId).toBeDefined();
    expect(masters.has(`${c.workId}/${c.goalId!}`)).toBe(true);
  });

  it('redeem to the right goal in the right manifest, with or without a work hint', async () => {
    const all = candidates();
    for (const c of DEMO_APP_CODES) {
      const other = c.workId === DEMO_HOSHIYOMI.workId ? DEMO_AMAOTO.workId : DEMO_HOSHIYOMI.workId;
      for (const preferWorkId of [undefined, c.workId, other]) {
        const r = await redeem(c.display, all, preferWorkId === undefined ? {} : { preferWorkId });
        expect(r.status, `${c.display} prefer=${preferWorkId}`).toBe('matched');
        if (r.status !== 'matched') continue;
        expect(r.goalId).toBe(c.goalId);
        expect(r.manifestKey).toBe(demoByWorkId(c.workId).name);
      }
    }
  });

  it('are accepted in the forms players type them', async () => {
    const all = candidates();
    const variants: [string, string][] = [
      ['st4rmap1x', 'end-a'],
      ['ＳＴ４－ＲＭＡ－Ｐ１Ｘ', 'end-a'],
      ['MOO NDE SKR', 'end-b'], // O → 0
      ['ホタル・カエデ・ツバメ・コダマ・スズメ', 'bonus-talk'],
      ['ほたるかえでつばめこだますずめ', 'bonus-talk'],
      ['ama-oto-nij', 'script-page'], // o → 0, i → 1
    ];
    for (const [input, goalId] of variants) {
      const r = await redeem(input, all);
      expect(r.status, input).toBe('matched');
      if (r.status === 'matched') expect(r.goalId, input).toBe(goalId);
    }
  });

  it('do not open the other demo', async () => {
    for (const c of DEMO_APP_CODES) {
      const otherOnly = candidates().filter((x) => x.manifest.work.id !== c.workId);
      const r = await redeem(c.display, otherOnly);
      expect(r.status, c.display).toBe('noMatch');
    }
  });

  it('reject a one-character typo before any KDF runs', async () => {
    let derived = 0;
    const r = await redeem('ST4-RMA-P1Y', candidates(), {
      derive: async () => {
        derived++;
        return new Uint8Array(32) as Bytes;
      },
    });
    expect(r).toEqual({ status: 'invalid', error: { kind: 'checksum' } });
    expect(derived).toBe(0);
  });

  it('the return code ほしあかり is not an app code (format error, no KDF)', async () => {
    let derived = 0;
    const r = await redeem(DEMO_RETURN_CODE, candidates(), {
      derive: async () => {
        derived++;
        return new Uint8Array(32) as Bytes;
      },
    });
    expect(r.status).toBe('invalid');
    expect(derived).toBe(0);
  });

  it('decrypt every goal secret back to the project plaintext', async () => {
    for (const c of DEMO_APP_CODES) {
      const d = demoByWorkId(c.workId);
      const m = manifestOf(d.name);
      const g = codeGoal(m, c.goalId!);
      const secret = await openGoalSecret(masterFor(c.workId, g.id), m.kdf!, m.work.id, g.id, g.secret);
      expect(secret).toEqual(draftGoal(d.project, g.id).secret);
    }
  });
});

describe('sealed extras open with their documented codes', () => {
  const items = DEMOS.flatMap((d) => d.project.sealed.map((s) => [d.name, s.id] as const));

  it.each(items)('%s / %s opens with all its codes and reproduces the project payload', async (name, id) => {
    const d = demo(name);
    const m = manifestOf(name);
    const item = sealedItem(m, id);
    const documented = DEMO_APP_CODES.filter((c) => c.workId === m.work.id && item.unlock.goals.includes(c.goalId!));
    expect(documented.map((c) => c.goalId).sort()).toEqual([...item.unlock.goals].sort());
    const payload = await openItem({ workId: m.work.id, kdf: m.kdf!, item, masters: mastersFor(m.work.id, item.unlock.goals) });
    expect(payload).toEqual(draftSealed(d.project, id).payload);
  });

  it.each(items.filter(([name, id]) => sealedItem(manifestOf(name), id).unlock.mode === 'allOf'))(
    '%s / %s (allOf) stays closed with any strict subset of its codes',
    async (name, id) => {
      const m = manifestOf(name);
      const item = sealedItem(m, id);
      const subsets = strictSubsets(item.unlock.goals);
      expect(subsets.length).toBe(2 ** item.unlock.goals.length - 1);
      for (const subset of subsets) {
        const payload = await openItem({ workId: m.work.id, kdf: m.kdf!, item, masters: mastersFor(m.work.id, subset) });
        expect(payload, subset.join('+') || '(none)').toBeNull();
      }
      // Every other code of the work together still does not open it.
      const others = DEMO_APP_CODES.filter((c) => c.workId === m.work.id && !item.unlock.goals.includes(c.goalId!));
      const payload = await openItem({
        workId: m.work.id,
        kdf: m.kdf!,
        item,
        masters: mastersFor(m.work.id, others.map((c) => c.goalId!)),
      });
      expect(payload).toBeNull();
    },
  );

  it('an allOf item fails with a wrong code in place of a right one', async () => {
    const m = manifestOf('hoshiyomi');
    const item = sealedItem(m, 'afterword');
    const wrong = mastersFor(m.work.id, item.unlock.goals);
    wrong['end-true'] = masterFor(m.work.id, 'end-a');
    const e = await caught(openItem({ workId: m.work.id, kdf: m.kdf!, item, masters: wrong }));
    expect(e).toBeInstanceOf(ShioriError);
    expect((e as ShioriError).code).toBe('decrypt');
  });

  it('the anyOf letter opens with each single ending, and not without one', async () => {
    const d = demo('hoshiyomi');
    const m = manifestOf('hoshiyomi');
    const item = sealedItem(m, 'letter-mina');
    const expected = draftSealed(d.project, 'letter-mina').payload;
    for (const g of item.unlock.goals) {
      const payload = await openItem({ workId: m.work.id, kdf: m.kdf!, item, masters: mastersFor(m.work.id, [g]) });
      expect(payload, g).toEqual(expected);
    }
    expect(await openItem({ workId: m.work.id, kdf: m.kdf!, item, masters: {} })).toBeNull();
    // A master under the wrong goal id is rejected, not silently accepted.
    const e = await caught(
      openItem({ workId: m.work.id, kdf: m.kdf!, item, masters: { 'end-a': masterFor(m.work.id, 'end-b') } }),
    );
    expect(e).toBeInstanceOf(ShioriError);
  });

  it('satisfiedSealed follows the documented conditions', () => {
    const m = manifestOf('hoshiyomi');
    const ids = (goals: string[]) => satisfiedSealed(m, goals).map((s) => s.id);
    expect(ids([])).toEqual([]);
    expect(ids(['end-a'])).toEqual(['letter-mina']);
    expect(ids(['end-true'])).toEqual(['letter-mina', 'door-code']);
    expect(ids(['end-a', 'end-b', 'end-c'])).toEqual(['letter-mina']);
    expect(ids(['end-a', 'end-b', 'end-c', 'end-true'])).toEqual(['letter-mina', 'afterword', 'door-code']);
    const a = manifestOf('amaoto');
    expect(satisfiedSealed(a, ['bonus-talk']).map((s) => s.id)).toEqual(['after-talk']);
    expect(satisfiedSealed(a, ['script-page']).map((s) => s.id)).toEqual(['profile']);
  });
});

// ───────────────────────── DEMO_CODES ─────────────────────────

describe('DEMO_CODES', () => {
  it('lists all 7 demo codes: the 6 app codes and the return code last', () => {
    expect(DEMO_CODES).toHaveLength(7);
    expect(DEMO_APP_CODES).toHaveLength(6);
    expect(DEMO_CODES.map((c) => c.display)).toEqual([
      'ST4-RMA-P1X',
      'M00-NDE-SKR',
      'NEK-0T0-M0E',
      'SK1-ES0-NGM',
      'ほたる・かえで・つばめ・こだま・すずめ',
      'AMA-0T0-N1J',
      'ほしあかり',
    ]);
    const last = DEMO_CODES[DEMO_CODES.length - 1]!;
    expect(last.kind).toBe('return');
    expect(last.goalId).toBeUndefined();
    expect(DEMO_CODES.filter((c) => c.kind === 'return')).toEqual([last]);
  });

  it('matches every code goal of the project files exactly once', () => {
    for (const d of DEMOS) {
      const codeGoals = d.project.goals.filter((g) => g.unlockType === 'code');
      const listed = DEMO_APP_CODES.filter((c) => c.workId === d.project.work.id);
      expect(listed.map((c) => c.goalId).sort()).toEqual(codeGoals.map((g) => g.id).sort());
      for (const c of listed) {
        const g = draftGoal(d.project, c.goalId!);
        expect(c.display).toBe(g.code);
        expect(c.goalLabel).toBe(g.label);
        expect(c.kind).toBe(g.codeKind);
        expect(c.workTitle).toBe(d.project.work.title);
        expect(c.alias).toBe(d.project.work.safeTitle);
      }
    }
  });

  it('uses canonical display forms', () => {
    for (const c of DEMO_APP_CODES) {
      const parsed = parseCode(c.display);
      expect(parsed.ok, c.display).toBe(true);
      if (parsed.ok) {
        expect(parsed.display).toBe(c.display);
        expect(parsed.kind).toBe(c.kind);
      }
    }
  });

  it('documents the return code as the END 4 extra, typed into the simulator', () => {
    const d = demo('hoshiyomi');
    const door = draftSealed(d.project, 'door-code');
    const entry = DEMO_CODES.find((c) => c.kind === 'return') as DemoCode;
    expect(DEMO_RETURN_CODE).toBe('ほしあかり');
    expect(entry.display).toBe(DEMO_RETURN_CODE);
    expect(door.payload.returnCode?.code).toBe(DEMO_RETURN_CODE);
    expect(entry.goalLabel).toBe(door.label);
    expect(entry.workId).toBe(d.project.work.id);
    expect(entry.workTitle).toBe(d.project.work.title);
    expect(entry.alias).toBe(d.project.work.safeTitle);
    expect(entry.where).toContain('シミュレータ');
    expect(DEMO_RETURN_CODE_NOTE).toContain(DEMO_RETURN_CODE);
    expect(DEMO_RETURN_CODE_NOTE).toContain('扉の合言葉');
  });

  it('has a Japanese "where" for every entry and matches the demo work constants', () => {
    for (const c of DEMO_CODES) {
      expect(c.where, c.display).toMatch(JAPANESE);
      expect(c.where).not.toMatch(/https?:\/\//);
    }
    expect(DEMO_HOSHIYOMI).toEqual({
      workId: demo('hoshiyomi').project.work.id,
      title: demo('hoshiyomi').project.work.title,
      alias: demo('hoshiyomi').project.work.safeTitle,
    });
    expect(DEMO_AMAOTO).toEqual({
      workId: demo('amaoto').project.work.id,
      title: demo('amaoto').project.work.title,
      alias: demo('amaoto').project.work.safeTitle,
    });
  });
});

// ───────────────────────── PC画面シミュレータ ─────────────────────────

/** Scene ids reachable from `start` (choices and, optionally, the door input). */
function reachable(start: string, opts: { door: boolean }): Set<string> {
  const seen = new Set<string>();
  const queue = [start];
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const s = getPcScene(id);
    if (!s) continue;
    for (const c of s.choices ?? []) queue.push(c.next);
    if (opts.door && s.doorInput) queue.push(s.doorInput.next);
  }
  return seen;
}

function endingScenes(): PcScene[] {
  return PC_SCENE_LIST.filter((s) => s.ending !== undefined);
}

describe('PC_SCENES', () => {
  it('is keyed by scene id, with unique ids', () => {
    expect(Object.keys(PC_SCENES)).toHaveLength(PC_SCENE_LIST.length);
    for (const [id, s] of Object.entries(PC_SCENES)) expect(s.id).toBe(id);
    expect(getPcScene(PC_START)).toBe(PC_SCENES[PC_START]);
    expect(getPcScene('constructor')).toBeUndefined();
    expect(getPcScene('nope')).toBeUndefined();
  });

  it('every choice (and the door input) points to an existing scene', () => {
    for (const s of PC_SCENE_LIST) {
      for (const c of s.choices ?? []) {
        expect(getPcScene(c.next), `${s.id} → ${c.next}`).toBeDefined();
        expect(c.label.trim()).not.toBe('');
      }
      if (s.doorInput) expect(getPcScene(s.doorInput.next)).toBeDefined();
    }
  });

  it('every scene has text and a way forward (no dead ends)', () => {
    for (const s of PC_SCENE_LIST) {
      expect(s.lines.length, s.id).toBeGreaterThan(0);
      for (const line of s.lines) expect(line.trim(), s.id).not.toBe('');
      expect((s.choices?.length ?? 0) + (s.doorInput ? 1 : 0), s.id).toBeGreaterThan(0);
    }
  });

  it('every scene is reachable from the title screen', () => {
    expect(PC_START).toBe('title');
    expect([...reachable(PC_START, { door: true })].sort()).toEqual(PC_SCENE_LIST.map((s) => s.id).sort());
  });

  it('all 4 endings are reachable from PC_START by choices alone, and each leads back to the title', () => {
    const fromStart = reachable(PC_START, { door: false });
    const endings = endingScenes();
    expect(endings.map((s) => s.ending!.goalId).sort()).toEqual(['end-a', 'end-b', 'end-c', 'end-true']);
    for (const s of endings) {
      expect(fromStart.has(s.id), s.id).toBe(true);
      expect(s.choices?.map((c) => c.next)).toContain(PC_START);
    }
  });

  it('ending screens show the documented demo codes and public labels', () => {
    const m = manifestOf('hoshiyomi');
    expect(PC_WORK_ID).toBe(m.work.id);
    for (const s of endingScenes()) {
      const e = s.ending!;
      const documented = DEMO_CODES.find((c) => c.workId === PC_WORK_ID && c.goalId === e.goalId);
      expect(documented, e.goalId).toBeDefined();
      expect(e.display).toBe(documented!.display);
      expect(e.label).toBe(codeGoal(m, e.goalId).label);
      expect(e.label).toBe(documented!.goalLabel);
    }
  });

  it('ending codes redeem to the ending goal', async () => {
    const all = candidates();
    for (const s of endingScenes()) {
      const r = await redeem(s.ending!.display, all, { preferWorkId: PC_WORK_ID });
      expect(r.status).toBe('matched');
      if (r.status === 'matched') expect(r.goalId).toBe(s.ending!.goalId);
    }
  });

  it('the title screen offers 「扉の合言葉」, which opens the bonus scene', () => {
    const title = getPcScene(PC_START)!;
    expect(title.doorInput?.label).toBe('扉の合言葉');
    expect(title.doorInput?.next).toBe(PC_BONUS);
    expect(title.doorInput?.wrongMessage).toMatch(JAPANESE);
    expect(getPcScene(PC_BONUS)?.ending).toBeUndefined();
    // Only the title screen has the field, and the bonus scene is reachable only through it.
    expect(PC_SCENE_LIST.filter((s) => s.doorInput).map((s) => s.id)).toEqual([PC_START]);
    expect(reachable(PC_START, { door: false }).has(PC_BONUS)).toBe(false);
  });

  it('isDoorCode accepts ほしあかり in the usual input forms only', () => {
    for (const ok of ['ほしあかり', 'ホシアカリ', 'ﾎｼｱｶﾘ', ' ほしあかり ', 'ほし あかり', 'ほし・あかり', 'ほしあかり。']) {
      expect(isDoorCode(ok), ok).toBe(true);
    }
    for (const ng of ['', 'ほしあかる', 'ほしあかりほし', 'hoshiakari', 'ほしあかり1', 'ぼしあかり']) {
      expect(isDoorCode(ng), ng).toBe(false);
    }
  });

  it('contains no URL and no store code', () => {
    const text = JSON.stringify(PC_SCENE_LIST);
    expect(text).not.toMatch(/https?:\/\//);
    expect(text).not.toMatch(STORE_CODE_LIKE);
    expect(JSON.stringify(DEMO_CODES)).not.toMatch(STORE_CODE_LIKE);
  });
});

// ───────────────────────── deterministic demo build ─────────────────────────

describe('demoRng / buildDemo', () => {
  const base = demo('amaoto').project;

  it('gives the same stream for the same project and a different one after any change', async () => {
    const a = await demoRng(base);
    const b = await demoRng(JSON.parse(JSON.stringify(base)) as StudioProject);
    const c = await demoRng({ ...base, updatedAt: base.updatedAt + 1 });
    const x = a(12);
    expect(x).toHaveLength(12);
    expect(b(12)).toEqual(x);
    expect(c(12)).not.toEqual(x);
    // Consecutive draws continue the stream.
    expect(a(12)).not.toEqual(x);
  });

  it('refuses to draw past the pool', async () => {
    const r = await demoRng(base, 64);
    expect(r(0)).toHaveLength(0);
    expect(r(60)).toHaveLength(60);
    expect(() => r(5)).toThrow(ShioriError);
    expect(() => r(-1)).toThrow(ShioriError);
    expect(() => r(1.5)).toThrow(ShioriError);
    expect(DEMO_RNG_POOL_BYTES).toBeGreaterThanOrEqual(1024);
  });

  it('requires a fixed kdfSalt', async () => {
    const { kdfSalt: _salt, ...withoutSalt } = base;
    const e = await caught(buildDemo(withoutSalt as StudioProject));
    expect(e).toBeInstanceOf(ShioriError);
    expect((e as ShioriError).code).toBe('validation');
  });
});
