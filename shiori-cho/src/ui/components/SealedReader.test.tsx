// @vitest-environment jsdom
import { screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { importBundledDemos } from '../../app/library';
import { submitCode } from '../../app/unlock';
import { DEFAULT_SETTINGS } from '../../core/types';
import { createMemoryRepo } from '../../storage/memoryRepo';
import { renderWithProviders } from '../../test/renderWithProviders';
import { EXTERNAL_CONFIRM_TITLE, ExternalLinkButton } from './ExternalLinkButton';
import { SealedReader } from './SealedReader';

afterEach(() => {
  vi.restoreAllMocks();
});

async function demo() {
  const repo = createMemoryRepo();
  const [hoshiyomi, amaoto] = await importBundledDemos(repo);
  return { repo, hoshiyomi: hoshiyomi!, amaoto: amaoto! };
}

describe('SealedReader (F12 AC3)', () => {
  it('shows the locked state before the code is entered', async () => {
    const { repo, hoshiyomi } = await demo();
    renderWithProviders(<SealedReader workId={hoshiyomi} sealedId="letter-mina" />, { repo });
    expect(await screen.findByText(/まだ封印されています/)).toBeTruthy();
  });

  it('renders the decrypted letter as plain text with its signature', async () => {
    const { repo, hoshiyomi } = await demo();
    await submitCode(repo, 'ST4-RMA-P1X', { workId: hoshiyomi });
    renderWithProviders(<SealedReader workId={hoshiyomi} sealedId="letter-mina" />, { repo });
    expect(await screen.findByRole('heading', { name: '司書ミナからの手紙' }, { timeout: 5000 })).toBeTruthy();
    expect(screen.getByText('司書ミナより')).toBeTruthy();
    const body = document.querySelector('.sr-body');
    expect(body?.className).toContain('pre');
  });

  it('blurs the body when discreet.blurExtras is on until tapped', async () => {
    const { repo, hoshiyomi } = await demo();
    await submitCode(repo, 'ST4-RMA-P1X', { workId: hoshiyomi });
    const { user } = renderWithProviders(<SealedReader workId={hoshiyomi} sealedId="letter-mina" />, {
      repo,
      settings: { discreet: { ...DEFAULT_SETTINGS.discreet, blurExtras: true } },
    });
    const reveal = await screen.findByRole('button', { name: 'タップして本文を表示' }, { timeout: 5000 });
    expect(document.querySelector('.sr-content-inner')?.getAttribute('aria-hidden')).toBe('true');
    await user.click(reveal);
    expect(document.querySelector('.sr-content-inner')?.getAttribute('aria-hidden')).toBeNull();
  });

  it('shows a return code with a copy button', async () => {
    const { repo, hoshiyomi } = await demo();
    await submitCode(repo, 'SK1-ES0-NGM', { workId: hoshiyomi });
    const { user } = renderWithProviders(<SealedReader workId={hoshiyomi} sealedId="door-code" />, { repo });
    const code = await screen.findByText('ほしあかり', {}, { timeout: 5000 });
    expect(code.className).toContain('mono');
    await user.click(screen.getByRole('button', { name: 'コピー' }));
    expect(await navigator.clipboard.readText()).toBe('ほしあかり');
    expect(await screen.findByText('コピーしました')).toBeTruthy();
  });
});

describe('ExternalLinkButton (F2 AC5)', () => {
  it('is hidden while discreet.hideStoreLinks is on (default)', () => {
    renderWithProviders(<ExternalLinkButton storeCode="RJ01234567" />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('asks first, then opens DLsite in a new tab with noopener,noreferrer', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    const { user } = renderWithProviders(<ExternalLinkButton storeCode="rj01234567" label="作品ページを開く" />, {
      settings: { discreet: { ...DEFAULT_SETTINGS.discreet, hideStoreLinks: false } },
    });
    await user.click(screen.getByRole('button', { name: /作品ページを開く/ }));
    expect(screen.getByRole('dialog', { name: EXTERNAL_CONFIRM_TITLE })).toBeTruthy();
    expect(open).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: '開く' }));
    await waitFor(() =>
      expect(open).toHaveBeenCalledWith(
        'https://www.dlsite.com/maniax/work/=/product_id/RJ01234567.html',
        '_blank',
        'noopener,noreferrer',
      ),
    );
  });

  it('renders nothing for an invalid store code', () => {
    renderWithProviders(<ExternalLinkButton storeCode="XX123" />, {
      settings: { discreet: { ...DEFAULT_SETTINGS.discreet, hideStoreLinks: false } },
    });
    expect(screen.queryByRole('button')).toBeNull();
  });
});
