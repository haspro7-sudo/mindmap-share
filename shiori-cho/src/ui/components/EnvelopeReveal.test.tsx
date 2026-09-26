// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { importBundledDemos } from '../../app/library';
import { submitCode } from '../../app/unlock';
import { createMemoryRepo } from '../../storage/memoryRepo';
import { renderWithProviders } from '../../test/renderWithProviders';
import { useUi } from '../context';
import { ENVELOPE_MS, ENVELOPE_REDUCED_MS, EnvelopeReveal } from './EnvelopeReveal';

function mockReducedMotion(reduce: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: reduce && query.includes('prefers-reduced-motion: reduce'),
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }),
  });
}

afterEach(() => {
  vi.useRealTimers();
  Reflect.deleteProperty(window, 'matchMedia');
});

describe('EnvelopeReveal (F12 AC2)', () => {
  it('honours prefers-reduced-motion: a 200 ms fade instead of the animation', () => {
    vi.useFakeTimers();
    mockReducedMotion(true);
    const onDone = vi.fn();
    render(<EnvelopeReveal kind="letter" label="司書ミナからの手紙" onDone={onDone} />);
    const root = screen.getByTestId('envelope-reveal');
    expect(root.getAttribute('data-reduced-motion')).toBe('true');
    expect(root.className).toContain('env-reduced');
    act(() => vi.advanceTimersByTime(ENVELOPE_REDUCED_MS - 1));
    expect(onDone).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('plays the full animation for at most 1.5 s without reduced motion', () => {
    vi.useFakeTimers();
    mockReducedMotion(false);
    const onDone = vi.fn();
    render(<EnvelopeReveal kind="afterword" label="あとがき" onDone={onDone} />);
    expect(screen.getByTestId('envelope-reveal').className).toContain('env-animated');
    expect(ENVELOPE_MS).toBeLessThanOrEqual(1500);
    act(() => vi.advanceTimersByTime(ENVELOPE_REDUCED_MS));
    expect(onDone).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(ENVELOPE_MS));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('a tap skips it (once)', () => {
    vi.useFakeTimers();
    const onDone = vi.fn();
    render(<EnvelopeReveal onDone={onDone} />);
    fireEvent.click(screen.getByRole('button', { name: 'おまけを開く（タップでスキップ）' }));
    act(() => vi.advanceTimersByTime(ENVELOPE_MS));
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});

function Opener({ items }: { items: { workId: string; sealedId: string }[] }) {
  const ui = useUi();
  return (
    <button type="button" onClick={() => ui.queueEnvelopes(items)}>
      開封
    </button>
  );
}

describe('UiProvider envelope queue', () => {
  it('plays the envelope, opens the reader, and marks the item seen when the reader closes', async () => {
    mockReducedMotion(true);
    const vibrate = vi.fn();
    Object.defineProperty(navigator, 'vibrate', { configurable: true, value: vibrate });
    const repo = createMemoryRepo();
    const [hoshiyomi] = await importBundledDemos(repo);
    const outcome = await submitCode(repo, 'ST4-RMA-P1X', { workId: hoshiyomi });
    expect(outcome.status).toBe('unlocked');
    expect(outcome.openedSealedIds.length).toBeGreaterThan(0);
    const items = outcome.openedSealedIds.map((sealedId) => ({ workId: hoshiyomi!, sealedId }));

    const { user } = renderWithProviders(<Opener items={items} />, { repo });
    await user.click(screen.getByRole('button', { name: '開封' }));
    expect(await screen.findByTestId('envelope-reveal')).toBeTruthy();
    expect(vibrate).toHaveBeenCalledWith(30);

    const dialog = await screen.findByRole('dialog', {}, { timeout: 3000 });
    expect(await screen.findByText('司書ミナより', { exact: false }, { timeout: 5000 })).toBeTruthy();
    expect(dialog.querySelector('.sr-body')?.textContent?.length).toBeGreaterThan(0);

    await user.click(screen.getByRole('button', { name: '閉じる' }));
    await waitFor(async () => {
      const opens = await repo.listSealedOpens(hoshiyomi!);
      expect(opens.find((o) => o.sealedId === items[0]!.sealedId)?.seen).toBe(true);
    });
    Reflect.deleteProperty(navigator, 'vibrate');
  });
});
