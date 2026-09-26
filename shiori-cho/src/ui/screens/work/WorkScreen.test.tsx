// @vitest-environment jsdom
import { act, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { createWork, importBundledDemos } from '../../../app/library';
import { startSession } from '../../../app/sessions';
import { submitCode } from '../../../app/unlock';
import type { WorkTab } from '../../../core/route';
import type { SpoilerLevel } from '../../../core/types';
import { createMemoryRepo } from '../../../storage/memoryRepo';
import type { ShioriRepo } from '../../../storage/repo';
import { renderWithProviders } from '../../../test/renderWithProviders';
import { SPOILER_PLACEHOLDER } from '../../components/SpoilerText';
import { ANSWER_CONFIRM_TITLE } from './GoalSheet';
import { WorkScreen } from './WorkScreen';
import type { WorkSheet } from './WorkScreen';

async function demo() {
  const repo = createMemoryRepo();
  const [hoshiyomi, amaoto] = await importBundledDemos(repo);
  return { repo, hoshiyomi: hoshiyomi!, amaoto: amaoto! };
}

/** Hosts WorkScreen with local tab/sheet state, like the studio preview does. */
function Harness(props: { workId: string; tab?: WorkTab; sheet?: WorkSheet }): ReactNode {
  const [state, setState] = useState<{ tab: WorkTab; sheet?: WorkSheet }>({ tab: props.tab ?? 'progress', sheet: props.sheet });
  return <WorkScreen workId={props.workId} tab={state.tab} sheet={state.sheet} onChange={setState} />;
}

async function setTolerance(repo: ShioriRepo, workId: string, t: SpoilerLevel) {
  const w = (await repo.getWork(workId))!;
  await repo.putWork({ ...w, spoilerTolerance: t });
}

async function progressIds(repo: ShioriRepo, workId: string) {
  return (await repo.listProgress(workId)).filter((p) => !p.archived).map((p) => p.goalId);
}

describe('WorkScreen 進捗 (F7)', () => {
  it('toggles a manual goal with one tap and undoes it from the toast', async () => {
    const { repo, hoshiyomi } = await demo();
    const { user } = renderWithProviders(<Harness workId={hoshiyomi} />, { repo });
    const title = await screen.findByText('図書館の猫と3回話した');
    const row = title.closest('li')!;
    const check = within(row).getByRole('button', { name: '達成' });
    expect(check.getAttribute('aria-pressed')).toBe('false');

    await user.click(check);
    await waitFor(async () => expect(await progressIds(repo, hoshiyomi)).toContain('ach-cat'));
    await waitFor(() => expect(within(row).getByRole('button', { name: '達成' }).getAttribute('aria-pressed')).toBe('true'));
    expect(await screen.findByText('達成にしました')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: '元に戻す' }));
    await waitFor(async () => expect(await progressIds(repo, hoshiyomi)).not.toContain('ach-cat'));
  });

  it('undoing an un-check restores the original completion record', async () => {
    const { repo, hoshiyomi } = await demo();
    await repo.putProgress({ workId: hoshiyomi, goalId: 'ach-cat', via: 'manual', doneAt: 1000, hintTierAtDone: 0, archived: false });
    const { user } = renderWithProviders(<Harness workId={hoshiyomi} />, { repo });
    const row = (await screen.findByText('図書館の猫と3回話した')).closest('li')!;
    expect(within(row).getByText('ノーヒント')).toBeTruthy();
    await user.click(within(row).getByRole('button', { name: '達成' }));
    await waitFor(async () => expect(await progressIds(repo, hoshiyomi)).not.toContain('ach-cat'));
    await user.click(await screen.findByRole('button', { name: '元に戻す' }));
    await waitFor(async () => {
      const p = (await repo.listProgress(hoshiyomi)).find((x) => x.goalId === 'ach-cat');
      expect(p?.doneAt).toBe(1000);
    });
  });

  it('shows a code goal as 🔒 + public label until redeemed, then the decrypted title', async () => {
    const { repo, hoshiyomi } = await demo();
    renderWithProviders(<Harness workId={hoshiyomi} />, { repo });
    const open = await screen.findByRole('button', { name: /^未解放\s*END 1$/ });
    const row = open.closest('li')!;
    expect(within(row).getByRole('img', { name: '未解放' }).textContent).toBe('🔒');
    expect(within(row).getByText('END 1')).toBeTruthy();
    expect(screen.queryByText('星図の果て')).toBeNull();

    await act(async () => {
      const out = await submitCode(repo, 'ST4-RMA-P1X', { workId: hoshiyomi });
      expect(out.status).toBe('unlocked');
    });
    expect(await within(row).findByText('星図の果て', {}, { timeout: 5000 })).toBeTruthy();
    expect(within(row).queryByRole('img', { name: '未解放' })).toBeNull();
    expect(within(row).queryByText('END 1')).toBeNull();
  });

  it('「合言葉なしで達成にする」 counts the goal but keeps the title masked and explains why', async () => {
    const { repo, hoshiyomi } = await demo();
    const { user } = renderWithProviders(<Harness workId={hoshiyomi} sheet={{ type: 'goal', index: 0 }} />, { repo });
    const sheet = await screen.findByRole('dialog', { name: 'END 1' });
    await user.click(within(sheet).getByRole('button', { name: /その他/ }));
    expect(within(sheet).getByText(/本当のタイトルは伏せたままで/)).toBeTruthy();
    await user.click(within(sheet).getByRole('button', { name: '合言葉なしで達成にする' }));
    await user.click(await screen.findByRole('button', { name: '達成にする' }));
    await waitFor(async () => {
      const p = (await repo.listProgress(hoshiyomi)).find((x) => x.goalId === 'end-a');
      expect(p?.via).toBe('manual');
    });
    expect(await within(sheet).findByText(/合言葉なしで達成にしています/)).toBeTruthy();
    expect(screen.queryByText('星図の果て')).toBeNull();
    expect(await repo.listSealedOpens(hoshiyomi)).toHaveLength(0);
  });

  it('pins a "soon" missable alert at the top for the current checkpoint', async () => {
    const { repo, hoshiyomi } = await demo();
    const w = (await repo.getWork(hoshiyomi))!;
    await repo.putWork({ ...w, currentCheckpointId: 'ch2' });
    renderWithProviders(<Harness workId={hoshiyomi} />, { repo });
    expect(await screen.findByRole('heading', { name: /この先に進む前に確認を/ })).toBeTruthy();
    expect(screen.getByText('第3章に進む前に、書架の本をもう一度よく調べておこう')).toBeTruthy();
    expect((screen.getByLabelText('いまどこ？') as HTMLSelectElement).value).toBe('ch2');
  });
});

