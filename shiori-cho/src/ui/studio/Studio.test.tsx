// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { newStudioProject } from '../../app/studio';
import type { StudioProject } from '../../core/types';
import { createMemoryStudioRepo } from '../../storage/memoryRepo';
import type { StudioRepo } from '../../storage/repo';
import { renderWithProviders } from '../../test/renderWithProviders';
import { useRoute } from '../router';
import { PREVIEW_BANNER, StudioPreviewScreen } from './Preview';
import { StudioListScreen } from './StudioList';
import { StudioProjectScreen } from './StudioProject';
import { resetCheckStore } from './tabs/checkStore';
import { MSG_SECRET_BANNER } from './tabs/model';

const B32_DISPLAY_RE = /^[0-9A-Z]{3}-[0-9A-Z]{3}-[0-9A-Z]{3}$/;

/** Routes the studio screens like the app shell does (tab changes go through the hash). */
function Harness(): ReactNode {
  const route = useRoute();
  switch (route.name) {
    case 'studio':
      return <StudioListScreen />;
    case 'studioProject':
      return <StudioProjectScreen projectId={route.id} tab={route.tab} />;
    case 'studioPreview':
      return <StudioPreviewScreen projectId={route.id} />;
    default:
      return <p>other: {route.name}</p>;
  }
}

function go(hash: string): void {
  window.history.replaceState(null, '', `${window.location.pathname}${hash}`);
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}

/** A small, valid project: one code goal (b32) and one manual goal; 100k iterations keep the test fast. */
function smallProject(patch: Partial<StudioProject> = {}): StudioProject {
  const p = newStudioProject('https://example.com/shiori/', 1_700_000_000_000);
  return {
    ...p,
    work: { ...p.work, title: 'テストの物語', safeTitle: 'テストA', circle: 'テスト工房' },
    kdfIterations: 100_000,
    checkpoints: [
      { id: 'ch1', label: '第1章' },
      { id: 'ch2', label: '第2章' },
    ],
    groups: [
      { id: 'endings', label: 'エンディング' },
      { id: 'ach', label: '実績' },
    ],
    goals: [
      {
        id: 'end-a',
        group: 'endings',
        label: 'END 1',
        teaser: '丘の上で',
        spoiler: 1,
        hints: ['丘を見上げてみましょう', '夜に丘へ行きましょう', '夜に丘の上で空を見るとEND 1です'],
        unlockType: 'code',
        codeKind: 'b32',
        code: 'ST4-RMA-P1X',
        secret: { title: '星空の約束', description: '丘の上で星を見ました。', unlockMessage: 'おめでとうございます。' },
      },
      {
        id: 'ach-cat',
        group: 'ach',
        label: '猫と話した',
        spoiler: 0,
        hints: ['猫を探してみましょう'],
        unlockType: 'manual',
      },
    ],
    sealed: [
      {
        id: 'afterword',
        label: 'あとがき',
        teaser: 'END 1で開きます',
        kind: 'afterword',
        mode: 'allOf',
        goals: ['end-a'],
        payload: { title: 'あとがき', body: '遊んでくださりありがとうございました。', from: 'テスト工房' },
      },
    ],
    ...patch,
  };
}

async function seeded(project: StudioProject): Promise<StudioRepo> {
  const studioRepo = createMemoryStudioRepo();
  await studioRepo.put(project);
  return studioRepo;
}

beforeEach(() => {
  resetCheckStore();
});
afterEach(() => {
  go('');
});

