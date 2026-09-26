// @vitest-environment jsdom
import { screen, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { importBundledDemos } from '../../app/library';
import * as platform from '../../app/platform';
import * as unlock from '../../app/unlock';
import { createMemoryRepo } from '../../storage/memoryRepo';
import { renderWithProviders } from '../../test/renderWithProviders';
import { peekCodeHandoff } from './codeHandoff';
import { IOS_COPY_NOTICE, UnlockLanding } from './UnlockLanding';

vi.mock('../../app/unlock', async (importOriginal) => {
  const m = await importOriginal<typeof import('../../app/unlock')>();
  return { ...m, handleDeepLink: vi.fn(m.handleDeepLink) };
});
vi.mock('../../app/platform', async (importOriginal) => {
  const m = await importOriginal<typeof import('../../app/platform')>();
  return { ...m, isIosSafariNotStandalone: vi.fn(() => false) };
});

function open(manifestWorkId: string, code: string) {
  window.location.hash = `#/u/${manifestWorkId}/${code}`;
}

beforeEach(() => {
  window.sessionStorage.clear();
  vi.mocked(unlock.handleDeepLink).mockClear();
  vi.mocked(platform.isIosSafariNotStandalone).mockReturnValue(false);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('UnlockLanding (#/u/…, F11)', () => {
  it('stores an unknown work’s code as pending and replaces the route with #/code (AC1–AC2)', async () => {
    const repo = createMemoryRepo();
    open('demo-hoshiyomi', 'ST4RMAP1X');
    const lengthBefore = window.history.length;
    const replace = vi.spyOn(window.history, 'replaceState');
    renderWithProviders(
      <StrictMode>
        <UnlockLanding manifestWorkId="demo-hoshiyomi" code="ST4RMAP1X" />
      </StrictMode>,
      { repo },
    );
    expect(screen.getByText('合言葉を確かめています…')).toBeTruthy();

    await waitFor(() => expect(window.location.hash).toBe('#/code'));
    expect(replace.mock.calls.some((c) => /#\/code$/.test(String(c[2])))).toBe(true);
    expect(window.history.length).toBe(lengthBefore);
    expect(window.location.href).not.toContain('ST4RMAP1X');
    // ran once despite StrictMode's double effect
    expect(unlock.handleDeepLink).toHaveBeenCalledTimes(1);

    const pending = await repo.listPending();
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ canonical: 'b32:ST4RMAP1X', manifestWorkIdHint: 'demo-hoshiyomi' });
    expect(await screen.findByText('しおりファイルがまだないため、合言葉を保留にしました')).toBeTruthy();
    expect(peekCodeHandoff()).toMatchObject({ status: 'pending', code: 'ST4-RMA-P1X', ios: false });
  });

  it('opens the work on a match (replace), with a toast and the envelopes queued', async () => {
    const repo = createMemoryRepo();
    const [hoshiyomi] = await importBundledDemos(repo);
    open('demo-hoshiyomi', 'st4-rma-p1x');
    renderWithProviders(<UnlockLanding manifestWorkId="demo-hoshiyomi" code="st4-rma-p1x" />, { repo });
    await waitFor(() => expect(window.location.hash).toBe(`#/w/${hoshiyomi}`), { timeout: 10_000 });
    expect(await screen.findByText('合言葉が通りました：星図の果て')).toBeTruthy();
    expect((await repo.listProgress(hoshiyomi!)).find((p) => p.goalId === 'end-a')?.via).toBe('code');
    expect(await screen.findByText('おまけが届きました')).toBeTruthy();
    expect(peekCodeHandoff()).toBeNull();
  });

  it('a remount while the code is being checked shows the SAME result (no second run, no 「入力済み」)', async () => {
    const repo = createMemoryRepo();
    const [hoshiyomi] = await importBundledDemos(repo);
    const real = (await vi.importActual<typeof import('../../app/unlock')>('../../app/unlock')).handleDeepLink;
    let release: () => void = () => undefined;
    vi.mocked(unlock.handleDeepLink).mockImplementationOnce(
      (r, id, c) =>
        new Promise((resolve, reject) => {
          release = () => void real(r, id, c).then(resolve, reject);
        }),
    );
    open('demo-hoshiyomi', 'ST4RMAP1X');
    const onSettled = vi.fn();
    const first = renderWithProviders(<UnlockLanding manifestWorkId="demo-hoshiyomi" code="ST4RMAP1X" onSettled={onSettled} />, { repo });
    // 「隠す」 unmounts the app frame while the key derivation runs
    first.unmount();
    release();
    await waitFor(async () => expect((await repo.listProgress(hoshiyomi!)).some((p) => p.goalId === 'end-a')).toBe(true), {
      timeout: 10_000,
    });
    expect(onSettled).not.toHaveBeenCalled();

    // back from the camouflage: a new landing for the same link
    renderWithProviders(<UnlockLanding manifestWorkId="demo-hoshiyomi" code="ST4RMAP1X" onSettled={onSettled} />, { repo });
    expect(await screen.findByText('合言葉が通りました：星図の果て', undefined, { timeout: 10_000 })).toBeTruthy();
    expect(screen.queryByText('この合言葉は入力済みです')).toBeNull();
    expect(unlock.handleDeepLink).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(window.location.hash).toBe(`#/w/${hoshiyomi}`));
    expect(onSettled).toHaveBeenCalledTimes(1);
  });

  it('sends an invalid code to #/code with its error message', async () => {
    open('demo-hoshiyomi', 'ST4RMAP1Y');
    renderWithProviders(<UnlockLanding manifestWorkId="demo-hoshiyomi" code="ST4RMAP1Y" />);
    await waitFor(() => expect(window.location.hash).toBe('#/code'));
    expect(await screen.findByText('入力ミスがあるようです。1文字違っているかもしれません')).toBeTruthy();
    expect(peekCodeHandoff()).toMatchObject({ status: 'invalid', code: 'ST4RMAP1Y' });
  });

  it('on iOS Safari outside the home-screen app, offers to copy the code (AC3)', async () => {
    vi.mocked(platform.isIosSafariNotStandalone).mockReturnValue(true);
    const repo = createMemoryRepo();
    const [, amaoto] = await importBundledDemos(repo);
    open('demo-amaoto', 'AMA0T0N1J');
    const { user } = renderWithProviders(<UnlockLanding manifestWorkId="demo-amaoto" code="AMA0T0N1J" />, { repo });
    await waitFor(() => expect(window.location.hash).toBe(`#/w/${amaoto}`), { timeout: 10_000 });
    expect(await screen.findByText(IOS_COPY_NOTICE)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'コピー' }));
    await waitFor(async () => expect(await window.navigator.clipboard.readText()).toBe('AMA-0T0-N1J'));

    // pending path: the code screen gets the notice through the hand-off
    window.sessionStorage.clear();
    open('demo-unknown', 'SK1ES0NGM');
    renderWithProviders(<UnlockLanding manifestWorkId="demo-unknown" code="SK1ES0NGM" />);
    await waitFor(() => expect(window.location.hash).toBe('#/code'));
    expect(peekCodeHandoff()).toMatchObject({ status: 'pending', code: 'SK1-ES0-NGM', ios: true });
  });
});
