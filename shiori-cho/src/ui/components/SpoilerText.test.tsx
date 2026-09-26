// @vitest-environment jsdom
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderWithProviders } from '../../test/renderWithProviders';
import { SpoilerNote } from './SpoilerNote';
import { SpoilerText, SPOILER_PLACEHOLDER } from './SpoilerText';

describe('SpoilerText (F8 AC1)', () => {
  it('shows text whose spoiler level is within the tolerance', () => {
    renderWithProviders(<SpoilerText text="図書館のいちばん上で" spoiler={1} tolerance={1} />);
    expect(screen.getByText('図書館のいちばん上で')).toBeTruthy();
    expect(screen.queryByText(SPOILER_PLACEHOLDER)).toBeNull();
  });

  it('hides text above the tolerance (not even in the DOM) until tapped, for this view only', async () => {
    const { user, unmount } = renderWithProviders(<SpoilerText text="天文台の望遠鏡を3回調べる" spoiler={2} tolerance={1} as="p" />);
    expect(document.body.textContent).not.toContain('天文台');
    const btn = screen.getByRole('button', { name: SPOILER_PLACEHOLDER });
    await user.click(btn);
    expect(screen.getByText('天文台の望遠鏡を3回調べる').tagName).toBe('P');
    unmount();
    renderWithProviders(<SpoilerText text="天文台の望遠鏡を3回調べる" spoiler={2} tolerance={1} />);
    expect(screen.getByRole('button', { name: SPOILER_PLACEHOLDER })).toBeTruthy();
  });

  it('tolerance 0 hides even level-1 text; level 0 is always shown', () => {
    renderWithProviders(
      <>
        <SpoilerText text="END 3" spoiler={1} tolerance={0} />
        <SpoilerText text="図書館の猫と3回話した" spoiler={0} tolerance={0} />
      </>,
    );
    expect(screen.queryByText('END 3')).toBeNull();
    expect(screen.getByText('図書館の猫と3回話した')).toBeTruthy();
  });
});

describe('SpoilerNote (F14 AC2)', () => {
  it('blurs ||spans|| until tapped and keeps an unclosed || literal', async () => {
    const { user, container } = renderWithProviders(<SpoilerNote text={'犯人は||司書さん||だった\nメモ || 閉じていない'} />);
    const hidden = screen.getByRole('button', { name: '伏せ字（タップで表示）' });
    expect(hidden.querySelector('[aria-hidden="true"]')).toBeTruthy();
    expect(container.textContent).toContain('メモ || 閉じていない');
    await user.click(hidden);
    expect(screen.queryByRole('button', { name: '伏せ字（タップで表示）' })).toBeNull();
    expect(screen.getByText('司書さん').className).toContain('spn-open');
  });

  it('renders markup-looking text as plain text', () => {
    const { container } = renderWithProviders(<SpoilerNote text={'<b>太字</b> ||<img src=x>||'} />);
    expect(container.querySelector('b')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toContain('<b>太字</b>');
  });
});
