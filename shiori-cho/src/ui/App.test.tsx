// @vitest-environment jsdom
import '../test/jsdomRealm';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createWork, importBundledDemos } from '../app/library';
import * as unlock from '../app/unlock';
import { hashPin } from '../core/crypto/pin';
import type { Settings } from '../core/types';
import * as idb from '../storage/idbRepo';
import { createMemoryRepo, createMemoryStudioRepo } from '../storage/memoryRepo';
import type { ShioriRepo } from '../storage/repo';
import * as studioStorage from '../storage/studioRepo';
import { resetWipeChannelForTests } from '../app/wipe';
import { restartApp } from './screens/settings/restart';
import { AGE_GATE_QUESTION } from './shell/AgeGate';

const TITLE = '星読みの図書館（テスト）';

/** Filled by the Home stand-in's 「あとで通知」 button: what the delayed confirm resolved to. */
const late: { confirm?: boolean } = {};

// The real HomeScreen belongs to another module owner; a stand-in that shows every work's REAL title makes
// "no work title remains in the DOM" meaningful regardless of how the library screen evolves.
vi.mock('./screens/Home', async () => {
  const { useRepoQuery, useUi } = await import('./context');
  const { Sheet } = await import('./components/Sheet');
  return {
    HomeScreen: () => {
      const q = useRepoQuery((r) => r.listWorks(), []);
      const ui = useUi();
      const [sheet, setSheet] = useState(false);
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
          <button type="button" onClick={() => setSheet(true)}>
            シートを開く
          </button>
          <button
            type="button"
            onClick={() => {
              // async work that finishes after 「隠す」 (like an export or an import)
              setTimeout(() => {
                ui.toast(`『${TITLE}』を書き出しました`);
                void ui.confirm({ title: 'あとからの確認' }).then((v) => {
                  late.confirm = v;
                });
              }, 30);
            }}
          >
            あとで通知
          </button>
          <Sheet open={sheet} onClose={() => setSheet(false)} title="項目">
            <p>{TITLE}のメモ</p>
          </Sheet>
        </main>
      );
    },
  };
});

vi.mock('./screens/work/WorkScreen', () => ({
  WorkScreen: (props: import('./screens/work/WorkScreen').WorkScreenProps) => {
    if (props.workId === 'boom') throw new Error('render failed');
    return (
      <main className="screen">
        <h1>作品</h1>
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
    );
  },
}));

const openIdbRepo = vi.fn<() => Promise<ShioriRepo>>();
vi.mock('../storage/idbRepo', () => ({
  openIdbRepo: () => openIdbRepo(),
  deleteIdbDatabase: vi.fn(async () => undefined),
}));
vi.mock('../storage/studioRepo', async () => {
  const { createMemoryStudioRepo: make } = await import('../storage/memoryRepo');
  return { openIdbStudioRepo: async () => make(), deleteIdbStudioDatabase: vi.fn(async () => undefined) };
});
vi.mock('./screens/settings/restart', () => ({ restartApp: vi.fn() }));
vi.mock('../app/unlock', async (importOriginal) => {
  const m = await importOriginal<typeof import('../app/unlock')>();
  return { ...m, handleDeepLink: vi.fn(m.handleDeepLink) };
});

const { App, AppRoot } = await import('./App');
const { wipeFromLockScreen } = await import('./shell/lockWipe');

async function renderRoot(settings: Partial<Settings>, withWork = true, repo = createMemoryRepo({ fullSettings: settings })) {
  if (withWork) await createWork(repo, { title: TITLE, alias: '作品A', kind: 'game' });
  const onWipe = vi.fn();
  const initialSettings = await repo.getSettings();
  const listWorks = vi.spyOn(repo, 'listWorks');
  const view = render(<AppRoot repo={repo} studioRepo={createMemoryStudioRepo()} initialSettings={initialSettings} onWipe={onWipe} />);
  return { repo, onWipe, listWorks, view, user: userEvent.setup() };
}

const PASSED: Partial<Settings> = { ageConfirmedAt: 1, onboardedAt: 1 };

/** The 1 s long-press on 「メモ」 (F2 AC3). */
function longPressMemo() {
  vi.useFakeTimers();
  fireEvent.pointerDown(screen.getByRole('heading', { name: 'メモ' }));
  act(() => vi.advanceTimersByTime(1000));
  vi.useRealTimers();
}

/** Escape as a keyboard would send it: to the focused element (so open layers see it too). */
function pressEscape(extra: Partial<KeyboardEventInit> = {}) {
  fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape', ...extra });
}

