import { beforeAll, describe, it, expect } from 'vitest';
import { DISCLAIMER_JA, NOT_DRM_JA } from './constants';
import { sha256, toHex, utf8 } from './encoding';
import {
  CODES_CSV_HEADER,
  KIT_PATHS,
  buildKitTextFiles,
  csvRow,
  kitHasAppUrl,
  returnCodeHashHex,
  sha256HexSync,
  storeTemplateJa,
} from './kit';
import { buildManifest } from './manifest/build';
import { collectSecrets } from './manifest/noSpoil';
import { FIXTURE_SALT, fixtureProject } from './manifest/testFixtures';
import type { BuildResult, CodeRow, KitFile, StudioProject } from './types';

const EXPECTED_PATHS = [
  '同梱用_PUBLIC/shiori.json',
  '同梱用_PUBLIC/はじめに.txt',
  '非公開_ゲームに埋め込む/codes.csv',
  '非公開_ゲームに埋め込む/エンジン別の表示例.txt',
  '非公開_控え/project.shiori-studio.json',
  '告知文テンプレート.txt',
  'README_最初に読んでください.txt',
];

function text(files: KitFile[], path: string): string {
  const f = files.find((x) => x.path === path);
  if (!f) throw new Error(`missing ${path}`);
  if (typeof f.content !== 'string') throw new Error(`${path} is not text`);
  return f.content;
}

