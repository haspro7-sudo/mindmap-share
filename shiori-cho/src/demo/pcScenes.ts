// Scene data for #/demo-pc, the PC画面シミュレータ (docs/SPEC.md F17 AC3, §6).
// A short click-through of the fictional game 「星読みの図書館」 (demo-hoshiyomi): four branches lead to the four
// endings, each ending screen shows its 合言葉, and the title screen's 「扉の合言葉」 accepts the return code
// ほしあかり (revealed by the END 4 extra) and opens a bonus scene. Data only: no React, no UI imports.
import { DEMO_HOSHIYOMI, DEMO_RETURN_CODE } from './demoCodes';

export interface PcChoice {
  label: string;
  /** id of the next scene */
  next: string;
}

export interface PcEnding {
  /** code goal id in demo-hoshiyomi */
  goalId: string;
  /** public goal label ('END 1') */
  label: string;
  /** code display form shown on the ending screen ('ST4-RMA-P1X'); the UI also builds the QR / deep link from it */
  display: string;
}

/** The title screen's 「扉の合言葉」 field. Check the input with isDoorCode(). */
export interface PcDoorInput {
  /** field label (「扉の合言葉」) */
  label: string;
  placeholder: string;
  /** scene shown when isDoorCode(input) is true */
  next: string;
  /** shown under the field when the input is wrong */
  wrongMessage: string;
}

export interface PcScene {
  id: string;
  /** heading shown at the top of the fake game window */
  title?: string;
  /** text box lines, shown in order */
  lines: string[];
  choices?: PcChoice[];
  /** present on ending screens: show 「しおり帳の合言葉：<display>」, a QR and 「この端末で入力する」 */
  ending?: PcEnding;
  /** title screen only */
  doorInput?: PcDoorInput;
}

/** manifest work.id the ending codes belong to (for buildUnlockUrl / deep links). */
export const PC_WORK_ID = DEMO_HOSHIYOMI.workId;
/** First scene (the title screen). */
export const PC_START = 'title';
/** Scene opened by the correct 「扉の合言葉」. */
export const PC_BONUS = 'bonus';

const BACK_TO_TITLE: PcChoice = { label: 'タイトルに戻る', next: PC_START };
const BACK_TO_READING_ROOM: PcChoice = { label: '閲覧室に戻る', next: 'reading-room' };

