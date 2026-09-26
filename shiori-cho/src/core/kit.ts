// Text files of the creator kit (docs/SPEC.md §4.4, F16 AC6). QR PNGs are added by app/studio.ts.
import { DISCLAIMER_JA, MANIFEST_FILE_NAME, NOT_DRM_JA } from './constants';
import { utf8 } from './encoding';
import type { CodeRow, Engine, KitFile, SealedKind, StudioProject, WorkKind } from './types';

export const KIT_PATHS = {
  shioriJson: `同梱用_PUBLIC/${MANIFEST_FILE_NAME}`,
  readmePlayer: '同梱用_PUBLIC/はじめに.txt',
  codesCsv: '非公開_ゲームに埋め込む/codes.csv',
  snippets: '非公開_ゲームに埋め込む/エンジン別の表示例.txt',
  projectBackup: '非公開_控え/project.shiori-studio.json',
  storeTemplate: '告知文テンプレート.txt',
  readmeCreator: 'README_最初に読んでください.txt',
} as const;

/** Folder of the QR PNGs added by app/studio.ts: `${KIT_QR_DIR}/<goalId>.png`. */
export const KIT_QR_DIR = '非公開_ゲームに埋め込む/qr';

export const CODES_CSV_HEADER = ['goalId', '表示名', '秘密タイトル', '種類', '合言葉', '解放URL'] as const;

const BOM = '\uFEFF';
const PLACEHOLDER_B32 = 'XXX-XXX-XXX';
const PLACEHOLDER_GOAL = 'end-a';
const APP_NAME = 'しおり帳';

// ───────────────────────── CSV ─────────────────────────

const CSV_NEEDS_QUOTES = /[",\r\n]/;
/** Cells that spreadsheet apps (Excel, LibreOffice, Google Sheets) would read as a formula. */
const CSV_FORMULA_START = /^[=+\-@\t\r]/;

/**
 * RFC 4180 CSV escaping for one row. A cell that starts with = + - @ (or a tab / CR) gets a leading apostrophe and
 * is quoted (OWASP CSV-injection guidance), so a label such as 「-END-」 or 「=真エンド=」 shows as text, not as a formula.
 */
export function csvRow(cells: readonly string[]): string {
  return (
    cells
      .map((c) => {
        const raw = String(c ?? '');
        const formula = CSV_FORMULA_START.test(raw);
        const s = formula ? `'${raw}` : raw;
        return formula || CSV_NEEDS_QUOTES.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      })
      .join(',') + '\r\n'
  );
}

/**
 * True when the app URL is an absolute http(s) URL, so unlock URLs and QR codes can open the app from a phone camera.
 * Without it an unlock "URL" is only a fragment ('#/u/…'): the kit then has no QR codes and no 解放URL.
 */
export function kitHasAppUrl(appUrl: string): boolean {
  return /^https?:\/\/[^\s/?#]+/i.test(appUrl.trim());
}

function codesCsv(codes: readonly CodeRow[], withUrls: boolean): string {
  const rows = codes.map((c) =>
    csvRow([c.goalId, c.label, c.secretTitle, c.codeKind === 'kana' ? 'ひらがな' : '英数字', c.display, withUrls ? c.unlockUrl : '']),
  );
  return BOM + csvRow(CODES_CSV_HEADER) + rows.join('');
}

// ───────────────────────── store template ─────────────────────────

const EXTRA_NAMES: ReadonlyArray<readonly [SealedKind, string]> = [
  ['letter', '手紙'],
  ['afterword', 'あとがき'],
  ['story', '後日談'],
  ['profile', '人物紹介'],
  ['returnCode', '作中で使える返し合言葉'],
];

/** 「【クリア特典】作中の“合言葉”を…」 store-description template */
export function storeTemplateJa(project: StudioProject): string {
  const kinds = new Set(project.sealed.map((s) => s.kind));
  const extras = EXTRA_NAMES.filter(([k]) => kinds.has(k)).map(([, name]) => name);
  const hasCodes = project.goals.some((g) => g.unlockType === 'code');
  const app = `無料のスマホ用Webアプリ「${APP_NAME}」`;
  if (extras.length > 0) {
    return `【クリア特典】作中の“合言葉”を${app}に入れると、${extras.join('・')}が読めます（ネタバレ防止ヒント・実績チェック付き／アカウント不要）`;
  }
  if (hasCodes) {
    return `【クリア特典】作中の“合言葉”を${app}に入れると、隠された実績の名前や解説が読めます（ネタバレ防止ヒント・実績チェック付き／アカウント不要）`;
  }
  return `【プレイのおともに】${app}で、ネタバレしない段階ヒントと実績チェックが使えます（アカウント不要）`;
}

// ───────────────────────── return-code hash (sync SHA-256) ─────────────────────────

const K256 = Uint32Array.from([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98,
  0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8,
  0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819,
  0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
  0xc67178f2,
]);
const H256 = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];

function rotr(x: number, n: number): number {
  return (x >>> n) | (x << (32 - n));
}

/**
 * Synchronous SHA-256 (FIPS 180-4) as lowercase hex. The kit text builder is synchronous, so WebCrypto's
 * async digest cannot be used here; kit.test.ts checks this against WebCrypto.
 */
export function sha256HexSync(data: Uint8Array): string {
  const len = data.length;
  const total = Math.ceil((len + 9) / 64) * 64;
  const buf = new Uint8Array(total);
  buf.set(data);
  buf[len] = 0x80;
  const view = new DataView(buf.buffer);
  view.setUint32(total - 8, Math.floor(len / 0x20000000));
  view.setUint32(total - 4, (len * 8) >>> 0);

  const h = [...H256];
  const w = new Uint32Array(64);
  for (let off = 0; off < total; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const w15 = w[i - 15]!;
      const w2 = w[i - 2]!;
      const s0 = rotr(w15, 7) ^ rotr(w15, 18) ^ (w15 >>> 3);
      const s1 = rotr(w2, 17) ^ rotr(w2, 19) ^ (w2 >>> 10);
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h as [number, number, number, number, number, number, number, number];
    for (let i = 0; i < 64; i++) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + s1 + ch + K256[i]! + w[i]!) >>> 0;
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (s0 + maj) >>> 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    const next = [a, b, c, d, e, f, g, hh];
    for (let i = 0; i < 8; i++) h[i] = (h[i]! + next[i]!) >>> 0;
  }
  return h.map((x) => x.toString(16).padStart(8, '0')).join('');
}

