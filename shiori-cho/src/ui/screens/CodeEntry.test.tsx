// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { importBundledDemos } from '../../app/library';
import { addPending } from '../../app/unlock';
import { generateCode } from '../../core/codes';
import { createMemoryRepo } from '../../storage/memoryRepo';
import { renderWithProviders } from '../../test/renderWithProviders';
import { writeCodeHandoff } from './codeHandoff';
import { CodeEntryScreen } from './CodeEntry';

async function demoRepo() {
  const repo = createMemoryRepo();
  const [hoshiyomi, amaoto] = await importBundledDemos(repo);
  return { repo, hoshiyomi: hoshiyomi!, amaoto: amaoto! };
}

/** A well-formed code (valid checksum) that no demo uses. */
function strayCode(): string {
  for (;;) {
    const c = generateCode('b32');
    if (!['ST4-RMA-P1X', 'M00-NDE-SKR', 'NEK-0T0-M0E', 'SK1-ES0-NGM', 'AMA-0T0-N1J'].includes(c.display)) return c.display;
  }
}

const vibrateMock = vi.fn(() => true);

beforeEach(() => {
  window.location.hash = '#/code';
  window.sessionStorage.clear();
  Object.defineProperty(window.navigator, 'vibrate', { value: vibrateMock, configurable: true, writable: true });
  vibrateMock.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('CodeEntryScreen (合言葉, F10)', () => {
  it('redeems a demo code: decrypted title, unlock message, vibration and a link to the work (AC4)', async () => {
    const { repo, hoshiyomi } = await demoRepo();
    const { user } = renderWithProviders(<CodeEntryScreen />, { repo });
    await user.type(screen.getByLabelText('合言葉'), 'st4rmap1x');
    await user.click(screen.getByRole('button', { name: '確かめる' }));

    expect(await screen.findByRole('heading', { name: '星図の果て' }, { timeout: 10_000 })).toBeTruthy();
    expect(screen.getByText('合言葉が通りました')).toBeTruthy();
    expect(screen.getByText(/END 1「星図の果て」にたどり着きました/)).toBeTruthy();
    const card = screen.getByRole('region', { name: '星図の果て' });
    expect(within(card).getByText('サンプルA')).toBeTruthy();
    expect(screen.getByRole('link', { name: '作品を見る' }).getAttribute('href')).toBe(`#/w/${hoshiyomi}`);
    expect(vibrateMock).toHaveBeenCalledWith(30);

    const progress = await repo.listProgress(hoshiyomi);
    expect(progress.find((p) => p.goalId === 'end-a')?.via).toBe('code');
    // the letter (anyOf over the endings) opened and was queued for the envelope animation
    expect((await repo.listSealedOpens(hoshiyomi)).length).toBeGreaterThan(0);
    expect((screen.getByLabelText('合言葉') as HTMLInputElement).value).toBe('');
  });

  it('says so when the code was already entered (AC5)', async () => {
    const { repo } = await demoRepo();
    const { user } = renderWithProviders(<CodeEntryScreen />, { repo });
    const input = screen.getByLabelText('合言葉');
    await user.type(input, 'AMA-0T0-N1J');
    await user.click(screen.getByRole('button', { name: '確かめる' }));
    await screen.findByText('合言葉が通りました', undefined, { timeout: 10_000 });
    await user.type(input, 'ama0t0n1j');
    await user.click(screen.getByRole('button', { name: '確かめる' }));
    expect(await screen.findByRole('heading', { name: 'この合言葉は入力済みです' }, { timeout: 10_000 })).toBeTruthy();
  });

  it('rejects a checksum error immediately, without deriving a key (AC2)', async () => {
    const { repo } = await demoRepo();
    const deriveBits = vi.spyOn(globalThis.crypto.subtle, 'deriveBits');
    const { user } = renderWithProviders(<CodeEntryScreen />, { repo });
    await user.type(screen.getByLabelText('合言葉'), 'st4rmap1y');
    expect(screen.getByText('入力ミスがあるようです。1文字違っているかもしれません')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '確かめる' }));
    // shown once (by the input's live feedback), no busy state, nothing stored, no PBKDF2
    expect(screen.getAllByText('入力ミスがあるようです。1文字違っているかもしれません')).toHaveLength(1);
    expect(screen.queryByText('確かめています…')).toBeNull();
    expect(deriveBits).not.toHaveBeenCalled();
    expect(await repo.listPending()).toEqual([]);
  });

  it('explains an incomplete code on 「確かめる」', async () => {
    const { user } = renderWithProviders(<CodeEntryScreen />);
    await user.type(screen.getByLabelText('合言葉'), 'ST4');
    await user.click(screen.getByRole('button', { name: '確かめる' }));
    expect(screen.getByRole('alert').textContent).toBe('英数字の合言葉は9文字です（いま 3文字）');
  });

  it('offers 「保留にする」 when nothing matches, and lists the pending code (AC5)', async () => {
    const { repo } = await demoRepo();
    const code = strayCode();
    const { user } = renderWithProviders(<CodeEntryScreen />, { repo });
    await user.type(screen.getByLabelText('合言葉'), code);
    await user.click(screen.getByRole('button', { name: '確かめる' }));
    expect(await screen.findByRole('heading', { name: '一致するしおりがありません' }, { timeout: 10_000 })).toBeTruthy();

    await user.click(screen.getByRole('button', { name: '保留にする' }));
    const section = await screen.findByRole('region', { name: /保留中の合言葉/ });
    expect(within(section).getByText(code)).toBeTruthy();
    const pending = await repo.listPending();
    expect(pending).toHaveLength(1);
    expect(pending[0]!.canonical).toBe(`b32:${code.replace(/-/g, '')}`);
  });

  it('says 「この作品の合言葉ではないようです」 when a chosen work does not match', async () => {
    const { repo, amaoto } = await demoRepo();
    const { user } = renderWithProviders(<CodeEntryScreen workId={amaoto} />, { repo });
    const select = (await screen.findByLabelText('どの作品？（おまかせ）')) as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe(amaoto));
    await user.type(screen.getByLabelText('合言葉'), strayCode());
    await user.click(screen.getByRole('button', { name: '確かめる' }));
    expect(await screen.findByRole('heading', { name: 'この作品の合言葉ではないようです' }, { timeout: 10_000 })).toBeTruthy();
  });

  it('retries pending codes with 「もう一度試す」 and deletes them with undo', async () => {
    const { repo, hoshiyomi } = await demoRepo();
    await addPending(repo, 'NEK-0T0-M0E');
    await addPending(repo, strayCode());
    const { user } = renderWithProviders(<CodeEntryScreen />, { repo });
    const section = await screen.findByRole('region', { name: /保留中の合言葉/ });
    expect(within(section).getByText('NEK-0T0-M0E')).toBeTruthy();

    await user.click(within(section).getByRole('button', { name: 'もう一度試す' }));
    expect(await screen.findByRole('heading', { name: '猫がくれた栞' }, { timeout: 10_000 })).toBeTruthy();
    await waitFor(async () => expect(await repo.listPending()).toHaveLength(1));
    expect((await repo.listRedemptions(hoshiyomi)).map((r) => r.goalId)).toEqual(['end-c']);

    const left = await repo.listPending();
    await user.click(screen.getByRole('button', { name: /を削除$/ }));
    await waitFor(async () => expect(await repo.listPending()).toHaveLength(0));
    await user.click(await screen.findByRole('button', { name: '元に戻す' }));
    await waitFor(async () => expect(await repo.listPending()).toEqual(left));
  });

  it('shows the deep-link hand-off: pending note and the iOS copy notice (F11 AC2–AC3)', async () => {
    writeCodeHandoff({ status: 'pending', code: 'ST4-RMA-P1X', ios: true });
    const { user } = renderWithProviders(<CodeEntryScreen />);
    expect(screen.getByText(/合言葉を保留にしました/)).toBeTruthy();
    const notice = screen.getByRole('region', { name: 'ホーム画面のしおり帳で使う場合' });
    expect(within(notice).getByText(/合言葉をコピー → しおり帳の『合言葉』で貼り付け/)).toBeTruthy();
    await user.click(within(notice).getByRole('button', { name: '合言葉をコピー' }));
    // user-event installs a clipboard stub on navigator.clipboard
    expect(await window.navigator.clipboard.readText()).toBe('ST4-RMA-P1X');
    expect(await screen.findByText('合言葉をコピーしました')).toBeTruthy();
    // read once
    expect(window.sessionStorage.length).toBe(0);
  });
});