/** Minimal RFC 4180 parser (for round-trip checks). */
function parseCsv(s: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (quoted) {
      if (ch === '"' && s[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\r' && s[i + 1] === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      i++;
    } else cell += ch;
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

describe('csvRow', () => {
  it('joins plain cells with commas and ends with CRLF', () => {
    expect(csvRow(['a', 'b', 'c'])).toBe('a,b,c\r\n');
    expect(csvRow([])).toBe('\r\n');
    expect(csvRow(['', ''])).toBe(',\r\n');
    expect(csvRow(['ほたる・かえで', 'https://x.example/#/u/w-1/K7QM2XRAP'])).toBe(
      'ほたる・かえで,https://x.example/#/u/w-1/K7QM2XRAP\r\n',
    );
  });

  it('quotes fields containing comma, quote, CR or LF and doubles quotes', () => {
    expect(csvRow(['a,b'])).toBe('"a,b"\r\n');
    expect(csvRow(['say "hi"'])).toBe('"say ""hi"""\r\n');
    expect(csvRow(['line1\nline2'])).toBe('"line1\nline2"\r\n');
    expect(csvRow(['cr\rhere'])).toBe('"cr\rhere"\r\n');
    expect(csvRow(['"'])).toBe('""""\r\n');
    expect(csvRow([' spaced '])).toBe(' spaced \r\n');
  });

  it('round-trips through an RFC 4180 parser', () => {
    const cells = ['end-a', 'END, 1', '「星図」の"果て"', 'x\r\ny', ''];
    expect(parseCsv(csvRow(cells))).toEqual([cells]);
  });

  it('neutralizes cells a spreadsheet would read as a formula (CSV injection)', () => {
    expect(csvRow(['-END-', '=x', '+α', '@here', '\tA', 'ok-'])).toBe(`"'-END-","'=x","'+α","'@here","'\tA",ok-\r\n`);
    expect(csvRow(['=SUM(A1,"b")'])).toBe(`"'=SUM(A1,""b"")"\r\n`);
    expect(parseCsv(csvRow(['-END-', '=真エンド=']))).toEqual([["'-END-", "'=真エンド="]]);
    // ordinary cells are unchanged
    expect(csvRow(['END 1', 'K7Q-M2X-RAP', 'https://x.example/#/u/w-1/K7QM2XRAP'])).toBe('END 1,K7Q-M2X-RAP,https://x.example/#/u/w-1/K7QM2XRAP\r\n');
  });
});

describe('kitHasAppUrl', () => {
  it('accepts absolute http(s) URLs only', () => {
    expect(kitHasAppUrl('https://example.github.io/shiori-cho/')).toBe(true);
    expect(kitHasAppUrl(' http://localhost:5173/ ')).toBe(true);
    expect(kitHasAppUrl('')).toBe(false);
    expect(kitHasAppUrl('example.com')).toBe(false);
    expect(kitHasAppUrl('#/u/w-1/X')).toBe(false);
  });
});

describe('storeTemplateJa', () => {
  it('names the extras in the project', () => {
    const t = storeTemplateJa(fixtureProject());
    expect(t.startsWith('【クリア特典】作中の“合言葉”を無料のスマホ用Webアプリ「しおり帳」に入れると、')).toBe(true);
    expect(t).toContain('手紙・あとがき・作中で使える返し合言葉が読めます');
    expect(t).toContain('（ネタバレ防止ヒント・実績チェック付き／アカウント不要）');
  });

  it('matches the spec wording for an afterword + story work', () => {
    const p = fixtureProject();
    p.sealed = p.sealed.slice(0, 1);
    p.sealed.push({ ...p.sealed[0]!, id: 'story', kind: 'story' });
    expect(storeTemplateJa(p)).toBe(
      '【クリア特典】作中の“合言葉”を無料のスマホ用Webアプリ「しおり帳」に入れると、あとがき・後日談が読めます（ネタバレ防止ヒント・実績チェック付き／アカウント不要）',
    );
  });

  it('falls back when there are no sealed items or no code goals', () => {
    expect(storeTemplateJa(fixtureProject({ sealed: [] }))).toContain('隠された実績');
    const manualOnly = fixtureProject({ sealed: [] });
    manualOnly.goals = manualOnly.goals.filter((g) => g.unlockType === 'manual');
    const t = storeTemplateJa(manualOnly);
    expect(t).toContain('しおり帳');
    expect(t).not.toContain('合言葉');
  });
});

describe('sha256HexSync / returnCodeHashHex', () => {
  it('matches WebCrypto for boundary lengths and non-ASCII input', async () => {
    const inputs = [
      '',
      'abc',
      'a'.repeat(55),
      'a'.repeat(56),
      'a'.repeat(63),
      'a'.repeat(64),
      'a'.repeat(65),
      'b'.repeat(1000),
      'しおり帳の合言葉：ほしあかり✨',
    ];
    for (const s of inputs) {
      const bytes = utf8(s);
      expect(sha256HexSync(bytes)).toBe(toHex(await sha256(bytes)));
    }
    expect(sha256HexSync(utf8('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('hashes "shiori-return|" + salt + "|" + NFKC(code)', async () => {
    const expected = toHex(await sha256(utf8(`shiori-return|${FIXTURE_SALT}|ABC123`)));
    expect(returnCodeHashHex(FIXTURE_SALT, 'ＡＢＣ１２３')).toBe(expected);
  });
});

describe('buildKitTextFiles', () => {
  let project: StudioProject;
  let built: BuildResult;
  let files: KitFile[];

  beforeAll(async () => {
    project = fixtureProject();
    built = await buildManifest(project);
    files = buildKitTextFiles({ project, json: built.json, codes: built.codes, appUrl: project.appUrl });
  });

  it('has exactly the §4.4 text paths, in order, all with string content', () => {
    expect(files.map((f) => f.path)).toEqual(EXPECTED_PATHS);
    expect(Object.values(KIT_PATHS)).toEqual(EXPECTED_PATHS);
    for (const f of files) {
      expect(typeof f.content).toBe('string');
      expect((f.content as string).length).toBeGreaterThan(0);
    }
  });

  it('ships the public JSON unchanged', () => {
    expect(text(files, '同梱用_PUBLIC/shiori.json')).toBe(built.json);
  });

  it('はじめに.txt explains the app, import, codes, disclaimers and the app URL', () => {
    const t = text(files, '同梱用_PUBLIC/はじめに.txt');
    expect(t).toContain('しおり帳');
    expect(t).toContain('shiori.json');
    expect(t).toContain('しおりファイルを読み込む');
    expect(t).toContain('貼り付け');
    expect(t).toContain('合言葉');
    expect(t).toContain(DISCLAIMER_JA);
    expect(t).toContain(NOT_DRM_JA);
    expect(t).toContain(project.appUrl);
    expect(t).toContain(project.work.title);
    expect(t).toContain('\r\n');
    expect(t.replace(/\r\n/g, '')).not.toContain('\n');
  });

  it('はじめに.txt contains no code, secret or unlock URL', () => {
    const t = text(files, '同梱用_PUBLIC/はじめに.txt');
    for (const row of built.codes) {
      expect(t).not.toContain(row.display);
      expect(t).not.toContain(row.canonical);
      expect(t).not.toContain(row.canonical.slice(row.canonical.indexOf(':') + 1));
      expect(t).not.toContain(row.unlockUrl);
      expect(t).not.toContain('#/u/');
    }
    for (const s of collectSecrets(project)) {
      if (s === project.work.title) continue;
      expect(t, s).not.toContain(s);
    }
  });

  it('はじめに.txt copes with an empty app URL and a work without codes', () => {
    const p = fixtureProject({ appUrl: '' });
    const t = text(buildKitTextFiles({ project: p, json: '{}', codes: [], appUrl: '' }), '同梱用_PUBLIC/はじめに.txt');
    expect(t).toContain('URLは作品の配布ページなどでご確認ください');
    expect(t).not.toContain('英数字9文字');
    expect(t).toContain(DISCLAIMER_JA);
  });

  it('codes.csv has a BOM, the header and one escaped row per code', () => {
    const csv = text(files, '非公開_ゲームに埋め込む/codes.csv');
    expect(csv.startsWith('\uFEFFgoalId,表示名,秘密タイトル,種類,合言葉,解放URL\r\n')).toBe(true);
    const rows = parseCsv(csv.slice(1));
    expect(rows[0]).toEqual([...CODES_CSV_HEADER]);
    expect(rows.slice(1)).toEqual(
      built.codes.map((c) => [c.goalId, c.label, c.secretTitle, c.codeKind === 'kana' ? 'ひらがな' : '英数字', c.display, c.unlockUrl]),
    );
    expect(rows[1]![3]).toBe('英数字');
    expect(rows[3]![3]).toBe('ひらがな');
    expect(csv.endsWith('\r\n')).toBe(true);
  });

  it('codes.csv escapes commas, quotes and newlines in labels and titles', () => {
    const codes: CodeRow[] = [
      { ...built.codes[0]!, label: 'END 1, 真', secretTitle: '「星図」の"果て"\n第二部' },
    ];
    const csv = text(buildKitTextFiles({ project, json: built.json, codes, appUrl: project.appUrl }), KIT_PATHS.codesCsv);
    expect(csv).toContain('"END 1, 真"');
    expect(csv).toContain('"「星図」の""果て""\n第二部"');
    expect(parseCsv(csv.slice(1))[1]).toEqual([
      'end-a',
      'END 1, 真',
      '「星図」の"果て"\n第二部',
      '英数字',
      'K7Q-M2X-RAP',
      built.codes[0]!.unlockUrl,
    ]);
  });

  it('エンジン別の表示例.txt uses the first code for every engine and notes the return-code hash', () => {
    const t = text(files, KIT_PATHS.snippets);
    for (const name of ['RPGツクールMV / MZ', 'ティラノ', 'ウディタ', "Ren'Py", 'Unity', '音声作品', 'CG集']) {
      expect(t).toContain(name);
    }
    expect(t).toContain('しおり帳の合言葉：\\C[3]K7Q-M2X-RAP\\C[0]');
    expect(t).toContain('しおり帳の合言葉：K7Q-M2X-RAP[p]');
    expect(t).toContain('\\c[2]K7Q-M2X-RAP');
    expect(t).toContain('"しおり帳の合言葉：{b}K7Q-M2X-RAP{/b}"');
    expect(t).toContain('img/pictures/shiori_end-a.png');
    expect(t).toContain('RPGツクールMV / MZ（★この作品のエンジン）');
    // voice snippet reads the first kana code aloud
    expect(t).toContain('しおり帳の合言葉は、ほたる、かえで、つばめ、こだま、すずめ、です');
    // return code note with the hash for the returnCode item
    expect(t).toContain('sha256hex("shiori-return|" + ソルト + "|" + NFKC正規化した入力)');
    expect(t).toContain(`ソルト：${FIXTURE_SALT}`);
    expect(t).toContain('返し合言葉：ほしあかり');
    expect(t).toContain(`ハッシュ値：${returnCodeHashHex(FIXTURE_SALT, 'ほしあかり')}`);
  });

  it('エンジン別の表示例.txt uses a placeholder when there are no codes', () => {
    const p = fixtureProject({ sealed: [] });
    const t = text(buildKitTextFiles({ project: p, json: '{}', codes: [], appUrl: p.appUrl }), KIT_PATHS.snippets);
    expect(t).toContain('XXX-XXX-XXX');
    expect(t).toContain('返し合言葉のおまけはありません');
  });

  it('project.shiori-studio.json is the full project', () => {
    expect(JSON.parse(text(files, KIT_PATHS.projectBackup))).toEqual(JSON.parse(JSON.stringify(project)));
    expect(text(files, KIT_PATHS.projectBackup)).toBe(JSON.stringify(project, null, 2));
  });

  it('告知文テンプレート.txt has the template and the DLsite rules note', () => {
    const t = text(files, KIT_PATHS.storeTemplate);
    expect(t).toContain(storeTemplateJa(project));
    expect(t).toContain('DLsiteの作品登録ルール');
    expect(t).toContain(DISCLAIMER_JA);
  });

  it('README lists what to ship, what never to ship, and what stays local (the store template is not secret)', () => {
    const t = text(files, KIT_PATHS.readmeCreator);
    const ship = t.indexOf('作品に同梱する');
    const never = t.indexOf('絶対に同梱・公開しない');
    const local = t.indexOf('作品のzipには入れない');
    expect(ship).toBeGreaterThan(-1);
    expect(never).toBeGreaterThan(ship);
    expect(local).toBeGreaterThan(never);
    expect(t.indexOf('同梱用_PUBLIC/shiori.json')).toBeGreaterThan(ship);
    expect(t.indexOf('同梱用_PUBLIC/shiori.json')).toBeLessThan(never);
    for (const p of [KIT_PATHS.codesCsv, KIT_PATHS.projectBackup, KIT_PATHS.snippets, '非公開_ゲームに埋め込む/qr/']) {
      expect(t.indexOf(p)).toBeGreaterThan(never);
      expect(t.indexOf(p)).toBeLessThan(local);
    }
    // the store template is meant for the store page: never listed as secret
    expect(t.indexOf(`[ ] ${KIT_PATHS.storeTemplate}`)).toBeGreaterThan(local);
    expect(t.indexOf(`[ ] ${KIT_PATHS.readmeCreator}`)).toBeGreaterThan(local);
    expect(t).toContain('作品ページの説明文などにそのまま使えます');
    expect(t).toContain(NOT_DRM_JA);
    expect(t).toContain(DISCLAIMER_JA);
    expect(t).toContain('発売後は合言葉を変えないでください');
  });

  it('without an absolute app URL: no unlock URLs in codes.csv and no QR promises', () => {
    const p = fixtureProject({ appUrl: '' });
    const codes = built.codes.map((c) => ({ ...c, unlockUrl: `#/u/${p.work.id}/${c.canonical.slice(c.canonical.indexOf(':') + 1)}` }));
    const noUrl = buildKitTextFiles({ project: p, json: built.json, codes, appUrl: '' });
    const rows = parseCsv(text(noUrl, KIT_PATHS.codesCsv).slice(1));
    expect(rows.slice(1).map((r) => r[5])).toEqual(codes.map(() => ''));
    expect(text(noUrl, KIT_PATHS.codesCsv)).not.toContain('#/u/');
    expect(text(noUrl, KIT_PATHS.readmePlayer)).not.toContain('QRコード');
    const snippets = text(noUrl, KIT_PATHS.snippets);
    expect(snippets).toContain('QRコード画像は入っていません');
    expect(snippets).not.toContain('qr/end-a.png');
    const readme = text(noUrl, KIT_PATHS.readmeCreator);
    expect(readme).toContain('QRコード画像は入っていません');
    expect(readme).not.toContain('[ ] 非公開_ゲームに埋め込む/qr/');
    // with a URL the QR text is there
    expect(text(files, KIT_PATHS.readmePlayer)).toContain('QRコード');
    expect(text(files, KIT_PATHS.snippets)).toContain('qr/end-a.png');
  });

  it('lists a return code only for kind 返し合言葉 (the build drops it elsewhere)', () => {
    const p = fixtureProject();
    p.sealed[1]!.payload.returnCode = { code: 'ひみつ', instruction: 'どこかで入力' };
    const t = text(buildKitTextFiles({ project: p, json: built.json, codes: built.codes, appUrl: p.appUrl }), KIT_PATHS.snippets);
    expect(t).not.toContain('ひみつ');
    expect(t).toContain('返し合言葉：ほしあかり');
  });

  it('no public kit file contains a code', () => {
    const publicFiles = [KIT_PATHS.shioriJson, KIT_PATHS.readmePlayer, KIT_PATHS.storeTemplate, KIT_PATHS.readmeCreator];
    for (const path of publicFiles) {
      const t = text(files, path);
      for (const row of built.codes) {
        expect(t, path).not.toContain(row.display);
        expect(t, path).not.toContain(row.canonical);
      }
    }
  });
});
