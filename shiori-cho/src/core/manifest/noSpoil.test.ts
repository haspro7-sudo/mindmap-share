import { describe, it, expect } from 'vitest';
import { codeSecretForms, collectSecrets, collectSignatures, findLeaks, foldText, leakMatcher } from './noSpoil';
import { fixtureProject } from './testFixtures';

describe('codeSecretForms', () => {
  it('covers display, canonical, bare and common spellings of a Base32 code', () => {
    const forms = codeSecretForms('k7q m2x rap');
    for (const f of ['k7q m2x rap', 'K7Q-M2X-RAP', 'b32:K7QM2XRAP', 'K7QM2XRAP', 'K7Q M2X RAP', 'k7q-m2x-rap', 'k7qm2xrap']) {
      expect(forms).toContain(f);
    }
  });

  it('covers display, canonical, bare, other separators and katakana of a kana code', () => {
    const forms = codeSecretForms('ほたる かえで つばめ こだま すずめ');
    for (const f of [
      'ほたる・かえで・つばめ・こだま・すずめ',
      'kana:ほたるかえでつばめこだますずめ',
      'ほたるかえでつばめこだますずめ',
      'ほたる、かえで、つばめ、こだま、すずめ',
      'ほたる　かえで　つばめ　こだま　すずめ',
      'ホタルカエデツバメコダマスズメ',
      'ホタル・カエデ・ツバメ・コダマ・スズメ',
    ]) {
      expect(forms).toContain(f);
    }
  });

  it('keeps the raw input of an unparseable code', () => {
    expect(codeSecretForms(' ABC-DEF ')).toEqual(['ABC-DEF']);
    expect(codeSecretForms('')).toEqual([]);
  });
});

describe('collectSecrets', () => {
  it('collects codes, secret texts, payload texts and return codes', () => {
    const s = collectSecrets(fixtureProject());
    for (const x of [
      'K7Q-M2X-RAP',
      'b32:K7QM2XRAP',
      'K7QM2XRAP',
      'ST4-RMA-P1X',
      'ST4RMAP1X',
      'ほたる・かえで・つばめ・こだま・すずめ',
      'ほたるかえでつばめこだますずめ',
      '星図の果て',
      '星の地図を最後まで読み解いた。\n夜空の端に、小さな灯りがあった。',
      'おめでとうございます！星図の旅はここで終わりです。',
      '閉館の鐘',
      '夜更けの朗読',
      '聞いてくれてありがとう。',
      '最後まで遊んでくれて、ありがとうございました。\n次回作もよろしくお願いします。',
      '感謝をこめて',
      '図書館の扉',
      'ほしあかり',
    ]) {
      expect(s).toContain(x);
    }
  });

  it('does not treat a `from` signature as a hard secret (F16 AC4 does not list it)', () => {
    expect(collectSecrets(fixtureProject())).not.toContain('司書ミナより');
  });

  it('skips a title equal to its label up to width, case and spaces', () => {
    const p = fixtureProject();
    p.goals[0]!.label = '星図 の 果て';
    p.sealed[1]!.label = ' 感謝をこめて ';
    const s = collectSecrets(p);
    expect(s).not.toContain('星図の果て');
    expect(s).not.toContain('感謝をこめて');
  });

  it('skips a title identical to its public label, a from equal to the circle, and empty or 1-char strings', () => {
    const p = fixtureProject();
    p.goals[1]!.label = '閉館の鐘';
    p.goals[2]!.secret = { title: '夜更けの朗読', description: '', unlockMessage: '!' };
    const s = collectSecrets(p);
    expect(s).not.toContain('閉館の鐘');
    expect(s).not.toContain('あとがき'); // payload title === sealed label
    expect(s).not.toContain('テスト工房（架空）'); // afterword signed with the circle name
    expect(s).not.toContain('');
    expect(s).not.toContain('!');
    expect(s.every((x) => [...x].length >= 2)).toBe(true);
  });

  it('ignores manual goals, trims and deduplicates', () => {
    const p = fixtureProject();
    p.goals[3]!.code = 'NEK-0T0-M0E'; // manual goal: its (stray) code is not collected
    p.sealed[1]!.payload.body = '  星図の果て  ';
    const s = collectSecrets(p);
    expect(s).not.toContain('NEK-0T0-M0E');
    expect(s.filter((x) => x === '星図の果て')).toHaveLength(1);
    expect(new Set(s).size).toBe(s.length);
  });
});

