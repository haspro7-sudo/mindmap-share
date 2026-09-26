// @vitest-environment jsdom
import '../test/jsdomRealm';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createWork } from '../app/library';
import { hashPin } from '../core/crypto/pin';
import type { Settings } from '../core/types';
import { createMemoryRepo, createMemoryStudioRepo } from '../storage/memoryRepo';
import type { ShioriRepo } from '../storage/repo';
import { AGE_GATE_QUESTION } from './shell/AgeGate';

const TITLE = '星読みの図書館（テスト）';

// The real HomeScreen belongs to another module owner; a stand-in that shows every work's REAL title makes
// "no work title remains in the DOM" meaningful regardless of how the library screen evolves.
vi.mock('./screens/Home', async () => {
  const { useRepoQuery, useUi } = await import('./context');
  return {
    HomeScreen: () => {
      const q = useRepoQuery((r) => r.listWorks(), []);
      const ui = useUi();
      return (
        <main className="screen">
          <h1>本棚</h1>
          {q.data?.map((w) => <p key={w.id}>{w.title}</p>)}
          <button type="button" onClick={() => void ui.confirm({ title: 'テストの確認' })}>
            確認を開く
          </button>
          <button type="button" onClick={() => ui.toast(`『${TITLE}』を更新しました`)}>
            通知を出す
          </button>
        </main>
      );
    },
  };
});

vi.mock('./screens/work/WorkScreen', () => ({
  WorkScreen: (props: import('./screens/work/WorkScreen').WorkScreenProps) => (
    <main className="screen">
      <p data-testid="work-props">{JSON.stringify({ id: props.workId, tab: props.tab, sheet: props.sheet ?? null })}</p>
      <button type="button" onClick={() => props.onChange({ tab: props.tab, sheet: { type: 'goal', index: 2 } })}>
        項目を開く
      </button>
      <button type="button" onClick={() => props.onChange({ tab: props.tab })}>
        項目を閉じる
      </button>
      <button type="button" onClick={() => props.onChange({ tab: 'extras' })}>
        おまけタブ
      </button>
    </main>
  ),
}));

const openIdbRepo = vi.fn<() => Promise<ShioriRepo>>();
vi.mock('../storage/idbRepo', () => ({
  openIdbRepo: () => openIdbRepo(),
  deleteIdbDatabase: vi.fn(async () => undefined),
}));
vi.mock('../storage/studioRepo', async () => {
  const { createMemoryStudioRepo: make } = await import('../storage/memoryRepo');
  return { openIdbStudioRepo: async () => make() };
});

const { App, AppRoot } = await import('./App');

async function renderRoot(settings: Partial<Settings>, withWork = true) {
  const repo = createMemoryRepo({ fullSettings: settings });
  if (withWork) await createWork(repo, { title: TITLE, alias: '作品A', kind: 'game' });
  const onWipe = vi.fn();
  const initialSettings = await repo.getSettings();
  const listWorks = vi.spyOn(repo, 'listWorks');
  const view = render(<AppRoot repo={repo} studioRepo={createMemoryStudioRepo()} initialSettings={initialSettings} onWipe={onWipe} />);
  return { repo, onWipe, listWorks, view, user: userEvent.setup() };
}

const PASSED: Partial<Settings> = { ageConfirmedAt: 1, onboardedAt: 1 };

