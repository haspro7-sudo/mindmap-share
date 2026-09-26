/**
 * DEV-ONLY visual harness for the shared UI components (not part of the app build).
 * Open http://localhost:<port>/scripts/e2e/harness.html on the Vite dev server. It renders the components
 * inside the real providers on an in-memory repository seeded with both demos (END 1 and END 4 redeemed),
 * so sheets, dialogs, toasts and the envelope queue can be screenshotted without any screen.
 */
import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../../src/ui/theme.css';
import { importBundledDemos } from '../../src/app/library';
import { submitCode } from '../../src/app/unlock';
import { DEFAULT_SETTINGS } from '../../src/core/types';
import { createMemoryRepo, createMemoryStudioRepo } from '../../src/storage/memoryRepo';
import type { ShioriRepo } from '../../src/storage/repo';
import { CodeInput } from '../../src/ui/components/CodeInput';
import { EmojiCover } from '../../src/ui/components/EmojiCover';
import { EmptyState } from '../../src/ui/components/EmptyState';
import { ExternalLinkButton } from '../../src/ui/components/ExternalLinkButton';
import { HoldToReveal } from '../../src/ui/components/HoldToReveal';
import { ProgressBar, ProgressRing } from '../../src/ui/components/Progress';
import { SealedReader } from '../../src/ui/components/SealedReader';
import { Sheet } from '../../src/ui/components/Sheet';
import { SpoilerNote } from '../../src/ui/components/SpoilerNote';
import { SpoilerText } from '../../src/ui/components/SpoilerText';
import { Tabs } from '../../src/ui/components/Tabs';
import { RepoContext, StudioRepoContext, useUi } from '../../src/ui/context';
import { Header } from '../../src/ui/shell/Header';
import { BottomNav } from '../../src/ui/shell/BottomNav';
import { SettingsProvider } from '../../src/ui/shell/SettingsProvider';
import { UiProvider } from '../../src/ui/shell/UiProvider';
import { NotFoundScreen } from '../../src/ui/screens/NotFound';

export function Gallery({ workId }: { workId: string }) {
  const ui = useUi();
  const [tab, setTab] = useState<'progress' | 'extras' | 'log' | 'notes'>('progress');
  const [code, setCode] = useState('');
  const [sheet, setSheet] = useState<'reader' | 'door' | null>(null);
  return (
    <div className="app has-nav" data-shell="app">
      <Header onHide={() => ui.toast('隠す（ハーネス）')} />
      <main className="screen stack">
        <div className="row">
          <EmojiCover emoji="📘" color="sky" size={56} />
          <div className="stack-sm" style={{ flex: 1, minWidth: 0 }}>
            <strong>サンプルA</strong>
            <ProgressBar pct={37.5} compact />
          </div>
          <ProgressRing pct={37.5} caption="3 / 8" size={72} />
        </div>
        <Tabs
          ariaLabel="作品の表示"
          value={tab}
          onChange={setTab}
          tabs={[
            { id: 'progress', label: '進捗' },
            { id: 'extras', label: 'おまけ', badge: 2 },
            { id: 'log', label: '記録' },
            { id: 'notes', label: 'メモ' },
          ]}
        />
        <ProgressBar pct={50} label="エンディング 2 / 4" />
        <div className="card stack-sm">
          <SpoilerText as="p" text="図書館のいちばん上で" spoiler={1} tolerance={1} />
          <SpoilerText as="p" text="天文台の望遠鏡を3回調べる" spoiler={2} tolerance={1} />
          <SpoilerNote text={'犯人は||司書さん||だった。\n次は||地下書庫||を調べる'} />
        </div>
        <div className="row-wrap">
          <HoldToReveal label="ヒント1を見る（長押し）" onReveal={() => ui.toast('ヒント1を表示しました', { tone: 'ok' })} />
          <HoldToReveal
            label="答えを見る（長押し）"
            confirm={{ title: '答えを表示します。よろしいですか？', okLabel: '表示する' }}
            onReveal={() => ui.toast('答えを表示しました')}
          />
          <HoldToReveal label="ヒント3を見る（長押し）" onReveal={() => undefined} disabled />
        </div>
        <label htmlFor="h-code" className="field-label">
          合言葉
        </label>
        <CodeInput id="h-code" value={code} onChange={setCode} onSubmit={() => ui.toast(`確かめる: ${code}`)} />
        <div className="row-wrap">
          <button type="button" className="btn" onClick={() => setSheet('reader')}>
            手紙を読む
          </button>
          <button type="button" className="btn" onClick={() => setSheet('door')}>
            返し合言葉
          </button>
          <button type="button" className="btn" onClick={() => ui.queueEnvelopes([{ workId, sealedId: 'letter-mina' }])}>
            封筒
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => ui.toast('「END 1」を達成にしました', { action: { label: '元に戻す', onClick: () => undefined } })}
          >
            トースト
          </button>
          <button type="button" className="btn" onClick={() => ui.toast('保存できませんでした', { tone: 'danger' })}>
            エラー
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => void ui.confirm({ title: '項目を削除しますか？', body: '達成の記録も消えます。', okLabel: '削除', danger: true })}
          >
            確認
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => void ui.prompt({ title: '名前を変える', label: '新しい名前', initialValue: 'END 1', validate: (v) => (v ? null : '名前を入力してください') })}
          >
            入力
          </button>
        </div>
        <ExternalLinkButton storeCode="RJ01234567" />
        <EmptyState icon="📚" title="まだ作品がありません" body="「＋ 追加」から始めましょう" />
        <NotFoundScreen />
      </main>
      <BottomNav />
      <Sheet open={sheet === 'reader'} onClose={() => setSheet(null)} title="司書ミナからの手紙" footer={<button type="button" className="btn" onClick={() => setSheet(null)}>閉じる</button>}>
        <SealedReader workId={workId} sealedId="letter-mina" />
      </Sheet>
      <Sheet open={sheet === 'door'} onClose={() => setSheet(null)} title="図書館の扉の合言葉">
        <SealedReader workId={workId} sealedId="door-code" />
      </Sheet>
    </div>
  );
}

async function main() {
  const params = new URLSearchParams(location.search);
  const repo: ShioriRepo = createMemoryRepo({
    fullSettings: {
      ageConfirmedAt: 1,
      onboardedAt: 1,
      discreet: { ...DEFAULT_SETTINGS.discreet, hideStoreLinks: false, blurExtras: params.has('blur') },
    },
  });
  const [hoshiyomi] = await importBundledDemos(repo);
  await submitCode(repo, 'ST4-RMA-P1X', { workId: hoshiyomi });
  await submitCode(repo, 'SK1-ES0-NGM', { workId: hoshiyomi });
  const initial = await repo.getSettings();
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <RepoContext.Provider value={repo}>
        <StudioRepoContext.Provider value={createMemoryStudioRepo()}>
          <SettingsProvider repo={repo} initial={initial}>
            <UiProvider onHide={() => undefined} onLock={() => undefined}>
              <Gallery workId={hoshiyomi!} />
            </UiProvider>
          </SettingsProvider>
        </StudioRepoContext.Provider>
      </RepoContext.Provider>
    </StrictMode>,
  );
}

void main();
