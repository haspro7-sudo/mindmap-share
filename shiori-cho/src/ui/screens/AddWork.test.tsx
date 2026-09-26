// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { importBundledDemos } from '../../app/library';
import { buildQuickManifest } from '../../core/manifest/quick';
import { parseManifestText } from '../../core/manifest/validate';
import type { ShioriManifestV1 } from '../../core/types';
import hoshiyomi from '../../demo/hoshiyomi.shiori.json';
import { createMemoryRepo } from '../../storage/memoryRepo';
import { renderWithProviders } from '../../test/renderWithProviders';
import { AddWorkScreen } from './AddWork';

const HOSHIYOMI_TEXT = JSON.stringify(hoshiyomi, null, 2);

beforeEach(() => {
  window.location.hash = '#/add';
});

type User = ReturnType<typeof renderWithProviders>['user'];

async function pasteAndCheck(user: User, text: string): Promise<void> {
  await user.click(screen.getByRole('button', { name: /テキストを貼り付けて読み込む/ }));
  fireEvent.change(screen.getByLabelText('しおりファイルの内容'), { target: { value: text } });
  await user.click(screen.getByRole('button', { name: '内容を確かめる' }));
}

describe('AddWorkScreen — しおりファイルを読み込む (F5)', () => {
  it('pastes a shiori file, previews it discreetly and imports it (F5 AC1, AC3)', async () => {
    const { user, repo } = renderWithProviders(<AddWorkScreen />);
    await pasteAndCheck(user, HOSHIYOMI_TEXT);

    expect(await screen.findByRole('heading', { name: 'しおりファイルの確認' })).toBeTruthy();
    const summary = screen.getByRole('region', { name: 'しおりファイルの内容' });
    expect(within(summary).getByText('サンプルA')).toBeTruthy();
    expect(summary.querySelector('.ip-counts')?.textContent).toBe('目標 8・合言葉 4・おまけ 3');
    expect(within(summary).getByText('1.0.0')).toBeTruthy();
    expect(within(summary).getByText('作成者の申告：サークル（サンプル工房（架空））')).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/確認済み|検証済み|verified/i);
    // aliasOnly (default ON): the real title only after an explicit tap
    expect(document.body.textContent).not.toContain('星読みの図書館');
    await user.click(screen.getByRole('button', { name: '本当のタイトルを表示' }));
    expect(screen.getByText('星読みの図書館')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: '読み込む' }));
    await waitFor(async () => expect((await repo.listWorks()).length).toBe(1));
    const [work] = await repo.listWorks();
    expect(work!.alias).toBe('サンプルA');
    expect((await repo.getManifest(work!.manifestKey!))?.source).toBe('paste');
    await waitFor(() => expect(window.location.hash).toBe(`#/w/${work!.id}`));
    expect(await screen.findByText('読み込みました')).toBeTruthy();
  });

  it('redeems pending codes after an import and says so (F5 AC5)', async () => {
    const repo = createMemoryRepo();
    await repo.putPending({ id: 'p1', canonical: 'b32:ST4RMAP1X', manifestWorkIdHint: 'demo-hoshiyomi', receivedAt: Date.now() });
    const { user } = renderWithProviders(<AddWorkScreen />, { repo });
    await pasteAndCheck(user, HOSHIYOMI_TEXT);
    await user.click(await screen.findByRole('button', { name: '読み込む' }));
    expect(await screen.findByText('読み込みました。保留中の合言葉を1件使いました', undefined, { timeout: 10_000 })).toBeTruthy();
    expect(await repo.listPending()).toEqual([]);
  });

  it('lists a JSON syntax error with its position', async () => {
    const { user } = renderWithProviders(<AddWorkScreen />);
    await pasteAndCheck(user, '{\n  "schema": "shiori/1",,\n}');
    expect(await screen.findByRole('heading', { name: '読み込めませんでした' })).toBeTruthy();
    expect(screen.getByText(/JSONの形式が正しくありません（2行目/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '戻る' }));
    expect(screen.getByRole('heading', { name: '作品を追加' })).toBeTruthy();
    // the pasted text is kept for a fix
    expect((screen.getByLabelText('しおりファイルの内容') as HTMLTextAreaElement).value).toContain('"schema"');
  });

  it('lists at most 20 schema errors (path + message) and 「ほかにN件」 (F5 AC2)', async () => {
    const m = buildQuickManifest({ title: 'テスト', kind: 'game', workId: 'p-0123456789', counts: { endings: 30, cg: 0, achievements: 0, tracks: 0, chapters: 0 } });
    const broken = { ...m, goals: m.goals.map((g) => ({ ...g, group: 'nowhere' })) };
    const text = JSON.stringify(broken);
    const r = parseManifestText(text);
    expect(r.ok).toBe(false);
    const total = r.ok ? 0 : r.errors.length;
    expect(total).toBeGreaterThan(20);

    const { user } = renderWithProviders(<AddWorkScreen />);
    await pasteAndCheck(user, text);
    await screen.findByRole('heading', { name: '読み込めませんでした' });
    const list = screen.getByRole('region', { name: '問題の一覧' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(20);
    expect(within(list).getByText('goals[0].group')).toBeTruthy();
    expect(within(list).getAllByText('グループ「nowhere」が見つかりません').length).toBe(20);
    expect(screen.getByText(`ほかに${total - 20}件`)).toBeTruthy();
  });

  it('rejects pasted text over 512 KiB before parsing', async () => {
    const { user } = renderWithProviders(<AddWorkScreen />);
    await pasteAndCheck(user, 'a'.repeat(512 * 1024 + 1));
    expect(screen.getByText('ファイルが大きすぎます（512KBまで）')).toBeTruthy();
    expect(screen.getByRole('heading', { name: '作品を追加' })).toBeTruthy();
  });

  it('reads a chosen file, and rejects a too-large one without reading it', async () => {
    const { user, container } = renderWithProviders(<AddWorkScreen />);
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    expect(input.accept).toBe('.json,application/json');

    const big = new File(['x'.repeat(600 * 1024)], 'shiori.json', { type: 'application/json' });
    let read = false;
    Object.defineProperty(big, 'text', { value: () => ((read = true), Promise.resolve('')) });
    await user.upload(input, big);
    expect(await screen.findByText('ファイルが大きすぎます（512KBまで）')).toBeTruthy();
    expect(read).toBe(false);

    await user.upload(input, new File([HOSHIYOMI_TEXT], 'shiori.json', { type: 'application/json' }));
    expect(await screen.findByRole('heading', { name: 'しおりファイルの確認' })).toBeTruthy();
  });

  it('accepts a file dropped on the page (desktop drag & drop)', async () => {
    renderWithProviders(<AddWorkScreen />);
    const file = new File([HOSHIYOMI_TEXT], 'shiori.json', { type: 'application/json' });
    const dataTransfer = { types: ['Files'], files: [file], dropEffect: 'none' };
    fireEvent.dragEnter(window, { dataTransfer });
    expect(screen.getByText('ここで離すと読み込みます')).toBeTruthy();
    fireEvent.drop(window, { dataTransfer });
    expect(await screen.findByRole('heading', { name: 'しおりファイルの確認' })).toBeTruthy();
  });

  it('says 「読み込み済みです」 for the same file again, and previews an update with the diff (F5 AC4)', async () => {
    const repo = createMemoryRepo();
    await importBundledDemos(repo);
    const { user } = renderWithProviders(<AddWorkScreen />, { repo });
    await pasteAndCheck(user, HOSHIYOMI_TEXT);
    expect(await screen.findByRole('heading', { name: '読み込み済みです' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '戻る' }));

    const m = structuredClone(hoshiyomi) as unknown as ShioriManifestV1;
    m.work.version = '1.1.0';
    m.goals = m.goals.filter((g) => g.id !== 'ach-cat');
    m.goals.push({ id: 'ach-new', group: 'ach', label: '新しい実績', spoiler: 0, hints: [], unlock: { type: 'manual' } });
    fireEvent.change(screen.getByLabelText('しおりファイルの内容'), { target: { value: JSON.stringify(m) } });
    await user.click(screen.getByRole('button', { name: '内容を確かめる' }));
    expect(await screen.findByText('『サンプルA』の更新として読み込みます：追加1・削除1')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '更新を読み込む' }));
    expect(await screen.findByText('更新を読み込みました')).toBeTruthy();
    const work = await repo.findWorkByManifestWorkId('demo-hoshiyomi');
    expect(work?.newGoalIds).toEqual(['ach-new']);
  });
});