/** sha256hex("shiori-return|" + salt + "|" + NFKC(code)) (docs/SPEC.md §4.4 step 6). */
export function returnCodeHashHex(salt: string, code: string): string {
  return sha256HexSync(utf8(`shiori-return|${salt}|${code.normalize('NFKC')}`));
}

// ───────────────────────── text builders ─────────────────────────

/** '\n' → CRLF (the .txt files are mostly opened on Windows). */
function crlf(lines: readonly string[]): string {
  return lines.join('\n').replace(/\r?\n/g, '\r\n') + '\r\n';
}

const CODE_WHERE: Readonly<Record<WorkKind, string>> = {
  game: 'ゲームを進めると、エンディングなどで',
  voice: '音声（ボーナストラックの最後など）や台本の最後のページで',
  cg: 'CG集の最後のページで',
  comic: '作品の最後のページで',
  other: '作品の中で',
};

function playerReadme(project: StudioProject, codes: readonly CodeRow[], appUrl: string): string {
  const { work } = project;
  const url = appUrl.trim();
  const qr = kitHasAppUrl(url);
  const lines = [
    `『${work.title}』しおり帳 対応のご案内`,
    '',
    `この作品には、無料のWebアプリ「${APP_NAME}」で使える「しおりファイル」（${MANIFEST_FILE_NAME}）が入っています。`,
    '',
    `■ ${APP_NAME}とは`,
    '遊んだ作品の進み具合を記録できる、スマホ・PC向けの無料Webアプリです。',
    '・ネタバレしないように、ヒントを一段階ずつ見られます',
    '・エンディングや実績の達成状況をチェックできます',
    '・作中に出てくる「合言葉」を入れると、封印された「おまけ」が読めます',
    'アカウント登録は不要です。記録はすべて、お使いの端末の中だけに保存されます。',
    '',
    '■ 使い方',
    `1. ブラウザで${APP_NAME}を開きます。`,
    url !== '' ? `   ${url}` : '   （URLは作品の配布ページなどでご確認ください）',
    '2. 本棚の「＋ 追加」から「しおりファイルを読み込む」を選びます。',
    `3. この ${MANIFEST_FILE_NAME} をファイルとして選ぶか、テキストエディタで開いた中身をコピーして貼り付けます。`,
    `   スマホでは、${MANIFEST_FILE_NAME} を「ファイル」アプリやクラウドドライブに保存してから選ぶと簡単です。`,
  ];
  if (codes.length > 0) {
    lines.push(
      `4. ${CODE_WHERE[work.kind]}「合言葉」（英数字9文字、またはひらがな5語）が出てきます。`,
      `   ${APP_NAME}の「合言葉」画面で入力してください。${qr ? 'QRコードがある場合は、スマホのカメラで読み取っても開けます。' : ''}`,
    );
  }
  lines.push(
    '',
    '■ ご注意',
    `・${MANIFEST_FILE_NAME} の中の合言葉で開く部分（エンディング名やおまけの中身）は暗号化されています。`,
    '  ファイルを開いてもネタバレにはなりません（ヒントと目標の表示名は、そのまま読める公開情報です）。',
    `・${NOT_DRM_JA}`,
    `・${DISCLAIMER_JA}`,
    `・このしおりファイルについては、作品の作者${work.circle ? `「${work.circle}」` : ''}へお問い合わせください。`,
  );
  return crlf(lines);
}

