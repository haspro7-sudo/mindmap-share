// @vitest-environment jsdom
import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DISCLAIMER_JA } from '../../core/constants';
import { DEMO_CODES } from '../../demo/demoCodes';
import { renderWithProviders } from '../../test/renderWithProviders';
import { HelpScreen, LICENSES_HREF } from './Help';

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

  it('links the full third-party license notices from このアプリについて', () => {
    renderWithProviders(<HelpScreen section="about" />);
    const link = screen.getByRole('link', { name: /ライセンスの全文を見る/ });
    // same-origin static file (public/licenses.txt, checked by scripts/gen-licenses.test.ts), opened outside
    // the app window so an installed app is never left on a page without its navigation
    expect(link.getAttribute('href')).toBe('./licenses.txt');
    expect(LICENSES_HREF).toBe('./licenses.txt');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
    expect(screen.getByText(/Scheduler/)).toBeTruthy();
  });

  it('describes what is stored and what a QR address holds without overstating it', () => {
    renderWithProviders(<HelpScreen section="privacy" />);
    expect(screen.getByText(/IndexedDB/)).toBeTruthy();
    expect(screen.getByText(/タブを閉じると消える一時的な保存場所（sessionStorage）/)).toBeTruthy();
    expect(screen.getByText(/作品のID（作者が付けた識別子）と合言葉だけ/)).toBeTruthy();
    expect(screen.queryByText(/意味のない番号/)).toBeNull();
  });

  it('shows the disclaimer and defaults to 使い方', () => {
    renderWithProviders(<HelpScreen section="about" />);
    expect(screen.getByText(DISCLAIMER_JA)).toBeTruthy();
    renderWithProviders(<HelpScreen />);
    expect(screen.getByRole('heading', { level: 2, name: /使い方/ })).toBeTruthy();
  });
});