describe('WorkScreen hints and spoilers (F8)', () => {
  it('opens hint tiers one at a time and asks before showing the answer', async () => {
    const { repo, hoshiyomi } = await demo();
    const { user } = renderWithProviders(<Harness workId={hoshiyomi} />, { repo });
    await user.click(await screen.findByRole('button', { name: '図書館の猫と3回話した' }));
    const sheet = await screen.findByRole('dialog', { name: '図書館の猫と3回話した' });

    const tier1 = within(sheet).getByRole('button', { name: 'ヒント1（示唆）を見る' });
    const tier2 = within(sheet).getByRole('button', { name: 'ヒント2（方向）を見る' });
    const tier3 = within(sheet).getByRole('button', { name: 'ヒント3（答え）を見る' });
    expect(tier1.hasAttribute('disabled')).toBe(false);
    expect(tier2.hasAttribute('disabled')).toBe(true);
    expect(tier3.hasAttribute('disabled')).toBe(true);

    // A click without a hold (keyboard / assistive activation) confirms first.
    await user.click(tier1);
    await user.click(await screen.findByRole('button', { name: '表示する' }));
    expect(await within(sheet).findByText('猫は、章によって居場所が変わります')).toBeTruthy();
    await waitFor(async () => expect((await repo.listHints(hoshiyomi)).find((h) => h.goalId === 'ach-cat')?.tier).toBe(1));

    await user.click(within(sheet).getByRole('button', { name: 'ヒント2（方向）を見る' }));
    await user.click(await screen.findByRole('button', { name: '表示する' }));
    await waitFor(async () => expect((await repo.listHints(hoshiyomi)).find((h) => h.goalId === 'ach-cat')?.tier).toBe(2));

    // 答え: the confirm says so; cancelling keeps it hidden.
    await waitFor(() => expect(within(sheet).getByRole('button', { name: 'ヒント3（答え）を見る' }).hasAttribute('disabled')).toBe(false));
    await user.click(within(sheet).getByRole('button', { name: 'ヒント3（答え）を見る' }));
    expect(await screen.findByRole('dialog', { name: ANSWER_CONFIRM_TITLE })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'キャンセル' }));
    expect(within(sheet).queryByText(/各章で1回ずつ猫に話しかけると達成です/)).toBeNull();

    await user.click(within(sheet).getByRole('button', { name: 'ヒント3（答え）を見る' }));
    await user.click(within(await screen.findByRole('dialog', { name: ANSWER_CONFIRM_TITLE })).getByRole('button', { name: '表示する' }));
    expect(await within(sheet).findByText(/各章で1回ずつ猫に話しかけると達成です/)).toBeTruthy();
    await waitFor(async () => expect((await repo.listHints(hoshiyomi)).find((h) => h.goalId === 'ach-cat')?.tier).toBe(3));
  });

  it('hides a spoiler-2 teaser at tolerance 1 and shows it at tolerance 2', async () => {
    const { repo, hoshiyomi } = await demo();
    const r = renderWithProviders(<Harness workId={hoshiyomi} sheet={{ type: 'goal', index: 3 }} />, { repo });
    const sheet = await screen.findByRole('dialog');
    expect(within(sheet).queryByText('図書館のいちばん上で')).toBeNull();
    expect(within(sheet).queryByText('END 4')).toBeNull();
    expect(within(sheet).getAllByText(SPOILER_PLACEHOLDER).length).toBeGreaterThanOrEqual(2);
    r.unmount();

    await setTolerance(repo, hoshiyomi, 2);
    renderWithProviders(<Harness workId={hoshiyomi} sheet={{ type: 'goal', index: 3 }} />, { repo });
    const sheet2 = await screen.findByRole('dialog', { name: 'END 4' });
    expect(within(sheet2).getByText('図書館のいちばん上で')).toBeTruthy();
  });
});