const ENGINE_SECTIONS: ReadonlyArray<{ engines: readonly Engine[]; title: string }> = [
  { engines: ['rpgmaker-mv', 'rpgmaker-mz'], title: 'RPGツクールMV / MZ' },
  { engines: ['tyrano'], title: 'ティラノスクリプト / ティラノビルダー' },
  { engines: ['wolf'], title: 'WOLF RPGエディター（ウディタ）' },
  { engines: ['renpy'], title: "Ren'Py" },
  { engines: ['unity'], title: 'Unity' },
];

function heading(title: string, mine: boolean): string {
  return `■ ${title}${mine ? '（★この作品のエンジン）' : ''}`;
}

function spokenCode(row: CodeRow | undefined): string {
  if (!row) return '〇〇〇、〇〇〇、〇〇〇、〇〇〇、〇〇〇';
  const parts = row.codeKind === 'kana' ? row.display.split('・') : [...row.display.replace(/-/g, '')];
  return parts.join('、');
}

function snippetsText(project: StudioProject, codes: readonly CodeRow[], salt: string | undefined, withQr: boolean): string {
  const ex = codes[0];
  const code = ex?.display ?? PLACEHOLDER_B32;
  const goalId = ex?.goalId ?? PLACEHOLDER_GOAL;
  const pic = `shiori_${goalId}.png`;
  const qr = `qr/${goalId}.png`;
  const engine = project.work.engine;
  const isMine = (i: number) => engine !== undefined && ENGINE_SECTIONS[i]!.engines.includes(engine);
  const voiceRow = codes.find((c) => c.codeKind === 'kana') ?? ex;

  const lines = [
    'しおり帳の合言葉 エンジン別の表示例',
    '（このファイルは非公開です。作品に同梱しないでください）',
    '',
    ex
      ? `例として、目標「${ex.label}」（${ex.goalId}）の合言葉 ${code} を使っています。`
      : `合言葉つきの目標がまだないため、${PLACEHOLDER_B32} を仮の合言葉として使っています。`,
    withQr
      ? 'ほかの目標の合言葉は codes.csv に、QRコード画像は qr/<目標ID>.png にあります。'
      : 'ほかの目標の合言葉は codes.csv にあります。（アプリのURLが未設定のため、QRコード画像は入っていません。工房の「作品」タブでURLを設定して書き出し直すと入ります）',
    withQr
      ? 'プラグインは必要ありません。プレイヤーが目標を達成した場面で、合言葉の文字列（またはQRコード画像）を表示するだけです。'
      : 'プラグインは必要ありません。プレイヤーが目標を達成した場面で、合言葉の文字列を表示するだけです。',
    '',
    heading(ENGINE_SECTIONS[0]!.title, isMine(0)),
    '「文章の表示」に次のように書きます（\\C[3] で文字の色を変えています）。',
    `  しおり帳の合言葉：\\C[3]${code}\\C[0]`,
    ...(withQr ? [`QRコードも出す場合は、${qr} を img/pictures/${pic} としてコピーし、「ピクチャの表示」で表示します。`] : []),
    '',
    heading(ENGINE_SECTIONS[1]!.title, isMine(1)),
    `  しおり帳の合言葉：${code}[p]`,
    ...(withQr
      ? [
          `QRコードも出す場合は、${qr} を data/fgimage/${pic} としてコピーし、次のように表示します。`,
          `  [image layer=1 storage="${pic}"]`,
          'マクロにまとめる例：',
          '  [macro name="shiori_code"][layopt layer=1 visible=true][image layer=1 storage=%qr x=440 y=120][ptext layer=1 text=%code size=40 x=440 y=560][l][freeimage layer=1][endmacro]',
          `  [shiori_code code="${code}" qr="${pic}"]`,
        ]
      : []),
    '',
    heading(ENGINE_SECTIONS[2]!.title, isMine(2)),
    '「文章表示」コマンドに次のように書きます（\\c[2] で文字の色を変えています）。',
    `  しおり帳の合言葉：\\c[2]${code}\\c[0]`,
    '',
    heading(ENGINE_SECTIONS[3]!.title, isMine(3)),
    `  "しおり帳の合言葉：{b}${code}{/b}"`,
    '',
    heading(ENGINE_SECTIONS[4]!.title, isMine(4)),
    'テキスト要素（Text / TextMeshPro）を1つ置き、次の文字列を表示します。',
    `  しおり帳の合言葉：${code}`,
    '',
    heading('音声作品', project.work.kind === 'voice'),
    'ボーナストラックの最後などで、次のように読み上げます。台本PDFの最後のページに書いてもかまいません。',
    `  「しおり帳の合言葉は、${spokenCode(voiceRow)}、です」`,
    '英数字の合言葉は聞き間違えやすいため、音声作品では「ひらがな5語」の合言葉をおすすめします。',
    '',
    heading('CG集・マンガ', project.work.kind === 'cg' || project.work.kind === 'comic'),
    withQr ? '最後のページに、合言葉（とQRコード）を載せます。' : '最後のページに、合言葉を載せます。',
    `  しおり帳の合言葉：${code}`,
    '',
    '■ 返し合言葉（任意）',
    '「返し合言葉」のおまけを開くと、プレイヤーに合言葉が表示されます。プレイヤーはそれをゲームに入力します。',
    'ゲーム側では、名前入力や [edit] などで入力を受け取り、変数と比べて判定してください。',
    '合言葉そのものをゲームに書きたくない場合は、入力から次の値を計算して、下のハッシュ値と比べる方法もあります。',
    '  sha256hex("shiori-return|" + ソルト + "|" + NFKC正規化した入力)',
    '（全角・半角の違いはNFKC正規化でそろいます。ひらがなとカタカナは別の文字として扱われます）',
  ];

  const items = project.sealed.filter((s) => s.kind === 'returnCode' && s.payload?.returnCode?.code);
  if (items.length === 0) {
    lines.push('（このプロジェクトには、返し合言葉のおまけはありません）');
  } else {
    if (salt !== undefined) lines.push(`  ソルト：${salt}`);
    for (const s of items) {
      const rc = s.payload.returnCode!;
      lines.push('', `おまけ「${s.label}」（${s.id}）`, `  返し合言葉：${rc.code}`, `  入力する場所：${rc.instruction}`);
      if (salt !== undefined) lines.push(`  ハッシュ値：${returnCodeHashHex(salt, rc.code)}`);
    }
    if (salt === undefined) lines.push('', '（ソルトは点検のあとに決まります。点検してから書き出し直すと、ハッシュ値も載ります）');
  }
  return crlf(lines);
}

