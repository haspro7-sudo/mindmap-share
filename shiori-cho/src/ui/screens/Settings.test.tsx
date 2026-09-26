// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { exportBackupFile } from '../../app/backup';
import { importBundledDemos } from '../../app/library';
import * as platform from '../../app/platform';
import { verifyPin } from '../../core/crypto/pin';
import * as idb from '../../storage/idbRepo';
import { createMemoryRepo } from '../../storage/memoryRepo';
import { renderWithProviders } from '../../test/renderWithProviders';
import { SettingsScreen } from './Settings';
import { restartApp } from './settings/restart';

vi.mock('../../app/platform', async (importOriginal) => {
  const m = await importOriginal<typeof import('../../app/platform')>();
  return { ...m, download: vi.fn() };
});
vi.mock('./settings/restart', () => ({ restartApp: vi.fn() }));
vi.mock('../../storage/idbRepo', async (importOriginal) => {
  const m = await importOriginal<typeof import('../../storage/idbRepo')>();
  return { ...m, deleteIdbDatabase: vi.fn(async () => undefined) };
});

beforeEach(() => {
  window.location.hash = '#/settings';
  vi.mocked(platform.download).mockClear();
  vi.mocked(idb.deleteIdbDatabase).mockClear();
  vi.mocked(restartApp).mockClear();
});

