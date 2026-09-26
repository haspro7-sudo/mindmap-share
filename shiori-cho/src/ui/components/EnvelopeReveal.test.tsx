// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
    fireEvent.click(screen.getByRole('button', { name: /おまけが届きました/ }));
    act(() => vi.advanceTimersByTime(ENVELOPE_MS));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('its accessible name is the visible text, including the item label (WCAG 2.5.3)', () => {
    render(<EnvelopeReveal kind="letter" label="司書ミナからの手紙" onDone={() => undefined} />);
    const button = screen.getByRole('button', { name: /司書ミナからの手紙/ });
    expect(button.getAttribute('aria-label')).toBeNull();
    expect(button.textContent).toContain('おまけが届きました');
    expect(button.textContent).toContain('タップで読む');
  });

  it('with onHide, Escape and 「隠す」 hide instead of skipping to the reader (F2 AC3)', () => {
    vi.useFakeTimers();
    const onDone = vi.fn();
    const onHide = vi.fn();
    render(<EnvelopeReveal label="司書ミナからの手紙" onDone={onDone} onHide={onHide} />);
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    expect(onHide).toHaveBeenCalledTimes(1);
    expect(onDone).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '隠す' }));
    expect(onHide).toHaveBeenCalledTimes(2);
    expect(onDone).not.toHaveBeenCalled();
  });

  it('without onHide (standalone), Escape skips like a tap and there is no 「隠す」', () => {
    const onDone = vi.fn();
    render(<EnvelopeReveal onDone={onDone} />);
    expect(screen.queryByRole('button', { name: '隠す' })).toBeNull();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});

async function openedLetter() {
  const repo = createMemoryRepo();
  const [hoshiyomi] = await importBundledDemos(repo);
  const outcome = await submitCode(repo, 'ST4-RMA-P1X', { workId: hoshiyomi });
  const items = outcome.openedSealedIds.map((sealedId) => ({ workId: hoshiyomi!, sealedId }));
  return { repo, hoshiyomi: hoshiyomi!, items };
}

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

  it('the envelope and the reader have their own 「隠す」', async () => {
    mockReducedMotion(true);
    const { repo, items } = await openedLetter();
    const { user, onHide } = renderWithProviders(<Opener items={items} />, { repo });
    await user.click(screen.getByRole('button', { name: '開封' }));
    const env = await screen.findByTestId('envelope-reveal');
    fireEvent.click(within(env).getByRole('button', { name: '隠す' }));
    expect(onHide).toHaveBeenCalledTimes(1);
    const reader = await screen.findByRole('dialog', { name: 'おまけが届きました' }, { timeout: 3000 });
    await user.click(within(reader).getByRole('button', { name: '隠す' }));
    expect(onHide).toHaveBeenCalledTimes(2);
  });

  it('a route change during the animation closes it and keeps the item unseen (it replays later)', async () => {
    mockReducedMotion(false);
    window.location.hash = '#/w/x';
    const { repo, hoshiyomi, items } = await openedLetter();
    const { user } = renderWithProviders(<Opener items={items} />, { repo });
    await user.click(screen.getByRole('button', { name: '開封' }));
    expect(await screen.findByTestId('envelope-reveal')).toBeTruthy();
    act(() => {
      window.location.hash = '#/settings';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    await waitFor(() => expect(screen.queryByTestId('envelope-reveal')).toBeNull());
    await new Promise((r) => setTimeout(r, ENVELOPE_MS + 100));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect((await repo.listSealedOpens(hoshiyomi)).find((o) => o.sealedId === items[0]!.sealedId)?.seen).toBe(false);
  });

  it('Back while the reader is open closes it (it was read: marked seen)', async () => {
    mockReducedMotion(true);
    window.location.hash = '#/w/x';
    const { repo, hoshiyomi, items } = await openedLetter();
    const { user } = renderWithProviders(<Opener items={items} />, { repo });
    await user.click(screen.getByRole('button', { name: '開封' }));
    await screen.findByRole('dialog', { name: 'おまけが届きました' }, { timeout: 3000 });
    act(() => {
      window.location.hash = '#/settings';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(async () =>
      expect((await repo.listSealedOpens(hoshiyomi)).find((o) => o.sealedId === items[0]!.sealedId)?.seen).toBe(true),
    );
  });
});