describe('findLeaks', () => {
  const json = JSON.stringify(
    {
      schema: 'shiori/1',
      kdf: { alg: 'PBKDF2-SHA256', iterations: 100000, salt: 'AAECAwQFBgcICQoLDA0ODw' },
      goals: [{ id: 'end-a', label: 'END 1', hints: ['夜の図書館へ'], secret: { iv: 'Zm9vYmFyYmF6cXV4', ct: 'QUJDREVGR0hJSktMTU5PUA' } }],
    },
    null,
    2,
  );

  it('finds nothing in a clean file', () => {
    expect(findLeaks(json, ['星図の果て', 'K7Q-M2X-RAP'])).toEqual([]);
  });

  it('finds a raw substring in a public field', () => {
    const leaky = json.replace('夜の図書館へ', '星図の果てへ');
    expect(findLeaks(leaky, ['星図の果て', '閉館の鐘'])).toEqual(['星図の果て']);
  });

  it('finds multi-line secrets through their JSON-escaped form', () => {
    const body = '一行目\n二行目の"引用"';
    const leaky = JSON.stringify({ label: 'x', teaser: `前置き${body}` });
    expect(leaky).not.toContain(body);
    expect(findLeaks(leaky, [body])).toEqual([body]);
    // also when the text is not valid JSON
    const broken = leaky.slice(0, -1);
    expect(findLeaks(broken, [body])).toEqual([body]);
  });

  it('finds secrets written with \\u escapes', () => {
    const escaped = '{"hints":["\\u661f\\u56f3\\u306e\\u679c\\u3066"]}';
    expect(findLeaks(escaped, ['星図の果て'])).toEqual(['星図の果て']);
  });

  it('ignores base64url binary fields and numbers (no accidental matches)', () => {
    expect(findLeaks(json, ['Zm9v', 'QUJD', 'AAECAwQF', 'ICQo'])).toEqual([]);
    expect(findLeaks(json, ['0000', '100000'])).toEqual([]);
    // but the same text in a public field is a leak
    expect(findLeaks(json.replace('夜の図書館へ', 'Zm9v'), ['Zm9v'])).toEqual(['Zm9v']);
  });

  it('checks keys and non-JSON text too', () => {
    expect(findLeaks('{"星図の果て": 1}', ['星図の果て'])).toEqual(['星図の果て']);
    expect(findLeaks('合言葉は K7Q-M2X-RAP です', ['K7Q-M2X-RAP', 'ST4-RMA-P1X'])).toEqual(['K7Q-M2X-RAP']);
  });

  it('skips secrets shorter than 2 characters and reports each leak once', () => {
    expect(findLeaks('{"a":"x"}', ['x', ''])).toEqual([]);
    expect(findLeaks('{"a":"ほしあかり ほしあかり"}', ['ほしあかり', 'ほしあかり'])).toEqual(['ほしあかり']);
  });
});

describe('collectSignatures', () => {
  it('lists letter signatures, except the public circle / author name', () => {
    const p = fixtureProject();
    expect(collectSignatures(p)).toEqual([{ index: 1, label: '司書からの手紙', from: '司書ミナより' }]);
    p.sealed[1]!.payload.from = ' テスト工房（架空） ';
    p.sealed[2]!.payload.from = 'ミナ';
    expect(collectSignatures(p)).toEqual([{ index: 2, label: '扉の合言葉', from: 'ミナ' }]);
    p.sealed[2]!.payload.from = 'ミ';
    expect(collectSignatures(p)).toEqual([]);
  });
});

