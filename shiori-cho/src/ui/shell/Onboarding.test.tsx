// @vitest-environment jsdom
import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { verifyPin } from '../../core/crypto/pin';
import { renderWithProviders } from '../../test/renderWithProviders';
import { Onboarding } from './Onboarding';

describe('Onboarding (§6 overlay 2)', () => {
  it('asks the three questions, stores the answers, requests persistence and sets onboardedAt', async () => {
    const persist = vi.fn(async () => true);
    Object.defineProperty(navigator, 'storage', { configurable: true, value: { persist, persisted: async () => false } });
    const onDone = vi.fn();
    const { user, repo } = renderWithProviders(<Onboarding onDone={onDone} />, { settings: { onboardedAt: undefined } });

    expect(screen.getByRole('heading', { name: '人前で使うことがありますか？' })).toBeTruthy();
    await user.click(screen.getByRole('radio', { name: /いいえ/ }));
    await user.click(screen.getByRole('button', { name: '次へ' }));

    expect(screen.getByRole('heading', { name: 'PINを設定しますか？' })).toBeTruthy();
    expect(screen.getByText(/保存データそのものは暗号化されません/)).toBeTruthy();
    await user.click(screen.getByRole('radio', { name: /設定する/ }));
    await user.type(screen.getByLabelText('PIN（4〜8桁の数字）'), '2468');
    await user.type(screen.getByLabelText('もう一度入力'), '2469');
    await user.click(screen.getByRole('button', { name: 'PINを設定して次へ' }));
    expect(screen.getByRole('alert').textContent).toBe('確認用のPINが一致しません');
    await user.clear(screen.getByLabelText('もう一度入力'));
    await user.type(screen.getByLabelText('もう一度入力'), '2468');
    await user.click(screen.getByRole('button', { name: 'PINを設定して次へ' }));

    expect(await screen.findByRole('heading', { name: '自動ロックまでの時間' }, { timeout: 5000 })).toBeTruthy();
    await user.click(screen.getByRole('radio', { name: '30秒' }));
    await user.click(screen.getByRole('button', { name: '次へ' }));

    expect(screen.getByText(/1秒ほど長押し/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'はじめる' }));
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));

    const s = await repo.getSettings();
    expect(s.discreet.aliasOnly).toBe(false);
    expect(s.autoLockSec).toBe(30);
    expect(s.onboardedAt).toBeTypeOf('number');
    expect(s.persist).toEqual({ requestedAt: expect.any(Number), granted: true });
    expect(s.pin && (await verifyPin('2468', s.pin))).toBe(true);
    expect(persist).toHaveBeenCalled();
    Reflect.deleteProperty(navigator, 'storage');
  });

  it('「スキップ」 keeps the defaults (alias only, no PIN) and still explains 「隠す」', async () => {
    const onDone = vi.fn();
    const { user, repo } = renderWithProviders(<Onboarding onDone={onDone} />, { settings: { onboardedAt: undefined } });
    await user.click(screen.getByRole('button', { name: 'スキップ' }));
    expect(screen.getByText(/「隠す」/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'はじめる' }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    const s = await repo.getSettings();
    expect(s.discreet.aliasOnly).toBe(true);
    expect(s.pin).toBeUndefined();
    expect(s.onboardedAt).toBeTypeOf('number');
    expect(s.persist?.granted).toBe(false);
  });
});
