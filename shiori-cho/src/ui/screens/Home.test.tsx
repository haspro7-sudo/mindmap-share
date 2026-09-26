// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { createWork, importBundledDemos, setGoalDone } from '../../app/library';
import { endSession, startSession } from '../../app/sessions';
import type { WorkRecord } from '../../core/types';
import { createMemoryRepo } from '../../storage/memoryRepo';
import type { ShioriRepo } from '../../storage/repo';
import { renderWithProviders } from '../../test/renderWithProviders';
import { HomeScreen } from './Home';

const DAY = 86_400_000;

/** 10:00 local time, `days` calendar days ago (stable across midnight). */
function daysAgoAt10(days: number): number {
  const d = new Date();
  d.setHours(10, 0, 0, 0);
  d.setDate(d.getDate() - days);
  return d.getTime();
}

async function seedDemos(repo: ShioriRepo): Promise<{ a: WorkRecord; b: WorkRecord }> {
  const [idA, idB] = await importBundledDemos(repo, Date.now() - 10 * DAY);
  const a = await repo.getWork(idA!);
  const b = await repo.getWork(idB!);
  return { a: a!, b: b! };
}

/** Titles of the work cards, in display order. */
function cardTitles(): string[] {
  const list = screen.getByRole('list', { name: /作品/ });
  return within(list)
    .getAllByRole('link')
    .map((a) => a.querySelector('.home-card-title')?.textContent ?? '');
}

beforeEach(() => {
  window.location.hash = '';
  window.sessionStorage.clear();
});