/** All scenes in story order. */
export const PC_SCENE_LIST: readonly PcScene[] = [
  {
    id: PC_START,
    title: '星読みの図書館',
    lines: ['丘の上の、小さな図書館の物語。', '（しおり帳の動きを試すための、架空のミニゲームです）'],
    choices: [{ label: 'はじめから', next: 'prologue' }],
    doorInput: {
      label: '扉の合言葉',
      placeholder: 'ひらがなで入力',
      next: PC_BONUS,
      wrongMessage: '扉は静かなままです。合言葉が違うようです',
    },
  },
  {
    id: 'prologue',
    title: '第1章　星の降る丘',
    lines: [
      '長い坂道をのぼりきると、古い図書館が見えてきました。',
      '重い扉を開けると、カウンターの司書が顔を上げます。',
      'ミナ「ようこそ、星読みの図書館へ。今夜は星がよく見えますよ」',
    ],
    choices: [{ label: '閲覧室へ行く', next: 'reading-room' }],
  },
  {
    id: 'reading-room',
    title: '閲覧室',
    lines: [
      '高い書架が、天井までずっと続いています。',
      '窓の外では、月がゆっくり昇りはじめました。',
      '足もとで、図書館の猫が「にゃあ」とひと声鳴きました。',
    ],
    choices: [
      { label: '書架の星図を調べる', next: 'star-maps' },
      { label: '窓際の席で月を待つ', next: 'moon-seat' },
      { label: '猫についていく', next: 'cat-path' },
      { label: '屋上への階段をのぼる', next: 'stairs' },
    ],
  },
  {
    id: 'star-maps',
    title: '天文の棚',
    lines: [
      '本のあいだから、古い星図が三枚見つかりました。',
      '北の空、東の空、南の空。つなげると、ひとつの夜空になりそうです。',
    ],
    choices: [
      { label: '北・東・南の順に並べる', next: 'end-a' },
      { label: '南・東・北の順に並べる', next: 'star-maps-miss' },
      BACK_TO_READING_ROOM,
    ],
  },
  {
    id: 'star-maps-miss',
    title: '天文の棚',
    lines: ['星図はばらばらのまま、何も起きませんでした。', 'ミナ「並べ方に、きっと意味があるんですよ」'],
    choices: [{ label: '並べなおす', next: 'star-maps' }, BACK_TO_READING_ROOM],
  },
  {
    id: 'end-a',
    title: 'END 1「星図の果て」',
    lines: [
      '三枚の星図がつながると、夜空の端に小さな灯りが浮かびました。',
      'ミナ「この灯り……この図書館ですね」',
      'あなたとミナは、しばらく黙って星図を眺めていました。',
    ],
    ending: { goalId: 'end-a', label: 'END 1', display: 'ST4-RMA-P1X' },
    choices: [BACK_TO_TITLE],
  },
  {
    id: 'moon-seat',
    title: '窓際の席',
    lines: [
      '閉館の鐘が鳴りました。',
      'ミナが明かりを落としても、あなたは窓際の席で月を待ちつづけます。',
      '月の光が、読みかけのページを少しずつ照らしていきます。',
    ],
    choices: [{ label: 'もう少し待つ', next: 'end-b' }, BACK_TO_READING_ROOM],
  },
  {
    id: 'end-b',
    title: 'END 2「月夜の閲覧席」',
    lines: [
      '月が窓のまんなかに昇ったとき、ページに見たことのない一行が浮かびました。',
      '「静かな夜を、ありがとう」',
      'あなたは本を閉じて、月におやすみを言いました。',
    ],
    ending: { goalId: 'end-b', label: 'END 2', display: 'M00-NDE-SKR' },
    choices: [BACK_TO_TITLE],
  },
  {
    id: 'cat-path',
    title: '猫の通り道',
    lines: [
      '猫はときどき振り返りながら、地下書庫へ降りていきます。',
      'いちばん奥の棚の前で、猫はちょこんと座りました。',
    ],
    choices: [{ label: '奥の棚を調べる', next: 'end-c' }, BACK_TO_READING_ROOM],
  },
  {
    id: 'end-c',
    title: 'END 3「猫がくれた栞」',
    lines: [
      '棚のすき間に、古い栞がはさまっていました。',
      '栞には、小さな字で「またおいで」と書かれています。',
      '猫は満足そうに、しっぽをひと振りしました。',
    ],
    ending: { goalId: 'end-c', label: 'END 3', display: 'NEK-0T0-M0E' },
    choices: [BACK_TO_TITLE],
  },
  {
    id: 'stairs',
    title: '屋上への階段',
    lines: [
      '階段の先には、鍵のかかった小さな扉がありました。',
      'いつのまにか後ろにいたミナが、そっと鍵を差し出します。',
      'ミナ「天文台の鍵です。ずっと、誰かに渡したかったんです」',
    ],
    choices: [{ label: '扉を開ける', next: 'observatory' }, BACK_TO_READING_ROOM],
  },
  {
    id: 'observatory',
    title: '天文台',
    lines: ['大きな望遠鏡が、夜空を向いています。', 'のぞきこむと、星々が本のページのように並んでいました。'],
    choices: [{ label: 'もう一度のぞく', next: 'end-true' }, BACK_TO_READING_ROOM],
  },
  {
    id: 'end-true',
    title: 'END 4「空をうたう天文台」',
    lines: [
      '星の光が、図書館じゅうの本をやさしく照らしました。',
      'ミナ「星を読む人が来てくれて、本当によかった」',
      'ミナと猫と並んで、あなたは夜明けまで空を眺めていました。',
    ],
    ending: { goalId: 'end-true', label: 'END 4', display: 'SK1-ES0-NGM' },
    choices: [BACK_TO_TITLE],
  },
  {
    id: PC_BONUS,
    title: '扉の向こう',
    lines: [
      '合言葉を唱えると、図書館の扉が静かに開きました。',
      'ミナ「おかえりなさい。あなたの席、ちゃんととってありますよ」',
      '猫がひざに乗って、ごろごろと喉を鳴らしています。',
      '（返し合言葉で開くボーナスシーンのサンプルです）',
    ],
    choices: [BACK_TO_TITLE],
  },
];

/** Scenes by id. */
export const PC_SCENES: Readonly<Record<string, PcScene>> = Object.fromEntries(PC_SCENE_LIST.map((s) => [s.id, s]));

/** The scene with this id, or undefined. */
export function getPcScene(id: string): PcScene | undefined {
  return Object.hasOwn(PC_SCENES, id) ? PC_SCENES[id] : undefined;
}

const DOOR_SEPARATORS = /[\s・、。,.-]/gu;

/** NFKC, katakana → hiragana, separators and spaces removed. */
function normalizeDoorCode(input: string): string {
  return input
    .normalize('NFKC')
    .replace(/[ァ-ヶ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60))
    .replace(DOOR_SEPARATORS, '');
}

/** True if the input is the return code ほしあかり (hiragana or katakana, full or half width, spaces ignored). */
export function isDoorCode(input: string): boolean {
  return typeof input === 'string' && normalizeDoorCode(input) === DEMO_RETURN_CODE;
}