describe('AddWorkScreen — かんたんしおり (F6)', () => {
  it('validates the title and the counts, then creates the checklist (F6 AC1–AC2)', async () => {
    const { user, repo } = renderWithProviders(<AddWorkScreen />);
    await user.click(screen.getByRole('button', { name: 'かんたんしおりを作る' }));
    expect(screen.getByRole('heading', { name: 'かんたんしおりを作る' })).toBeTruthy();

    await user.click(screen.getByRole('button', { name: '作成する' }));
    expect(screen.getByText('タイトルを入力してください')).toBeTruthy();
    expect(screen.getByText('エンディング・CG・実績・トラックのどれかを1以上にしてください')).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByLabelText(/^タイトル/));

    await user.type(screen.getByLabelText(/^タイトル/), '夜の図書室');
    // chapters alone make no goals
    fireEvent.change(screen.getByLabelText('章'), { target: { value: '4' } });
    await user.click(screen.getByRole('button', { name: '作成する' }));
    expect(screen.getByText('エンディング・CG・実績・トラックのどれかを1以上にしてください')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('エンディング'), { target: { value: '51' } });
    await user.click(screen.getByRole('button', { name: '作成する' }));
    expect(screen.getByText('エンディングは0〜50の整数で入力してください')).toBeTruthy();
    expect((await repo.listWorks()).length).toBe(0);

    fireEvent.change(screen.getByLabelText('エンディング'), { target: { value: '0' } });
    for (let i = 0; i < 3; i++) await user.click(screen.getByRole('button', { name: 'エンディングを1つ増やす' }));
    await user.click(screen.getByRole('button', { name: '回想・CGを1つ増やす' }));
    expect(screen.getByText('チェック項目 4個・章 4')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '作成する' }));

    await waitFor(async () => expect((await repo.listWorks()).length).toBe(1));
    const [work] = await repo.listWorks();
    const rec = await repo.getManifest(work!.manifestKey!);
    expect(rec?.source).toBe('quick');
    expect(rec?.manifest.author.kind).toBe('player');
    expect(rec?.manifest.goals.map((g) => g.label)).toEqual(['END 1', 'END 2', 'END 3', 'CG 1']);
    expect(rec?.manifest.checkpoints.map((c) => c.label)).toEqual(['第1章', '第2章', '第3章', '第4章']);
    expect(work!.alias).toBe('作品A');
    await waitFor(() => expect(window.location.hash).toBe(`#/w/${work!.id}`));
  });

  it('「やめる」 returns to the menu', async () => {
    const { user } = renderWithProviders(<AddWorkScreen />);
    await user.click(screen.getByRole('button', { name: 'かんたんしおりを作る' }));
    await user.click(screen.getByRole('button', { name: 'やめる' }));
    expect(screen.getByRole('heading', { name: '作品を追加' })).toBeTruthy();
  });
});

