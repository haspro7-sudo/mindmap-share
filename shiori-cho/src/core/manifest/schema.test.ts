import { describe, it, expect } from 'vitest';
import { b64uEncode } from '../encoding';
import type { StudioProject } from '../types';
import { zodIssuesToValidationIssues } from './messagesJa';
import { goalSchema, manifestSchema, studioProjectSchema } from './schema';

const bin = (n: number, fill = 3) => b64uEncode(new Uint8Array(n).fill(fill));

function project(): StudioProject {
  return {
    format: 'shiori-studio-project',
    version: 1,
    id: '6f1c1d1e-0000-4000-8000-000000000001',
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_100_000,
    appUrl: 'https://example.github.io/shiori-cho/',
    work: { id: 'w-abcdefghjk', title: '星読みの図書館', safeTitle: 'サンプルA', kind: 'game', engine: 'rpgmaker-mz', version: '1.0.0' },
    authorName: 'サンプル工房（架空）',
    kdfIterations: 200_000,
    kdfSalt: bin(16),
    checkpoints: [{ id: 'ch1', label: '第1章' }],
    groups: [{ id: 'endings', label: 'エンディング' }],
    goals: [
      {
        id: 'end-a',
        group: 'endings',
        label: 'END 1',
        spoiler: 1,
        hints: ['夜の図書館へ'],
        unlockType: 'code',
        codeKind: 'b32',
        code: 'K7Q-M2X-RAP',
        secret: { title: '星図の果て', description: '一行目\n二行目', unlockMessage: 'おめでとう' },
      },
      { id: 'ach-cat', group: 'endings', label: '猫と話した', spoiler: 0, hints: [], unlockType: 'manual' },
    ],
    sealed: [
      {
        id: 'afterword',
        label: 'あとがき',
        kind: 'returnCode',
        mode: 'allOf',
        goals: ['end-a'],
        payload: {
          title: '図書館の扉',
          body: '本文\n二行目',
          from: '司書ミナより',
          returnCode: { code: 'ほしあかり', instruction: 'タイトル画面で入力してください' },
        },
      },
    ],
    changelog: [{ version: '1.0.0', date: '2026-10-01', notes: '初版' }],
  };
}

function paths(r: ReturnType<typeof studioProjectSchema.safeParse>): Array<[string, string]> {
  if (r.success) return [];
  return zodIssuesToValidationIssues(r.error.issues).map((i) => [i.path, i.code]);
}

