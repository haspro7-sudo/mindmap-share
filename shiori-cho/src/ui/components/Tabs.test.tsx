// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup } from '@testing-library/react';
import { EmojiCover } from './EmojiCover';
import { EmptyState } from './EmptyState';
import { ProgressBar, ProgressRing } from './Progress';
import { Tabs } from './Tabs';

afterEach(() => {
  cleanup();
});

function TabsHarness() {
  const [v, setV] = useState<'progress' | 'extras' | 'log'>('progress');
  return (
    <Tabs
      ariaLabel="作品の表示"
      value={v}
      onChange={setV}
      tabs={[
        { id: 'progress', label: '進捗' },
        { id: 'extras', label: 'おまけ', badge: 2 },
        { id: 'log', label: '記録' },
      ]}
    />
  );
}

describe('Tabs', () => {
  it('is a tablist with roving focus and arrow-key navigation', async () => {
    const user = userEvent.setup();
    render(<TabsHarness />);
    expect(screen.getByRole('tablist', { name: '作品の表示' })).toBeTruthy();
    const first = screen.getByRole('tab', { name: '進捗' });
    expect(first.getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tab', { name: /おまけ/ }).getAttribute('tabindex')).toBe('-1');
    first.focus();
    await user.keyboard('{ArrowRight}');
    const extras = screen.getByRole('tab', { name: /おまけ/ });
    expect(extras.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(extras);
    await user.keyboard('{ArrowLeft}{ArrowLeft}');
    expect(screen.getByRole('tab', { name: '記録' }).getAttribute('aria-selected')).toBe('true');
    await user.keyboard('{Home}');
    expect(first.getAttribute('aria-selected')).toBe('true');
  });
});

describe('Progress', () => {
  it('exposes progressbar values, floored and clamped; NaN → 0', () => {
    render(
      <>
        <ProgressBar pct={66.9} label="エンディング" />
        <ProgressBar pct={Number.NaN} compact />
        <ProgressRing pct={140} caption="8 / 8" />
      </>,
    );
    const bars = screen.getAllByRole('progressbar');
    expect(bars.map((b) => b.getAttribute('aria-valuenow'))).toEqual(['66', '0', '100']);
    expect(screen.getByRole('progressbar', { name: 'エンディング' })).toBeTruthy();
    expect(bars[2]!.getAttribute('aria-valuetext')).toBe('100%（8 / 8）');
  });
});

describe('EmojiCover / EmptyState', () => {
  it('renders an emoji tile on the cover color (no image)', () => {
    const { container } = render(<EmojiCover emoji="📘" color="sky" size={40} />);
    const tile = container.firstElementChild as HTMLElement;
    expect(tile.textContent).toBe('📘');
    expect(tile.style.background).toContain('--cover-sky');
    expect(tile.style.width).toBe('40px');
    expect(container.querySelector('img')).toBeNull();
  });

  it('renders title, body and action', () => {
    render(<EmptyState icon="📚" title="まだ作品がありません" body="「＋ 追加」から始めましょう" action={<button type="button">追加</button>} />);
    expect(screen.getByRole('heading', { name: 'まだ作品がありません' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '追加' })).toBeTruthy();
  });
});