describe('WorkScreen おまけ (F12)', () => {
  it('shows condition progress (2/4 style for allOf, いずれか1つ for anyOf) and opens after a code', async () => {
    const { repo, hoshiyomi } = await demo();
    renderWithProviders(<Harness workId={hoshiyomi} tab="extras" />, { repo });
    const afterword = () => screen.getByRole('heading', { name: 'あとがき' }).closest('li')!;
    const letter = () => screen.getByRole('heading', { name: '司書ミナからの手紙' }).closest('li')!;
    await screen.findByRole('heading', { name: 'あとがき' });
    expect(within(afterword()).getByText('0/4')).toBeTruthy();
    expect(within(letter()).getByText('いずれか1つ')).toBeTruthy();
    expect(within(letter()).getByText('封印中')).toBeTruthy();
    expect(within(letter()).queryByRole('button', { name: '読む' })).toBeNull();

    await act(async () => {
      await submitCode(repo, 'ST4-RMA-P1X', { workId: hoshiyomi });
    });
    await waitFor(() => expect(within(afterword()).getByText('1/4')).toBeTruthy(), { timeout: 5000 });
    await waitFor(() => expect(within(letter()).getByText('開封済み')).toBeTruthy());
    expect(within(letter()).getByRole('button', { name: '読む' })).toBeTruthy();
  });
});

