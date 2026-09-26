// @vitest-environment jsdom
import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DISCLAIMER_JA } from '../../core/constants';
import { DEMO_CODES } from '../../demo/demoCodes';
import { renderWithProviders } from '../../test/renderWithProviders';
import { HelpScreen } from './Help';

describe('HelpScreen (ヘルプ, F19)', () => {
  it('links every section and marks the current one', () => {
    renderWithProviders(<HelpScreen section="ios" />);
    const nav = screen.getByRole('navigation', { name: 'ヘルプの項目' });
    const links = within(nav).getAllByRole('link');
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      '#/help/usage',
      '#/help/demo-codes',
      '#/help/ios',
      '#/help/creators',
      '#/help/privacy',
      '#/help/about',
    ]);
    expect(within(nav).getByRole('link', { name: /iOSでの注意/ }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('heading', { level: 2, name: /iOSでの注意/ })).toBeTruthy();
    expect(screen.getByText('Safariとホーム画面では保存場所が別々です')).toBeTruthy();
  });

  it('lists every demo code with aliases in discreet mode (F17 AC2)', () => {
    renderWithProviders(<HelpScreen section="demo-codes" />, { settings: { discreet: { aliasOnly: true, blurOnHide: true, hideStoreLinks: true, blurExtras: false } } });
    const table = screen.getByRole('table');
    for (const c of DEMO_CODES) expect(within(table).getByText(c.display)).toBeTruthy();
    expect(within(table).queryByText('星読みの図書館')).toBeNull();
    expect(within(table).getAllByText('サンプルA').length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: 'PC画面シミュレータを開く' }).getAttribute('href')).toBe('#/demo-pc');
  });

  it('shows the disclaimer and defaults to 使い方', () => {
    renderWithProviders(<HelpScreen section="about" />);
    expect(screen.getByText(DISCLAIMER_JA)).toBeTruthy();
    renderWithProviders(<HelpScreen />);
    expect(screen.getByRole('heading', { level: 2, name: /使い方/ })).toBeTruthy();
  });
});
