// @vitest-environment jsdom
import { act, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { writeClipboard } from '../../app/platform';
import { renderWithProviders } from '../../test/renderWithProviders';
import { Sheet } from './Sheet';

// The legacy clipboard fallback (hidden textarea + execCommand) must keep focus while a Sheet's focus trap is
// active; otherwise it copies nothing but still reports success (e.g. 返し合言葉「コピー」 in the reader).
describe('clipboard fallback inside an open Sheet', () => {
  afterEach(() => {
    Reflect.deleteProperty(document, 'execCommand');
  });

  it('copies from inside the trap and returns focus to the button', async () => {
    let focusedAtCopy: Element | null = null;
    let selectedAtCopy = '';
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: vi.fn(() => {
        focusedAtCopy = document.activeElement;
        const el = document.activeElement as HTMLTextAreaElement | null;
        selectedAtCopy = el && 'value' in el ? el.value.slice(el.selectionStart ?? 0, el.selectionEnd ?? 0) : '';
        return true;
      }),
    });
    renderWithProviders(
      <Sheet open onClose={() => undefined} title="おまけ">
        <button type="button">コピー</button>
      </Sheet>,
    );
    // after render: userEvent.setup() (in renderWithProviders) installs its own navigator.clipboard stub
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
    const button = screen.getByRole('button', { name: 'コピー' });
    act(() => button.focus());
    let ok = false;
    await act(async () => {
      ok = await writeClipboard('ほしあかり');
    });
    expect(ok).toBe(true);
    expect(focusedAtCopy).toBeInstanceOf(HTMLTextAreaElement);
    expect(selectedAtCopy).toBe('ほしあかり');
    expect(document.activeElement).toBe(button);
    expect(document.querySelector('textarea[data-focus-trap-ignore]')).toBeNull();
  });
});
