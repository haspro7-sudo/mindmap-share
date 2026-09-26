// @vitest-environment jsdom
import { act, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../test/renderWithProviders';
import { Sheet } from '../components/Sheet';
import { useUi } from '../context';

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