beforeEach(() => {
  window.sessionStorage.clear();
  window.location.hash = '#/';
  document.title = 'しおり帳';
  delete late.confirm;
  vi.mocked(unlock.handleDeepLink).mockClear();
  vi.mocked(idb.deleteIdbDatabase).mockClear();
  vi.mocked(studioStorage.deleteIdbStudioDatabase).mockClear();
  vi.mocked(restartApp).mockClear();
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
    longPressMemo();
    expect(screen.getByText('PINを入力してください')).toBeTruthy();
    expect(document.body.innerHTML).not.toContain(TITLE);
  });

  it('Escape hides in one step even while a dialog is open; IME Escape is ignored', async () => {
    const { user } = await renderRoot(PASSED);
    await screen.findByText(TITLE);
    pressEscape({ isComposing: true });
    expect(screen.getByText(TITLE)).toBeTruthy();

    await user.click(screen.getByRole('button', { name: '確認を開く' }));
    expect(screen.getByRole('dialog', { name: 'テストの確認' })).toBeTruthy();
    pressEscape();
    expect(screen.getByRole('heading', { name: 'メモ' })).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.body.innerHTML).not.toContain(TITLE);
  });

  it('a sheet has its own 「隠す」 (it covers the header), and Escape over a sheet hides at once', async () => {
    const { user } = await renderRoot(PASSED);
    await screen.findByText(TITLE);
    await user.click(screen.getByRole('button', { name: 'シートを開く' }));
    const sheet = screen.getByRole('dialog', { name: '項目' });
    await user.click(within(sheet).getByRole('button', { name: '隠す' }));
    expect(screen.getByRole('heading', { name: 'メモ' })).toBeTruthy();
    expect(document.body.innerHTML).not.toContain(TITLE);

    longPressMemo();
    await screen.findByText(TITLE);
    await user.click(screen.getByRole('button', { name: 'シートを開く' }));
    expect(screen.getByRole('dialog', { name: '項目' })).toBeTruthy();
    pressEscape();
    expect(screen.getByRole('heading', { name: 'メモ' })).toBeTruthy();
    expect(document.body.innerHTML).not.toContain(TITLE);
  });

  it('hiding clears toasts and open dialogs that could show work data (the dialog has its own 「隠す」)', async () => {
    const { user } = await renderRoot(PASSED);
    await screen.findByText(TITLE);
    await user.click(screen.getByRole('button', { name: '通知を出す' }));
    await user.click(screen.getByRole('button', { name: '確認を開く' }));
    expect(screen.getByRole('status').textContent).toContain(TITLE);
    const dialog = screen.getByRole('dialog', { name: 'テストの確認' });
    await user.click(within(dialog).getByRole('button', { name: '隠す' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.body.innerHTML).not.toContain(TITLE);
  });

  it('toasts and dialogs from work that finishes after 「隠す」 never appear over the notepad', async () => {
    const { user } = await renderRoot(PASSED);
    await screen.findByText(TITLE);
    await user.click(screen.getByRole('button', { name: 'あとで通知' }));
    await user.click(screen.getByRole('button', { name: '隠す' }));
    await waitFor(() => expect(late.confirm).toBe(false));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.body.innerHTML).not.toContain(TITLE);
    expect(screen.getByRole('heading', { name: 'メモ' })).toBeTruthy();
  });

  it('the camouflage survives a reload of the tab (no library, no PIN pad first)', async () => {
    const pin = await hashPin('2468', { iterations: 1000 });
    const first = await renderRoot({ ...PASSED, pin });
    for (const d of ['2', '4', '6', '8']) await first.user.click(screen.getByRole('button', { name: d }));
    await first.user.click(screen.getByRole('button', { name: '解除' }));
    await screen.findByText(TITLE);
    await first.user.click(screen.getByRole('button', { name: '隠す' }));
    first.view.unmount();

    // "reload": a fresh shell on the same tab
    await renderRoot({ ...PASSED, pin }, false, first.repo);
    expect(screen.getByRole('heading', { name: 'メモ' })).toBeTruthy();
    expect(screen.queryByText('PINを入力してください')).toBeNull();
    expect(document.body.innerHTML).not.toContain(TITLE);
    expect(document.title).toBe('メモ');
    longPressMemo();
    expect(screen.getByText('PINを入力してください')).toBeTruthy();
  });

  it('keeps the camouflage text (debounced save)', async () => {
    const { repo, user } = await renderRoot(PASSED);
    await user.click(screen.getByRole('button', { name: '隠す' }));
    await user.type(screen.getByLabelText('メモ'), '買い物リスト');
    await waitFor(async () => expect((await repo.getSettings()).camouflageText).toBe('買い物リスト'));
  });
});