function storeTemplateText(project: StudioProject): string {
  return crlf([
    '告知文テンプレート（作品ページの説明文などにお使いください）',
    '',
    storeTemplateJa(project),
    '',
    '※ 作品ページで外部ツールやURLに触れる前に、DLsiteの作品登録ルール（外部サービスやURLの記載について）を必ずご確認ください。',
    `※ ${APP_NAME}は、作品内にURLを書かなくても使えます（合言葉の文字列だけで動きます）。`,
    `※ ${DISCLAIMER_JA}`,
  ]);
}

function creatorReadme(project: StudioProject, codes: readonly CodeRow[], withQr: boolean): string {
  const { work } = project;
  return crlf([
    'README_最初に読んでください',
    `しおり帳 作品キット『${work.title}』（作品ID: ${work.id}）`,
    '',
    'このキットには、作品に同梱してよいファイルと、絶対に公開してはいけないファイルが入っています。',
    '配布する前に、次のチェックリストを確かめてください。',
    '',
    '■ 作品に同梱する（公開してよい）',
    `[ ] ${KIT_PATHS.shioriJson} …… しおりファイル。合言葉で開く部分は暗号化されています`,
    `[ ] ${KIT_PATHS.readmePlayer} …… プレイヤー向けの使い方`,
    '',
    '■ 絶対に同梱・公開しない（秘密を含みます）',
    `[ ] ${KIT_PATHS.codesCsv} …… すべての合言葉の一覧です`,
    withQr
      ? `[ ] ${KIT_QR_DIR}/ …… 合言葉のQRコード画像（512×600）。作中の表示場面で使う分だけを組み込みます`
      : `（${KIT_QR_DIR}/ …… アプリのURLが未設定のため、QRコード画像は入っていません）`,
    `[ ] ${KIT_PATHS.snippets} …… 表示例（合言葉を含みます）`,
    `[ ] ${KIT_PATHS.projectBackup} …… 秘密をすべて含むプロジェクトの控え。安全な場所に保管してください`,
    '',
    '■ 作品のzipには入れない（手元用・秘密は含みません）',
    `[ ] ${KIT_PATHS.storeTemplate} …… 告知文のひな形。文章は作品ページの説明文などにそのまま使えます`,
    `[ ] ${KIT_PATHS.readmeCreator} …… この README`,
    '',
    '■ 手順',
    `1. 作中でプレイヤーが目標を達成する場面に、合言葉${withQr ? '（またはQRコード画像）' : ''}を表示します（${codes.length}件）。`,
    '   書き方はエンジン別の表示例.txt を見てください。プラグインは不要です。',
    `2. ${MANIFEST_FILE_NAME} と はじめに.txt を作品のzipに入れます。発売済みの作品にはアップデートで追加できます。`,
    `3. ${KIT_PATHS.storeTemplate} を参考に、作品ページで案内します。`,
    '',
    '■ 大切な注意',
    '・発売後は合言葉を変えないでください。プレイヤーが開いたおまけが読めなくなります。',
    '・ヒント、目標の表示名、ひとこと、おまけの表示名は公開情報です。ネタバレになることは書かないでください。',
    `・${NOT_DRM_JA}有料の本編をおまけに入れないでください。`,
    '・作品ページで外部ツールやURLに触れる前に、DLsiteの作品登録ルールを確認してください。',
    `・${DISCLAIMER_JA}`,
  ]);
}

