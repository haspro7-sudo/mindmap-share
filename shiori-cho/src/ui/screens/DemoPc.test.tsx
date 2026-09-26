// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { importBundledDemos } from '../../app/library';
import { parseCode } from '../../core/codes';
import { buildUnlockUrl } from '../../core/route';
import { DEFAULT_SETTINGS } from '../../core/types';
import { PC_SCENES, PC_WORK_ID } from '../../demo/pcScenes';
import { createMemoryRepo } from '../../storage/memoryRepo';
import { renderWithProviders } from '../../test/renderWithProviders';
import { qrSvgPath } from '../studio/qrPng';
import { DPC_INTRO, DemoPcScreen } from './DemoPc';

type User = ReturnType<typeof renderWithProviders>['user'];

const SHOW_TITLES = { discreet: { ...DEFAULT_SETTINGS.discreet, aliasOnly: false } };

/** Clicks 「次へ」 until the text box has no more lines. */
async function readAll(user: User): Promise<void> {
  for (let i = 0; i < 20; i++) {
    const next = screen.queryByRole('button', { name: /次へ/ });
    if (!next) return;
    await user.click(next);
  }
  throw new Error('text box never ended');
}

async function choose(user: User, label: string): Promise<void> {
  await readAll(user);
  await user.click(screen.getByRole('button', { name: label }));
}