describe('Sealed extras and 「隠す」 (F2 AC3, F12)', () => {
  it('Escape during the envelope hides instead of opening the letter; the envelope waits and replays', async () => {
    const repo = createMemoryRepo({ fullSettings: PASSED });
    const [hoshiyomi] = await importBundledDemos(repo);
    window.location.hash = '#/u/demo-hoshiyomi/ST4RMAP1X';
    await renderRoot(PASSED, false, repo);
    expect(await screen.findByTestId('envelope-reveal', undefined, { timeout: 10_000 })).toBeTruthy();

    pressEscape();
    expect(screen.getByRole('heading', { name: 'メモ' })).toBeTruthy();
    expect(screen.queryByTestId('envelope-reveal')).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.body.textContent).not.toContain('星を読みに来てくれたあなたへ');
    expect((await repo.listSealedOpens(hoshiyomi!)).find((o) => o.sealedId === 'letter-mina')?.seen).toBe(false);

    longPressMemo();
    // the queue was kept: the envelope plays again once the app is back
    expect(await screen.findByTestId('envelope-reveal')).toBeTruthy();
    const hide = within(screen.getByTestId('envelope-reveal')).getByRole('button', { name: '隠す' });
    fireEvent.click(hide);
    expect(screen.getByRole('heading', { name: 'メモ' })).toBeTruthy();
  });
});

describe('Deep links (F11)', () => {
  it('leave the address bar at once while locked, and run after the PIN', async () => {
    const pin = await hashPin('2468', { iterations: 1000 });
    window.location.hash = '#/u/demo-hoshiyomi/ST4RMAP1X';
    const { repo, user } = await renderRoot({ ...PASSED, pin }, false);
    expect(screen.getByText('PINを入力してください')).toBeTruthy();
    expect(window.location.hash).toBe('#/code');
    expect(window.location.href).not.toContain('ST4RMAP1X');
    expect(unlock.handleDeepLink).not.toHaveBeenCalled();
    expect(await repo.listPending()).toHaveLength(0);

    for (const d of ['2', '4', '6', '8']) await user.click(screen.getByRole('button', { name: d }));
    await user.click(screen.getByRole('button', { name: '解除' }));
    expect(await screen.findByText('しおりファイルがまだないため、合言葉を保留にしました', undefined, { timeout: 10_000 })).toBeTruthy();
    expect(unlock.handleDeepLink).toHaveBeenCalledTimes(1);
    expect(await repo.listPending()).toHaveLength(1);
    expect(window.sessionStorage.getItem('shiori.deeplink')).toBeNull();
  });

  it('on first launch: out of the address bar during the age gate and onboarding, processed afterwards', async () => {
    window.location.hash = '#/u/demo-hoshiyomi/ST4RMAP1X';
    const { repo, user } = await renderRoot({}, false);
    expect(screen.getByText(AGE_GATE_QUESTION)).toBeTruthy();
    expect(window.location.hash).toBe('#/code');
    expect(window.location.href).not.toContain('ST4RMAP1X');
    expect(unlock.handleDeepLink).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'はい、18歳以上です' }));
    await user.click(await screen.findByRole('button', { name: 'スキップ' }));
    await user.click(await screen.findByRole('button', { name: 'はじめる' }));
    expect(await screen.findByText('しおりファイルがまだないため、合言葉を保留にしました', undefined, { timeout: 10_000 })).toBeTruthy();
    expect(unlock.handleDeepLink).toHaveBeenCalledTimes(1);
    expect(await repo.listPending()).toHaveLength(1);
  });

  it('hiding while the code is checked keeps the result: success is shown on return, not 「入力済み」', async () => {
    const repo = createMemoryRepo({ fullSettings: PASSED });
    const [hoshiyomi] = await importBundledDemos(repo);
    const real = (await vi.importActual<typeof import('../app/unlock')>('../app/unlock')).handleDeepLink;
    let release: () => void = () => undefined;
    let settled: Promise<unknown> = Promise.resolve();
    vi.mocked(unlock.handleDeepLink).mockImplementationOnce(
      (r, id, code) =>
        new Promise((resolve, reject) => {
          release = () => {
            const p = real(r, id, code);
            settled = p;
            p.then(resolve, reject);
          };
        }),
    );
    window.location.hash = '#/u/demo-hoshiyomi/ST4RMAP1X';
    await renderRoot(PASSED, false, repo);
    expect(screen.getByText('合言葉を確かめています…')).toBeTruthy();

    pressEscape();
    expect(screen.getByRole('heading', { name: 'メモ' })).toBeTruthy();
    expect(window.location.hash).toBe('#/code');
    release();
    await act(async () => {
      await settled;
    });
    expect(screen.queryByText(/合言葉が通りました/)).toBeNull(); // nothing over the notepad

    longPressMemo();
    expect(await screen.findByText('合言葉が通りました：星図の果て', undefined, { timeout: 10_000 })).toBeTruthy();
    expect(screen.queryByText('この合言葉は入力済みです')).toBeNull();
    expect(unlock.handleDeepLink).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(window.location.hash).toBe(`#/w/${hoshiyomi}`));
  });
});

