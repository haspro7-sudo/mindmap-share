// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../test/renderWithProviders';
import { Sheet } from '../components/Sheet';
import { useUi } from '../context';
import { UiProvider } from './UiProvider';

afterEach(() => {
  vi.useRealTimers();
});

function Buttons({ onResult }: { onResult?: (v: unknown) => void }) {
  const ui = useUi();
  return (
    <>
      <button type="button" onClick={() => ui.toast('保存しました')}>
        トースト
      </button>
      <button type="button" onClick={() => ui.toast('削除しました', { action: { label: '元に戻す', onClick: () => onResult?.('undo') } })}>
        取り消せるトースト
      </button>
      <button
        type="button"
        onClick={() => void ui.confirm({ title: '削除しますか？', body: '元に戻せません。', okLabel: '削除', danger: true }).then(onResult)}
      >
        確認
      </button>
      <button
        type="button"
        onClick={() =>
          void ui
            .prompt({
              title: '名前を変える',
              label: '新しい名前',
              initialValue: 'END 1',
              validate: (v) => (v.trim() === '' ? '名前を入力してください' : null),
            })
            .then(onResult)
        }
      >
        入力
      </button>
      <button type="button" onClick={() => ui.hide()}>
        隠す
      </button>
    </>
  );
}

describe('UiProvider toasts', () => {
  it('announces politely and auto-dismisses after 3 s (5 s with an action)', () => {
    vi.useFakeTimers();
    const onResult = vi.fn();
    renderWithProviders(<Buttons onResult={onResult} />);
    act(() => screen.getByRole('button', { name: 'トースト' }).click());
    const region = screen.getByRole('status');
    expect(region.getAttribute('aria-live')).toBe('polite');
    expect(region.textContent).toContain('保存しました');
    act(() => vi.advanceTimersByTime(3000));
    expect(region.textContent).not.toContain('保存しました');

    act(() => screen.getByRole('button', { name: '取り消せるトースト' }).click());
    act(() => vi.advanceTimersByTime(3000));
    expect(region.textContent).toContain('削除しました');
    act(() => screen.getByRole('button', { name: '元に戻す' }).click());
    expect(onResult).toHaveBeenCalledWith('undo');
    expect(region.textContent).not.toContain('削除しました');
  });
});

describe('UiProvider dialogs', () => {
  it('confirm: role dialog with danger styling; Escape cancels and focus returns', async () => {
    const onResult = vi.fn();
    const { user } = renderWithProviders(<Buttons onResult={onResult} />);
    const opener = screen.getByRole('button', { name: '確認' });
    await user.click(opener);
    const dialog = screen.getByRole('alertdialog', { name: '削除しますか？' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.className).toContain('is-danger');
    // danger → the safe choice has the focus
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'キャンセル' }));
    await user.keyboard('{Escape}');
    await waitFor(() => expect(onResult).toHaveBeenCalledWith(false));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('confirm resolves true on OK', async () => {
    const onResult = vi.fn();
    const { user } = renderWithProviders(<Buttons onResult={onResult} />);
    await user.click(screen.getByRole('button', { name: '確認' }));
    await user.click(screen.getByRole('button', { name: '削除' }));
    await waitFor(() => expect(onResult).toHaveBeenCalledWith(true));
  });

  it('prompt: validates, blocks OK with the message, and resolves the value', async () => {
    const onResult = vi.fn();
    const { user } = renderWithProviders(<Buttons onResult={onResult} />);
    await user.click(screen.getByRole('button', { name: '入力' }));
    const input = screen.getByLabelText('新しい名前');
    expect(document.activeElement).toBe(input);
    await user.clear(input);
    await user.click(screen.getByRole('button', { name: 'OK' }));
    expect(screen.getByRole('alert').textContent).toBe('名前を入力してください');
    expect(onResult).not.toHaveBeenCalled();
    await user.type(input, '星図の果て{Enter}');
    await waitFor(() => expect(onResult).toHaveBeenCalledWith('星図の果て'));
  });

  it('keeps Tab focus inside the dialog', async () => {
    const { user } = renderWithProviders(<Buttons />);
    await user.click(screen.getByRole('button', { name: '確認' }));
    const dialog = screen.getByRole('alertdialog');
    for (let i = 0; i < 4; i++) {
      await user.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
  });

  it('hide() and lockNow() go to the shell', async () => {
    const { user, onHide } = renderWithProviders(<Buttons />);
    await user.click(screen.getByRole('button', { name: '隠す' }));
    expect(onHide).toHaveBeenCalledTimes(1);
  });
});

function SheetHarness() {
  const [open, setOpen] = useState(false);
  const ui = useUi();
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        開く
      </button>
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title="項目"
        footer={
          <button type="button" onClick={() => void ui.confirm({ title: '本当に？' })}>
            確かめる
          </button>
        }
      >
        <p>本文</p>
      </Sheet>
    </>
  );
}

