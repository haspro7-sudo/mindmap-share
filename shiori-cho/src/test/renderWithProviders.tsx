/**
 * renderWithProviders — the standard way to render a screen or component in a jsdom UI test.
 *
 * ```tsx
 * // @vitest-environment jsdom
 * import { screen } from '@testing-library/react';
 * import { renderWithProviders } from '../../test/renderWithProviders';
 *
 * it('shows the alias', async () => {
 *   const repo = createMemoryRepo();
 *   await importBundledDemos(repo);                       // seed data through the app services
 *   const { user } = renderWithProviders(<HomeScreen />, { repo, settings: { discreet: { aliasOnly: true } } });
 *   expect(await screen.findByText('サンプルA')).toBeTruthy();  // repo data loads asynchronously
 *   await user.click(screen.getByRole('button', { name: '隠す' }));
 * });
 * ```
 *
 * What you get
 * - `RepoContext` with `opts.repo` or a fresh `createMemoryRepo()`, and `StudioRepoContext` with
 *   `opts.studioRepo` or a fresh `createMemoryStudioRepo()`.
 * - A real `SettingsContext` (shell/SettingsProvider) bound to that repo: `useSettings().update()` writes
 *   to the repo, and changes made directly on the repo (`repo.updateSettings`) re-render the tree.
 * - The real `UiProvider` (toasts, confirm/prompt dialogs, envelope queue). `ui.hide()` and `ui.lockNow()`
 *   call the returned `onHide` / `onLock` mocks (vi.fn), so you can assert on them.
 *
 * Settings
 * - The repo gets `{ ageConfirmedAt, onboardedAt, ...opts.settings }` (gates already passed by default).
 *   `discreet` is merged key-wise like `repo.updateSettings`; pass `ageConfirmedAt: undefined` to clear it.
 * - The first render already uses these values (synchronous render, `getBy…` works right away for static
 *   UI). If you pass your own repo that was seeded with OTHER settings (e.g. `fullSettings`), those only
 *   appear after the provider re-reads the repo on mount, so prefer `opts.settings`, or `await findBy…`.
 * - Anything read through `useRepoQuery` is asynchronous: use `await screen.findBy…` / `waitFor`.
 *
 * Returns everything `render()` returns (`rerender` keeps the providers), plus
 * `{ repo, studioRepo, user, onHide, onLock }`, where `user = userEvent.setup(opts.user)`.
 * With fake timers pass `user: { advanceTimers: vi.advanceTimersByTime }`.
 *
 * Dialogs, sheets and toasts render in portals on document.body, so query them through `screen`
 * (e.g. `await screen.findByRole('dialog')`, `screen.getByRole('button', { name: 'OK' })`).
 *
 * Importing this module registers `afterEach(cleanup)` for the test file (vitest runs without `globals`, so
 * Testing Library's automatic cleanup is off), and applies ./jsdomRealm (restores Node's Uint8Array/ArrayBuffer globals), so real
 * crypto (PINs, 合言葉, sealed extras, imports) works in jsdom tests.
 */
import './jsdomRealm';
import { cleanup, render } from '@testing-library/react';
import type { RenderOptions, RenderResult } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement, ReactNode } from 'react';
import { afterEach, vi } from 'vitest';
import type { Mock } from 'vitest';
import type { Settings } from '../core/types';
import { createMemoryRepo, createMemoryStudioRepo } from '../storage/memoryRepo';
import type { ShioriRepo, StudioRepo } from '../storage/repo';
import { applySettingsPatch, normalizeSettings } from '../storage/shared';
import { RepoContext, StudioRepoContext } from '../ui/context';
import { SettingsProvider } from '../ui/shell/SettingsProvider';
import { UiProvider } from '../ui/shell/UiProvider';

// vitest runs without `globals`, so @testing-library/react cannot register its automatic cleanup:
// importing this helper registers it for the importing test file.
afterEach(() => {
  cleanup();
});

export interface RenderWithProvidersOptions {
  /** defaults to a fresh createMemoryRepo() */
  repo?: ShioriRepo;
  /** defaults to a fresh createMemoryStudioRepo() */
  studioRepo?: StudioRepo;
  /** applied on top of `{ ageConfirmedAt: now, onboardedAt: now }` (see the module comment) */
  settings?: Partial<Settings>;
  /** options for userEvent.setup() */
  user?: Parameters<typeof userEvent.setup>[0];
  /** extra options for @testing-library/react render() (container, baseElement, …) */
  render?: Omit<RenderOptions, 'wrapper' | 'queries'>;
}

export type RenderWithProvidersResult = RenderResult & {
  repo: ShioriRepo;
  studioRepo: StudioRepo;
  user: ReturnType<typeof userEvent.setup>;
  /** called by useUi().hide() */
  onHide: Mock<() => void>;
  /** called by useUi().lockNow() */
  onLock: Mock<() => void>;
};

export function renderWithProviders(ui: ReactElement, opts: RenderWithProvidersOptions = {}): RenderWithProvidersResult {
  const now = Date.now();
  const patch: Partial<Settings> = { ageConfirmedAt: now, onboardedAt: now, ...opts.settings };
  const repo = opts.repo ?? createMemoryRepo({ fullSettings: patch });
  // Memory repositories apply updateSettings synchronously, so the provider's first read sees the patch.
  if (opts.repo) void opts.repo.updateSettings(patch);
  const studioRepo = opts.studioRepo ?? createMemoryStudioRepo();
  const initial = applySettingsPatch(normalizeSettings(undefined), patch);
  const onHide = vi.fn<() => void>();
  const onLock = vi.fn<() => void>();

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <RepoContext.Provider value={repo}>
        <StudioRepoContext.Provider value={studioRepo}>
          <SettingsProvider repo={repo} initial={initial}>
            <UiProvider onHide={onHide} onLock={onLock}>
              {children}
            </UiProvider>
          </SettingsProvider>
        </StudioRepoContext.Provider>
      </RepoContext.Provider>
    );
  }

  const user = userEvent.setup(opts.user);
  const result = render(ui, { ...opts.render, wrapper: Wrapper });
  return { ...result, repo, studioRepo, user, onHide, onLock };
}