describe('AddWorkScreen — 記録だけ付ける (F4 AC1)', () => {
  it('validates the store code inline and creates a work without a manifest', async () => {
    const { user, repo } = renderWithProviders(<AddWorkScreen />);
    await user.click(screen.getByRole('button', { name: '記録だけ付ける' }));
    const alias = screen.getByLabelText(/^表示名/) as HTMLInputElement;
    await waitFor(() => expect(alias.placeholder).toBe('作品A'));

    await user.type(screen.getByLabelText(/^タイトル/), '白い灯台');
    const store = screen.getByLabelText(/^作品コード/);
    await user.type(store, 'rj123');
    await user.tab();
    expect(screen.getByText('作品コードの形式が違います（例: RJ01234567）')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '追加する' }));
    expect((await repo.listWorks()).length).toBe(0);

    await user.clear(store);
    await user.type(store, 'ｒｊ０１２３４５６７');
    expect(screen.queryByText('作品コードの形式が違います（例: RJ01234567）')).toBeNull();
    await user.click(screen.getByRole('radio', { name: '音声' }));
    await user.click(screen.getByRole('radio', { name: '絵文字 🌙' }));
    await user.click(screen.getByRole('radio', { name: '藤色' }));
    await user.click(screen.getByRole('button', { name: '追加する' }));

    await waitFor(async () => expect((await repo.listWorks()).length).toBe(1));
    const [work] = await repo.listWorks();
    expect(work).toMatchObject({
      title: '白い灯台',
      alias: '作品A',
      kind: 'voice',
      storeCode: 'RJ01234567',
      coverEmoji: '🌙',
      coverColor: 'plum',
      status: 'backlog',
    });
    expect(work!.manifestKey).toBeUndefined();
    await waitFor(() => expect(window.location.hash).toBe(`#/w/${work!.id}`));
  });
});

describe('AddWorkScreen — サンプルを試す (F17 AC1)', () => {
  it('imports both demos and goes back to the library', async () => {
    const { user, repo } = renderWithProviders(<AddWorkScreen />);
    await user.click(screen.getByRole('button', { name: 'サンプルを試す' }));
    await waitFor(async () => expect((await repo.listWorks()).map((w) => w.alias).sort()).toEqual(['サンプルA', 'サンプルB']));
    await waitFor(() => expect(window.location.hash).toBe('#/'));
  });
});