describe('StudioList (F16 AC1)', () => {
  it('shows the secret banner and creates a new project', async () => {
    go('#/studio');
    const { user, studioRepo } = renderWithProviders(<Harness />);
    expect(screen.getByText(MSG_SECRET_BANNER)).toBeTruthy();
    expect(await screen.findByText('プロジェクトはまだありません')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: '＋ 新規作成' }));

    await waitFor(async () => expect(await studioRepo.list()).toHaveLength(1));
    const [created] = await studioRepo.list();
    expect(created!.work.id).toMatch(/^w-[0-9a-z]{10}$/);
    expect(created!.appUrl).not.toBe('');
    // navigated into the editor
    expect(await screen.findByRole('tablist', { name: '工房の編集項目' })).toBeTruthy();
    expect(window.location.hash).toBe(`#/studio/${created!.id}`);
  });

  it('opens the bundled sample as a copy', async () => {
    go('#/studio');
    const { user, studioRepo } = renderWithProviders(<Harness />, { settings: { discreet: { aliasOnly: false, blurOnHide: true, hideStoreLinks: true, blurExtras: false } } });
    await user.click(screen.getByRole('button', { name: 'サンプルを開く' }));
    await waitFor(async () => expect(await studioRepo.list()).toHaveLength(1));
    const [sample] = await studioRepo.list();
    expect(sample!.id).not.toBe('demo-project-hoshiyomi');
    expect(sample!.work.title).toBe('星読みの図書館');
    expect(sample!.goals.filter((g) => g.unlockType === 'code')).toHaveLength(4);
    expect(await screen.findByRole('heading', { level: 1, name: '星読みの図書館' })).toBeTruthy();
  });

  it('duplicates and deletes (with a confirmation)', async () => {
    const studioRepo = await seeded(smallProject());
    go('#/studio');
    const { user } = renderWithProviders(<Harness />, { studioRepo });
    // おしのびモード (default): the list shows the safe title
    await user.click(await screen.findByRole('button', { name: '「テストA」を複製' }));
    await waitFor(async () => expect(await studioRepo.list()).toHaveLength(2));
    const titles = (await studioRepo.list()).map((p) => p.work.title).sort();
    expect(titles).toEqual(['テストの物語', 'テストの物語（コピー）']);

    const deleteButtons = await screen.findAllByRole('button', { name: '「テストA」を削除' });
    await user.click(deleteButtons[0]!);
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: '削除' }));
    await waitFor(async () => expect(await studioRepo.list()).toHaveLength(1));
  });
});

describe('StudioProject editor (F16 AC2)', () => {
  it('adds a code goal with a generated code and autosaves it', async () => {
    const project = newStudioProject('https://example.com/', 1_700_000_000_000);
    const studioRepo = await seeded(project);
    go(`#/studio/${project.id}?tab=goals`);
    const { user } = renderWithProviders(<Harness />, { studioRepo });

    await user.click(await screen.findByRole('button', { name: '＋ 合言葉つきの目標' }));
    const code = await screen.findByLabelText(/^合言葉 /);
    const shown = code.textContent ?? '';
    expect(shown).toMatch(B32_DISPLAY_RE);
    expect(screen.getByText(/ヒントは/)).toBeTruthy();

    await waitFor(
      async () => {
        const saved = await studioRepo.get(project.id);
        expect(saved!.goals).toHaveLength(1);
        expect(saved!.goals[0]!.unlockType).toBe('code');
        expect(saved!.goals[0]!.code).toBe(shown);
        expect(saved!.updatedAt).toBeGreaterThan(project.updatedAt);
      },
      { timeout: 3000 },
    );
    expect(await screen.findByText('保存済み')).toBeTruthy();

    // 「作り直す」 gives a different code (no warning before the first export)
    await user.click(screen.getByRole('button', { name: '作り直す' }));
    await waitFor(() => expect(screen.getByLabelText(/^合言葉 /).textContent).not.toBe(shown));
    expect(screen.getByLabelText(/^合言葉 /).textContent).toMatch(B32_DISPLAY_RE);
  });

  it('warns before regenerating a code after the first export', async () => {
    const project = smallProject({ lastExportedAt: 1_700_000_100_000 });
    const studioRepo = await seeded(project);
    go(`#/studio/${project.id}?tab=goals`);
    const { user } = renderWithProviders(<Harness />, { studioRepo });

    await user.click(await screen.findByRole('button', { name: /^END 1.*を編集$/ }));
    await user.click(screen.getByRole('button', { name: '作り直す' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('発売済みの作品では合言葉を変えないでください')).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: 'キャンセル' }));
    expect(screen.getByLabelText(/^合言葉 /).textContent).toBe('ST4-RMA-P1X');
  });
});