describe('WorkScreen sessions (F13)', () => {
  it('starts and ends a session with the end sheet', async () => {
    const { repo, hoshiyomi } = await demo();
    const { user } = renderWithProviders(<Harness workId={hoshiyomi} tab="log" />, { repo });
    await user.click(await screen.findByRole('button', { name: '始める' }));
    await waitFor(async () => expect((await repo.getOpenSession())?.workId).toBe(hoshiyomi));
    expect((await repo.getWork(hoshiyomi))?.status).toBe('playing');

    await user.click(await screen.findByRole('button', { name: /終える/ }));
    const sheet = await screen.findByRole('dialog', { name: '記録を終える' });
    expect((within(sheet).getByLabelText('遊んだ時間（分）') as HTMLInputElement).value).toBe('0');
    await user.clear(within(sheet).getByLabelText('遊んだ時間（分）'));
    await user.type(within(sheet).getByLabelText('遊んだ時間（分）'), '42');
    await user.selectOptions(within(sheet).getByLabelText('現在地'), 'ch2');
    await user.type(within(sheet).getByLabelText('どこまで進んだ？'), '閲覧室の奥まで');
    await user.type(within(sheet).getByLabelText('次にやること'), '地下の書庫へ');
    await user.click(within(sheet).getByRole('button', { name: '記録を終える' }));

    await waitFor(async () => expect(await repo.getOpenSession()).toBeUndefined());
    const [s] = await repo.listSessions(hoshiyomi);
    expect(s).toMatchObject({ minutes: 42, checkpointId: 'ch2', whereNote: '閲覧室の奥まで', nextTodo: '地下の書庫へ' });
    expect((await repo.getWork(hoshiyomi))?.currentCheckpointId).toBe('ch2');
    expect((await screen.findAllByText('42分')).length).toBeGreaterThanOrEqual(2); // 累計時間 + the list
    expect(await screen.findByRole('button', { name: '始める' })).toBeTruthy();
  });

  it('refuses a second open session with the service message', async () => {
    const { repo, hoshiyomi, amaoto } = await demo();
    await startSession(repo, amaoto);
    const { user } = renderWithProviders(<Harness workId={hoshiyomi} />, { repo });
    expect(await screen.findByText('ほかの作品を記録中です。')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '始める' }));
    expect(await screen.findByText('ほかの作品の記録中です。先に終えてください')).toBeTruthy();
    expect((await repo.getOpenSession())?.workId).toBe(amaoto);
  });
});

describe('WorkScreen without a manifest (記録だけ) and notes (F14)', () => {
  it('offers to add a shiori, still records sessions, and keeps notes with ||spoiler|| spans', async () => {
    const repo = createMemoryRepo();
    const work = await createWork(repo, { title: 'テスト作品', kind: 'game' });
    const { user, rerender } = renderWithProviders(<Harness workId={work.id} />, { repo });
    expect(await screen.findByText('しおりファイルがありません')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'しおりファイルを読み込む' }).getAttribute('href')).toBe('#/add');
    expect(screen.getByRole('button', { name: 'かんたんしおりにする' })).toBeTruthy();
    expect(screen.queryByText('テスト作品')).toBeNull(); // alias only (おしのびモード)

    await user.click(screen.getByRole('button', { name: '始める' }));
    await waitFor(async () => expect((await repo.getOpenSession())?.workId).toBe(work.id));

    rerender(<Harness workId={work.id} tab="notes" />);
    await user.click(screen.getByRole('tab', { name: /メモ/ }));
    await user.type(await screen.findByLabelText('新しいメモ'), '猫は||地下||にいる');
    await user.click(screen.getByRole('button', { name: 'メモを追加' }));
    expect(await screen.findByRole('button', { name: '伏せ字（タップで表示）' })).toBeTruthy();
    const notes = await repo.listNotes(work.id);
    expect(notes).toHaveLength(1);
    expect(notes[0]?.text).toBe('猫は||地下||にいる');
  });

  it('turns a 記録だけ work into a quick shiori in place', async () => {
    const repo = createMemoryRepo();
    const work = await createWork(repo, { title: 'テスト作品', kind: 'game' });
    const { user } = renderWithProviders(<Harness workId={work.id} />, { repo });
    await user.click(await screen.findByRole('button', { name: 'かんたんしおりにする' }));
    const sheet = await screen.findByRole('dialog', { name: 'かんたんしおりにする' });
    await user.clear(within(sheet).getByLabelText('エンディング'));
    await user.type(within(sheet).getByLabelText('エンディング'), '3');
    await user.click(within(sheet).getByRole('button', { name: '作る' }));
    expect(await screen.findByText('END 3')).toBeTruthy();
    const w = await repo.getWork(work.id);
    expect(w?.manifestKey).toBeDefined();
    expect(await repo.listWorks()).toHaveLength(1);
  });
});