describe('findLeaks: normalized spellings (F16 AC4: any spelling the parser accepts is a plaintext code)', () => {
  const b32 = 'AMA-0T0-N1J';
  const kana = 'ほたる・かえで・つばめ・こだま・すずめ';
  const secrets = [...codeSecretForms(b32), ...codeSecretForms(kana), '星図の果て'];
  const inHint = (hint: string) => findLeaks(JSON.stringify({ goals: [{ label: 'END 1', hints: [hint] }] }), secrets);

  it.each([
    ['full width (IME default)', '合言葉 ＡＭＡ－０Ｔ０－Ｎ１Ｊ の表示を修正'],
    ['middle dots', 'AMA・0T0・N1J'],
    ['O instead of 0', 'AMA-OTO-N1J'],
    ['lower case with spaces', 'ama 0t0 n1j'],
    ['mixed separators', 'AMA0T0 N1J'],
    ['I and L aliases', 'AMA-0T0-NIJ'],
    ['long dash', 'AMA—0T0—N1J'],
  ])('finds a Base32 code written %s', (_, hint) => {
    expect(inHint(hint)).toEqual([b32]);
  });

  it.each([
    ['katakana with spaces', 'ホタル カエデ ツバメ コダマ スズメ'],
    ['half-width katakana', 'ﾎﾀﾙ ｶｴﾃﾞ ﾂﾊﾞﾒ ｺﾀﾞﾏ ｽｽﾞﾒ'],
    ['comma and space', 'ほたる、 かえで、 つばめ、 こだま、 すずめ'],
    ['long vowel marks', 'ほたるーかえでーつばめーこだまーすずめ'],
    ['inside a sentence', '合言葉は「ほたる かえで つばめ こだま すずめ」です'],
  ])('finds a kana code written in %s', (_, hint) => {
    expect(inHint(hint)).toEqual([kana]);
  });

  it('finds secret texts with other width, case or spaces', () => {
    expect(inHint('星図 の 果て を目指そう')).toEqual(['星図の果て']);
    expect(findLeaks('{"a":"ＨＥＬＬＯ ｗｏｒｌｄ"}', ['hello world'])).toEqual(['hello world']);
  });

  it('compares keys and fixed-vocabulary values (kind, engine, mode…) with the exact secret only', () => {
    const json = JSON.stringify({ work: { kind: 'game', engine: 'rpgmaker-mz' }, sealed: [{ kind: 'afterword', label: 'あとがき' }] });
    expect(findLeaks(json, ['After', 'Label', 'GAME'])).toEqual([]);
    // exact matches are still reported there, and free text is still folded
    expect(findLeaks(json, ['afterword'])).toEqual(['afterword']);
    expect(findLeaks(JSON.stringify({ goals: [{ teaser: 'after the rain' }] }), ['After'])).toEqual(['After']);
    expect(leakMatcher('After')('afterword', true)).toBe(false);
    expect(leakMatcher('After')('afterword')).toBe(true);
  });

  it('does not report unrelated text', () => {
    expect(inHint('AMA-0T0-N1K と ほたる かえで')).toEqual([]);
    expect(inHint('END 1 から END 3 まで見よう')).toEqual([]);
  });

  it('leakMatcher agrees with findLeaks', () => {
    const m = leakMatcher(b32);
    expect(m('ａｍａ・ｏｔｏ・ｎｉｊ')).toBe(true);
    expect(m('ほかの文章')).toBe(false);
    expect(leakMatcher('星図の果て')('星図　の果て')).toBe(true);
  });

  it('foldText folds width, case and whitespace', () => {
    expect(foldText('Ａ Ｂ\tc　Ｄ')).toBe('abcd');
  });
});
