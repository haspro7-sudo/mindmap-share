// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as platform from '../../../app/platform';
import { createQuickWork, createWork, importBundledDemos } from '../../../app/library';
import { DEFAULT_SETTINGS } from '../../../core/types';
import { createMemoryRepo } from '../../../storage/memoryRepo';
import { renderWithProviders } from '../../../test/renderWithProviders';
import { WorkEditScreen } from './WorkEdit';

afterEach(() => {
  vi.restoreAllMocks();
  window.location.hash = '';
});

describe('WorkEditScreen (作品設定)', () => {
  it('keeps the real title hidden in おしのびモード until 「本当のタイトルを表示」', async () => {
    const repo = createMemoryRepo();
    const work = await createWork(repo, { title: 'ひみつの題名', kind: 'game' });
    const { user } = renderWithProviders(<WorkEditScreen workId={work.id} />, { repo });
    await screen.findByRole('heading', { name: '作品設定' });
    expect(screen.queryByDisplayValue('ひみつの題名')).toBeNull();
    expect(document.body.textContent).not.toContain('ひみつの題名');
    await user.click(screen.getByRole('button', { name: '本当のタイトルを表示' }));
    expect(screen.getByLabelText('本当のタイトル')).toHaveProperty('value', 'ひみつの題名');
  });

  it('validates and normalizes the store code, and saves the other fields', async () => {
    const repo = createMemoryRepo();
    const work = await createWork(repo, { title: 'テスト', kind: 'game' });
    const { user } = renderWithProviders(<WorkEditScreen workId={work.id} />, {
      repo,
      settings: { discreet: { ...DEFAULT_SETTINGS.discreet, aliasOnly: false } },
    });
    const store = await screen.findByLabelText('作品コード（任意）');
    await user.type(store, 'RJ123');
    await user.click(screen.getByRole('button', { name: '変更を保存する' }));
    expect(await screen.findByText('作品コードの形式が違います（例: RJ01234567）')).toBeTruthy();
    expect((await repo.getWork(work.id))?.storeCode).toBeUndefined();

    await user.clear(store);
    await user.type(store, 'ｒｊ０１２３４５６７');
    await user.clear(screen.getByLabelText('表示名'));
    await user.type(screen.getByLabelText('表示名'), 'あの作品');
    await user.selectOptions(screen.getByLabelText('状態'), 'cleared');
    await user.click(screen.getByRole('radio', { name: /2: 条件の方向性まで見せる/ }));
    await user.click(screen.getByRole('radio', { name: '空' }));
    await user.click(screen.getByRole('button', { name: '変更を保存する' }));
    await waitFor(async () => expect((await repo.getWork(work.id))?.storeCode).toBe('RJ01234567'));
    const saved = (await repo.getWork(work.id))!;
    expect(saved).toMatchObject({ alias: 'あの作品', status: 'cleared', spoilerTolerance: 2, coverColor: 'sky', title: 'テスト' });
    expect(await screen.findByRole('button', { name: '保存済み' })).toBeTruthy();
  });

  it('shows the manifest author claim and exports a player manifest as shiori.json', async () => {
    const repo = createMemoryRepo();
    const work = await createQuickWork(repo, {
      title: 'テスト',
      kind: 'game',
      counts: { endings: 2, cg: 0, achievements: 0, tracks: 0, chapters: 0 },
    });
    const download = vi.spyOn(platform, 'download').mockImplementation(() => undefined);
    const { user } = renderWithProviders(<WorkEditScreen workId={work.id} />, { repo });
    expect(await screen.findByText(/作成者の申告：プレイヤー/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'しおりファイルとして書き出す' }));
    await waitFor(() => expect(download).toHaveBeenCalledTimes(1));
    const [name, text] = download.mock.calls[0]!;
    expect(name).toBe('shiori.json');
    expect(JSON.parse(text as string).author.kind).toBe('player');
  });

  it('creator manifests show the claim but no export button', async () => {
    const repo = createMemoryRepo();
    const [hoshiyomi] = await importBundledDemos(repo);
    renderWithProviders(<WorkEditScreen workId={hoshiyomi!} />, { repo });
    expect(await screen.findByText(/作成者の申告：サークル/)).toBeTruthy();
    expect(screen.getAllByText('1.0.0').length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByRole('button', { name: 'しおりファイルとして書き出す' })).toBeNull();
    expect(screen.getByRole('link', { name: '更新を読み込む' }).getAttribute('href')).toBe('#/add');
  });

  it('deletes the work only after a double confirmation', async () => {
    const repo = createMemoryRepo();
    const work = await createWork(repo, { title: 'テスト', kind: 'game' });
    window.location.hash = `#/w/${work.id}/edit`;
    const { user } = renderWithProviders(<WorkEditScreen workId={work.id} />, { repo });
    await user.click(await screen.findByRole('button', { name: 'この作品を削除' }));
    await user.click(within(await screen.findByRole('alertdialog', { name: 'この作品を削除しますか？' })).getByRole('button', { name: '削除へ進む' }));
    await user.click(within(await screen.findByRole('alertdialog', { name: '本当に削除しますか？' })).getByRole('button', { name: 'キャンセル' }));
    expect(await repo.getWork(work.id)).toBeDefined();

    await user.click(screen.getByRole('button', { name: 'この作品を削除' }));
    await user.click(within(await screen.findByRole('alertdialog', { name: 'この作品を削除しますか？' })).getByRole('button', { name: '削除へ進む' }));
    await user.click(within(await screen.findByRole('alertdialog', { name: '本当に削除しますか？' })).getByRole('button', { name: '削除する' }));
    await waitFor(async () => expect(await repo.getWork(work.id)).toBeUndefined());
    await waitFor(() => expect(window.location.hash).toBe('#/'));
  });
});