describe('DemoPcScreen (PC画面シミュレータ, F17 AC3)', () => {
  beforeEach(() => {
    window.location.hash = '#/demo-pc';
  });

  it('shows the explanatory bar and the title screen', () => {
    renderWithProviders(<DemoPcScreen />, { settings: SHOW_TITLES });
    expect(screen.getByText(DPC_INTRO)).toBeTruthy();
    expect(screen.getByRole('link', { name: '本棚に戻る' }).getAttribute('href')).toBe('#/');
    expect(screen.getByRole('heading', { level: 2, name: '星読みの図書館' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'はじめから' })).toBeTruthy();
    expect(screen.getByLabelText(/扉の合言葉/)).toBeTruthy();
  });

  it('uses the alias for the game title in おしのびモード', () => {
    renderWithProviders(<DemoPcScreen />, {
      settings: { discreet: { ...DEFAULT_SETTINGS.discreet, aliasOnly: true } },
    });
    expect(screen.getByRole('heading', { level: 2, name: 'サンプルA' })).toBeTruthy();
    expect(screen.queryByText('星読みの図書館')).toBeNull();
  });

  it('reaches END 1 through the choices and shows its 合言葉, QR and same-device button', async () => {
    const { user } = renderWithProviders(<DemoPcScreen />, { settings: SHOW_TITLES });
    await user.click(screen.getByRole('button', { name: 'はじめから' }));
    expect(screen.getByRole('heading', { level: 2, name: '第1章　星の降る丘' })).toBeTruthy();
    // the name plate is split off the dialogue line
    await user.click(screen.getByRole('button', { name: /次へ/ }));
    await user.click(screen.getByRole('button', { name: /次へ/ }));
    expect(screen.getByText('ミナ')).toBeTruthy();

    await choose(user, '閲覧室へ行く');
    await choose(user, '書架の星図を調べる');
    await choose(user, '北・東・南の順に並べる');
    expect(screen.getByRole('heading', { level: 2, name: 'END 1「星図の果て」' })).toBeTruthy();
    // the code panel appears once the last line is shown
    expect(screen.queryByText('ST4-RMA-P1X')).toBeNull();
    await readAll(user);

    const panel = screen.getByRole('region', { name: 'しおり帳の合言葉：' });
    expect(within(panel).getByText('ST4-RMA-P1X')).toBeTruthy();
    // there is no in-app scanner: the QR is read with the phone's own camera
    expect(within(panel).getByText('スマホのカメラでQRを読み取るか、しおり帳の「合言葉」に入力してください。')).toBeTruthy();
    expect(within(panel).queryByText(/しおり帳でQRを読み取る/)).toBeNull();
    const qr = within(panel).getByRole('img', { name: '合言葉 ST4-RMA-P1X のQRコード' });
    const url = buildUnlockUrl(location.origin + location.pathname, PC_WORK_ID, 'b32:ST4RMAP1X');
    expect(qr.querySelector('path')?.getAttribute('d')).toBe(qrSvgPath(url).path);
    const enter = within(panel).getByRole('button', { name: 'この端末で入力する' });
    expect(document.activeElement).toBe(enter);
    await user.click(enter);
    expect(window.location.hash).toBe('#/u/demo-hoshiyomi/ST4RMAP1X');
  });

  it('has a parseable 合言葉 on every ending (the panel needs it for the QR and the deep link)', () => {
    const endings = Object.values(PC_SCENES).flatMap((s) => (s.ending ? [s.ending] : []));
    expect(endings.length).toBe(4);
    for (const e of endings) expect(parseCode(e.display).ok).toBe(true);
  });

  it('advances with Enter and moves focus to the choices', async () => {
    const { user } = renderWithProviders(<DemoPcScreen />, { settings: SHOW_TITLES });
    await user.click(screen.getByRole('button', { name: 'はじめから' }));
    const next = screen.getByRole('button', { name: /次へ/ });
    expect(document.activeElement).toBe(next);
    expect(screen.getByText('長い坂道をのぼりきると、古い図書館が見えてきました。')).toBeTruthy();
    await user.keyboard('{Enter}');
    expect(screen.getByText('重い扉を開けると、カウンターの司書が顔を上げます。')).toBeTruthy();
    await user.keyboard('{Enter}');
    const choice = screen.getByRole('button', { name: '閲覧室へ行く' });
    expect(document.activeElement).toBe(choice);
    await user.keyboard('{Enter}');
    expect(screen.getByRole('heading', { level: 2, name: '閲覧室' })).toBeTruthy();
  });

  it('opens the bonus scene with the door code ほしあかり', async () => {
    const { user } = renderWithProviders(<DemoPcScreen />, { settings: SHOW_TITLES });
    await user.type(screen.getByLabelText(/扉の合言葉/), 'ホシ アカリ');
    await user.click(screen.getByRole('button', { name: '唱える' }));
    expect(screen.getByRole('heading', { level: 2, name: '扉の向こう' })).toBeTruthy();
    expect(screen.getByText('合言葉を唱えると、図書館の扉が静かに開きました。')).toBeTruthy();
    await readAll(user);
    await user.click(screen.getByRole('button', { name: 'タイトルに戻る' }));
    expect(screen.getByRole('button', { name: 'はじめから' })).toBeTruthy();
  });

  it('keeps the door closed for a wrong code', async () => {
    const { user } = renderWithProviders(<DemoPcScreen />, { settings: SHOW_TITLES });
    const input = screen.getByLabelText(/扉の合言葉/);
    await user.type(input, 'ひらけごま{Enter}');
    const door = PC_SCENES['title']!.doorInput!;
    const msg = screen.getByText(door.wrongMessage);
    expect(msg.getAttribute('role')).toBe('status');
    expect(input.getAttribute('aria-describedby')).toBe(msg.id);
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(screen.queryByRole('heading', { name: '扉の向こう' })).toBeNull();
    expect(screen.getByRole('button', { name: 'はじめから' })).toBeTruthy();
    await user.type(input, 'あ');
    expect(msg.textContent).toBe('');
  });

  it('offers 「サンプルを本棚に入れる」 only while the demo is missing', async () => {
    const { user, repo } = renderWithProviders(<DemoPcScreen />, { settings: SHOW_TITLES });
    await user.click(await screen.findByRole('button', { name: 'サンプルを本棚に入れる' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'サンプルを本棚に入れる' })).toBeNull());
    expect(await screen.findByText('サンプルは本棚にあります')).toBeTruthy();
    expect(await repo.findWorkByManifestWorkId(PC_WORK_ID)).toBeTruthy();
  });

  it('hides the import button when the demo is already on the shelf', async () => {
    const repo = createMemoryRepo();
    await importBundledDemos(repo);
    renderWithProviders(<DemoPcScreen />, { repo, settings: SHOW_TITLES });
    expect(await screen.findByText('サンプルは本棚にあります')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'サンプルを本棚に入れる' })).toBeNull();
  });
});