describe('HomeScreen (本棚)', () => {
  it('shows the empty state, and 「サンプルを試す」 fills the library (F17 AC1)', async () => {
    const { user, repo } = renderWithProviders(<HomeScreen />);
    expect(await screen.findByRole('heading', { name: '本棚はまだ空です' })).toBeTruthy();
    expect(screen.getByRole('link', { name: '作品を追加' }).getAttribute('href')).toBe('#/add');
    await user.click(screen.getByRole('button', { name: 'サンプルを試す' }));
    expect(await screen.findByText('サンプルA')).toBeTruthy();
    expect(screen.getByText('サンプルB')).toBeTruthy();
    expect((await repo.listWorks()).length).toBe(2);
    expect(await screen.findByText('サンプルを2作品追加しました')).toBeTruthy();
  });

  it('filters by status with counts and sorts (F4 AC2)', async () => {
    const repo = createMemoryRepo();
    const { a, b } = await seedDemos(repo);
    await createWork(repo, { title: '青い鳥の歌', kind: 'other' }, Date.now() - DAY); // alias 作品A, added last
    await repo.putWork({ ...a, status: 'cleared' });
    await repo.putWork({ ...b, lastPlayedAt: Date.now() - 2 * DAY });

    const { user } = renderWithProviders(<HomeScreen />, { repo, settings: { changesSinceBackup: 0 } });
    await screen.findByText('サンプルA');
    const chips = screen.getByRole('group', { name: '状態で絞り込む' });
    expect(within(chips).getByRole('button', { name: /^すべて\s*3$/ }).getAttribute('aria-pressed')).toBe('true');
    expect(within(chips).getByRole('button', { name: /^積み\s*2$/ })).toBeTruthy();
    expect(within(chips).getByRole('button', { name: /^クリア\s*1$/ })).toBeTruthy();
    expect(within(chips).getByRole('button', { name: /^コンプ\s*0$/ })).toBeTruthy();

    // default: 最近遊んだ順 — the played work first, then the rest newest first
    expect(cardTitles()).toEqual(['サンプルB', '作品A', 'サンプルA']);
    expect(screen.getByText('2日前')).toBeTruthy();

    await user.click(within(chips).getByRole('button', { name: /^クリア/ }));
    expect(cardTitles()).toEqual(['サンプルA']);
    await user.click(within(chips).getByRole('button', { name: /^コンプ/ }));
    expect(screen.getByText('この状態の作品はありません。')).toBeTruthy();
    await user.click(within(chips).getByRole('button', { name: /^すべて/ }));

    const sort = screen.getByRole('combobox', { name: '並び順' });
    await user.selectOptions(sort, 'name');
    expect(cardTitles()).toEqual(['サンプルA', 'サンプルB', '作品A']);
    await user.selectOptions(sort, 'added');
    expect(cardTitles()[0]).toBe('作品A');
  });

  it('cards show alias or real title, status, progress % and the NEW badge (F4 AC3, F2 AC2)', async () => {
    const repo = createMemoryRepo();
    const { a } = await seedDemos(repo);
    await setGoalDone(repo, a.id, 'ach-cat', true);
    await repo.putWork({ ...(await repo.getWork(a.id))!, newGoalIds: ['ach-cat'] });

    renderWithProviders(<HomeScreen />, { repo, settings: { changesSinceBackup: 0 } });
    const card = (await screen.findByText('サンプルA')).closest('a')!;
    expect(card.getAttribute('href')).toBe(`#/w/${a.id}`);
    expect(within(card).getByText('積み')).toBeTruthy();
    expect(within(card).getByText('NEW')).toBeTruthy();
    expect(within(card).getByRole('progressbar').getAttribute('aria-valuenow')).toBe('12'); // 1 of 8
    expect(document.body.textContent).not.toContain('星読みの図書館');
  });

  it('shows real titles when おしのびモード aliasOnly is off', async () => {
    const repo = createMemoryRepo();
    await seedDemos(repo);
    renderWithProviders(<HomeScreen />, { repo, settings: { discreet: { aliasOnly: false, blurOnHide: true, hideStoreLinks: true, blurExtras: false }, changesSinceBackup: 0 } });
    expect(await screen.findByText('星読みの図書館')).toBeTruthy();
    expect(screen.queryByText('サンプルA')).toBeNull();
  });

  it('shows the resume card and 「続きを始める」 opens a session and the work (F4 AC4, F13 AC3)', async () => {
    const repo = createMemoryRepo();
    const { a, b } = await seedDemos(repo);
    const s1 = await startSession(repo, b.id, daysAgoAt10(6));
    await endSession(repo, s1.id, { whereNote: '古い記録' }, daysAgoAt10(6) + 1_800_000);
    const s2 = await startSession(repo, a.id, daysAgoAt10(3));
    await endSession(
      repo,
      s2.id,
      { checkpointId: 'ch2', whereNote: '図書館の2階まで', nextTodo: '猫に話しかける' },
      daysAgoAt10(3) + 1_800_000,
    );

    const { user } = renderWithProviders(<HomeScreen />, { repo, settings: { changesSinceBackup: 0 } });
    const heading = await screen.findByRole('heading', { name: '前回の続き（3日ぶり）' });
    const card = heading.closest('section')!;
    expect(within(card).getByText('サンプルA')).toBeTruthy();
    expect(within(card).getByText('第2章')).toBeTruthy();
    expect(within(card).getByText('図書館の2階まで')).toBeTruthy();
    expect(within(card).getByText('猫に話しかける')).toBeTruthy();
    expect(within(card).queryByText('古い記録')).toBeNull();

    await user.click(within(card).getByRole('button', { name: /続きを始める/ }));
    await waitFor(() => expect(window.location.hash).toBe(`#/w/${a.id}`));
    expect((await repo.getOpenSession())?.workId).toBe(a.id);
  });

  it('「続きを始める」 while another work is being recorded shows the conflict (F13 AC1)', async () => {
    const repo = createMemoryRepo();
    const { a, b } = await seedDemos(repo);
    const s = await startSession(repo, a.id, daysAgoAt10(1));
    await endSession(repo, s.id, { nextTodo: '第3章へ' }, daysAgoAt10(1) + 600_000);
    await startSession(repo, b.id);

    const { user } = renderWithProviders(<HomeScreen />, { repo, settings: { changesSinceBackup: 0 } });
    const heading = await screen.findByRole('heading', { name: '前回の続き（昨日）' });
    await user.click(within(heading.closest('section')!).getByRole('button', { name: /続きを始める/ }));
    expect(await screen.findByText('ほかの作品の記録中です。先に終えてください')).toBeTruthy();
    expect(window.location.hash).toBe('');
    expect((await repo.getOpenSession())?.workId).toBe(b.id);
  });

  it('shows the pending-code banner linking to 合言葉 (F4 AC5)', async () => {
    const repo = createMemoryRepo();
    await seedDemos(repo);
    await repo.putPending({ id: 'p1', canonical: 'b32:ST4RMAP1X', receivedAt: Date.now() });
    await repo.putPending({ id: 'p2', canonical: 'b32:M00NDESKR', receivedAt: Date.now() });
    renderWithProviders(<HomeScreen />, { repo, settings: { changesSinceBackup: 0 } });
    const banner = await screen.findByRole('link', { name: /保留中の合言葉があります（2件）/ });
    expect(banner.getAttribute('href')).toBe('#/code');
  });

  it('shows the backup reminder and 「7日後に」 snoozes it (F15 AC5)', async () => {
    const repo = createMemoryRepo();
    await seedDemos(repo);
    const { user } = renderWithProviders(<HomeScreen />, { repo, settings: { changesSinceBackup: 25 } });
    const link = await screen.findByRole('link', { name: 'バックアップする' });
    expect(link.getAttribute('href')).toBe('#/settings');
    await user.click(screen.getByRole('button', { name: '7日後に' }));
    await waitFor(() => expect(screen.queryByRole('link', { name: 'バックアップする' })).toBeNull());
    const snoozed = (await repo.getSettings()).backupReminderSnoozedUntil ?? 0;
    expect(snoozed).toBeGreaterThan(Date.now() + 6 * DAY);
  });

  it('never shows the backup reminder without data', async () => {
    renderWithProviders(<HomeScreen />, { settings: { changesSinceBackup: 30 } });
    await screen.findByRole('heading', { name: '本棚はまだ空です' });
    expect(screen.queryByRole('link', { name: 'バックアップする' })).toBeNull();
  });
});