describe('Sheet', () => {
  it('is a modal dialog with focus inside, scroll lock, and Escape closing only the topmost layer', async () => {
    const { user } = renderWithProviders(<SheetHarness />);
    await user.click(screen.getByRole('button', { name: '開く' }));
    const sheet = screen.getByRole('dialog', { name: '項目' });
    expect(sheet.contains(document.activeElement)).toBe(true);
    expect(document.body.style.overflow).toBe('hidden');

    await user.click(screen.getByRole('button', { name: '確かめる' }));
    expect(screen.getByRole('dialog', { name: '本当に？' })).toBeTruthy();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: '本当に？' })).toBeNull();
    expect(screen.getByRole('dialog', { name: '項目' })).toBeTruthy();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.body.style.overflow).toBe('');
  });

  it('closes from the backdrop and the close button', async () => {
    const { user } = renderWithProviders(<SheetHarness />);
    await user.click(screen.getByRole('button', { name: '開く' }));
    await user.click(document.querySelector('.sheet-backdrop') as HTMLElement);
    expect(screen.queryByRole('dialog')).toBeNull();
    await user.click(screen.getByRole('button', { name: '開く' }));
    await user.click(screen.getByRole('button', { name: '閉じる' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

// ───────── discretion: camouflage, lock screen, route changes, one-tap 「隠す」 ─────────

function Requests({ results }: { results: unknown[] }) {
  const ui = useUi();
  return (
    <>
      <button type="button" onClick={() => ui.toast('アプリの通知')}>
        アプリの通知
      </button>
      <button type="button" onClick={() => ui.toast('ロック画面の通知', { whileSuspended: true })}>
        ロック画面の通知
      </button>
      <button type="button" onClick={() => void ui.confirm({ title: 'アプリの確認' }).then((v) => results.push(v))}>
        アプリの確認
      </button>
      <button type="button" onClick={() => void ui.confirm({ title: 'ロック画面の確認', whileSuspended: true }).then((v) => results.push(v))}>
        ロック画面の確認
      </button>
      <button type="button" onClick={() => void ui.prompt({ title: 'アプリの入力', label: '名前' }).then((v) => results.push(v))}>
        アプリの入力
      </button>
    </>
  );
}

function renderBare(props: { suspended?: boolean; camouflaged?: boolean }, results: unknown[] = []) {
  const onHide = vi.fn();
  const tree = (p: typeof props) => (
    <UiProvider onHide={onHide} onLock={() => undefined} {...p}>
      <Requests results={results} />
    </UiProvider>
  );
  const view = render(tree(props));
  return { ...view, onHide, results, update: (p: typeof props) => view.rerender(tree(p)) };
}

function press(name: string) {
  act(() => screen.getByRole('button', { name }).click());
}

describe('UiProvider while suspended (F2 AC3, F3)', () => {
  afterEach(() => {
    cleanup();
  });

  it('over the camouflage nothing appears: toasts are dropped and dialogs resolve as cancelled at once', async () => {
    const { results } = renderBare({ suspended: true, camouflaged: true });
    press('アプリの通知');
    press('ロック画面の通知');
    press('アプリの確認');
    press('ロック画面の確認');
    press('アプリの入力');
    await waitFor(() => expect(results).toEqual([false, false, null]));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.querySelector('.ui-toast')).toBeNull();
    expect(document.querySelector('.ui-toasts')).toBeNull();
  });

  it('on the lock screen only its own toasts and questions (whileSuspended) are shown', async () => {
    const { results } = renderBare({ suspended: true });
    press('アプリの通知');
    press('アプリの確認');
    await waitFor(() => expect(results).toEqual([false]));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('status').textContent).not.toContain('アプリの通知');

    press('ロック画面の通知');
    expect(screen.getByRole('status').textContent).toContain('ロック画面の通知');
    press('ロック画面の確認');
    expect(screen.getByRole('dialog', { name: 'ロック画面の確認' })).toBeTruthy();
  });

  it('entering the camouflage clears toasts and cancels open dialogs, the lock screen’s too', async () => {
    const { results, update } = renderBare({ suspended: true });
    press('ロック画面の通知');
    press('ロック画面の確認');
    expect(screen.getByRole('dialog', { name: 'ロック画面の確認' })).toBeTruthy();
    update({ suspended: true, camouflaged: true });
    await waitFor(() => expect(results).toEqual([false]));
    expect(screen.queryByRole('dialog')).toBeNull();
    update({ suspended: true });
    expect(screen.getByRole('status').textContent).not.toContain('ロック画面の通知');
  });

  it('dialogs and toasts work normally once the app is shown again', async () => {
    const { results, update } = renderBare({ suspended: true, camouflaged: true });
    update({});
    press('アプリの通知');
    expect(screen.getByRole('status').textContent).toContain('アプリの通知');
    press('アプリの確認');
    const dialog = screen.getByRole('dialog', { name: 'アプリの確認' });
    act(() => within(dialog).getByRole('button', { name: 'OK' }).click());
    await waitFor(() => expect(results).toEqual([true]));
  });
});

describe('UiProvider and route changes', () => {
  afterEach(() => {
    cleanup();
  });

  it('Back (a hash change) cancels a dialog asked for on the page that was left', async () => {
    window.location.hash = '#/w/x/edit';
    const { results } = renderBare({});
    press('アプリの確認');
    press('アプリの入力');
    expect(screen.getByRole('dialog', { name: 'アプリの確認' })).toBeTruthy();
    act(() => {
      window.history.replaceState(null, '', `${window.location.pathname}#/w/x`);
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    await waitFor(() => expect(results).toEqual([false, null]));
    expect(screen.queryByRole('dialog')).toBeNull();

    // a dialog asked for on the new page is untouched
    press('アプリの確認');
    expect(screen.getByRole('dialog', { name: 'アプリの確認' })).toBeTruthy();
  });
});

describe('「隠す」 on every layer that covers the header (F2 AC3)', () => {
  it('a dialog has its own 「隠す」', async () => {
    const { user, onHide } = renderWithProviders(<Buttons />);
    await user.click(screen.getByRole('button', { name: '確認' }));
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: '隠す' }));
    expect(onHide).toHaveBeenCalledTimes(1);
  });

  it('a sheet has its own 「隠す」 (inside the app’s UiProvider only)', async () => {
    const { user, onHide } = renderWithProviders(<SheetHarness />);
    await user.click(screen.getByRole('button', { name: '開く' }));
    await user.click(within(screen.getByRole('dialog', { name: '項目' })).getByRole('button', { name: '隠す' }));
    expect(onHide).toHaveBeenCalledTimes(1);
    cleanup();

    render(<Sheet open onClose={() => undefined} title="単独"><p>本文</p></Sheet>);
    expect(within(screen.getByRole('dialog', { name: '単独' })).queryByRole('button', { name: '隠す' })).toBeNull();
  });
});

function VanishingHarness() {
  const [shown, setShown] = useState(true);
  return (
    <Sheet open onClose={() => undefined} title="ヒント">
      {shown ? (
        <button type="button" onClick={() => setShown(false)}>
          ヒントを見る
        </button>
      ) : (
        <p>ヒントの本文</p>
      )}
      <button type="button">つぎへ</button>
    </Sheet>
  );
}

describe('focus trap', () => {
  it('when the focused control disappears, Tab still stays inside the sheet', async () => {
    const { user } = renderWithProviders(<VanishingHarness />);
    const sheet = screen.getByRole('dialog', { name: 'ヒント' });
    await user.click(screen.getByRole('button', { name: 'ヒントを見る' }));
    expect(screen.getByText('ヒントの本文')).toBeTruthy();
    await user.tab();
    expect(sheet.contains(document.activeElement)).toBe(true);
    await user.tab();
    expect(sheet.contains(document.activeElement)).toBe(true);
  });

  it('focus moved outside the open layer is brought back', () => {
    renderWithProviders(
      <>
        <button type="button">うしろのボタン</button>
        <SheetHarnessOpen />
      </>,
    );
    const sheet = screen.getByRole('dialog', { name: '開いた項目' });
    act(() => screen.getByRole('button', { name: 'うしろのボタン', hidden: true }).focus());
    expect(sheet.contains(document.activeElement)).toBe(true);
  });
});

function SheetHarnessOpen() {
  return (
    <Sheet open onClose={() => undefined} title="開いた項目">
      <p>本文</p>
    </Sheet>
  );
}