describe('SettingsScreen (設定)', () => {
  it('おしのびモード switches persist (F2)', async () => {
    const { user, repo } = renderWithProviders(<SettingsScreen />);
    const alias = screen.getByRole('switch', { name: '表示名で隠す' });
    const blur = screen.getByRole('switch', { name: 'おまけの本文をぼかす' });
    expect((alias as HTMLInputElement).checked).toBe(true);
    expect((blur as HTMLInputElement).checked).toBe(false);

    await user.click(alias);
    await user.click(blur);
    await waitFor(async () => {
      const s = await repo.getSettings();
      expect(s.discreet).toEqual({ aliasOnly: false, blurOnHide: true, hideStoreLinks: true, blurExtras: true });
    });
    expect((alias as HTMLInputElement).checked).toBe(false);
    expect((blur as HTMLInputElement).checked).toBe(true);
  });

  it('saves the camouflage text and 「隠すを試す」 hides the app', async () => {
    const { user, repo, onHide } = renderWithProviders(<SettingsScreen />);
    await user.type(screen.getByLabelText('メモ画面に表示する文章'), '買い物：牛乳');
    await user.click(screen.getByRole('button', { name: '隠すを試す' }));
    await waitFor(() => expect(onHide).toHaveBeenCalledTimes(1));
    expect((await repo.getSettings()).camouflageText).toBe('買い物：牛乳');
  });

  it('sets, checks and removes the PIN with re-entry (F3)', async () => {
    const { user, repo } = renderWithProviders(<SettingsScreen />);
    expect(screen.getByText(/画面ロックです。保存データそのものは暗号化されません。/)).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'PINを設定する' }));
    await user.type(screen.getByLabelText('PIN（4〜8桁の数字）'), '1234');
    await user.type(screen.getByLabelText('もう一度入力'), '1235');
    await user.click(screen.getByRole('button', { name: '設定する' }));
    expect(screen.getByRole('alert').textContent).toBe('確認用のPINが一致しません');

    await user.clear(screen.getByLabelText('もう一度入力'));
    await user.type(screen.getByLabelText('もう一度入力'), '1234');
    await user.click(screen.getByRole('button', { name: '設定する' }));
    expect(await screen.findByText('PINを設定しました', undefined, { timeout: 10_000 })).toBeTruthy();
    const withPin = await repo.getSettings();
    expect(withPin.pin).toBeDefined();
    expect(await verifyPin('1234', withPin.pin!)).toBe(true);
    expect(screen.getByLabelText('自動ロックまでの時間')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'PINを外す' }));
    await user.type(screen.getByLabelText('いまのPIN'), '9999');
    await user.click(screen.getByRole('button', { name: 'PINを外す' }));
    expect(await screen.findByText('いまのPINが違います', undefined, { timeout: 10_000 })).toBeTruthy();
    expect((await repo.getSettings()).pin).toBeDefined();

    await user.type(screen.getByLabelText('いまのPIN'), '1234');
    await user.click(screen.getByRole('button', { name: 'PINを外す' }));
    expect(await screen.findByText('PINを外しました', undefined, { timeout: 10_000 })).toBeTruthy();
    expect((await repo.getSettings()).pin).toBeUndefined();
    expect(screen.getByRole('button', { name: 'PINを設定する' })).toBeTruthy();
  });

  it('exports a backup as a download with a neutral file name (F15 AC1)', async () => {
    const repo = createMemoryRepo();
    await importBundledDemos(repo);
    const { user } = renderWithProviders(<SettingsScreen />, { repo });
    await user.click(screen.getByRole('button', { name: 'バックアップを書き出す' }));

    await waitFor(() => expect(platform.download).toHaveBeenCalledTimes(1));
    const [filename, text, mime] = vi.mocked(platform.download).mock.calls[0]!;
    expect(filename).toMatch(/^shiori-backup-\d{8}\.json$/);
    expect(mime).toBe('application/json');
    const file = JSON.parse(text as string) as { format: string; encrypted: boolean; data: { works: unknown[] } };
    expect(file.format).toBe('shiori-backup');
    expect(file.encrypted).toBe(false);
    expect(file.data.works).toHaveLength(2);
    expect((await repo.getSettings()).lastBackupAt).toBeDefined();
    expect(await screen.findByText(`バックアップを書き出しました（${filename}）`)).toBeTruthy();
  });

  it('encrypts the backup with a passphrase of at least 8 characters', async () => {
    const { user } = renderWithProviders(<SettingsScreen />);
    await user.click(screen.getByLabelText('パスフレーズで暗号化する'));
    await user.type(screen.getByLabelText('パスフレーズ（8文字以上）'), 'short');
    await user.click(screen.getByRole('button', { name: 'バックアップを書き出す' }));
    expect(screen.getByRole('alert').textContent).toBe('パスフレーズは8文字以上にしてください');
    expect(platform.download).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText('パスフレーズ（8文字以上）'), '-and-longer');
    await user.type(screen.getAllByLabelText('もう一度入力')[0]!, 'short-and-longer');
    await user.click(screen.getByRole('button', { name: 'バックアップを書き出す' }));
    await waitFor(() => expect(platform.download).toHaveBeenCalledTimes(1), { timeout: 15_000 });
    const text = vi.mocked(platform.download).mock.calls[0]![1] as string;
    expect((JSON.parse(text) as { encrypted: boolean }).encrypted).toBe(true);
  });

  it('restores a backup: preview counts, then まとめる after a confirmation (F15 AC2)', async () => {
    const source = createMemoryRepo();
    await importBundledDemos(source);
    const { text } = await exportBackupFile(source, {});
    const { user, repo, container } = renderWithProviders(<SettingsScreen />);

    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    await user.upload(input, new File([text], 'shiori-backup-20260926.json', { type: 'application/json' }));
    const preview = await screen.findByRole('group', { name: /のバックアップ/ });
    const works = within(preview).getByText('作品').parentElement!;
    expect(within(works).getByText('2')).toBeTruthy();

    await user.click(within(preview).getByRole('button', { name: '復元する' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('バックアップをまとめますか？')).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: 'まとめる' }));
    expect(await screen.findByText('まとめました（作品：追加2・更新0）')).toBeTruthy();
    expect(await repo.listWorks()).toHaveLength(2);
  });

  it('全データを消す asks twice, then deletes the databases (F15 AC6)', async () => {
    const { user } = renderWithProviders(<SettingsScreen />);
    await user.click(screen.getByLabelText('サークル工房のデータも消す'));
    await user.click(screen.getByRole('button', { name: '全データを消す' }));
    let dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('全データを消しますか？')).toBeTruthy();
    expect(within(dialog).getByText(/サークル工房のデータも消えます/)).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: 'キャンセル' }));
    expect(idb.deleteIdbDatabase).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: '全データを消す' }));
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: '次へ' }));
    dialog = await screen.findByRole('alertdialog', { name: '本当に消しますか？' });
    await user.click(within(dialog).getByRole('button', { name: 'すべて消す' }));
    await waitFor(() => expect(idb.deleteIdbDatabase).toHaveBeenCalledTimes(2));
    expect(vi.mocked(idb.deleteIdbDatabase).mock.calls.map((c) => c[0])).toEqual(['shiori', 'shiori-studio']);
    await waitFor(() => expect(restartApp).toHaveBeenCalledTimes(1));
  });

  it('年齢確認を取り消す clears the flag after a confirmation (F1 AC3)', async () => {
    const { user, repo } = renderWithProviders(<SettingsScreen />);
    await user.click(screen.getByRole('button', { name: '年齢確認を取り消す' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: '取り消す' }));
    await waitFor(async () => expect((await repo.getSettings()).ageConfirmedAt).toBeUndefined());
  });
});