function kdfSaltOf(json: string, project: StudioProject): string | undefined {
  try {
    const salt = (JSON.parse(json) as { kdf?: { salt?: unknown } } | null)?.kdf?.salt;
    if (typeof salt === 'string' && salt !== '') return salt;
  } catch {
    // fall through to the project's salt
  }
  return project.kdfSalt;
}

/**
 * Without an absolute app URL (kitHasAppUrl) the 解放URL column of codes.csv is left empty and the texts do not
 * mention QR codes (app/studio.ts then adds no QR PNGs).
 * Returns exactly these paths (all string content):
 *  同梱用_PUBLIC/shiori.json, 同梱用_PUBLIC/はじめに.txt, 非公開_ゲームに埋め込む/codes.csv,
 *  非公開_ゲームに埋め込む/エンジン別の表示例.txt, 非公開_控え/project.shiori-studio.json,
 *  告知文テンプレート.txt, README_最初に読んでください.txt
 */
export function buildKitTextFiles(args: { project: StudioProject; json: string; codes: readonly CodeRow[]; appUrl: string }): KitFile[] {
  const { project, json, codes, appUrl } = args;
  const withUrls = kitHasAppUrl(appUrl);
  return [
    { path: KIT_PATHS.shioriJson, content: json },
    { path: KIT_PATHS.readmePlayer, content: playerReadme(project, codes, appUrl) },
    { path: KIT_PATHS.codesCsv, content: codesCsv(codes, withUrls) },
    { path: KIT_PATHS.snippets, content: snippetsText(project, codes, kdfSaltOf(json, project), withUrls) },
    { path: KIT_PATHS.projectBackup, content: JSON.stringify(project, null, 2) },
    { path: KIT_PATHS.storeTemplate, content: storeTemplateText(project) },
    { path: KIT_PATHS.readmeCreator, content: creatorReadme(project, codes, withUrls) },
  ];
}
