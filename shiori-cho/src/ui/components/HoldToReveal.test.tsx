// @vitest-environment jsdom
import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../test/renderWithProviders';
import { HoldToReveal } from './HoldToReveal';

const ANSWER = { title: '答えを表示します。よろしいですか？', okLabel: '表示する' };

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

describe('HoldToReveal (F8 AC2)', () => {
  it('reveals after a 600 ms hold (no confirm prop)', () => {
    const onReveal = vi.fn();
    renderWithProviders(<HoldToReveal label="ヒント1を見る（長押し）" onReveal={onReveal} />);
    const btn = screen.getByRole('button', { name: 'ヒント1を見る（長押し）' });
    fireEvent.pointerDown(btn);
    act(() => vi.advanceTimersByTime(599));
    expect(onReveal).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(onReveal).toHaveBeenCalledTimes(1);
    fireEvent.pointerUp(btn);
    fireEvent.click(btn); // the click that ends the hold does not ask again
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('cancels when the pointer is released or leaves early', () => {
    const onReveal = vi.fn();
    renderWithProviders(<HoldToReveal label="ヒント1を見る（長押し）" onReveal={onReveal} />);
    const btn = screen.getByRole('button', { name: 'ヒント1を見る（長押し）' });
    fireEvent.pointerDown(btn);
    act(() => vi.advanceTimersByTime(300));
    fireEvent.pointerLeave(btn);
    act(() => vi.advanceTimersByTime(1000));
    expect(onReveal).not.toHaveBeenCalled();
  });

  it('the answer tier ALWAYS requires the confirm dialog, even after a full hold', async () => {
    const onReveal = vi.fn();
    renderWithProviders(<HoldToReveal label="答えを見る（長押し）" onReveal={onReveal} confirm={ANSWER} />);
    const btn = screen.getByRole('button', { name: '答えを見る（長押し）' });
    fireEvent.pointerDown(btn);
    act(() => vi.advanceTimersByTime(600));
    fireEvent.pointerUp(btn);
    fireEvent.click(btn);
    expect(onReveal).not.toHaveBeenCalled();
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(screen.getByRole('dialog', { name: '答えを表示します。よろしいですか？' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '表示する' }));
    await flush();
    expect(onReveal).toHaveBeenCalledTimes(1);
  });

  it('cancelling the answer confirm does not reveal', async () => {
    const onReveal = vi.fn();
    renderWithProviders(<HoldToReveal label="答えを見る（長押し）" onReveal={onReveal} confirm={ANSWER} />);
    const btn = screen.getByRole('button', { name: '答えを見る（長押し）' });
    fireEvent.pointerDown(btn);
    act(() => vi.advanceTimersByTime(600));
    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }));
    await flush();
    expect(onReveal).not.toHaveBeenCalled();
  });

  it('keyboard activation (or a click without a hold) opens a confirm dialog instead', async () => {
    const onReveal = vi.fn();
    renderWithProviders(<HoldToReveal label="ヒント2を見る（長押し）" onReveal={onReveal} />);
    const btn = screen.getByRole('button', { name: 'ヒント2を見る（長押し）' });
    btn.focus();
    fireEvent.click(btn); // Enter / Space on a button dispatch a click without a pointer hold
    expect(onReveal).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '表示する' }));
    await flush();
    expect(onReveal).toHaveBeenCalledTimes(1);
  });

  it('does nothing while disabled', () => {
    const onReveal = vi.fn();
    renderWithProviders(<HoldToReveal label="ヒント3を見る（長押し）" onReveal={onReveal} disabled />);
    const btn = screen.getByRole('button', { name: 'ヒント3を見る（長押し）' });
    fireEvent.pointerDown(btn);
    act(() => vi.advanceTimersByTime(1000));
    expect(onReveal).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
