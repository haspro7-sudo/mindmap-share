import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import type { ValidationIssue } from '../types';
import { CUSTOM_CODES, customMessageJa, formatPath, zodIssuesToValidationIssues } from './messagesJa';
import { text } from './payloadSchemas';
import { DATE_RE, ID_RE, VERSION_RE, WORK_ID_RE } from './schema';

const JAPANESE = /[ぁ-んァ-ヶー一-龠]/;
const ENGLISH_ZOD = /Invalid|expected|received|Too (big|small)/;

function issuesOf(schema: z.ZodType, input: unknown, reportInput = true): ValidationIssue[] {
  const r = schema.safeParse(input, { reportInput });
  if (r.success) throw new Error('expected failure');
  return zodIssuesToValidationIssues(r.error.issues);
}

function one(schema: z.ZodType, input: unknown, reportInput = true): ValidationIssue {
  const issues = issuesOf(schema, input, reportInput);
  expect(issues).toHaveLength(1);
  return issues[0]!;
}

describe('formatPath', () => {
  it.each([
    [[], ''],
    [['work'], 'work'],
    [['work', 'title'], 'work.title'],
    [['goals', 3, 'hints', 1], 'goals[3].hints[1]'],
    [['sealed', 0, 'unlock', 'wraps', 2, 'ct'], 'sealed[0].unlock.wraps[2].ct'],
    [[0], '[0]'],
    [[0, 'id'], '[0].id'],
    [['goals', '3'], 'goals[3]'],
    [['a-b', 'c d'], '["a-b"]["c d"]'],
  ] as Array<[PropertyKey[], string]>)('%j → %s', (path, expected) => {
    expect(formatPath(path)).toBe(expected);
  });

  it('formats symbols', () => {
    expect(formatPath(['x', Symbol('s')])).toBe('x[Symbol(s)]');
  });
});

describe('customMessageJa', () => {
  const REQUIRED_CODES = [
    'notShiori',
    'schemaVersion',
    'tooLarge',
    'json',
    'duplicateId',
    'duplicateRef',
    'duplicateTag',
    'danglingGroup',
    'danglingCheckpoint',
    'danglingGoal',
    'sealedRefersManual',
    'wrapsMismatch',
    'emptyGroup',
    'kdfMissing',
    'kdfUnused',
    'kdfIterations',
    'kdfIterationsLow',
    'invalidBase64',
    'saltLength',
    'ivLength',
    'tagLength',
    'ctLength',
    'wrapLength',
    'controlChar',
    'bidiChar',
    'required',
    'invalid',
  ];

  it('knows every cross-check and binary code', () => {
    for (const code of REQUIRED_CODES) expect(CUSTOM_CODES, code).toContain(code);
  });

  it.each(CUSTOM_CODES.map((c) => [c]))('%s gives a Japanese message with and without params', (code) => {
    for (const params of [undefined, { id: 'end-a', label: 'エンディング', actual: 11, line: 3, column: 5 }]) {
      const msg = customMessageJa(code, params);
      expect(msg).toMatch(JAPANESE);
      expect(msg).not.toContain('undefined');
      expect(msg).not.toMatch(ENGLISH_ZOD);
    }
  });

  it('uses the spec wording', () => {
    expect(customMessageJa('schemaVersion')).toBe('新しいバージョンのしおり帳が必要です');
    expect(customMessageJa('notShiori')).toBe('しおりファイルではないようです');
    expect(customMessageJa('tooLarge')).toBe('ファイルが大きすぎます（512KBまで）');
    expect(customMessageJa('json', { line: 3, column: 14 })).toBe('JSONの形式が正しくありません（3行目 14文字目付近）');
    expect(customMessageJa('json')).toBe('JSONの形式が正しくありません');
    expect(customMessageJa('json', { reason: 'end' })).toBe('JSONの形式が正しくありません（途中で終わっているようです）');
    expect(customMessageJa('json', { reason: 'empty' })).toBe('JSONの形式が正しくありません（内容が空です）');
  });

  it('interpolates params', () => {
    expect(customMessageJa('duplicateId', { id: 'end-a' })).toBe('ID「end-a」が重複しています');
    expect(customMessageJa('danglingGroup', { id: 'ach' })).toBe('グループ「ach」が見つかりません');
    expect(customMessageJa('danglingCheckpoint', { id: 'ch9' })).toBe('章「ch9」が見つかりません');
    expect(customMessageJa('danglingGoal', { id: 'x' })).toBe('目標「x」が見つかりません');
    expect(customMessageJa('sealedRefersManual', { id: 'ach-cat' })).toContain('ach-cat');
    expect(customMessageJa('emptyGroup', { id: 'g', label: '実績' })).toBe('グループ「実績」に目標がありません');
    expect(customMessageJa('emptyGroup', { id: 'g' })).toBe('グループ「g」に目標がありません');
    expect(customMessageJa('ivLength', { actual: 11 })).toBe('IVは12バイトにしてください（現在11バイト）');
    expect(customMessageJa('ctLength', { actual: 70000 })).toBe('暗号文は16〜65,552バイトにしてください（現在70,000バイト）');
    expect(customMessageJa('kdfIterations')).toBe('反復回数は100,000〜2,000,000の整数にしてください');
    expect(customMessageJa('kdfIterationsLow')).toBe('反復回数が150,000未満です（200,000以上をおすすめします）');
  });

  it('falls back to a generic Japanese message for unknown codes', () => {
    expect(customMessageJa('nope')).toBe('値が正しくありません');
    expect(customMessageJa('toString')).toBe('値が正しくありません');
    expect(customMessageJa('__proto__')).toBe('値が正しくありません');
  });
});