beforeEach(() => {
  window.location.hash = '#/';
  document.title = 'しおり帳';
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('AgeGate (F1)', () => {
  it('renders only the gate and reads no work data until confirmed', async () => {
    const { listWorks } = await renderRoot({});
    expect(screen.getByText(AGE_GATE_QUESTION)).toBeTruthy();
    expect(screen.queryByRole('button', { name: '隠す' })).toBeNull();
    expect(screen.queryByRole('navigation')).toBeNull();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(listWorks).not.toHaveBeenCalled();
    expect(screen.queryByText(TITLE)).toBeNull();
  });

  it('「いいえ」 is a dead end with no way forward and stores nothing', async () => {
    const { repo, user } = await renderRoot({});
    await user.click(screen.getByRole('button', { name: 'いいえ' }));
    expect(screen.getByText('このアプリはご利用いただけません')).toBeTruthy();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(screen.queryAllByRole('link')).toHaveLength(0);
    expect((await repo.getSettings()).ageConfirmedAt).toBeUndefined();
  });

  it('「はい、18歳以上です」 stores ageConfirmedAt and continues to onboarding', async () => {
    const { repo, user } = await renderRoot({});
    await user.click(screen.getByRole('button', { name: 'はい、18歳以上です' }));
    expect(await screen.findByRole('heading', { name: '人前で使うことがありますか？' })).toBeTruthy();
    expect((await repo.getSettings()).ageConfirmedAt).toBeTypeOf('number');
  });
});

describe('Discreet mode (F2 AC3)', () => {
  it('Escape shows the camouflage notepad and removes every work title from the DOM', async () => {
    await renderRoot(PASSED);
    expect(await screen.findByText(TITLE)).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.getByRole('heading', { name: 'メモ' })).toBeTruthy();
    expect(document.body.textContent).not.toContain(TITLE);
    expect(document.body.innerHTML).not.toContain(TITLE);
    expect(screen.queryByText('しおり帳')).toBeNull();
    expect(document.title).toBe('メモ');
  });

  it('「隠す」 in the header does the same, and a 1 s long-press on 「メモ」 returns', async () => {
    const { user } = await renderRoot(PASSED);
    await screen.findByText(TITLE);
    await user.click(screen.getByRole('button', { name: '隠す' }));
    expect(document.body.innerHTML).not.toContain(TITLE);
    expect(document.title).toBe('メモ');

    vi.useFakeTimers();
    const heading = screen.getByRole('heading', { name: 'メモ' });
    fireEvent.pointerDown(heading);
    act(() => vi.advanceTimersByTime(500));
    fireEvent.pointerUp(heading); // released too early: stays hidden
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.queryByRole('button', { name: '隠す' })).toBeNull();

    fireEvent.pointerDown(heading);
    act(() => vi.advanceTimersByTime(1000));
    vi.useRealTimers();
    expect(await screen.findByText(TITLE)).toBeTruthy();
    expect(document.title).toBe('しおり帳');
  });

  it('returning from the camouflage asks for the PIN when one is set', async () => {
    const pin = await hashPin('2468', { iterations: 1000 });
    const { user } = await renderRoot({ ...PASSED, pin });
    // cold start with a PIN → locked
    expect(screen.getByText('PINを入力してください')).toBeTruthy();
    expect(document.body.innerHTML).not.toContain(TITLE);
    for (const d of ['2', '4', '6', '8']) await user.click(screen.getByRole('button', { name: d }));
    await user.click(screen.getByRole('button', { name: '解除' }));
    expect(await screen.findByText(TITLE)).toBeTruthy();

    fireEvent.keyDown(window, { key: 'Escape' });
    vi.useFakeTimers();
    fireEvent.pointerDown(screen.getByRole('heading', { name: 'メモ' }));
    act(() => vi.advanceTimersByTime(1000));
    vi.useRealTimers();
    expect(screen.getByText('PINを入力してください')).toBeTruthy();
    expect(document.body.innerHTML).not.toContain(TITLE);
  });

  it('Escape closes an open dialog first instead of hiding, and IME Escape is ignored', async () => {
    const { user } = await renderRoot(PASSED);
    await screen.findByText(TITLE);
    fireEvent.keyDown(window, { key: 'Escape', isComposing: true });
    expect(screen.getByText(TITLE)).toBeTruthy();

    await user.click(screen.getByRole('button', { name: '確認を開く' }));
    expect(screen.getByRole('dialog', { name: 'テストの確認' })).toBeTruthy();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByText(TITLE)).toBeTruthy();

    await user.keyboard('{Escape}');
    expect(screen.getByRole('heading', { name: 'メモ' })).toBeTruthy();
    expect(document.body.innerHTML).not.toContain(TITLE);
  });

  it('hiding clears toasts and open dialogs that could show work data', async () => {
    const { user } = await renderRoot(PASSED);
    await screen.findByText(TITLE);
    await user.click(screen.getByRole('button', { name: '通知を出す' }));
    await user.click(screen.getByRole('button', { name: '確認を開く' }));
    expect(screen.getByRole('status').textContent).toContain(TITLE);
    await user.click(screen.getByRole('button', { name: '隠す' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.body.innerHTML).not.toContain(TITLE);
  });

  it('keeps the camouflage text (debounced save)', async () => {
    const { repo, user } = await renderRoot(PASSED);
    await user.click(screen.getByRole('button', { name: '隠す' }));
    await user.type(screen.getByLabelText('メモ'), '買い物リスト');
    await waitFor(async () => expect((await repo.getSettings()).camouflageText).toBe('買い物リスト'));
  });
});

describe('App boot', () => {
  it('shows a friendly Japanese error when IndexedDB cannot be opened', async () => {
    const { ShioriError } = await import('../core/errors');
    openIdbRepo.mockRejectedValueOnce(
      new ShioriError('io', 'データの保存場所を開けませんでした。プライベートブラウズを解除するか、別のブラウザでお試しください。'),
    );
    render(<App />);
    expect(await screen.findByText('データの保存場所を使えません')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('プライベートブラウズ');
    expect(screen.getByRole('button', { name: '再読み込み' })).toBeTruthy();
  });

  it('opens the repository and shows the age gate on first launch', async () => {
    openIdbRepo.mockResolvedValueOnce(createMemoryRepo());
    render(<App />);
    expect(await screen.findByText(AGE_GATE_QUESTION)).toBeTruthy();
  });

  it('shows the bottom navigation with aria-current on the current page', async () => {
    await renderRoot(PASSED, false);
    const nav = await screen.findByRole('navigation', { name: 'メインメニュー' });
    expect(within(nav).getByRole('link', { name: '本棚' }).getAttribute('aria-current')).toBe('page');
    expect(within(nav).getByRole('link', { name: '合言葉' }).getAttribute('aria-current')).toBeNull();
  });
});

describe('Route outlet', () => {
  it('passes the route to WorkScreen; a sheet opens as a history entry and closing goes back', async () => {
    window.location.hash = '#/w/abc-123?tab=log';
    const { user } = await renderRoot(PASSED, false);
    const props = () => JSON.parse(screen.getByTestId('work-props').textContent ?? '{}');
    expect(props()).toEqual({ id: 'abc-123', tab: 'log', sheet: null });
    expect(screen.getByRole('button', { name: '戻る' })).toBeTruthy();
    const depth = window.history.length;

    await user.click(screen.getByRole('button', { name: '項目を開く' }));
    await waitFor(() => expect(window.location.hash).toBe('#/w/abc-123?tab=log&sheet=g2'));
    expect(window.history.length).toBe(depth + 1);
    expect(props().sheet).toEqual({ type: 'goal', index: 2 });

    await user.click(screen.getByRole('button', { name: '項目を閉じる' }));
    await waitFor(() => expect(window.location.hash).toBe('#/w/abc-123?tab=log'));
    expect(props().sheet).toBeNull();

    await user.click(screen.getByRole('button', { name: 'おまけタブ' }));
    await waitFor(() => expect(window.location.hash).toBe('#/w/abc-123?tab=extras'));
    expect(window.history.length).toBe(depth + 1); // tab changes replace the entry
  });

  it('renders NotFound for an unknown hash', async () => {
    window.location.hash = '#/nothing-here';
    await renderRoot(PASSED, false);
    expect(await screen.findByRole('heading', { name: 'ページが見つかりません' })).toBeTruthy();
    expect(screen.getByRole('link', { name: '本棚に戻る' }).getAttribute('href')).toBe('#/');
  });
});

