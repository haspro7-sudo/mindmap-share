// Test-only fixtures for the build / self-test / lint / kit / redeem tests (fictional, SFW content).
// Iterations are the minimum valid value (100,000) to keep PBKDF2 fast in tests.
import type { Bytes, DraftGoal, DraftSealed, StudioProject } from '../types';
import type { Rng } from '../encoding';

export const FIXTURE_SALT = 'AAECAwQFBgcICQoLDA0ODw';
export const FIXTURE_ITERATIONS = 100_000;

/** Codes of the fixture (display forms). */
export const FIXTURE_CODES = {
  'end-a': 'K7Q-M2X-RAP',
  'end-b': 'ST4-RMA-P1X',
  'voice-1': 'ほたる・かえで・つばめ・こだま・すずめ',
} as const;

/** Deterministic counter rng: every call continues where the previous one stopped. */
export function counterRng(start = 0): Rng {
  let c = start;
  return (n) => Uint8Array.from({ length: n }, () => c++ & 0xff) as Bytes;
}

function goals(): DraftGoal[] {
  return [
    {
      id: 'end-a',
      group: 'endings',
      label: 'END 1',
      teaser: '静かな結末',
      spoiler: 1,
      hints: ['夜の図書館には、昼とは違う顔がある', '第2章の夜、屋上の天文台へ', '天文台の望遠鏡を3回調べる'],
      unlockType: 'code',
      codeKind: 'b32',
      code: FIXTURE_CODES['end-a'],
      secret: {
        title: '星図の果て',
        description: '星の地図を最後まで読み解いた。\n夜空の端に、小さな灯りがあった。',
        unlockMessage: 'おめでとうございます！星図の旅はここで終わりです。',
      },
    },
    {
      id: 'end-b',
      group: 'endings',
      label: 'END 2',
      spoiler: 0,
      hints: ['閉館の時間まで待ってみよう'],
      missable: { before: 'ch3', warn: '第3章に進む前に、書架をもう一度見て回ろう' },
      unlockType: 'code',
      codeKind: 'b32',
      code: FIXTURE_CODES['end-b'],
      secret: { title: '閉館の鐘', description: '', unlockMessage: '' },
    },
    {
      id: 'voice-1',
      group: 'endings',
      label: '？？？',
      spoiler: 2,
      hints: ['おまけトラックを最後まで聞く'],
      unlockType: 'code',
      codeKind: 'kana',
      code: FIXTURE_CODES['voice-1'],
      secret: { title: '夜更けの朗読', unlockMessage: '聞いてくれてありがとう。' },
    },
    {
      id: 'ach-cat',
      group: 'ach',
      label: '図書館の猫と3回話した',
      spoiler: 0,
      hints: [],
      unlockType: 'manual',
    },
    {
      id: 'ach-shelf',
      group: 'ach',
      label: '全ての書架を調べた',
      teaser: '',
      spoiler: 0,
      hints: ['書架は全部で12あります', ''],
      missable: { before: '', warn: '' },
      unlockType: 'manual',
    },
  ];
}

function sealed(): DraftSealed[] {
  return [
    {
      id: 'afterword',
      label: 'あとがき',
      teaser: '全てのエンディングで開きます',
      kind: 'afterword',
      mode: 'allOf',
      goals: ['end-a', 'end-b', 'voice-1'],
      payload: {
        title: 'あとがき',
        body: '最後まで遊んでくれて、ありがとうございました。\n次回作もよろしくお願いします。',
        from: 'テスト工房（架空）',
      },
    },
    {
      id: 'letter',
      label: '司書からの手紙',
      teaser: 'どれか1つのエンディングで開きます',
      kind: 'letter',
      mode: 'anyOf',
      goals: ['end-a', 'end-b'],
      payload: {
        title: '感謝をこめて',
        body: '図書館に来てくれて、とてもうれしかったです。\nまたいつでも「本」を読みに来てくださいね。',
        from: '司書ミナより',
      },
    },
    {
      id: 'door',
      label: '扉の合言葉',
      kind: 'returnCode',
      mode: 'allOf',
      goals: ['end-b'],
      payload: {
        title: '図書館の扉',
        body: '扉の向こうには、まだ誰も知らない書庫がありました。',
        returnCode: { code: 'ほしあかり', instruction: 'タイトル画面の「扉の合言葉」に入力してください' },
      },
    },
  ];
}

/** 3 code goals (b32 ×2, kana ×1), 2 manual goals, allOf + anyOf items and a returnCode item. */
export function fixtureProject(overrides: Partial<StudioProject> = {}): StudioProject {
  return {
    format: 'shiori-studio-project',
    version: 1,
    id: 'proj-test',
    createdAt: 1_790_000_000_000,
    updatedAt: 1_790_000_000_000,
    appUrl: 'https://example.github.io/shiori-cho/',
    work: {
      id: 'w-test00001',
      title: '星読みの試験館',
      safeTitle: 'テストA',
      circle: 'テスト工房（架空）',
      kind: 'game',
      engine: 'rpgmaker-mz',
      version: '1.0.0',
    },
    authorName: 'テスト工房（架空）',
    kdfIterations: FIXTURE_ITERATIONS,
    kdfSalt: FIXTURE_SALT,
    checkpoints: [
      { id: 'ch1', label: '第1章' },
      { id: 'ch2', label: '第2章' },
      { id: 'ch3', label: '第3章' },
    ],
    groups: [
      { id: 'endings', label: 'エンディング' },
      { id: 'ach', label: '実績' },
    ],
    goals: goals(),
    sealed: sealed(),
    changelog: [{ version: '1.0.0', date: '2026-10-01', notes: '初版' }],
    ...overrides,
  };
}

/** A small project with one code goal (for redeem tests). */
export function smallProject(workId: string, code: string, opts: { salt?: string; kind?: 'b32' | 'kana' } = {}): StudioProject {
  return fixtureProject({
    work: { id: workId, title: `作品 ${workId}`, kind: 'game', version: '1.0.0' },
    kdfSalt: opts.salt ?? FIXTURE_SALT,
    checkpoints: [],
    groups: [{ id: 'endings', label: 'エンディング' }],
    goals: [
      {
        id: 'end-1',
        group: 'endings',
        label: 'END 1',
        spoiler: 0,
        hints: ['最後まで進める'],
        unlockType: 'code',
        codeKind: opts.kind ?? 'b32',
        code,
        secret: { title: `${workId} の結末` },
      },
      { id: 'ach-1', group: 'endings', label: '寄り道をした', spoiler: 0, hints: [], unlockType: 'manual' },
    ],
    sealed: [],
  });
}