describe('zodIssuesToValidationIssues', () => {
  it('maps string length issues', () => {
    expect(one(z.object({ t: text(1, 60) }), { t: 'あ'.repeat(61) })).toEqual({
      path: 't',
      code: 'tooLong',
      messageJa: '60文字以内にしてください',
      severity: 'error',
    });
    expect(one(text(1, 60), '')).toMatchObject({ code: 'tooShort', messageJa: '空にはできません' });
    expect(one(z.string().min(3), 'ab')).toMatchObject({ code: 'tooShort', messageJa: '3文字以上にしてください' });
    expect(one(z.string().length(4), 'ab')).toMatchObject({ code: 'tooShort', messageJa: '4文字にしてください' });
    expect(one(z.string().max(20000), 'a'.repeat(20001))).toMatchObject({ messageJa: '20,000文字以内にしてください' });
  });

  it('maps array size issues', () => {
    expect(one(z.array(z.string()).max(3), ['a', 'b', 'c', 'd'])).toMatchObject({ code: 'tooMany', messageJa: '3個までにしてください' });
    expect(one(z.array(z.string()).min(1), [])).toMatchObject({ code: 'tooFew', messageJa: '1つ以上必要です' });
    expect(one(z.array(z.string()).min(2), ['a'])).toMatchObject({ code: 'tooFew', messageJa: '2個以上必要です' });
    expect(one(z.array(z.string()).length(2), ['a'])).toMatchObject({ code: 'tooFew', messageJa: '2個にしてください' });
  });

  it('maps number range issues', () => {
    expect(one(z.number().max(10), 11)).toMatchObject({ code: 'tooBig', messageJa: '10以下にしてください' });
    expect(one(z.number().lt(10), 10)).toMatchObject({ code: 'tooBig', messageJa: '10未満にしてください' });
    expect(one(z.number().min(100000), 5)).toMatchObject({ code: 'tooSmall', messageJa: '100,000以上にしてください' });
    expect(one(z.number().gt(0), 0)).toMatchObject({ code: 'tooSmall', messageJa: '0より大きくしてください' });
    expect(one(z.number().multipleOf(5), 7)).toMatchObject({ code: 'invalidNumber', messageJa: '5の倍数にしてください' });
  });

  it('distinguishes missing values from wrong types', () => {
    const schema = z.object({ a: z.string(), n: z.number().int(), b: z.boolean(), o: z.object({}), l: z.array(z.string()) });
    const withInput = issuesOf(schema, { n: 1.5, b: 'yes', o: [], l: 'x' });
    expect(withInput.map((i) => [i.path, i.code, i.messageJa])).toEqual([
      ['a', 'required', '必須の項目です'],
      ['n', 'invalidType', '整数で指定してください'],
      ['b', 'invalidType', 'true か false で指定してください'],
      ['o', 'invalidType', 'オブジェクトで指定してください'],
      ['l', 'invalidType', '配列で指定してください'],
    ]);
    // Without reportInput the English message still tells a missing value apart.
    const withoutInput = issuesOf(z.object({ a: z.string(), b: z.string() }), { b: 1 }, false);
    expect(withoutInput.map((i) => [i.path, i.code, i.messageJa])).toEqual([
      ['a', 'required', '必須の項目です'],
      ['b', 'invalidType', '文字列で指定してください'],
    ]);
  });

  it('maps literal, enum and discriminator mismatches', () => {
    expect(one(z.literal('shiori/1'), 'x')).toMatchObject({ code: 'invalidValue', messageJa: '「shiori/1」にしてください' });
    expect(one(z.enum(['game', 'voice']), 'x')).toMatchObject({
      code: 'invalidValue',
      messageJa: '次のどれかにしてください：game / voice',
    });
    const du = z.object({
      u: z.discriminatedUnion('mode', [z.object({ mode: z.literal('allOf') }), z.object({ mode: z.literal('anyOf') })]),
    });
    expect(one(du, { u: { mode: 'x' } })).toEqual({
      path: 'u.mode',
      code: 'invalidValue',
      messageJa: '次のどれかにしてください：allOf / anyOf',
      severity: 'error',
    });
  });

  it('unwraps plain unions to the closest branch', () => {
    const u = z.object({
      v: z.union([z.object({ kind: z.literal('a'), x: z.string() }), z.object({ kind: z.literal('b'), y: z.number(), z: z.number() })]),
    });
    const issues = issuesOf(u, { v: { kind: 'a', x: 5 } });
    expect(issues.map((i) => [i.path, i.code])).toEqual([['v.x', 'invalidType']]);
  });

  it('maps pattern mismatches to specific messages', () => {
    const id = one(z.string().regex(ID_RE), 'Bad!');
    expect(id).toMatchObject({ code: 'invalidFormat' });
    expect(id.messageJa).toMatch(/^IDは/);
    expect(one(z.string().regex(WORK_ID_RE), 'x').messageJa).toMatch(/^作品IDは/);
    expect(one(z.string().regex(VERSION_RE), 'v 1').messageJa).toMatch(/^バージョンは/);
    expect(one(z.string().regex(DATE_RE), '2026/1/1').messageJa).toBe('日付はYYYY-MM-DDの形式にしてください');
    expect(one(z.string().regex(/^x$/), 'y')).toMatchObject({ code: 'invalidFormat', messageJa: '形式が正しくありません' });
    expect(one(z.email(), 'nope')).toMatchObject({ code: 'invalidFormat', messageJa: '形式が正しくありません' });
  });

  it('maps control and bidi refinements from payloadSchemas', () => {
    expect(one(text(0, 10), 'a\u0001')).toMatchObject({ code: 'controlChar', messageJa: '使えない制御文字が含まれています' });
    const bidi = one(text(0, 10), 'a\u202Eb');
    expect(bidi.code).toBe('bidiChar');
    expect(bidi.messageJa).toMatch(JAPANESE);
  });

  it('maps custom issues by params.code and falls back otherwise', () => {
    expect(one(z.string().refine(() => false, { params: { code: 'duplicateTag', id: 'end-a' } }), 'x')).toMatchObject({
      code: 'duplicateTag',
      messageJa: '目標「end-a」と同じ合言葉が使われています',
    });
    expect(one(z.string().refine(() => false), 'x')).toMatchObject({ code: 'invalid', messageJa: '値が正しくありません' });
  });

  it('maps unrecognized keys (strict objects)', () => {
    expect(one(z.strictObject({ a: z.string() }), { a: 'x', b: 1, c: 2 })).toMatchObject({
      code: 'unknownKey',
      messageJa: '不明な項目があります：b, c',
    });
  });

  it('tolerates foreign or malformed issue objects', () => {
    const out = zodIssuesToValidationIssues([null, 'x', 5, { code: 'weird' }, { code: 'too_big', path: ['a'], origin: 'string', maximum: 5 }]);
    expect(out).toEqual([
      { path: '', code: 'invalid', messageJa: '値が正しくありません', severity: 'error' },
      { path: 'a', code: 'tooLong', messageJa: '5文字以内にしてください', severity: 'error' },
    ]);
  });

  it('never leaks zod English messages', () => {
    const schema = z.object({
      s: text(1, 3),
      n: z.number().int().min(1),
      e: z.enum(['a']),
      l: z.literal(1),
      arr: z.array(z.string()).min(1),
      re: z.string().regex(/^a$/),
    });
    const issues = issuesOf(schema, { s: 'abcd\u202E', n: 0.5, e: 'b', l: 2, arr: [], re: 'b' });
    expect(issues.length).toBeGreaterThanOrEqual(6);
    for (const i of issues) {
      expect(i.messageJa).toMatch(JAPANESE);
      expect(i.messageJa).not.toMatch(ENGLISH_ZOD);
      expect(i.severity).toBe('error');
    }
  });
});