describe('「PINを忘れた」 → 全データを消して初期化 (F3 AC4)', () => {
  async function bootLocked() {
    const pin = await hashPin('2468', { iterations: 1000 });
    const repo = createMemoryRepo({ fullSettings: { ...PASSED, pin } });
    window.location.hash = '#/studio/p-1';
    // the same wiring as <App/> (whose repositories open once per page load)
    render(<AppRoot repo={repo} studioRepo={createMemoryStudioRepo()} initialSettings={await repo.getSettings()} onWipe={wipeFromLockScreen} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'PINを忘れた' }));
    expect(screen.getByText(/サークル工房のプロジェクトがすべて消えます/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '全データを消して初期化' }));
    expect(within(screen.getByRole('alertdialog')).getByText(/サークル工房のプロジェクト/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '次へ' }));
    await user.click(await screen.findByRole('button', { name: '消して初期化する' }));
    return user;
  }

  it('deletes the player AND studio databases, then restarts at #/', async () => {
    await bootLocked();
    await waitFor(() => expect(restartApp).toHaveBeenCalledTimes(1));
    expect(vi.mocked(idb.deleteIdbDatabase).mock.calls.map((c) => c[0])).toEqual(['shiori']);
    expect(vi.mocked(studioStorage.deleteIdbStudioDatabase).mock.calls.map((c) => c[0])).toEqual(['shiori-studio']);
  });

  it('shows a failure instead of reloading into the same PIN pad', async () => {
    vi.mocked(idb.deleteIdbDatabase).mockRejectedValueOnce(new Error('blocked'));
    await bootLocked();
    expect((await screen.findByRole('alert')).textContent).toContain('データを消せませんでした');
    expect(restartApp).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '全データを消して初期化' })).toBeTruthy();
  });
});

describe('全データを消す in another window', () => {
  /** in-process BroadcastChannel: delivers to every OTHER instance with the same name */
  class FakeChannel {
    static all: FakeChannel[] = [];
    listeners = new Set<(e: MessageEvent) => void>();
    readonly name: string;
    constructor(name: string) {
      this.name = name;
      FakeChannel.all.push(this);
    }
    postMessage(data: unknown) {
      for (const c of FakeChannel.all) if (c !== this && c.name === this.name) for (const l of c.listeners) l({ data } as MessageEvent);
    }
    addEventListener(_t: 'message', l: (e: MessageEvent) => void) {
      this.listeners.add(l);
    }
    removeEventListener(_t: 'message', l: (e: MessageEvent) => void) {
      this.listeners.delete(l);
    }
    close() {
      FakeChannel.all = FakeChannel.all.filter((c) => c !== this);
    }
  }

  it('restarts this window instead of showing (and writing back) the wiped data', async () => {
    resetWipeChannelForTests();
    vi.stubGlobal('BroadcastChannel', FakeChannel);
    try {
      await renderRoot(PASSED);
      await screen.findByText(TITLE);
      window.sessionStorage.setItem('shiori.codeHandoff', '{}');
      act(() => new FakeChannel('shiori').postMessage({ type: 'wiped', studio: false }));
      expect(restartApp).toHaveBeenCalledTimes(1);
      expect(window.sessionStorage.getItem('shiori.codeHandoff')).toBeNull();
    } finally {
      cleanup();
      resetWipeChannelForTests();
      vi.unstubAllGlobals();
    }
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
    expect(document.documentElement.hasAttribute('data-bottom-nav')).toBe(true);
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

  it('moves focus to the new screen’s heading after navigation', async () => {
    await renderRoot(PASSED, false);
    await screen.findByRole('heading', { name: '本棚' });
    act(() => {
      window.location.hash = '#/nothing-here';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    const heading = await screen.findByRole('heading', { name: 'ページが見つかりません' });
    await waitFor(() => expect(document.activeElement).toBe(heading));
  });

  it('a screen that fails to render keeps the header (「隠す」) and the navigation', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    window.location.hash = '#/w/boom';
    const { user } = await renderRoot(PASSED);
    expect(await screen.findByRole('heading', { name: '画面を表示できませんでした' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '隠す' })).toBeTruthy();
    expect(screen.getByRole('navigation', { name: 'メインメニュー' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '再読み込み' })).toBeTruthy();

    await user.click(screen.getByRole('button', { name: '本棚へ' }));
    expect(await screen.findByText(TITLE)).toBeTruthy();
    error.mockRestore();
  });
});