describe('点検 and 書き出し (F16 AC3)', () => {
  it('checks a small valid project: exportable, salt kept, export enabled after acknowledging warnings', async () => {
    const project = smallProject();
    const studioRepo = await seeded(project);
    go(`#/studio/${project.id}?tab=check`);
    const { user } = renderWithProviders(<Harness />, { studioRepo });

    await user.click(await screen.findByRole('button', { name: '点検する' }));
    expect(await screen.findByText('書き出せます', {}, { timeout: 15_000 })).toBeTruthy();
    expect(screen.getByText(/公開用のしおりファイルに、合言葉や秘密の内容は含まれていません/)).toBeTruthy();
    // the salt of the first build is stored (not an edit: updatedAt unchanged)
    await waitFor(async () => {
      const saved = await studioRepo.get(project.id);
      expect(saved!.kdfSalt).toMatch(/^[A-Za-z0-9_-]{22}$/);
      expect(saved!.updatedAt).toBe(project.updatedAt);
    });

    await user.click(screen.getByRole('tab', { name: '書き出し' }));
    const kit = await screen.findByRole('button', { name: /キットをダウンロード/ });
    // 100k iterations → a warning that must be acknowledged first
    expect((kit as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByRole('checkbox', { name: '注意の内容を確認しました' }));
    await waitFor(() => expect((screen.getByRole('button', { name: /キットをダウンロード/ }) as HTMLButtonElement).disabled).toBe(false));
    expect((screen.getByRole('button', { name: /shiori\.json だけ/ }) as HTMLButtonElement).disabled).toBe(false);
    // code sheet with the QR for on-screen checking
    expect(screen.getByRole('img', { name: '「END 1」の合言葉のQRコード' })).toBeTruthy();
  }, 30_000);

  it('keeps export disabled when the check has errors', async () => {
    const base = smallProject();
    const broken = smallProject({
      goals: base.goals.map((g) => (g.id === 'end-a' ? { ...g, secret: undefined } : g)),
    });
    const studioRepo = await seeded(broken);
    go(`#/studio/${broken.id}?tab=check`);
    const { user } = renderWithProviders(<Harness />, { studioRepo });

    await user.click(await screen.findByRole('button', { name: '点検する' }));
    expect(await screen.findByText(/エラーが\d+件あります/, {}, { timeout: 15_000 })).toBeTruthy();
    expect(screen.getAllByText(/秘密タイトルを入力してください/).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: '書き出しへ進む' })).toBeNull();

    await user.click(screen.getByRole('tab', { name: '書き出し' }));
    expect(await screen.findByText(/点検でエラーが見つかりました/)).toBeTruthy();
    expect((screen.getByRole('button', { name: /キットをダウンロード/ }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: /shiori\.json だけ/ }) as HTMLButtonElement).disabled).toBe(true);
    // the project backup is always available
    expect((screen.getByRole('button', { name: /プロジェクトの控え/ }) as HTMLButtonElement).disabled).toBe(false);
  }, 30_000);

  it('makes the last check stale after an edit', async () => {
    const project = smallProject({ kdfIterations: 200_000 });
    const studioRepo = await seeded(project);
    go(`#/studio/${project.id}?tab=check`);
    const { user } = renderWithProviders(<Harness />, { studioRepo });
    await user.click(await screen.findByRole('button', { name: '点検する' }));
    expect(await screen.findByText('書き出せます', {}, { timeout: 15_000 })).toBeTruthy();

    await user.click(screen.getByRole('tab', { name: '作品' }));
    const version = await screen.findByLabelText(/^バージョン/);
    await user.clear(version);
    await user.type(version, '1.0.1');
    await user.click(screen.getByRole('tab', { name: '書き出し' }));
    expect(await screen.findByText(/点検のあとで内容が変わりました/)).toBeTruthy();
    expect((screen.getByRole('button', { name: /キットをダウンロード/ }) as HTMLButtonElement).disabled).toBe(true);
  }, 30_000);
});

describe('Preview (F16 AC5)', () => {
  it('renders the built work on a memory repository and redeems a code there', async () => {
    const project = smallProject();
    const studioRepo = await seeded(project);
    go(`#/studio/${project.id}/preview`);
    const { user, repo } = renderWithProviders(<Harness />, { studioRepo });

    expect(await screen.findByText(PREVIEW_BANNER, {}, { timeout: 15_000 })).toBeTruthy();
    expect(await screen.findByRole('heading', { level: 1, name: 'テストA' })).toBeTruthy();
    expect(await screen.findByText('猫と話した')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: '「END 1」の合言葉を入れる' }));
    expect(await screen.findByText('解放しました：星空の約束', {}, { timeout: 10_000 })).toBeTruthy();
    // nothing reaches the app's repository
    expect(await repo.listWorks()).toHaveLength(0);
  }, 30_000);
});