describe('studioProjectSchema', () => {
  it('accepts a complete project unchanged', () => {
    const r = studioProjectSchema.safeParse(project());
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toEqual(project());
  });

  it('is lenient with incomplete drafts', () => {
    const p: any = project();
    p.work.title = '';
    p.work.id = '';
    p.groups.push({ id: '', label: '' });
    p.goals.push({ id: 'draft', group: '', label: '', hints: [''], unlockType: 'code' }); // no code/secret yet
    delete p.kdfSalt;
    delete p.kdfIterations;
    delete p.checkpoints;
    delete p.changelog;
    const r = studioProjectSchema.safeParse(p);
    expect(r.success, JSON.stringify(paths(r))).toBe(true);
    if (!r.success) return;
    expect(r.data.kdfIterations).toBe(200_000);
    expect(r.data.checkpoints).toEqual([]);
    expect(r.data.changelog).toEqual([]);
    expect(r.data.goals[2]).toEqual({ id: 'draft', group: '', label: '', spoiler: 0, hints: [''], unlockType: 'code' });
  });

  it('accepts every intermediate editor state of secrets, payloads and hints (F16 AC7 round trip)', () => {
    const p: any = project();
    p.goals[0].secret = { title: '', description: '説明だけ先に書いた' };
    p.goals[0].hints = ['一行目\n二行目'];
    p.goals[1].secret = { title: '', description: '手動に切り替える前の残り' };
    p.sealed[0].payload = {
      title: '',
      body: '',
      returnCode: { code: 'ひみつ', instruction: '' },
      storeLink: { storeCode: 'rj01234567', caption: '' },
    };
    p.sealed.push({ ...p.sealed[0], id: 'x2', payload: { title: 't', body: '', returnCode: { code: '', instruction: '案内' }, storeLink: { storeCode: '', caption: '次回作' } } });
    const r = studioProjectSchema.safeParse(p);
    expect(r.success, JSON.stringify(paths(r))).toBe(true);
    if (r.success) expect(r.data).toEqual(p);
  });

  it('strips unknown keys', () => {
    const p: any = project();
    p.extra = 1;
    p.goals[0].secret.extra = 1;
    p.sealed[0].payload.extra = 1;
    const r = studioProjectSchema.safeParse(p);
    expect(r.success).toBe(true);
    if (r.success) expect(JSON.stringify(r.data)).not.toContain('extra');
  });

  it('rejects wrong formats, enums and limits', () => {
    const cases: Array<[(p: any) => void, string, string]> = [
      [(p) => (p.format = 'shiori-backup'), 'format', 'invalidValue'],
      [(p) => (p.version = 2), 'version', 'invalidValue'],
      [(p) => (p.work.kind = 'movie'), 'work.kind', 'invalidValue'],
      [(p) => (p.goals[0].unlockType = 'auto'), 'goals[0].unlockType', 'invalidValue'],
      [(p) => (p.goals[0].codeKind = 'hex'), 'goals[0].codeKind', 'invalidValue'],
      [(p) => (p.goals[0].secret.title = 'あ'.repeat(61)), 'goals[0].secret.title', 'tooLong'],
      [(p) => (p.goals[0].label = 'あ'.repeat(61)), 'goals[0].label', 'tooLong'],
      [(p) => (p.goals[0].hints = ['a', 'b', 'c', 'd']), 'goals[0].hints', 'tooMany'],
      [(p) => (p.sealed[0].mode = 'someOf'), 'sealed[0].mode', 'invalidValue'],
      [(p) => (p.sealed[0].payload.body = 'a\u202Eb'), 'sealed[0].payload.body', 'bidiChar'],
      [(p) => (p.sealed[0].payload.storeLink = { storeCode: 'R'.repeat(21), caption: '次回作' }), 'sealed[0].payload.storeLink.storeCode', 'tooLong'],
      [(p) => (p.goals[0].hints = ['a\tb']), 'goals[0].hints[0]', 'controlChar'],
      [(p) => (p.goals[0].hints = ['a'.repeat(201)]), 'goals[0].hints[0]', 'tooLong'],
      [(p) => (p.kdfSalt = bin(8)), 'kdfSalt', 'saltLength'],
      [(p) => (p.kdfIterations = 1.5), 'kdfIterations', 'invalidType'],
      [(p) => (p.createdAt = -1), 'createdAt', 'tooSmall'],
      [(p) => delete p.appUrl, 'appUrl', 'required'],
      [(p) => delete p.sealed[0].payload, 'sealed[0].payload', 'required'],
    ];
    for (const [mutate, path, code] of cases) {
      const p = structuredClone(project());
      mutate(p);
      const r = studioProjectSchema.safeParse(p, { reportInput: true });
      expect(r.success, path).toBe(false);
      expect(paths(r), path).toContainEqual([path, code]);
    }
  });
});

describe('goalSchema', () => {
  const base = { id: 'g', group: 'grp', label: 'ラベル' };

  it('produces a CodeGoal with a stripped secret', () => {
    const r = goalSchema.safeParse({
      ...base,
      unlock: { type: 'code', codeKind: 'kana', tag: bin(16), x: 1 },
      secret: { iv: bin(12), ct: bin(16), x: 1 },
      x: 1,
    });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data).toEqual({
      ...base,
      spoiler: 0,
      hints: [],
      unlock: { type: 'code', codeKind: 'kana', tag: bin(16) },
      secret: { iv: bin(12), ct: bin(16) },
    });
    expect(Object.keys(r.data)).toEqual(['id', 'group', 'label', 'spoiler', 'hints', 'unlock', 'secret']);
  });

  it('produces a ManualGoal without secret and keeps optional fields in order', () => {
    const r = goalSchema.safeParse({
      ...base,
      teaser: 'ヒント',
      missable: { before: 'ch1', warn: '注意' },
      unlock: { type: 'manual' },
      secret: { iv: 1 },
    });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data).not.toHaveProperty('secret');
    expect(Object.keys(r.data)).toEqual(['id', 'group', 'label', 'teaser', 'spoiler', 'hints', 'missable', 'unlock']);
  });
});

describe('manifestSchema', () => {
  it('parses a minimal manifest into the typed shape', () => {
    const r = manifestSchema.safeParse({
      schema: 'shiori/1',
      work: { id: 'abcd', title: 't', kind: 'other', version: '1' },
      author: { kind: 'player' },
      groups: [{ id: 'g', label: 'G' }],
      goals: [],
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(Object.keys(r.data)).toEqual(['schema', 'work', 'author', 'checkpoints', 'groups', 'goals', 'sealed', 'changelog']);
    }
  });
});
