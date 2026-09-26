// @vitest-environment jsdom
import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PIN_COOLDOWN_MS } from '../../core/constants';
import { hashPin } from '../../core/crypto/pin';
import { renderWithProviders } from '../../test/renderWithProviders';
import { LockScreen } from './LockScreen';

const FAST = { iterations: 1000 };

async function setup(extra: Record<string, unknown> = {}) {
  const pin = await hashPin('1357', FAST);
  const onUnlock = vi.fn();
  const onWipe = vi.fn();
  const r = renderWithProviders(<LockScreen onUnlock={onUnlock} onWipe={onWipe} />, { settings: { pin, ...extra } });
  return { ...r, onUnlock, onWipe };
}

describe('LockScreen (F3)', () => {
  it('unlocks with the right PIN (keypad) and resets the failure counter', async () => {
    const { user, onUnlock, repo } = await setup({ pinFailures: 3 });
    for (const d of ['1', '3', '5', '7']) await user.click(screen.getByRole('button', { name: d }));
    await user.click(screen.getByRole('button', { name: '解除' }));
    await waitFor(() => expect(onUnlock).toHaveBeenCalledTimes(1));
    expect((await repo.getSettings()).pinFailures).toBe(0);
  });

  it('accepts keyboard digits and Enter', async () => {
    const { user, onUnlock } = await setup();
    await user.keyboard('1357{Enter}');
    await waitFor(() => expect(onUnlock).toHaveBeenCalledTimes(1));
  });

  it('counts failures and starts a persisted 30 s cooldown after 5 wrong PINs', async () => {
    const { user, onUnlock, repo } = await setup();
    for (let i = 1; i <= 4; i++) {
      await user.keyboard('0000{Enter}');
      await screen.findByText(`PINが違います（あと${5 - i}回まちがえると30秒お待ちいただきます）`);
      expect((await repo.getSettings()).pinFailures).toBe(i);
    }
    const before = Date.now();
    await user.keyboard('0000{Enter}');
    expect(await screen.findByText(/あと(30|29)秒お待ちください/)).toBeTruthy();
    const s = await repo.getSettings();
    expect(s.pinCooldownUntil).toBeGreaterThanOrEqual(before + PIN_COOLDOWN_MS);
    expect(screen.getByRole('button', { name: '1' }).hasAttribute('disabled')).toBe(true);
    // even the right PIN is ignored during the cooldown
    await user.keyboard('1357{Enter}');
    expect(onUnlock).not.toHaveBeenCalled();
  });

  it('shows a cooldown stored earlier (after a reload)', async () => {
    await setup({ pinCooldownUntil: Date.now() + 12_000 });
    expect(screen.getByText(/あと1[12]秒お待ちください/)).toBeTruthy();
    expect(screen.getByRole('button', { name: '解除' }).hasAttribute('disabled')).toBe(true);
  });

  it('「PINを忘れた」 offers only the wipe, behind a double confirmation', async () => {
    const { user, onWipe } = await setup();
    await user.click(screen.getByRole('button', { name: 'PINを忘れた' }));
    await user.click(screen.getByRole('button', { name: '全データを消して初期化' }));
    await user.click(screen.getByRole('button', { name: '次へ' }));
    expect(onWipe).not.toHaveBeenCalled();
    expect(screen.getByRole('alertdialog', { name: '本当に消しますか？' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '消して初期化する' }));
    await waitFor(() => expect(onWipe).toHaveBeenCalledTimes(1));
  });

  it('cancelling either confirmation keeps the data', async () => {
    const { user, onWipe } = await setup();
    await user.click(screen.getByRole('button', { name: 'PINを忘れた' }));
    await user.click(screen.getByRole('button', { name: '全データを消して初期化' }));
    await user.click(screen.getByRole('button', { name: '次へ' }));
    await user.click(screen.getByRole('button', { name: 'キャンセル' }));
    expect(onWipe).not.toHaveBeenCalled();
  });
});
