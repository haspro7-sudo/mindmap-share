// @vitest-environment jsdom
import { fireEvent, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../test/renderWithProviders';
import { CodeInput } from './CodeInput';

function Harness({ onSubmit = () => undefined, initial = '' }: { onSubmit?: (v: string) => void; initial?: string }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <label htmlFor="code">合言葉</label>
      <CodeInput id="code" value={value} onChange={setValue} onSubmit={() => onSubmit(value)} />
    </>
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('CodeInput (F10)', () => {
  it('shows the checksum error for a complete code instantly, without any KDF call', async () => {
    const deriveBits = vi.spyOn(globalThis.crypto.subtle, 'deriveBits');
    const importKey = vi.spyOn(globalThis.crypto.subtle, 'importKey');
    const { user } = renderWithProviders(<Harness />);
    const input = screen.getByLabelText('合言葉');
    await user.type(input, 'ST4-RMA-P1Y'); // END 1 with the last character changed
    expect(screen.getByText('入力ミスがあるようです。1文字違っているかもしれません')).toBeTruthy();
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(deriveBits).not.toHaveBeenCalled();
    expect(importKey).not.toHaveBeenCalled();
  });

  it('gives live format feedback and hides errors while the input is still incomplete', async () => {
    const { user } = renderWithProviders(<Harness />);
    const input = screen.getByLabelText('合言葉');
    await user.type(input, 'st4-rm');
    expect(screen.getByText('英数字の合言葉（いま 5/9文字）')).toBeTruthy();
    expect(input.getAttribute('aria-invalid')).toBeNull();
    await user.type(input, 'a-p1x');
    expect(screen.getByText('英数字の合言葉（9文字）')).toBeTruthy();
    expect(screen.getByText('ST4-RMA-P1X')).toBeTruthy();
  });

  it('recognises kana codes and reports an unknown word once complete', async () => {
    const { user } = renderWithProviders(<Harness />);
    const input = screen.getByLabelText('合言葉');
    await user.type(input, 'ほたる・かえで・つばめ・こだま・すずめ');
    expect(screen.getByText('ひらがなの合言葉（5語）')).toBeTruthy();
    await user.clear(input);
    await user.type(input, 'ほたる かえで ぬぬぬ こだま すずめ');
    expect(screen.getByText('3語目『ぬぬぬ』が見つかりません')).toBeTruthy();
  });

  it('shows an error for a character that can never be valid right away', async () => {
    const { user } = renderWithProviders(<Harness />);
    await user.type(screen.getByLabelText('合言葉'), 'ST4U');
    expect(screen.getByText('使えない文字が含まれています（U）')).toBeTruthy();
  });

  it('submits on Enter and then shows the error for an incomplete code', async () => {
    const onSubmit = vi.fn();
    const { user } = renderWithProviders(<Harness onSubmit={onSubmit} />);
    await user.type(screen.getByLabelText('合言葉'), 'ST4{Enter}');
    expect(onSubmit).toHaveBeenCalledWith('ST4');
    expect(screen.getByText('英数字の合言葉は9文字です（いま 3文字）')).toBeTruthy();
  });

  it('「貼り付け」 extracts the code from a pasted deep-link URL', async () => {
    const { user } = renderWithProviders(<Harness />);
    // user-event installs a clipboard stub on setup()
    await navigator.clipboard.writeText('ここから開けます https://example.test/app/#/u/demo-hoshiyomi/ST4RMAP1X 。');
    await user.click(screen.getByRole('button', { name: '貼り付け' }));
    expect(await screen.findByDisplayValue('ST4RMAP1X')).toBe(screen.getByLabelText('合言葉'));
    expect(await screen.findByText('英数字の合言葉（9文字）')).toBeTruthy();
  });

  it('a normal paste of a deep link also keeps only the code', () => {
    renderWithProviders(<Harness />);
    const input = screen.getByLabelText('合言葉');
    fireEvent.paste(input, { clipboardData: { getData: () => '#/u/demo-amaoto/AMA0T0N1J' } });
    expect((input as HTMLInputElement).value).toBe('AMA0T0N1J');
  });

  it('uses the attributes of a code field', () => {
    renderWithProviders(<Harness />);
    const input = screen.getByLabelText('合言葉');
    expect(input.getAttribute('autocomplete')).toBe('off');
    expect(input.getAttribute('autocapitalize')).toBe('characters');
    expect(input.getAttribute('spellcheck')).toBe('false');
    expect(input.getAttribute('inputmode')).toBe('text');
  });
});
