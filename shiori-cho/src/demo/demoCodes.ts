// The bundled demos' codes, listed in ヘルプ →「サンプルの合言葉」 (docs/SPEC.md F17 AC2, §4.6).
// Demo codes are public on purpose: the demos exist so anyone can try the whole loop on one device.
// demo.test.ts checks this list against src/demo/*.project.json and the committed *.shiori.json.
import type { CodeKind } from '../core/types';

export interface DemoCode {
  /** real title of the (fictional) demo work */
  workTitle: string;
  /** alias shown in the library (the manifest's safeTitle) */
  alias: string;
  /** public goal label ('END 1'), or the sealed item label for the return code */
  goalLabel: string;
  /** display form, as the work shows it */
  display: string;
  /** where the player finds the code (Japanese, one sentence) */
  where: string;
  /** manifest work.id of the demo */
  workId: string;
  /** code goal the code unlocks in しおり帳; absent for the return code */
  goalId?: string;
  /** 'return' = 返し合言葉: typed into the PC画面シミュレータ, never into しおり帳 */
  kind: CodeKind | 'return';
}

export const DEMO_HOSHIYOMI = { workId: 'demo-hoshiyomi', title: '星読みの図書館', alias: 'サンプルA' } as const;
export const DEMO_AMAOTO = { workId: 'demo-amaoto', title: '雨音と読書の時間', alias: 'サンプルB' } as const;

/** 返し合言葉 revealed by the sealed item 「図書館の扉の合言葉」 (END 4). Typed into the simulator, not the app. */
export const DEMO_RETURN_CODE = 'ほしあかり';

export const DEMO_RETURN_CODE_NOTE =
  '「ほしあかり」は返し合言葉です。しおり帳の「合言葉」ではなく、PC画面シミュレータのタイトル画面にある「扉の合言葉」に入力してください。';

const SIMULATOR = 'PC画面シミュレータで試せます';

/** All 7 demo codes: 6 app codes (4 for サンプルA, 2 for サンプルB) and the return code ほしあかり last. */
export const DEMO_CODES: readonly DemoCode[] = [
  {
    workTitle: DEMO_HOSHIYOMI.title,
    alias: DEMO_HOSHIYOMI.alias,
    goalLabel: 'END 1',
    display: 'ST4-RMA-P1X',
    where: `ゲーム内のEND 1の画面に表示されます（${SIMULATOR}）`,
    workId: DEMO_HOSHIYOMI.workId,
    goalId: 'end-a',
    kind: 'b32',
  },
  {
    workTitle: DEMO_HOSHIYOMI.title,
    alias: DEMO_HOSHIYOMI.alias,
    goalLabel: 'END 2',
    display: 'M00-NDE-SKR',
    where: `ゲーム内のEND 2の画面に表示されます（${SIMULATOR}）`,
    workId: DEMO_HOSHIYOMI.workId,
    goalId: 'end-b',
    kind: 'b32',
  },
  {
    workTitle: DEMO_HOSHIYOMI.title,
    alias: DEMO_HOSHIYOMI.alias,
    goalLabel: 'END 3',
    display: 'NEK-0T0-M0E',
    where: `ゲーム内のEND 3の画面に表示されます（${SIMULATOR}）`,
    workId: DEMO_HOSHIYOMI.workId,
    goalId: 'end-c',
    kind: 'b32',
  },
  {
    workTitle: DEMO_HOSHIYOMI.title,
    alias: DEMO_HOSHIYOMI.alias,
    goalLabel: 'END 4',
    display: 'SK1-ES0-NGM',
    where: `ゲーム内のEND 4の画面に表示されます（${SIMULATOR}）`,
    workId: DEMO_HOSHIYOMI.workId,
    goalId: 'end-true',
    kind: 'b32',
  },
  {
    workTitle: DEMO_AMAOTO.title,
    alias: DEMO_AMAOTO.alias,
    goalLabel: 'おまけ：Track 6 の合言葉',
    display: 'ほたる・かえで・つばめ・こだま・すずめ',
    where: 'Track 6 の最後に、声で語られる合言葉です（という設定です）',
    workId: DEMO_AMAOTO.workId,
    goalId: 'bonus-talk',
    kind: 'kana',
  },
  {
    workTitle: DEMO_AMAOTO.title,
    alias: DEMO_AMAOTO.alias,
    goalLabel: 'おまけ：台本の合言葉',
    display: 'AMA-0T0-N1J',
    where: '台本の最後のページに載っている合言葉です（という設定です）',
    workId: DEMO_AMAOTO.workId,
    goalId: 'script-page',
    kind: 'b32',
  },
  {
    workTitle: DEMO_HOSHIYOMI.title,
    alias: DEMO_HOSHIYOMI.alias,
    goalLabel: '図書館の扉の合言葉',
    display: DEMO_RETURN_CODE,
    where:
      'END 4の合言葉で開くおまけに書かれている返し合言葉です。しおり帳ではなく、PC画面シミュレータのタイトル画面「扉の合言葉」に入力します',
    workId: DEMO_HOSHIYOMI.workId,
    kind: 'return',
  },
];

/** The 6 codes that are entered into しおり帳 (everything except the return code). */
export const DEMO_APP_CODES: readonly DemoCode[] = DEMO_CODES.filter((c) => c.kind !== 'return');
